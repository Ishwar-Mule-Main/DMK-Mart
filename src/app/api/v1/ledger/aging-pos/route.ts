// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/aging-pos — PRECISE PO-wise AP aging
// Outstanding per CONFIRMED purchase order from payment allocations
// + debit notes (not party-balance approximation). Buckets by PO age;
// overdue flags from vendor payment terms.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { computeOpenPurchaseOrders } from "@/app/api/v1/_lib/settlement-ap";
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

    const vendorId = getStr(sp.get("vendorId"));
    const asOf = getDateOrNull(sp.get("asOf")) ?? new Date();

    const rows = await computeOpenPurchaseOrders(firmId, vendorId || undefined, asOf);

    const totals = {
      outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
      overdue: round2(rows.filter((r) => r.isOverdue).reduce((s, r) => s + r.outstanding, 0)),
      buckets: {
        d0_30: round2(rows.filter((r) => r.bucket === "0-30").reduce((s, r) => s + r.outstanding, 0)),
        d31_60: round2(rows.filter((r) => r.bucket === "31-60").reduce((s, r) => s + r.outstanding, 0)),
        d61_90: round2(rows.filter((r) => r.bucket === "61-90").reduce((s, r) => s + r.outstanding, 0)),
        d90plus: round2(rows.filter((r) => r.bucket === "90+").reduce((s, r) => s + r.outstanding, 0)),
      },
      openPOs: rows.length,
      overduePOs: rows.filter((r) => r.isOverdue).length,
    };

    // Vendor rollup (same precise math, grouped)
    const vendorMap = new Map<
      string,
      { vendorId: string; vendorName: string; outstanding: number; poCount: number; oldestPoDate: string | null; oldestPoNo: string }
    >();
    for (const r of rows) {
      const cur = vendorMap.get(r.vendorId) ?? {
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        outstanding: 0,
        poCount: 0,
        oldestPoDate: null as string | null,
        oldestPoNo: "",
      };
      cur.outstanding = round2(cur.outstanding + r.outstanding);
      cur.poCount += 1;
      if (!cur.oldestPoDate || r.poDate < cur.oldestPoDate) {
        cur.oldestPoDate = r.poDate;
        cur.oldestPoNo = r.poNumber;
      }
      vendorMap.set(r.vendorId, cur);
    }
    const vendors = Array.from(vendorMap.values()).sort((a, b) => b.outstanding - a.outstanding);

    // ── AP subledger reconciliation ─────────────────────────────
    // On-account (unapplied) payments = Σ(payment amount − allocations).
    // Standalone debit notes (no PO) reduce payable without a bill.
    // GL payables = Σ vendor closingBalance (Cr positive).
    // Invariant: open POs − unapplied payments + vendor openings −
    // standalone debit notes ≈ GL payables.
    const payments = await db.vendorPayment.findMany({
      where: { firmId, ...(vendorId ? { vendorId } : {}) },
      select: { vendorId: true, amount: true, allocations: { select: { amount: true } } },
    });
    let unappliedTotal = 0;
    const unappliedByVendor = new Map<string, number>();
    for (const p of payments) {
      const allocated = round2(p.allocations.reduce((s, a) => s + a.amount, 0));
      const rest = round2(p.amount - allocated);
      if (rest > 0.009) {
        unappliedTotal = round2(unappliedTotal + rest);
        unappliedByVendor.set(p.vendorId, round2((unappliedByVendor.get(p.vendorId) ?? 0) + rest));
      }
    }
    const standaloneDebits = await db.purchaseReturn.findMany({
      where: { firmId, poId: null, vendorId: { not: null }, ...(vendorId ? { vendorId } : {}) },
      select: { vendorId: true, grandTotal: true },
    });
    let standaloneDebitTotal = 0;
    const debitByVendor = new Map<string, number>();
    for (const d of standaloneDebits) {
      if (d.vendorId) {
        standaloneDebitTotal = round2(standaloneDebitTotal + d.grandTotal);
        debitByVendor.set(d.vendorId, round2((debitByVendor.get(d.vendorId) ?? 0) + d.grandTotal));
      }
    }
    const glAgg = await db.vendor.aggregate({
      where: { firmId, isActive: true },
      _sum: { closingBalance: true, openingBalance: true },
    });
    const glPayables = round2(glAgg._sum.closingBalance ?? 0);
    const openingTotal = round2(glAgg._sum.openingBalance ?? 0);

    for (const v of vendors) {
      (v as { unapplied?: number }).unapplied = round2(unappliedByVendor.get(v.vendorId) ?? 0);
      (v as { standaloneDebits?: number }).standaloneDebits = round2(debitByVendor.get(v.vendorId) ?? 0);
    }

    return ok({
      type: "AP_PO",
      firmName: firm.firmName,
      asOf: asOf.toISOString(),
      rows,
      totals,
      vendors,
      reconciliation: {
        openPOs: totals.outstanding,
        unappliedPayments: unappliedTotal,
        openingBalances: openingTotal,
        standaloneDebitNotes: standaloneDebitTotal,
        glPayables,
        // Identity: GL closing (Cr+) = open POs − unapplied payments + openings − standalone debits
        difference: round2(glPayables - (totals.outstanding - unappliedTotal + openingTotal - standaloneDebitTotal)),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
