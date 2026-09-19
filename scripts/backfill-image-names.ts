// One-time backfill: stamp every product with its canonical
// "Brand Name + Product Name" image file name.
import { db } from '../src/lib/db';
import { canonicalImageFileName } from '../src/app/api/v1/inventory/_lib/inventory';

async function main() {
  const products = await db.product.findMany({
    select: { id: true, name: true, brand: true, photoUrl: true, imageFileName: true },
  });
  let updated = 0;
  for (const p of products) {
    const canonical = canonicalImageFileName(p.brand, p.name, p.photoUrl);
    if (canonical !== p.imageFileName) {
      await db.product.update({ where: { id: p.id }, data: { imageFileName: canonical } });
      updated++;
    }
  }
  console.log(`products: ${products.length}, canonical names stamped: ${updated}`);
  const sample = await db.product.findMany({ where: { photoUrl: { not: null } }, take: 5, select: { name: true, brand: true, imageFileName: true } });
  console.log(JSON.stringify(sample, null, 1));
  await db.$disconnect();
}
main();
