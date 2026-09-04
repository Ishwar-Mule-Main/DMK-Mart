// Sync RecurringTemplateItem.productName snapshots with current product names
// (vendor-prefixed naming convention).
import { db } from "../src/lib/db";

async function main() {
  const items = await db.recurringTemplateItem.findMany({ include: { product: { select: { name: true } } } });
  let n = 0;
  for (const it of items) {
    if (it.product?.name && it.product.name !== it.productName) {
      await db.recurringTemplateItem.update({ where: { id: it.id }, data: { productName: it.product.name } });
      n++;
    }
  }
  console.log(`synced ${n}/${items.length} template item names`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
