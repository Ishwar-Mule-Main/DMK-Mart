// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — AR / AP AGING ENGINE
// Oldest-first allocation of party closing balances into 0-30 / 31-60 /
// 61-90 / 90+ day buckets against credit invoices (AR) or confirmed
// purchase orders (AP). Shared by /ledger/aging and /dashboard.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";

export interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface AgingRow {
  partyId: string;
  partyName: string;
  stateCode: string;
  balance: number;
  buckets: AgingBuckets;
  oldestDocDate: string | null;
  oldestDocNo: string;
}

export interface AgingResult {
  type: "AR" | "AP";
  rows: AgingRow[];
  totals: AgingBuckets & { total: number };
}

export function emptyBuckets(): AgingBuckets {
  return { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
}

function bucketFor(ageDays: number): keyof AgingBuckets {
  if (ageDays <= 30) return "d0_30";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 90) return "d61_90";
  return "d90plus";
}

/** Allocate `balance` oldest-first across dated documents. */
export function allocateByAge(
  balance: number,
  docs: Array<{ amount: number; date: Date; no?: string }>,
  now: number
): AgingBuckets {
  const buckets = emptyBuckets();
  let remaining = round2(balance);
  for (const doc of docs) {
    if (remaining <= 0.009) break;
    const take = Math.min(remaining, round2(doc.amount));
    if (take <= 0) continue;
    const ageDays = Math.floor((now - doc.date.getTime()) / 86400000);
    buckets[bucketFor(ageDays)] = round2(buckets[bucketFor(ageDays)] + take);
    remaining = round2(remaining - take);
  }
  // Any unallocated remainder (e.g. opening balance without documents)
  // is treated as the oldest debt.
  if (remaining > 0.009) {
    buckets.d90plus = round2(buckets.d90plus + remaining);
  }
  return buckets;
}

function emptyTotals(): AgingBuckets & { total: number } {
  return { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
}

/** AR aging: customers with closingBalance > 0 allocated over posted credit invoices. */
export async function computeARAging(firmId: string, asOf: Date = new Date()): Promise<AgingResult> {
  const customers = await db.customer.findMany({
    where: { firmId, isActive: true, closingBalance: { gt: 0.009 } },
    orderBy: { closingBalance: "desc" },
  });
  const ids = customers.map((c) => c.id);
  const invoices = ids.length
    ? await db.invoice.findMany({
        where: { firmId, customerId: { in: ids }, paymentMode: "CREDIT", status: "POSTED" },
        orderBy: { invoiceDate: "asc" },
        select: { id: true, customerId: true, invoiceNumber: true, invoiceDate: true, grandTotal: true },
      })
    : [];

  const byCustomer = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const list = byCustomer.get(inv.customerId ?? "") ?? [];
    list.push(inv);
    byCustomer.set(inv.customerId ?? "", list);
  }

  const now = asOf.getTime();
  const rows: AgingRow[] = [];
  const totals = emptyTotals();

  for (const c of customers) {
    const docs = (byCustomer.get(c.id) ?? []).map((i) => ({
      amount: i.grandTotal,
      date: i.invoiceDate,
      no: i.invoiceNumber,
    }));
    const buckets = allocateByAge(c.closingBalance, docs, now);
    const rowTotal = round2(buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus);
    const oldest = docs[0];
    rows.push({
      partyId: c.id,
      partyName: c.partyName,
      stateCode: c.stateCode,
      balance: round2(c.closingBalance),
      buckets,
      oldestDocDate: oldest ? oldest.date.toISOString() : null,
      oldestDocNo: oldest?.no ?? "",
    });
    totals.d0_30 = round2(totals.d0_30 + buckets.d0_30);
    totals.d31_60 = round2(totals.d31_60 + buckets.d31_60);
    totals.d61_90 = round2(totals.d61_90 + buckets.d61_90);
    totals.d90plus = round2(totals.d90plus + buckets.d90plus);
    totals.total = round2(totals.total + rowTotal);
  }

  return { type: "AR", rows, totals };
}

/** AP aging: vendors with closingBalance > 0 allocated over confirmed POs. */
export async function computeAPAging(firmId: string, asOf: Date = new Date()): Promise<AgingResult> {
  const vendors = await db.vendor.findMany({
    where: { firmId, isActive: true, closingBalance: { gt: 0.009 } },
    orderBy: { closingBalance: "desc" },
  });
  const ids = vendors.map((v) => v.id);
  const pos = ids.length
    ? await db.purchaseOrder.findMany({
        where: { firmId, vendorId: { in: ids }, status: "CONFIRMED" },
        orderBy: { poDate: "asc" },
        select: { id: true, vendorId: true, poNumber: true, poDate: true, grandTotal: true },
      })
    : [];

  const byVendor = new Map<string, typeof pos>();
  for (const po of pos) {
    const list = byVendor.get(po.vendorId) ?? [];
    list.push(po);
    byVendor.set(po.vendorId, list);
  }

  const now = asOf.getTime();
  const rows: AgingRow[] = [];
  const totals = emptyTotals();

  for (const v of vendors) {
    const docs = (byVendor.get(v.id) ?? []).map((p) => ({
      amount: p.grandTotal,
      date: p.poDate,
      no: p.poNumber,
    }));
    const buckets = allocateByAge(v.closingBalance, docs, now);
    const rowTotal = round2(buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus);
    const oldest = docs[0];
    rows.push({
      partyId: v.id,
      partyName: v.vendorName,
      stateCode: v.stateCode,
      balance: round2(v.closingBalance),
      buckets,
      oldestDocDate: oldest ? oldest.date.toISOString() : null,
      oldestDocNo: oldest?.no ?? "",
    });
    totals.d0_30 = round2(totals.d0_30 + buckets.d0_30);
    totals.d31_60 = round2(totals.d31_60 + buckets.d31_60);
    totals.d61_90 = round2(totals.d61_90 + buckets.d61_90);
    totals.d90plus = round2(totals.d90plus + buckets.d90plus);
    totals.total = round2(totals.total + rowTotal);
  }

  return { type: "AP", rows, totals };
}
