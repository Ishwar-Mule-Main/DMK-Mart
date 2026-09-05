// ═══════════════════════════════════════════════════════════════
// /api/v1/finance/sundry — SUNDRY PARTY REGISTERS (Finance & Accts)
// "Sundry" = the miscellaneous trade parties a firm deals with on
// credit. For a trading/distribution business like DMK Mart:
//   · Sundry Debtors  (A/c 1100) — B2B customers owed money (AR)
//   · Sundry Creditors (A/c 2000) — vendors the firm owes (AP)
// Party ledger balances (Customer/Vendor.closingBalance) are the
// subledger; this API rolls them up WITH credit control (limit,
// utilization), precise invoice-wise aging (AR), open-PO exposure
// (AP), last payment / last activity, and a GL ↔ subledger
// reconciliation strip so amounts agree everywhere they appear.
// Balances are running (as-of-now) by nature — balance-sheet
// accounts are cumulative, not FY-scoped.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { computeOpenInvoices } from "@/app/api/v1/_lib/settlement";
import { computeAPAging } from "@/app/api/v1/_lib/aging";
import {
  BusinessError,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";
import { db } from "@/lib/db";

interface BucketSet {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

const EMPTY_BUCKETS: BucketSet = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };

function bucketFor(ageDays: number): keyof BucketSet {
  if (ageDays <= 30) return "d0_30";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 90) return "d61_90";
  return "d90plus";
}

/**
 * GL balance for an account code. Sign convention: ASSET/EXPENSE accounts
 * are debit-positive; LIABILITY/EQUITY/REVENUE accounts are credit-positive.
 * Balance = COA opening + Σ(debit − credit) × sign.
 */
async function glBalance(firmId: string, accountCode: string): Promise<number> {
  const coa = await db.chartOfAccount.findFirst({
    where: { firmId, accountCode },
    select: { id: true, openingBalance: true, accountClass: true },
  });
  if (!coa) return 0;
  const debitPositive = coa.accountClass === "ASSET" || coa.accountClass === "EXPENSE";
  const agg = await db.journalLine.aggregate({
    where: { accountId: coa.id },
    _sum: { debitAmount: true, creditAmount: true },
  });
  const raw = (agg._sum.debitAmount ?? 0) - (agg._sum.creditAmount ?? 0);
  return round2(coa.openingBalance + (debitPositive ? raw : -raw));
}

async function debtors(firmId: string, partyId?: string) {
  const asOf = new Date();
  const customers = await db.customer.findMany({
    where: { firmId, isActive: true, ...(partyId ? { id: partyId } : {}) },
    orderBy: { partyName: "asc" },
  });

  // Precise invoice-wise outstanding (receipt allocations + credit notes).
  const openRows = await computeOpenInvoices(firmId, partyId || undefined, asOf);

  // On-account (unapplied) receipts per customer.
  const receipts = await db.customerReceipt.findMany({
    where: { firmId, ...(partyId ? { customerId: partyId } : {}) },
    select: { customerId: true, amount: true, allocations: { select: { amount: true } } },
  });
  const unappliedByCustomer = new Map<string, number>();
  for (const r of receipts) {
    const allocated = round2(r.allocations.reduce((s, a) => s + a.amount, 0));
    const rest = round2(r.amount - allocated);
    if (rest > 0.009) {
      unappliedByCustomer.set(r.customerId, round2((unappliedByCustomer.get(r.customerId) ?? 0) + rest));
    }
  }

  // Last ledger activity per customer.
  const activity = await db.ledgerEntry.groupBy({
    by: ["customerId"],
    where: { firmId, partyType: "CUSTOMER", ...(partyId ? { customerId: partyId } : {}) },
    _max: { entryDate: true },
  });
  const lastActivityByCustomer = new Map(activity.map((a) => [a.customerId ?? "", a._max.entryDate]));

  // Per-party aggregates from the open invoice rows.
  const openByCustomer = new Map<
    string,
    {
      outstanding: number;
      count: number;
      overdue: number;
      overdueCount: number;
      buckets: BucketSet;
      oldest: { no: string; date: string; ageDays: number } | null;
    }
  >();
  for (const r of openRows) {
    if (!r.customerId) continue; // walk-in counter sales are cash, not sundry
    const cur =
      openByCustomer.get(r.customerId) ??
      { outstanding: 0, count: 0, overdue: 0, overdueCount: 0, buckets: { ...EMPTY_BUCKETS }, oldest: null as null | { no: string; date: string; ageDays: number } };
    cur.outstanding = round2(cur.outstanding + r.outstanding);
    cur.count += 1;
    if (r.isOverdue) {
      cur.overdue = round2(cur.overdue + r.outstanding);
      cur.overdueCount += 1;
    }
    cur.buckets[bucketFor(r.ageDays)] = round2(cur.buckets[bucketFor(r.ageDays)] + r.outstanding);
    if (!cur.oldest || r.invoiceDate < cur.oldest.date) {
      cur.oldest = { no: r.invoiceNumber, date: r.invoiceDate, ageDays: r.ageDays };
    }
    openByCustomer.set(r.customerId, cur);
  }

  const parties = customers.map((c) => {
    const ledger = round2(c.closingBalance); // Dr positive = they owe us
    const open = openByCustomer.get(c.id);
    const openOutstanding = open?.outstanding ?? 0;
    const unapplied = round2(unappliedByCustomer.get(c.id) ?? 0);
    const limit = c.creditLimit;
    const utilizationPct = limit > 0 ? Math.min(999, round2((Math.max(ledger, 0) / limit) * 100)) : 0;
    return {
      id: c.id,
      name: c.partyName,
      city: c.city,
      phone: c.phone,
      customerType: c.customerType,
      ledgerBalance: ledger, // Dr+ receivable / Cr− advance held
      creditLimit: limit,
      creditDays: c.creditDays,
      available: limit > 0 ? round2(limit - Math.max(ledger, 0)) : null,
      utilizationPct,
      overLimit: limit > 0 && ledger > limit + 0.009,
      openInvoiceCount: open?.count ?? 0,
      openOutstanding,
      unapplied,
      overdueOutstanding: open?.overdue ?? 0,
      overdueCount: open?.overdueCount ?? 0,
      oldestInvoice: open?.oldest ?? null,
      buckets: open?.buckets ?? { ...EMPTY_BUCKETS },
      lastActivity: lastActivityByCustomer.get(c.id) ?? null,
    };
  });

  const allCustomers = await db.customer.aggregate({
    where: { firmId },
    _sum: { closingBalance: true },
  });
  const glReceivables = await glBalance(firmId, "1100");

  const debit = round2(parties.filter((p) => p.ledgerBalance > 0.009).reduce((s, p) => s + p.ledgerBalance, 0));
  const credit = round2(parties.filter((p) => p.ledgerBalance < -0.009).reduce((s, p) => s - p.ledgerBalance, 0));

  return {
    type: "DEBTORS" as const,
    glCode: "1100",
    glName: "Sundry Debtors (Accounts Receivable)",
    asOf: asOf.toISOString(),
    parties: parties.sort((a, b) => b.ledgerBalance - a.ledgerBalance),
    totals: {
      debit, // receivables
      credit, // advances held
      net: round2(debit - credit),
      openOutstanding: round2(parties.reduce((s, p) => s + p.openOutstanding, 0)),
      unapplied: round2(parties.reduce((s, p) => s + p.unapplied, 0)),
      overdue: round2(parties.reduce((s, p) => s + p.overdueOutstanding, 0)),
      overLimitCount: parties.filter((p) => p.overLimit).length,
      partyCount: parties.length,
    },
    reconciliation: {
      glBalance: glReceivables,
      partySum: round2(allCustomers._sum.closingBalance ?? 0),
      difference: round2(glReceivables - (allCustomers._sum.closingBalance ?? 0)),
    },
  };
}

async function creditors(firmId: string, partyId?: string) {
  const asOf = new Date();
  const vendors = await db.vendor.findMany({
    where: { firmId, isActive: true, ...(partyId ? { id: partyId } : {}) },
    orderBy: { vendorName: "asc" },
  });

  // Party-wise AP aging buckets (oldest-first allocation on confirmed POs).
  const apAging = await computeAPAging(firmId, asOf);
  const agingByVendor = new Map(apAging.rows.map((r) => [r.partyId, r]));

  // Open PO exposure: confirmed POs not fully settled by payments.
  const pos = await db.purchaseOrder.findMany({
    where: { firmId, status: "CONFIRMED", ...(partyId ? { vendorId: partyId } : {}) },
    select: {
      vendorId: true,
      grandTotal: true,
      paymentAllocations: { select: { amount: true } },
    },
  });
  const openPOByVendor = new Map<string, { value: number; count: number }>();
  for (const po of pos) {
    const settled = round2(po.paymentAllocations.reduce((s, a) => s + a.amount, 0));
    const open = round2(po.grandTotal - settled);
    if (open > 0.009) {
      const cur = openPOByVendor.get(po.vendorId) ?? { value: 0, count: 0 };
      cur.value = round2(cur.value + open);
      cur.count += 1;
      openPOByVendor.set(po.vendorId, cur);
    }
  }

  // Last payment per vendor (payments are few — pick first per vendor).
  const payments = await db.vendorPayment.findMany({
    where: { firmId, ...(partyId ? { vendorId: partyId } : {}) },
    orderBy: { paymentDate: "desc" },
    take: 500,
  });
  const lastPaymentByVendor = new Map<string, { date: string; amount: number; mode: string }>();
  for (const p of payments) {
    if (!lastPaymentByVendor.has(p.vendorId)) {
      lastPaymentByVendor.set(p.vendorId, { date: p.paymentDate.toISOString(), amount: p.amount, mode: p.mode });
    }
  }

  // Last ledger activity per vendor.
  const activity = await db.ledgerEntry.groupBy({
    by: ["vendorId"],
    where: { firmId, partyType: "VENDOR", ...(partyId ? { vendorId: partyId } : {}) },
    _max: { entryDate: true },
  });
  const lastActivityByVendor = new Map(activity.map((a) => [a.vendorId ?? "", a._max.entryDate]));

  const parties = vendors.map((v) => {
    const ledger = round2(v.closingBalance); // Cr positive = we owe them
    const aging = agingByVendor.get(v.id);
    const openPO = openPOByVendor.get(v.id);
    return {
      id: v.id,
      name: v.vendorName,
      vendorType: v.vendorType,
      brand: v.brand,
      ledgerBalance: ledger, // Cr+ payable / Dr− advance paid
      paymentTerms: v.paymentTerms,
      openPOCount: openPO?.count ?? 0,
      openPOValue: openPO?.value ?? 0,
      buckets: aging
        ? { d0_30: aging.buckets.d0_30, d31_60: aging.buckets.d31_60, d61_90: aging.buckets.d61_90, d90plus: aging.buckets.d90plus }
        : { ...EMPTY_BUCKETS },
      oldestDocDate: aging?.oldestDocDate ?? null,
      oldestDocNo: aging?.oldestDocNo ?? "",
      lastPayment: lastPaymentByVendor.get(v.id) ?? null,
      lastActivity: lastActivityByVendor.get(v.id) ?? null,
    };
  });

  const allVendors = await db.vendor.aggregate({
    where: { firmId },
    _sum: { closingBalance: true },
  });
  const glPayables = await glBalance(firmId, "2000");
  // Unattributed vendor recoveries parked in A/c 1400 keep AP = Σ vendors.
  const claimsBalance = await glBalance(firmId, "1400");

  const credit = round2(parties.filter((p) => p.ledgerBalance > 0.009).reduce((s, p) => s + p.ledgerBalance, 0));
  const debit = round2(parties.filter((p) => p.ledgerBalance < -0.009).reduce((s, p) => s - p.ledgerBalance, 0));

  return {
    type: "CREDITORS" as const,
    glCode: "2000",
    glName: "Sundry Creditors (Accounts Payable)",
    asOf: asOf.toISOString(),
    parties: parties.sort((a, b) => b.ledgerBalance - a.ledgerBalance),
    totals: {
      credit, // payables
      debit, // advances paid
      net: round2(credit - debit),
      openPOValue: round2(parties.reduce((s, p) => s + p.openPOValue, 0)),
      openPOCount: parties.reduce((s, p) => s + p.openPOCount, 0),
      partyCount: parties.length,
    },
    reconciliation: {
      glBalance: glPayables,
      partySum: round2(allVendors._sum.closingBalance ?? 0),
      difference: round2(glPayables - (allVendors._sum.closingBalance ?? 0)),
      claimsBalance,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const type = (getStr(sp.get("type")).toUpperCase() || "DEBTORS") as "DEBTORS" | "CREDITORS";
    if (!["DEBTORS", "CREDITORS"].includes(type)) {
      throw new BusinessError("ERR_VALIDATION", "type must be DEBTORS or CREDITORS", 400);
    }
    const partyId = getStr(sp.get("partyId")) || undefined;

    const result = type === "DEBTORS" ? await debtors(firmId, partyId) : await creditors(firmId, partyId);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
