// ═══════════════════════════════════════════════════════════════
// One-time backfill: document/voucher numbers carry the right FY
//
// History: every document number was built from the FIRM's default
// financialYear ("2025-26") even though the system clock (and thus
// every posting date) is in FY 2026-27 — so invoices printed as
// DMK/2025-26/INV/0020 while dated 2026-09-05. The engines now
// derive the FY segment from the document date (fyLabelForDate);
// this script repairs the HISTORIC numbers to match.
//
// Renumber rule: PREFIX/OLD_FY/REST → PREFIX/CORRECT_FY/REST where
// CORRECT_FY = FY of the document date and the REST (type + seq) is
// preserved, so narrations that reference "INV/0020" stay valid.
// Also fixes the firm default FY to the current FY.
// Pure label rewrite — no amounts, ledgers, journals or stock move.
// Idempotent: rows whose FY segment is already correct are skipped.
// Run: bunx tsx scripts/backfill-doc-fy-labels.ts
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Indian FY label ("2026-27") for a date — Apr 1 – Mar 31. */
function fyLabelForDate(d: Date): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const DOC_RE = /^(.+)\/(\d{4}-\d{2})\/(.+)$/;

function renumber(current: string, correctFy: string): string | null {
  const m = DOC_RE.exec(current);
  if (!m) return null;
  if (m[2] === correctFy) return null; // already accurate
  return `${m[1]}/${correctFy}/${m[3]}`;
}

async function main() {
  let changed = 0;

  // ── Firm default FY → current FY ──────────────────────────────
  const nowFy = fyLabelForDate(new Date());
  const firms = await db.firm.findMany({ select: { id: true, firmName: true, financialYear: true } });
  for (const f of firms) {
    if (f.financialYear !== nowFy) {
      await db.firm.update({ where: { id: f.id }, data: { financialYear: nowFy } });
      console.log(`firm ${f.firmName}: default FY ${f.financialYear} → ${nowFy}`);
      changed++;
    }
  }

  // ── Invoices (INV) ─────────────────────────────────────────────
  for (const inv of await db.invoice.findMany({ select: { id: true, invoiceNumber: true, invoiceDate: true } })) {
    const next = renumber(inv.invoiceNumber, fyLabelForDate(inv.invoiceDate));
    if (next) {
      await db.invoice.update({ where: { id: inv.id }, data: { invoiceNumber: next } });
      console.log(`invoice ${inv.invoiceNumber} → ${next}`);
      changed++;
    }
  }

  // ── Purchase orders (PO) ───────────────────────────────────────
  for (const po of await db.purchaseOrder.findMany({ select: { id: true, poNumber: true, poDate: true } })) {
    const next = renumber(po.poNumber, fyLabelForDate(po.poDate));
    if (next) {
      await db.purchaseOrder.update({ where: { id: po.id }, data: { poNumber: next } });
      console.log(`po ${po.poNumber} → ${next}`);
      changed++;
    }
  }

  // ── Sales returns / credit notes (CN) ──────────────────────────
  for (const sr of await db.salesReturn.findMany({ select: { id: true, creditNoteNo: true, returnDate: true } })) {
    const next = renumber(sr.creditNoteNo, fyLabelForDate(sr.returnDate));
    if (next) {
      await db.salesReturn.update({ where: { id: sr.id }, data: { creditNoteNo: next } });
      console.log(`cn ${sr.creditNoteNo} → ${next}`);
      changed++;
    }
  }

  // ── Purchase returns / debit notes (DN) ────────────────────────
  for (const pr of await db.purchaseReturn.findMany({ select: { id: true, debitNoteNo: true, returnDate: true } })) {
    const next = renumber(pr.debitNoteNo, fyLabelForDate(pr.returnDate));
    if (next) {
      await db.purchaseReturn.update({ where: { id: pr.id }, data: { debitNoteNo: next } });
      console.log(`dn ${pr.debitNoteNo} → ${next}`);
      changed++;
    }
  }

  // ── Journal vouchers (SAL/PUR/REC/PAY/…) ───────────────────────
  for (const je of await db.journalEntry.findMany({ select: { id: true, voucherNumber: true, postingDate: true } })) {
    const next = renumber(je.voucherNumber, fyLabelForDate(je.postingDate));
    if (next) {
      await db.journalEntry.update({ where: { id: je.id }, data: { voucherNumber: next } });
      console.log(`voucher ${je.voucherNumber} → ${next}`);
      changed++;
    }
  }

  console.log(`\nDone — ${changed} row(s) updated. Books untouched (labels only).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
