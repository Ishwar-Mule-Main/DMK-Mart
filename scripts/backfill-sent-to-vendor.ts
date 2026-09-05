// ═══════════════════════════════════════════════════════════════
// One-time backfill: SalesReturnItem.sentToVendorQty
//
// The bulk "send to purchase return" ran BEFORE per-line recovery
// tracking existed (this field was added with the user's command:
// "even if there is no any sales return its sending one product
// sales return on its own — do not do that"). Damaged pools were
// swept by those historic debit notes, but no SR line was ever
// marked as recovered — leaving ghost "pending" lines.
//
// This script reconciles history: per product, total qty drawn by
// ALL purchase-return debit notes is marked against the product's
// sales-return lines FIFO (oldest credit note first) until the
// drawn qty is exhausted. Pure metadata — no stock, ledger or
// journal changes. Idempotent: only raises sentToVendorQty, never
// lowers it, and never marks more than damagedQty.
// Run: bunx tsx scripts/backfill-sent-to-vendor.ts
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { round2 } from "../src/lib/gst";

const db = new PrismaClient();

async function main() {
  const firms = await db.firm.findMany({ select: { id: true, firmName: true } });

  for (const firm of firms) {
    // total qty drawn per product by all debit notes of this firm
    const prItems = await db.purchaseReturnItem.findMany({
      where: { return: { firmId: firm.id } },
      select: { productId: true, damagedQty: true },
    });
    const drawnByProduct = new Map<string, number>();
    for (const it of prItems) {
      drawnByProduct.set(it.productId, round2((drawnByProduct.get(it.productId) ?? 0) + it.damagedQty));
    }

    // SR lines per product, oldest credit note first (FIFO)
    const srItems = await db.salesReturnItem.findMany({
      where: { return: { firmId: firm.id } },
      select: {
        id: true,
        productId: true,
        damagedQty: true,
        sentToVendorQty: true,
        return: { select: { returnDate: true, creditNoteNo: true } },
      },
      orderBy: [{ return: { returnDate: "asc" } }, { id: "asc" }],
    });
    const byProduct = new Map<string, typeof srItems>();
    for (const it of srItems) {
      if (!byProduct.has(it.productId)) byProduct.set(it.productId, []);
      byProduct.get(it.productId)!.push(it);
    }

    let marked = 0;
    let linesTouched = 0;
    for (const [productId, drawn] of drawnByProduct) {
      let budget = drawn;
      for (const line of byProduct.get(productId) ?? []) {
        if (budget <= 0.001) break;
        const already = line.sentToVendorQty;
        const target = round2(Math.min(line.damagedQty, Math.max(already, budget)));
        const delta = round2(target - already);
        if (delta > 0.001) {
          await db.salesReturnItem.update({
            where: { id: line.id },
            data: { sentToVendorQty: target },
          });
          marked += delta;
          linesTouched += 1;
          budget = round2(budget - delta);
        } else {
          budget = round2(budget - Math.max(0, round2(line.damagedQty - already)));
        }
      }
    }
    console.log(
      `[${firm.firmName}] products with DN draws: ${drawnByProduct.size} · SR lines marked recovered: ${linesTouched} · qty marked: ${round2(marked)}`,
    );
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
