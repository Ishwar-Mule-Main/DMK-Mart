// One-time migration — pulls the future-dated recurring invoices (INV/0011,
// INV/0013, INV/0014 — the "3 Nov 2026" bug) back to today. Updates the
// invoice, its SALES + COGS journals, and its stock movements together.
import { db } from "../src/lib/db";

const FIRM = "cmtkfbyvx00p9lgwiokanm7hn";
const TARGETS = ["DMK/2025-26/INV/0011", "DMK/2025-26/INV/0013", "DMK/2025-26/INV/0014"];

async function main() {
  const now = new Date();
  const today = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago — same day, safely in the past

  for (const no of TARGETS) {
    const inv = await db.invoice.findFirst({ where: { firmId: FIRM, invoiceNumber: no } });
    if (!inv) { console.log("skip (not found):", no); continue; }
    if (new Date(inv.invoiceDate).getTime() <= now.getTime()) { console.log("ok (not future):", no); continue; }

    await db.invoice.update({ where: { id: inv.id }, data: { invoiceDate: today } });

    const js = await db.journalEntry.findMany({
      where: { firmId: FIRM, narration: { contains: no }, postingDate: { gt: now } },
    });
    for (const j of js) {
      await db.journalEntry.update({ where: { id: j.id }, data: { postingDate: today } });
    }

    const mv = await db.inventoryMovement.findMany({
      where: { firmId: FIRM, referenceNo: no, createdAt: { gt: now } },
    });
    for (const m of mv) {
      await db.inventoryMovement.update({ where: { id: m.id }, data: { createdAt: today } });
    }

    console.log(`fixed ${no}: journal(s)=${js.length} movement(s)=${mv.length} → ${today.toISOString().slice(0, 10)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
