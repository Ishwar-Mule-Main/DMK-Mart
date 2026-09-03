// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/aging-invoices — PRECISE invoice-wise AR aging
// Outstanding per credit invoice from receipt allocations + credit
// notes (not party-balance approximation). Buckets by invoice age;
// overdue flags from customer credit days (R13).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { computeOpenInvoices } from "@/app/api/v1/_lib/settlement";
import {
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const customerId = getStr(sp.get("customerId"));
    const asOf = getDateOrNull(sp.get("asOf")) ?? new Date();

    const rows = await computeOpenInvoices(firmId, customerId || undefined, asOf);

    const totals = {
      outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      overdue: round2(rows.filter((r) => r.isOverdue).reduce((s, r) => s + r.outstanding, 0)),
      buckets: {
        d0_30: round2(rows.filter((r) => r.bucket === "0-30").reduce((s, r) => s + r.outstanding, 0)),
        d31_60: round2(rows.filter((r) => r.bucket === "31-60").reduce((s, r) => s + r.outstanding, 0)),
        d61_90: round2(rows.filter((r) => r.bucket === "61-90").reduce((s, r) => s + r.outstanding, 0)),
        d90plus: round2(rows.filter((r) => r.bucket === "90+").reduce((s, r) => s + r.outstanding, 0)),
      },
      openInvoices: rows.length,
      overdueInvoices: rows.filter((r) => r.isOverdue).length,
    };

    // Party rollup (same precise math, grouped)
    const partyMap = new Map<
      string,
      { customerId: string; partyName: string; outstanding: number; invoiceCount: number; oldestInvoiceDate: string | null; oldestInvoiceNo: string }
    >();
    for (const r of rows) {
      const key = r.customerId ?? r.partyName;
      const cur = partyMap.get(key) ?? {
        customerId: r.customerId ?? "",
        partyName: r.partyName,
        outstanding: 0,
        invoiceCount: 0,
        oldestInvoiceDate: null as string | null,
        oldestInvoiceNo: "",
      };
      cur.outstanding = round2(cur.outstanding + r.outstanding);
      cur.invoiceCount += 1;
      if (!cur.oldestInvoiceDate || r.invoiceDate < cur.oldestInvoiceDate) {
        cur.oldestInvoiceDate = r.invoiceDate;
        cur.oldestInvoiceNo = r.invoiceNumber;
      }
      partyMap.set(key, cur);
    }
    const parties = Array.from(partyMap.values()).sort((a, b) => b.outstanding - a.outstanding);

    // ── AR subledger reconciliation ─────────────────────────────
    // On-account (unapplied) receipts = Σ(receipt amount − allocations).
    // GL receivables = Σ customer closingBalance (Dr positive).
    // Invariant: open invoices − unapplied receipts ≈ GL receivables.
    const receipts = await db.customerReceipt.findMany({
      where: { firmId, ...(customerId ? { customerId } : {}) },
      select: { customerId: true, amount: true, allocations: { select: { amount: true } } },
    });
    let unappliedTotal = 0;
    const unappliedByCustomer = new Map<string, number>();
    for (const r of receipts) {
      const allocated = round2(r.allocations.reduce((s, a) => s + a.amount, 0));
      const rest = round2(r.amount - allocated);
      if (rest > 0.009) {
        unappliedTotal = round2(unappliedTotal + rest);
        unappliedByCustomer.set(r.customerId, round2((unappliedByCustomer.get(r.customerId) ?? 0) + rest));
      }
    }
    const glAgg = await db.customer.aggregate({
      where: { firmId, isActive: true },
      _sum: { closingBalance: true, openingBalance: true },
    });
    const glReceivables = round2(glAgg._sum.closingBalance ?? 0);
    const openingTotal = round2(glAgg._sum.openingBalance ?? 0);

    for (const p of parties) {
      (p as { unapplied?: number }).unapplied = round2(unappliedByCustomer.get(p.customerId) ?? 0);
    }

    return ok({
      type: "AR_INVOICE",
      firmName: firm.firmName,
      asOf: asOf.toISOString(),
      rows,
      totals,
      parties,
      reconciliation: {
        openInvoices: totals.outstanding,
        unappliedReceipts: unappliedTotal,
        openingBalances: openingTotal,
        glReceivables,
        // Identity: GL closing = open invoices − unapplied receipts + opening balances
        difference: round2(glReceivables - (totals.outstanding - unappliedTotal + openingTotal)),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
