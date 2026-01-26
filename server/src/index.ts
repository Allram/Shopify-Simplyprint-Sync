import cors from "cors";
import crypto from "crypto";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT ?? 4000);

const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const SHOPIFY_APP_API_KEY = process.env.SHOPIFY_APP_API_KEY;
const SHOPIFY_APP_API_SECRET = process.env.SHOPIFY_APP_API_SECRET;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;
const SHOPIFY_APP_SCOPES =
  process.env.SHOPIFY_APP_SCOPES ?? "read_products,read_orders";
const SHOPIFY_APP_ACCESS_TOKEN = process.env.SHOPIFY_APP_ACCESS_TOKEN;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2023-10";
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

const SIMPLYPRINT_COMPANY_ID = process.env.SIMPLYPRINT_COMPANY_ID;
const SIMPLYPRINT_API_KEY = process.env.SIMPLYPRINT_API_KEY;
const SIMPLYPRINT_QUEUE_GROUP_NAME =
  process.env.SIMPLYPRINT_QUEUE_GROUP_NAME ?? "Shopify";

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use((req: Request, res: Response, next: express.NextFunction) => {
  if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
    return next();
  }

  if (
    req.path.startsWith("/api/webhooks/shopify") ||
    req.path === "/api/health"
  ) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", "Basic");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const decoded = Buffer.from(header.split(" ")[1], "base64")
    .toString("utf8")
    .split(":");
  const [user, pass] = decoded;

  if (user !== BASIC_AUTH_USER || pass !== BASIC_AUTH_PASS) {
    res.setHeader("WWW-Authenticate", "Basic");
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
});

app.post(
  "/api/webhooks/shopify/orders/create",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      console.log("Shopify webhook received");
      if (SHOPIFY_WEBHOOK_SECRET) {
        const hmac = req.header("X-Shopify-Hmac-Sha256") ?? "";
        const digest = crypto
          .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
          .update(req.body)
          .digest("base64");

        const hmacBuffer = Buffer.from(hmac, "utf8");
        const digestBuffer = Buffer.from(digest, "utf8");

        if (
          hmacBuffer.length !== digestBuffer.length ||
          !crypto.timingSafeEqual(hmacBuffer, digestBuffer)
        ) {
          return res.status(401).json({ error: "Invalid webhook signature" });
        }
      }

      const payload = JSON.parse(req.body.toString("utf8"));
      const orderId = String(payload?.id ?? "");
      const orderName = payload?.name ? String(payload.name) : null;
      console.log(
        "Order",
        orderId || "unknown",
        "Line items",
        payload?.line_items?.length ?? 0
      );
      const lineItems = Array.isArray(payload?.line_items)
        ? payload.line_items
        : [];

      for (const item of lineItems) {
        const productId = String(item?.product_id ?? "");
        const variantId = item?.variant_id ? String(item.variant_id) : null;
        const quantity = Number(item?.quantity ?? 1);

        if (!productId) {
          console.log("Skipped line item without product_id");
          continue;
        }

        const mapping = await findMapping(productId, variantId);
        if (!mapping) {
          console.log(
            "No mapping found",
            JSON.stringify({ productId, variantId, sku: item?.sku ?? null })
          );
          if (orderId) {
            await recordUnmatchedLineItem({
              orderId,
              orderName,
              productId,
              variantId,
              sku: item?.sku ? String(item.sku) : null,
              quantity,
              reason: "No mapping found",
            });
          }
          continue;
        }

        if (mapping.skipQueue) {
          console.log(
            "Skipping queue for product",
            JSON.stringify({ productId, variantId, sku: item?.sku ?? null })
          );
          continue;
        }

        const filesToQueue = normalizeMappingFiles(mapping);

        for (const fileName of filesToQueue) {
          console.log(
            "Queueing file",
            JSON.stringify({
              file: fileName,
              productId,
              variantId,
              quantity,
            })
          );
          try {
            await addToSimplyPrintQueue(fileName, quantity);
          } catch (error) {
            console.error("Failed to queue file", error);
            if (orderId) {
              await recordUnmatchedLineItem({
                orderId,
                orderName,
                productId,
                variantId,
                sku: item?.sku ? String(item.sku) : null,
                quantity,
                reason: "Queueing failed",
              });
            }
          }
        }
      }

      return res.status(200).json({ status: "ok" });
    } catch (error) {
      console.error("Webhook processing failed", error);
      return res.status(200).json({ status: "error" });
    }
  }
);

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/shopify/auth", async (req: Request, res: Response) => {
  try {
    if (!SHOPIFY_APP_API_KEY || !SHOPIFY_APP_API_SECRET || !SHOPIFY_APP_URL) {
      return res.status(500).json({ error: "Shopify app credentials missing" });
    }

    const shopFromQuery = req.query.shop ? String(req.query.shop) : "";
    const shop = shopFromQuery || SHOPIFY_SHOP_DOMAIN || "";
    if (!shop) {
      return res.status(400).json({ error: "Missing shop domain" });
    }

    if (SHOPIFY_SHOP_DOMAIN && shop !== SHOPIFY_SHOP_DOMAIN) {
      return res.status(400).json({ error: "Shop domain mismatch" });
    }

    const appUrl = SHOPIFY_APP_URL.replace(/\/+$/, "");
    const redirectUri = `${appUrl}/api/shopify/callback`;
    const state = crypto.randomBytes(16).toString("hex");

    await prisma.setting.upsert({
      where: { key: "shopifyOauthState" },
      update: { value: state },
      create: { key: "shopifyOauthState", value: state },
    });

    const authorizeUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(SHOPIFY_APP_API_KEY)}` +
      `&scope=${encodeURIComponent(SHOPIFY_APP_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    return res.redirect(authorizeUrl);
  } catch (error) {
    console.error("Failed to start Shopify OAuth", error);
    return res.status(500).json({ error: "Failed to start Shopify OAuth" });
  }
});

app.get("/api/shopify/callback", async (req: Request, res: Response) => {
  try {
    if (!SHOPIFY_APP_API_KEY || !SHOPIFY_APP_API_SECRET || !SHOPIFY_APP_URL) {
      return res.status(500).json({ error: "Shopify app credentials missing" });
    }

    const shop = req.query.shop ? String(req.query.shop) : "";
    const code = req.query.code ? String(req.query.code) : "";
    const state = req.query.state ? String(req.query.state) : "";
    const hmac = req.query.hmac ? String(req.query.hmac) : "";

    if (!shop || !code || !state || !hmac) {
      return res.status(400).json({ error: "Missing OAuth parameters" });
    }

    if (SHOPIFY_SHOP_DOMAIN && shop !== SHOPIFY_SHOP_DOMAIN) {
      return res.status(400).json({ error: "Shop domain mismatch" });
    }

    const storedState = await prisma.setting.findUnique({
      where: { key: "shopifyOauthState" },
    });

    if (!storedState?.value || storedState.value !== state) {
      return res.status(401).json({ error: "Invalid OAuth state" });
    }

    if (!verifyShopifyHmac(req.query, SHOPIFY_APP_API_SECRET)) {
      return res.status(401).json({ error: "Invalid OAuth signature" });
    }

    const tokenUrl = `https://${shop}/admin/oauth/access_token`;
    const tokenResponse = await axios.post(tokenUrl, {
      client_id: SHOPIFY_APP_API_KEY,
      client_secret: SHOPIFY_APP_API_SECRET,
      code,
    });

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      return res.status(500).json({ error: "Missing access token" });
    }

    await prisma.setting.upsert({
      where: { key: "shopifyAccessToken" },
      update: { value: accessToken },
      create: { key: "shopifyAccessToken", value: accessToken },
    });

    const appUrl = SHOPIFY_APP_URL.replace(/\/+$/, "");
    return res.redirect(appUrl);
  } catch (error) {
    console.error("Shopify OAuth callback failed", error);
    return res.status(500).json({ error: "Shopify OAuth failed" });
  }
});

app.get("/api/shopify/products", async (_req: Request, res: Response) => {
  try {
    const { shopDomain, accessToken } = await ensureShopifyEnv();

    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`;
    const response = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
      params: {
        limit: 250,
        status: "active",
      },
    });

    const products = (response.data?.products ?? []).map((product: any) => ({
      id: String(product.id),
      title: product.title,
      variants: (product.variants ?? []).map((variant: any) => ({
        id: String(variant.id),
        title: variant.title,
        sku: variant.sku,
      })),
    }));

    res.json({ products });
  } catch (error) {
    console.error("Failed to fetch Shopify products", error);
    res.status(500).json({ error: "Failed to fetch Shopify products" });
  }
});

app.get("/api/mappings", async (_req: Request, res: Response) => {
  const mappings = await prisma.mapping.findMany({
    orderBy: [{ shopifyProductId: "asc" }, { shopifyVariantId: "asc" }],
  });
  res.json({ mappings });
});

app.get("/api/products/hidden", async (_req: Request, res: Response) => {
  const hidden = await prisma.hiddenProduct.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json({ hidden });
});

const hiddenProductSchema = z.object({
  productId: z.string().min(1),
});

app.post("/api/products/hidden", async (req: Request, res: Response) => {
  try {
    const { productId } = hiddenProductSchema.parse(req.body);
    const record = await prisma.hiddenProduct.upsert({
      where: { shopifyProductId: productId },
      update: {},
      create: { shopifyProductId: productId },
    });
    res.json({ hidden: record });
  } catch (error) {
    console.error("Failed to hide product", error);
    res.status(400).json({ error: "Invalid product id" });
  }
});

app.delete(
  "/api/products/hidden/:productId",
  async (req: Request, res: Response) => {
    const productId = String(req.params.productId ?? "");
    if (!productId) {
      return res.status(400).json({ error: "Invalid product id" });
    }

    await prisma.hiddenProduct
      .delete({ where: { shopifyProductId: productId } })
      .catch(() => undefined);

    return res.json({ status: "deleted" });
  }
);

const mappingSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  fileName: z.string().min(1).optional(),
  fileNames: z.array(z.string().min(1)).optional(),
  skipQueue: z.boolean().optional(),
});

app.post("/api/mappings", async (req: Request, res: Response) => {
  try {
    const { productId, variantId, fileName, fileNames, skipQueue } =
      mappingSchema.parse(req.body);
    const normalizedVariantId = variantId ?? null;
    const normalizedFiles = (fileNames ?? (fileName ? [fileName] : [])).filter(
      (name: string) => name.trim().length > 0
    );

    const existing = await prisma.mapping.findFirst({
      where: {
        shopifyProductId: productId,
        shopifyVariantId: normalizedVariantId,
      },
    });

    if (normalizedFiles.length === 0) {
      if (skipQueue !== undefined) {
        if (existing) {
          const mapping = await prisma.mapping.update({
            where: { id: existing.id },
            data: { skipQueue },
          });
          return res.json({ mapping });
        }

        if (skipQueue) {
          const mapping = await prisma.mapping.create({
            data: {
              shopifyProductId: productId,
              shopifyVariantId: normalizedVariantId,
              skipQueue: true,
            },
          });
          return res.json({ mapping });
        }
      }

      return res.status(400).json({ error: "At least one file is required" });
    }

    const serializedFiles = JSON.stringify(normalizedFiles);
    const mapping = existing
      ? await prisma.mapping.update({
          where: { id: existing.id },
          data: {
            simplyprintFileNames: serializedFiles,
            simplyprintFileName: normalizedFiles[0],
            skipQueue: skipQueue ?? existing.skipQueue,
          },
        })
      : await prisma.mapping.create({
          data: {
            shopifyProductId: productId,
            shopifyVariantId: normalizedVariantId,
            simplyprintFileNames: serializedFiles,
            simplyprintFileName: normalizedFiles[0],
            skipQueue: skipQueue ?? false,
          },
        });

    res.json({ mapping });
  } catch (error) {
    console.error("Failed to save mapping", error);
    res.status(400).json({ error: "Invalid mapping payload" });
  }
});

app.delete("/api/mappings/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid mapping id" });
  }

  await prisma.mapping.delete({ where: { id } });
  return res.json({ status: "deleted" });
});

app.get("/api/simplyprint/files", async (req: Request, res: Response) => {
  try {
    ensureSimplyPrintEnv();
    const search = String(req.query.search ?? "").trim();

    const response = await axios.get(`${simplyPrintBaseUrl()}/files/GetFiles`, {
      headers: {
        "X-API-KEY": SIMPLYPRINT_API_KEY,
      },
      params: {
        search: search || undefined,
        global_search: true,
      },
    });

    const files = (response.data?.files ?? []).map((file: any) => ({
      id: file.id,
      name: file.name,
      ext: file.ext,
      type: file.type,
      fullName: file.ext ? `${file.name}.${file.ext}` : file.name,
    }));

    res.json({ files });
  } catch (error) {
    console.error("Failed to fetch SimplyPrint files", error);
    res.status(500).json({ error: "Failed to fetch SimplyPrint files" });
  }
});

const testQueueSchema = z.object({
  fileNames: z.array(z.string().min(1)),
  quantity: z.number().int().positive().optional().default(1),
  dryRun: z.boolean().optional().default(false),
});

app.post("/api/simplyprint/test-queue", async (req: Request, res: Response) => {
  try {
    ensureSimplyPrintEnv();
    const { fileNames, quantity, dryRun } = testQueueSchema.parse(req.body);

    await getQueueGroupId();

    const results = [] as {
      fileName: string;
      status: "ok" | "error";
      message?: string;
    }[];

    for (const fileName of fileNames) {
      try {
        const fileId = await resolveSimplyPrintFileId(fileName);
        if (!dryRun) {
          const groupId = await getQueueGroupId();
          await axios.post(
            `${simplyPrintBaseUrl()}/queue/AddItem`,
            {
              filesystem: fileId,
              amount: quantity,
              group: groupId,
            },
            {
              headers: {
                "X-API-KEY": SIMPLYPRINT_API_KEY,
              },
            }
          );
        }

        results.push({ fileName, status: "ok" });
      } catch (error: any) {
        results.push({
          fileName,
          status: "error",
          message: error?.message ?? "Failed to validate file",
        });
      }
    }

    return res.json({ results });
  } catch (error) {
    console.error("Failed to test queue", error);
    return res.status(400).json({ error: "Failed to test queue" });
  }
});

app.get("/api/simplyprint/suggest", async (req: Request, res: Response) => {
  try {
    ensureSimplyPrintEnv();
    const query = String(req.query.query ?? "").trim();
    if (!query) {
      return res.json({ files: [] });
    }

    const normalizedQuery = normalizeText(query);
    const tokens = Array.from(
      new Set(
        normalizedQuery
          .split(" ")
          .filter((token) => token.length > 2)
          .slice(0, 4)
      )
    );

    if (tokens.length === 0) {
      return res.json({ files: [] });
    }

    const responses = await Promise.all(
      tokens.map((token) =>
        axios.get(`${simplyPrintBaseUrl()}/files/GetFiles`, {
          headers: {
            "X-API-KEY": SIMPLYPRINT_API_KEY,
          },
          params: {
            search: token,
            global_search: true,
          },
        })
      )
    );

    const files = responses.flatMap(
      (response: any) => response.data?.files ?? []
    );
    const seen = new Set<string>();
    const uniqueFiles = files.filter((file: any) => {
      const key = String(file.id ?? file.name);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const scored = uniqueFiles
      .map((file: any) => {
        const fullName = file.ext ? `${file.name}.${file.ext}` : file.name;
        const score = scoreMatch(normalizedQuery, fullName);
        return {
          id: file.id,
          name: file.name,
          ext: file.ext,
          fullName,
          score,
        };
      })
      .filter((item: any) => item.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 8);

    return res.json({ files: scored });
  } catch (error) {
    console.error("Failed to suggest SimplyPrint files", error);
    res.status(500).json({ error: "Failed to suggest SimplyPrint files" });
  }
});

app.get("/api/simplyprint/queue-groups", async (_req: Request, res: Response) => {
  try {
    ensureSimplyPrintEnv();
    const response = await axios.get(`${simplyPrintBaseUrl()}/queue/groups/Get`, {
      headers: {
        "X-API-KEY": SIMPLYPRINT_API_KEY,
      },
    });

    res.json({ groups: response.data?.list ?? [] });
  } catch (error) {
    console.error("Failed to fetch SimplyPrint queue groups", error);
    res.status(500).json({ error: "Failed to fetch SimplyPrint queue groups" });
  }
});

app.get("/api/unmatched", async (_req: Request, res: Response) => {
  const items = await prisma.unmatchedLineItem.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json({ items });
});

const unmatchedQueueSchema = z.object({
  fileName: z.string().min(1),
  saveMapping: z.boolean().optional().default(false),
});

app.post("/api/unmatched/:id/queue", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid unmatched id" });
    }

    const payload = unmatchedQueueSchema.parse(req.body);
    const item = await prisma.unmatchedLineItem.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ error: "Unmatched item not found" });
    }

    if (payload.saveMapping) {
      const existing = await prisma.mapping.findFirst({
        where: {
          shopifyProductId: item.shopifyProductId,
          shopifyVariantId: item.shopifyVariantId,
        },
      });

      if (existing) {
        await prisma.mapping.update({
          where: { id: existing.id },
          data: {
            simplyprintFileName: payload.fileName,
            simplyprintFileNames: JSON.stringify([payload.fileName]),
          },
        });
      } else {
        await prisma.mapping.create({
          data: {
            shopifyProductId: item.shopifyProductId,
            shopifyVariantId: item.shopifyVariantId,
            simplyprintFileName: payload.fileName,
            simplyprintFileNames: JSON.stringify([payload.fileName]),
          },
        });
      }
    }

    await addToSimplyPrintQueue(payload.fileName, item.quantity);
    await prisma.unmatchedLineItem.update({
      where: { id },
      data: { queuedAt: new Date(), reason: "Queued manually" },
    });

    res.json({ status: "queued" });
  } catch (error) {
    console.error("Failed to queue unmatched item", error);
    res.status(400).json({ error: "Failed to queue unmatched item" });
  }
});

app.delete("/api/unmatched/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid unmatched id" });
  }
  await prisma.unmatchedLineItem.delete({ where: { id } });
  return res.json({ status: "deleted" });
});

app.get("/api/settings/queue-group", async (_req: Request, res: Response) => {
  const setting = await prisma.setting.findUnique({
    where: { key: "simplyprintQueueGroupId" },
  });
  const groupId = setting?.value ? Number(setting.value) : null;
  res.json({ groupId: Number.isFinite(groupId) ? groupId : null });
});

const queueGroupSchema = z.object({
  groupId: z.number().nullable(),
});

app.post("/api/settings/queue-group", async (req: Request, res: Response) => {
  try {
    const { groupId } = queueGroupSchema.parse(req.body);

    if (groupId === null) {
      await prisma.setting.delete({
        where: { key: "simplyprintQueueGroupId" },
      }).catch(() => undefined);
      cachedQueueGroupId = null;
      cachedQueueGroupAt = 0;
      return res.json({ groupId: null });
    }

    const setting = await prisma.setting.upsert({
      where: { key: "simplyprintQueueGroupId" },
      update: { value: String(groupId) },
      create: { key: "simplyprintQueueGroupId", value: String(groupId) },
    });

    cachedQueueGroupId = groupId;
    cachedQueueGroupAt = Date.now();
    res.json({ groupId: Number(setting.value) });
  } catch (error) {
    console.error("Failed to save queue group setting", error);
    res.status(400).json({ error: "Invalid queue group setting" });
  }
});

const webDistPath = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

async function ensureShopifyEnv() {
  if (!SHOPIFY_SHOP_DOMAIN) {
    throw new Error("Shopify shop domain is missing");
  }

  const accessToken = await resolveShopifyAccessToken();
  if (!accessToken) {
    throw new Error("Shopify access token is missing");
  }

  return { shopDomain: SHOPIFY_SHOP_DOMAIN, accessToken };
}

async function resolveShopifyAccessToken(): Promise<string | null> {
  if (SHOPIFY_ADMIN_API_TOKEN) {
    return SHOPIFY_ADMIN_API_TOKEN;
  }

  if (SHOPIFY_APP_ACCESS_TOKEN) {
    return SHOPIFY_APP_ACCESS_TOKEN;
  }

  const setting = await prisma.setting.findUnique({
    where: { key: "shopifyAccessToken" },
  });

  return setting?.value ?? null;
}

function verifyShopifyHmac(
  query: Request["query"],
  secret: string
): boolean {
  const provided = query.hmac ? String(query.hmac) : "";
  if (!provided) {
    return false;
  }

  const params = new URLSearchParams();
  Object.keys(query)
    .sort()
    .forEach((key) => {
      if (key === "hmac" || key === "signature") {
        return;
      }
      const value = query[key];
      if (Array.isArray(value)) {
        params.append(key, value.join(","));
      } else if (value !== undefined) {
        params.append(key, String(value));
      }
    });

  const message = params.toString();
  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const digestBuffer = Buffer.from(digest, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (digestBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, providedBuffer);
}

function ensureSimplyPrintEnv() {
  if (!SIMPLYPRINT_COMPANY_ID || !SIMPLYPRINT_API_KEY) {
    throw new Error("SimplyPrint environment variables are missing");
  }
}

function simplyPrintBaseUrl() {
  return `https://api.simplyprint.io/${SIMPLYPRINT_COMPANY_ID}`;
}

async function findMapping(productId: string, variantId: string | null) {
  if (variantId) {
    const variantMatch = await prisma.mapping.findFirst({
      where: {
        shopifyProductId: productId,
        shopifyVariantId: variantId,
      },
    });

    if (variantMatch) {
      return variantMatch;
    }
  }

  return prisma.mapping.findFirst({
    where: {
      shopifyProductId: productId,
      shopifyVariantId: null,
    },
  });
}

async function recordUnmatchedLineItem(input: {
  orderId: string;
  orderName: string | null;
  productId: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  reason: string;
}) {
  await prisma.unmatchedLineItem.create({
    data: {
      orderId: input.orderId,
      orderName: input.orderName,
      shopifyProductId: input.productId,
      shopifyVariantId: input.variantId,
      sku: input.sku,
      quantity: input.quantity,
      reason: input.reason,
    },
  });
}

function normalizeMappingFiles(mapping: any): string[] {
  let files: string[] = [];
  if (typeof mapping?.simplyprintFileNames === "string") {
    try {
      const parsed = JSON.parse(mapping.simplyprintFileNames);
      if (Array.isArray(parsed)) {
        files = parsed.map((name) => String(name));
      }
    } catch {
      files = [];
    }
  }

  const legacy = mapping?.simplyprintFileName
    ? [String(mapping.simplyprintFileName)]
    : [];

  const merged = [...files, ...legacy]
    .map((name) => String(name).trim())
    .filter((name) => name.length > 0);

  const seen = new Set<string>();
  return merged.filter((name) => {
    const key = normalizeText(name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

let cachedQueueGroupId: number | null = null;
let cachedQueueGroupAt = 0;

async function getQueueGroupId() {
  if (cachedQueueGroupId !== null && Date.now() - cachedQueueGroupAt < 5 * 60_000) {
    return cachedQueueGroupId;
  }

  const setting = await prisma.setting.findUnique({
    where: { key: "simplyprintQueueGroupId" },
  });
  const savedGroupId = setting?.value ? Number(setting.value) : null;
  if (savedGroupId && Number.isFinite(savedGroupId)) {
    cachedQueueGroupId = savedGroupId;
    cachedQueueGroupAt = Date.now();
    return cachedQueueGroupId;
  }

  const response = await axios.get(`${simplyPrintBaseUrl()}/queue/groups/Get`, {
    headers: {
      "X-API-KEY": SIMPLYPRINT_API_KEY,
    },
  });

  const groups = response.data?.list ?? [];
  const match = groups.find(
    (group: any) =>
      String(group.name).toLowerCase() ===
      SIMPLYPRINT_QUEUE_GROUP_NAME.toLowerCase()
  );

  cachedQueueGroupId = match?.id ?? 0;
  cachedQueueGroupAt = Date.now();
  return cachedQueueGroupId;
}

async function addToSimplyPrintQueue(fileName: string, amount: number) {
  ensureSimplyPrintEnv();

  const fileId = await resolveSimplyPrintFileId(fileName);
  const groupId = await getQueueGroupId();

  await axios.post(
    `${simplyPrintBaseUrl()}/queue/AddItem`,
    {
      filesystem: fileId,
      amount,
      group: groupId,
    },
    {
      headers: {
        "X-API-KEY": SIMPLYPRINT_API_KEY,
      },
    }
  );
}

async function resolveSimplyPrintFileId(fileName: string) {
  const searchAttempts = buildSearchQueries(fileName);
  const targetNormalized = normalizeText(fileName);

  for (const search of searchAttempts) {
    const response = await axios.get(`${simplyPrintBaseUrl()}/files/GetFiles`, {
      headers: {
        "X-API-KEY": SIMPLYPRINT_API_KEY,
      },
      params: {
        search,
        global_search: true,
      },
    });

    const files = response.data?.files ?? [];
    const match = files.find((file: any) => {
      const fullName = file.ext ? `${file.name}.${file.ext}` : file.name;
      const normalizedFull = normalizeText(fullName);
      const normalizedName = normalizeText(file.name);
      return (
        normalizedFull === targetNormalized ||
        normalizedName === targetNormalized
      );
    });

    if (match) {
      return match.id;
    }
  }

  throw new Error(`SimplyPrint file not found: ${fileName}`);
}

function buildSearchQueries(fileName: string): string[] {
  const trimmed = fileName.trim();
  const base = trimmed.includes(".") ? trimmed.slice(0, trimmed.lastIndexOf(".")) : trimmed;
  const tokens = normalizeText(base)
    .split(" ")
    .filter((token) => token.length > 2);

  const queries = [trimmed, base, ...tokens].filter((value) => value.length > 0);
  return Array.from(new Set(queries));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreMatch(query: string, fileName: string) {
  const normalizedFile = normalizeText(fileName);
  if (!normalizedFile) {
    return 0;
  }

  if (normalizedFile === query) {
    return 100;
  }

  let score = 0;
  const queryTokens = query.split(" ").filter((token) => token.length > 1);
  const fileTokens = normalizedFile.split(" ");

  for (const token of queryTokens) {
    if (fileTokens.includes(token)) {
      score += 8;
    } else if (normalizedFile.includes(token)) {
      score += 4;
    }
  }

  const compactQuery = query.replace(/\s+/g, "");
  const compactFile = normalizedFile.replace(/\s+/g, "");
  if (compactFile.includes(compactQuery) && compactQuery.length > 3) {
    score += 10;
  }

  if (normalizedFile.includes(query)) {
    score += 6;
  }

  return score;
}
