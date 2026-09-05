// One-off (idempotent) data fix: legacy DEBIT_NOTE vouchers that debited
// Sundry Creditors (A/c 2000) without a vendor dimension (bulk sales-return
// recoveries / vendor-less purchase returns) broke the identity
//   GL A/c 2000 == Σ vendor closingBalance.
// This script reclassifies each such amount to "Vendor Claims Recoverable"
// (A/c 1400): Dr 1400 / Cr 2000, dated on the original voucher date so the
// FY placement is preserved. Safe to re-run — existing reclass journals are
// detected by narration marker and skipped.

import { PrismaClient } from "@prisma/client";
import { postJournal, ACC, fyLabelForDate } from "../src/lib/journal";

const db = new PrismaClient();
const MARKER = "Reclass: unattributed vendor recovery";

async function main() {
  const firms = await db.firm.findMany({ select: { id: true, firmName: true } });
  let reclassedCount = 0;
  let reclassedTotal = 0;

  for (const firm of firms) {
    // 1. Ensure A/c 1400 exists for this firm.
    await db.chartOfAccount.upsert({
      where: { firmId_accountCode: { firmId: firm.id, accountCode: ACC.VENDOR_CLAIMS } },
      create: {
        firmId: firm.id,
        accountCode: ACC.VENDOR_CLAIMS,
        accountName: "Vendor Claims Recoverable",
        accountGroup: "Current Assets",
        accountClass: "ASSET",
      },
      update: {},
    });

    // 2. Find journals with a DEBIT line on A/c 2000.
    const apCoa = await db.chartOfAccount.findFirst({
      where: { firmId: firm.id, accountCode: ACC.AP },
      select: { id: true },
    });
    if (!apCoa) continue;
    const journals = await db.journalEntry.findMany({
      where: { firmId: firm.id, voucherType: "DEBIT_NOTE", lines: { some: { accountId: apCoa.id, entrySide: "DEBIT" } } },
      include: { lines: { include: { account: { select: { accountCode: true } } } } },
    });

    for (const j of journals) {
      if (j.narration.includes(MARKER)) continue;
      // already a reclass target? a previous reclass mentions this voucher
      const already = await db.journalEntry.findFirst({
        where: { firmId: firm.id, narration: { contains: j.voucherNumber } },
        select: { voucherNumber: true, narration: true },
      });
      if (already && already.narration.includes(MARKER)) continue;

      const apDebit = j.lines
        .filter((l) => l.account.accountCode === ACC.AP && l.entrySide === "DEBIT")
        .reduce((s, l) => s + l.debitAmount, 0);
      if (apDebit <= 0.009) continue;

      // 3. Is the source purchase return vendor-less?
      let unattributed = false;
      if (j.referenceDocId) {
        const pr = await db.purchaseReturn.findUnique({ where: { id: j.referenceDocId }, select: { vendorId: true } });
        unattributed = !!pr && !pr.vendorId;
      } else {
        // Legacy bulk-recovery rows may not carry referenceDocId — detect via narration.
        unattributed = j.narration.includes("recovery of sales returns") && !j.narration.includes(" from ");
      }
      if (!unattributed) continue;

      // 4. Post the reclass journal dated on the original voucher date.
      const voucher = await postJournal({
        firmId: firm.id,
        voucherType: "JOURNAL",
        postingDate: j.postingDate,
        narration: `${MARKER} from A/c 2000 to A/c 1400 — ${j.voucherNumber}`,
        referenceDocId: j.id,
        lines: [
          { accountCode: ACC.VENDOR_CLAIMS, entrySide: "DEBIT", amount: apDebit },
          { accountCode: ACC.AP, entrySide: "CREDIT", amount: apDebit },
        ],
      });
      console.log(`[${firm.firmName}] reclassed ${j.voucherNumber} → ${voucher.voucherNumber} (₹${apDebit.toFixed(2)}, FY ${fyLabelForDate(j.postingDate)})`);
      reclassedCount += 1;
      reclassedTotal += apDebit;
    }
  }

  console.log(`Done — ${reclassedCount} voucher(s) reclassed, total ₹${reclassedTotal.toFixed(2)}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
