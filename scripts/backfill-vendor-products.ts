/**
 * One-off backfill — vendor product ownership + naming convention.
 * · Links every product to its MANUFACTURER vendor via brand match.
 * · Prefixes product names with the vendor name when missing
 *   ("Bucket 20L Heavy Duty" → "DMK Polymers Bucket 20L Heavy Duty").
 * Idempotent — safe to re-run.
 *
 * Run: bun scripts/backfill-vendor-products.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function shortVendor(vendorName: string): string {
  return (
    vendorName
      .replace(/\s+(pvt\.?|private|ltd\.?|limited|llp|industries|traders|distributors|co\.?|company)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || vendorName.trim()
  );
}

async function main() {
  const vendors = await db.vendor.findMany({
    where: { vendorType: "MANUFACTURER", brand: { not: "" } },
  });
  console.log(`Manufacturer vendors: ${vendors.length}`);

  let linked = 0;
  let renamed = 0;

  for (const v of vendors) {
    const products = await db.product.findMany({
      // SQLite: plain equals — brand values are stored verbatim per firm
      where: { firmId: v.firmId, brand: v.brand },
    });
    for (const p of products) {
      const patch: { manufacturerVendorId?: string; name?: string } = {};
      if (p.manufacturerVendorId !== v.id) patch.manufacturerVendorId = v.id;

      const prefix = shortVendor(v.vendorName);
      if (!p.name.toLowerCase().startsWith(prefix.toLowerCase()) && !p.name.toLowerCase().startsWith(v.vendorName.toLowerCase())) {
        patch.name = `${prefix} ${p.name}`;
      }
      if (Object.keys(patch).length === 0) continue;
      await db.product.update({ where: { id: p.id }, data: patch });
      if (patch.manufacturerVendorId) linked += 1;
      if (patch.name) renamed += 1;
      console.log(`  ✓ ${p.sku}: ${p.name}${patch.name ? ` → ${patch.name}` : ""}`);
    }
  }

  console.log(`Done — linked ${linked}, renamed ${renamed}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
