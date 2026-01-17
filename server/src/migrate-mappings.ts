import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
  const mappings = await prisma.mapping.findMany();
  let updated = 0;

  for (const mapping of mappings) {
    const legacy = mapping.simplyprintFileName
      ? String(mapping.simplyprintFileName).trim()
      : "";
    const raw = mapping.simplyprintFileNames;

    let files: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          files = parsed.map((name) => String(name)).filter((name) => name.trim());
        }
      } catch {
        files = [];
      }
    }

    if (files.length === 0 && legacy) {
      files = [legacy];
    }

    if (files.length > 0 && raw !== JSON.stringify(files)) {
      await prisma.mapping.update({
        where: { id: mapping.id },
        data: {
          simplyprintFileNames: JSON.stringify(files),
          simplyprintFileName: files[0],
        },
      });
      updated += 1;
    }
  }

  console.log(`Migration complete. Updated ${updated} mapping(s).`);
}

run()
  .catch((error) => {
    console.error("Migration failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
