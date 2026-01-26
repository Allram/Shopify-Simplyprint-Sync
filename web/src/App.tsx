import React, { useCallback, useEffect, useMemo, useState } from "react";

type ShopifyVariant = {
  id: string;
  title: string;
  sku?: string | null;
};

type ShopifyProduct = {
  id: string;
  title: string;
  variants: ShopifyVariant[];
};

type Mapping = {
  id: number;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  simplyprintFileName?: string | null;
  simplyprintFileNames?: string | null;
  skipQueue?: boolean | null;
};

type FileItem = {
  id: string;
  name: string;
  ext?: string | null;
  fullName: string;
  score?: number;
};

type QueueGroup = {
  id: number;
  name: string;
  virtual?: boolean;
  extensions?: string[];
  sort_order?: number;
};

type UnmatchedLineItem = {
  id: number;
  orderId: string;
  orderName: string | null;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  sku: string | null;
  quantity: number;
  reason: string | null;
  queuedAt: string | null;
  createdAt: string;
};

type HiddenProduct = {
  id: number;
  shopifyProductId: string;
  createdAt: string;
};

const fetchJson = async <T,>(input: RequestInfo, init?: RequestInit) => {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
};

export default function App() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [queueGroups, setQueueGroups] = useState<QueueGroup[]>([]);
  const [queueGroupId, setQueueGroupId] = useState<number | null>(null);
  const [queueSaving, setQueueSaving] = useState(false);
  const [unmatched, setUnmatched] = useState<UnmatchedLineItem[]>([]);
  const [activeTab, setActiveTab] = useState<"mappings" | "unmatched">(
    "mappings"
  );
  const [mappingFilter, setMappingFilter] = useState<
    "all" | "mapped" | "unmapped"
  >("all");
  const [hideSkipQueue, setHideSkipQueue] = useState(false);
  const [hiddenProductIds, setHiddenProductIds] = useState<Set<string>>(
    () => new Set()
  );
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(
    () => window.localStorage.getItem("theme") === "dark"
  );
  const [shopDomain, setShopDomain] = useState(
    () => window.localStorage.getItem("shopDomain") ?? ""
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        productData,
        mappingData,
        groupData,
        queueSetting,
        unmatchedData,
        hiddenData,
      ] =
        await Promise.all([
        fetchJson<{ products: ShopifyProduct[] }>("/api/shopify/products"),
        fetchJson<{ mappings: Mapping[] }>("/api/mappings"),
        fetchJson<{ groups: QueueGroup[] }>("/api/simplyprint/queue-groups"),
        fetchJson<{ groupId: number | null }>("/api/settings/queue-group"),
          fetchJson<{ items: UnmatchedLineItem[] }>("/api/unmatched"),
          fetchJson<{ hidden: HiddenProduct[] }>("/api/products/hidden"),
      ]);

      const filteredProducts = productData.products
        .map((product) => ({
          ...product,
          variants: product.variants.filter((variant) => !!variant.sku),
        }))
        .filter((product) => product.variants.length > 0);

      setProducts(filteredProducts);
      setMappings(mappingData.mappings);
      setQueueGroups(groupData.groups);
      setQueueGroupId(queueSetting.groupId ?? null);
      setUnmatched(unmatchedData.items);
      setHiddenProductIds(
        new Set(hiddenData.hidden.map((item) => item.shopifyProductId))
      );
    } catch (err) {
      console.error(err);
      setError("Failed to load data. Check server configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    document.body.classList.toggle("theme-dark", darkMode);
    window.localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    window.localStorage.setItem("shopDomain", shopDomain);
  }, [shopDomain]);

  const startShopifyAuth = () => {
    const cleaned = shopDomain.trim();
    const url = cleaned
      ? `/api/shopify/auth?shop=${encodeURIComponent(cleaned)}`
      : "/api/shopify/auth";
    window.location.href = url;
  };

  const mappingFor = useCallback(
    (productId: string, variantId: string | null) =>
      mappings.find(
        (mapping: Mapping) =>
          mapping.shopifyProductId === productId &&
          mapping.shopifyVariantId === variantId
      ) ?? null,
    [mappings]
  );

  const upsertMapping = async (
    productId: string,
    variantId: string | null,
    fileNames: string[],
    skipQueue: boolean
  ) => {
    const payload = {
      productId,
      variantId,
      fileNames,
      skipQueue,
    };

    const result = await fetchJson<{ mapping: Mapping }>("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setMappings((prev: Mapping[]) => {
      const index = prev.findIndex(
        (mapping: Mapping) => mapping.id === result.mapping.id
      );
      if (index >= 0) {
        const next = [...prev];
        next[index] = result.mapping;
        return next;
      }
      return [result.mapping, ...prev];
    });
  };

  const deleteMapping = async (id: number) => {
    await fetchJson(`/api/mappings/${id}`, { method: "DELETE" });
    setMappings((prev: Mapping[]) =>
      prev.filter((mapping: Mapping) => mapping.id !== id)
    );
  };

  const saveQueueGroup = async () => {
    setQueueSaving(true);
    try {
      await fetchJson("/api/settings/queue-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: queueGroupId }),
      });
    } finally {
      setQueueSaving(false);
    }
  };

  const queueUnmatched = async (
    itemId: number,
    fileName: string,
    saveMapping: boolean
  ) => {
    await fetchJson(`/api/unmatched/${itemId}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, saveMapping }),
    });

    setUnmatched((prev: UnmatchedLineItem[]) =>
      prev.map((item: UnmatchedLineItem) =>
        item.id === itemId
          ? { ...item, queuedAt: new Date().toISOString(), reason: "Queued manually" }
          : item
      )
    );
  };

  const deleteUnmatched = async (itemId: number) => {
    await fetchJson(`/api/unmatched/${itemId}`, { method: "DELETE" });
    setUnmatched((prev: UnmatchedLineItem[]) =>
      prev.filter((item: UnmatchedLineItem) => item.id !== itemId)
    );
  };

  const hideProduct = async (productId: string) => {
    await fetchJson("/api/products/hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    setHiddenProductIds((prev: Set<string>) => new Set(prev).add(productId));
  };

  const unhideProduct = async (productId: string) => {
    await fetchJson(`/api/products/hidden/${productId}`, { method: "DELETE" });
    setHiddenProductIds((prev: Set<string>) => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  };

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Shopify → SimplyPrint Sync</h1>
          <p>
            Map Shopify products and variants to SimplyPrint files. Orders will be
            queued automatically in the Shopify queue group.
          </p>
        </div>
        <div className="app__header-actions">
          <button
            className="btn btn--ghost"
            onClick={() => setDarkMode((prev: boolean) => !prev)}
          >
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
          <button className="btn" onClick={loadData} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      <div className="tab-bar">
        <button
          className={`tab ${activeTab === "mappings" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("mappings")}
        >
          Mappings
        </button>
        <button
          className={`tab ${activeTab === "unmatched" ? "tab--active" : ""}`}
          onClick={() => setActiveTab("unmatched")}
        >
          Unmatched Orders
        </button>
      </div>

      {error && (
        <div className="banner banner--error banner--actions">
          <div>
            <strong>Failed to load data.</strong>
            <div className="muted">{error}</div>
          </div>
          <div className="banner__actions">
            <input
              className="input"
              type="text"
              value={shopDomain}
              onChange={(event) => setShopDomain(event.target.value)}
              placeholder="your-store.myshopify.com (optional)"
            />
            <button className="btn" onClick={startShopifyAuth}>
              Authenticate with Shopify
            </button>
          </div>
        </div>
      )}
      {loading ? (
        <div className="panel">Loading products…</div>
      ) : activeTab === "mappings" ? (
        <>
          <div className="panel queue-panel">
            <div className="queue-settings">
              <div>
                <h3>SimplyPrint queue</h3>
                <p className="muted">
                  Select the queue group used when orders are created.
                </p>
              </div>
              <div className="queue-settings__actions">
                <select
                  value={queueGroupId ?? ""}
                  onChange={(event) =>
                    setQueueGroupId(
                      event.target.value ? Number(event.target.value) : null
                    )
                  }
                >
                  <option value="">Default (Shopify)</option>
                  {queueGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={saveQueueGroup} disabled={queueSaving}>
                  Save
                </button>
              </div>
            </div>
            <div className="mapping-filters">
              <label className="muted" htmlFor="mappingFilter">
                Filter variants:
              </label>
              <select
                id="mappingFilter"
                value={mappingFilter}
                onChange={(event) =>
                  setMappingFilter(event.target.value as "all" | "mapped" | "unmapped")
                }
              >
                <option value="all">All</option>
                <option value="unmapped">Unmatched only</option>
                <option value="mapped">Matched only</option>
              </select>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={hideSkipQueue}
                  onChange={(event) => setHideSkipQueue(event.target.checked)}
                />
                Hide skip queue
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(event) => setShowHidden(event.target.checked)}
                />
                Show hidden
              </label>
            </div>
          </div>

          <div className="product-grid">
            {products
              .map((product: ShopifyProduct) => {
                const isHidden = hiddenProductIds.has(product.id);
                if (isHidden && !showHidden) {
                  return null;
                }

                const visibleVariants = product.variants.filter((variant) => {
                  const mapping = mappingFor(product.id, variant.id);
                  const hasMapping = !!mapping;

                  if (hideSkipQueue && mapping?.skipQueue) {
                    return false;
                  }

                  if (mappingFilter === "mapped") {
                    return hasMapping;
                  }
                  if (mappingFilter === "unmapped") {
                    return !hasMapping;
                  }

                  return true;
                });

                if (visibleVariants.length === 0) {
                  return null;
                }

                return (
                  <div key={product.id} className="panel">
                <div className="panel__header">
                  <div>
                    <h2>{product.title}</h2>
                    <span className="muted">Product ID: {product.id}</span>
                  </div>
                  <button
                    className="btn btn--ghost"
                    onClick={() =>
                      isHidden ? unhideProduct(product.id) : hideProduct(product.id)
                    }
                  >
                    {isHidden ? "Unhide" : "Hide"}
                  </button>
                </div>

                <div className="variant-list">
                  {visibleVariants.map((variant: ShopifyVariant) => (
                    <MappingRow
                      key={variant.id}
                      label={variant.title}
                      subtitle={
                        variant.sku
                          ? `SKU: ${variant.sku} • Variant ID: ${variant.id}`
                          : `Variant ID: ${variant.id}`
                      }
                      productId={product.id}
                      variantId={variant.id}
                      current={mappingFor(product.id, variant.id)}
                      suggestQuery={
                        variant.sku ?? `${product.title} ${variant.title}`
                      }
                      onSave={upsertMapping}
                      onDelete={deleteMapping}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          </div>
        </>
      ) : (
        <div className="panel">
          {unmatched.length === 0 ? (
            <div className="muted">No unmatched orders.</div>
          ) : (
            <div className="unmatched-list">
              {unmatched.map((item) => (
                <UnmatchedRow
                  key={item.id}
                  item={item}
                  onQueue={queueUnmatched}
                  onDelete={deleteUnmatched}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type MappingRowProps = {
  label: string;
  subtitle?: string;
  productId: string;
  variantId: string | null;
  current: Mapping | null;
  suggestQuery?: string;
  onSave: (
    productId: string,
    variantId: string | null,
    fileNames: string[],
    skipQueue: boolean
  ) => void;
  onDelete: (id: number) => void;
};

function MappingRow({
  label,
  subtitle,
  productId,
  variantId,
  current,
  suggestQuery,
  onSave,
  onDelete,
}: MappingRowProps) {
  const initialFiles = getMappingFiles(current);
  const [fileNames, setFileNames] = useState<string[]>(initialFiles);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [skipQueue, setSkipQueue] = useState<boolean>(
    Boolean(current?.skipQueue)
  );
  const [suggestMessage, setSuggestMessage] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<FileItem[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<string>("");
  const [activeSearch, setActiveSearch] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setFileNames(getMappingFiles(current));
    setSkipQueue(Boolean(current?.skipQueue));
  }, [current?.simplyprintFileName, current?.simplyprintFileNames, current?.skipQueue]);

  useEffect(() => {
    const searchValue = activeSearch.trim();
    if (!searchValue) {
      setFiles([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        const result = await fetchJson<{ files: FileItem[] }>(
          `/api/simplyprint/files?search=${encodeURIComponent(searchValue)}`
        );
        setFiles(result.files.slice(0, 8));
      } catch (error) {
        console.error(error);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [activeSearch]);

  useEffect(() => {
    if (selectedSuggestion) {
      setFileNames((prev: string[]) => {
        const next = [...prev];
        const targetIndex = next.findIndex((name) => name.trim().length === 0);
        const index = targetIndex >= 0 ? targetIndex : 0;
        next[index] = selectedSuggestion;
        return next;
      });
    }
  }, [selectedSuggestion]);

  const options = useMemo(
    () => files.map((file: FileItem) => file.fullName),
    [files]
  );

  const handleSave = async () => {
    const cleaned = fileNames
      .map((name: string) => name.trim())
      .filter((name: string) => name);
    if (cleaned.length === 0) {
      return;
    }

    setSaving(true);
    try {
      await onSave(productId, variantId, cleaned, skipQueue);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!current) {
      return;
    }

    setSaving(true);
    try {
      await onDelete(current.id);
    } finally {
      setSaving(false);
    }
  };

  const handleTestQueue = async () => {
    const cleaned = fileNames
      .map((name: string) => name.trim())
      .filter((name: string) => name);
    if (cleaned.length === 0) {
      setTestMessage("Add at least one file before testing.");
      return;
    }

    setTesting(true);
    setTestMessage(null);
    try {
      const result = await fetchJson<{
        results: { fileName: string; status: "ok" | "error"; message?: string }[];
      }>("/api/simplyprint/test-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNames: cleaned }),
      });

      const failed = result.results.filter((entry) => entry.status !== "ok");
      if (failed.length === 0) {
        setTestMessage("All files are ready to queue.");
      } else {
        setTestMessage(
          failed
            .map((entry) => `${entry.fileName}: ${entry.message ?? "Failed"}`)
            .join(" | ")
        );
      }
    } catch (error) {
      console.error(error);
      setTestMessage("Test queue failed.");
    } finally {
      setTesting(false);
    }
  };

  const handleSuggest = async () => {
    const query = (suggestQuery ?? fileNames.join(" ")).trim();
    if (!query) {
      return;
    }

    setSaving(true);
    setSuggestMessage(null);
    try {
      const result = await fetchJson<{ files: FileItem[] }>(
        `/api/simplyprint/suggest?query=${encodeURIComponent(query)}`
      );
      setFiles(result.files.slice(0, 8));
      setSuggested(result.files.slice(0, 3));
      setSelectedSuggestion(result.files[0]?.fullName ?? "");
      if (result.files.length === 0) {
        setSuggestMessage("No matching files found.");
      }
    } finally {
      setSaving(false);
    }
  };

  const updateFileName = (index: number, value: string) => {
    setFileNames((prev: string[]) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setActiveSearch(value);
  };

  const addFileInput = () => {
    setFileNames((prev: string[]) => [...prev, ""]);
  };

  const handleSkipQueueChange = async (nextValue: boolean) => {
    setSkipQueue(nextValue);

    const cleaned = fileNames
      .map((name: string) => name.trim())
      .filter((name: string) => name);
    if (cleaned.length === 0 && !current && !nextValue) {
      return;
    }

    setSaving(true);
    try {
      await onSave(productId, variantId, cleaned, nextValue);
    } finally {
      setSaving(false);
    }
  };

  const removeFileInput = (index: number) => {
    setFileNames((prev: string[]) =>
      prev.filter((_value: string, idx: number) => idx !== index)
    );
  };

  return (
    <div className="mapping-row">
      <div>
        <div className="mapping-row__title">{label}</div>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="mapping-row__actions">
        <div className="mapping-row__files">
          {fileNames.map((name: string, index: number) => (
            <div key={`${productId}-${variantId}-${index}`} className="file-input">
              <input
                list={`files-${productId}-${variantId ?? "product"}`}
                value={name}
                onFocus={() => setActiveSearch(name)}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  updateFileName(index, event.target.value)
                }
                placeholder="SimplyPrint filename (e.g. Widget.gcode)"
              />
              <button
                className="btn btn--ghost"
                onClick={() => removeFileInput(index)}
                disabled={fileNames.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
          <datalist id={`files-${productId}-${variantId ?? "product"}`}>
            {options.map((option: string) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <button className="btn btn--ghost" onClick={addFileInput}>
            Add file
          </button>
        </div>
        <label className="checkbox mapping-row__checkbox">
          <input
            type="checkbox"
            checked={skipQueue}
            onChange={(event) => handleSkipQueueChange(event.target.checked)}
          />
          Skip queue
        </label>
        <button className="btn btn--ghost" onClick={handleSuggest} disabled={saving}>
          Suggest
        </button>
        <button className="btn btn--ghost" onClick={handleTestQueue} disabled={testing}>
          {testing ? "Testing…" : "Test queue"}
        </button>
        <button className="btn" onClick={handleSave} disabled={saving}>
          {current ? "Update" : "Save"}
        </button>
        <button
          className="btn btn--ghost"
          onClick={handleDelete}
          disabled={!current || saving}
        >
          Clear
        </button>
      </div>
      {suggested.length > 0 && (
        <div className="suggest-panel">
          <label className="muted" htmlFor={`suggest-${productId}-${variantId}`}>
            Suggested matches
          </label>
          <select
            id={`suggest-${productId}-${variantId}`}
            value={selectedSuggestion}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedSuggestion(event.target.value)
            }
          >
            {suggested.map((option) => (
              <option key={option.id} value={option.fullName}>
                {option.fullName}
              </option>
            ))}
          </select>
        </div>
      )}
      {suggestMessage && <div className="muted">{suggestMessage}</div>}
      {testMessage && <div className="muted">{testMessage}</div>}
      {current && (
        <div className="mapping-row__current muted">
          Current: {getMappingFiles(current).filter(Boolean).join(", ")}
        </div>
      )}
    </div>
  );
}

function getMappingFiles(mapping: Mapping | null): string[] {
  if (!mapping) {
    return [""];
  }

  if (mapping.simplyprintFileNames) {
    try {
      const parsed = JSON.parse(mapping.simplyprintFileNames);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((name) => String(name));
      }
    } catch {
      // ignore parse errors
    }
  }

  if (mapping.simplyprintFileName) {
    return [mapping.simplyprintFileName];
  }

  return [""];
}

type UnmatchedRowProps = {
  item: UnmatchedLineItem;
  onQueue: (itemId: number, fileName: string, saveMapping: boolean) => void;
  onDelete: (itemId: number) => void;
};

function UnmatchedRow({ item, onQueue, onDelete }: UnmatchedRowProps) {
  const [fileName, setFileName] = useState("");
  const [saveMapping, setSaveMapping] = useState(true);
  const [suggested, setSuggested] = useState<FileItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const query = item.sku ?? "";
    if (!query) {
      setSuggested([]);
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        const result = await fetchJson<{ files: FileItem[] }>(
          `/api/simplyprint/suggest?query=${encodeURIComponent(query)}`
        );
        setSuggested(result.files.slice(0, 5));
      } catch (error) {
        console.error(error);
      }
    }, 300);

    return () => window.clearTimeout(handle);
  }, [item.sku]);

  const handleQueue = async () => {
    if (!fileName.trim()) {
      return;
    }
    setSaving(true);
    try {
      await onQueue(item.id, fileName.trim(), saveMapping);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unmatched-row">
      <div className="unmatched-row__info">
        <div className="unmatched-row__title">
          Order {item.orderName ?? item.orderId}
        </div>
        <div className="muted">
          Product {item.shopifyProductId}
          {item.shopifyVariantId ? ` • Variant ${item.shopifyVariantId}` : ""}
          {item.sku ? ` • SKU ${item.sku}` : ""} • Qty {item.quantity}
        </div>
        {item.reason && <div className="muted">Reason: {item.reason}</div>}
        {item.queuedAt && <div className="muted">Queued at: {item.queuedAt}</div>}
      </div>
      <div className="unmatched-row__actions">
        <input
          list={`unmatched-files-${item.id}`}
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          placeholder="SimplyPrint filename"
        />
        <datalist id={`unmatched-files-${item.id}`}>
          {suggested.map((file) => (
            <option key={file.id} value={file.fullName} />
          ))}
        </datalist>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={saveMapping}
            onChange={(event) => setSaveMapping(event.target.checked)}
          />
          Save mapping
        </label>
        <button className="btn" onClick={handleQueue} disabled={saving}>
          Queue
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => onDelete(item.id)}
          disabled={saving}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
