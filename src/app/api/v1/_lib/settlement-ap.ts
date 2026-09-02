// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — AP SETTLEMENT ENGINE (per-PO vendor tracking)
// Precise outstanding per CONFIRMED purchase order:
//   outstanding = grandTotal − Σ(PaymentAllocation) − Σ(DebitNotes)
// Mirror of settlement.ts (AR) — powers /ledger/aging-pos,
// vendor payment allocation and the AP subledger reconciliation.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";
import type { AllocationInput } from "./settlement";

export interface OpenPurchaseOrderRow {
  poId: string;
  poNumber: string;
  vendorBillNo: string;
  vendorId: string;
  vendorName: string;
  poDate: string;
  grandTotal: number;
  settled: number; // Σ payment allocations
  credited: number; // Σ debit notes against this PO
  outstanding: number;
  ageDays: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  paymentDays: number;
  dueDate: string;
  overdueDays: number;
  isOverdue: boolean;
}

/** "NET_30" → 30 · "NET_15" → 15 · anything else → 30 (default terms). */
export function parsePaymentDays(terms: string | null | undefined): number {
  const m = /(\d+)/.exec(terms ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function bucketFor(ageDays: number): OpenPurchaseOrderRow["bucket"] {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

/**
 * Precise outstanding per CONFIRMED purchase order (optionally one vendor).
 * Outstanding = grandTotal − Σ payment allocations − Σ debit notes (poId).
 * Rows sorted oldest-first (date, then number).
 */
export async function computeOpenPurchaseOrders(
  firmId: string,
  vendorId?: string,
  asOf: Date = new Date()
): Promise<OpenPurchaseOrderRow[]> {
  const pos = await db.purchaseOrder.findMany({
    where: {
      firmId,
      status: "CONFIRMED",
      ...(vendorId ? { vendorId } : {}),
    },
    include: { vendor: { select: { id: true, vendorName: true, paymentTerms: true } } },
    orderBy: [{ poDate: "asc" }, { poNumber: "asc" }],
  });
  if (pos.length === 0) return [];

  const ids = pos.map((p) => p.id);

  const [allocGroups, debitGroups] = await Promise.all([
    db.paymentAllocation.groupBy({
      by: ["purchaseOrderId"],
      where: { firmId, purchaseOrderId: { in: ids } },
      _sum: { amount: true },
    }),
    db.purchaseReturn.groupBy({
      by: ["poId"],
      where: { firmId, poId: { in: ids } },
      _sum: { grandTotal: true },
    }),
  ]);

  const allocMap = new Map(allocGroups.map((g) => [g.purchaseOrderId, round2(g._sum.amount ?? 0)]));
  const debitMap = new Map(
    debitGroups.filter((g) => g.poId).map((g) => [g.poId as string, round2(g._sum.grandTotal ?? 0)])
  );

  const now = asOf.getTime();
  const rows: OpenPurchaseOrderRow[] = [];
  for (const po of pos) {
    const grand = round2(po.grandTotal);
    const settled = round2(allocMap.get(po.id) ?? 0);
    const credited = round2(debitMap.get(po.id) ?? 0);
    const outstanding = round2(Math.max(0, grand - settled - credited));
    if (outstanding <= 0.009) continue; // fully settled — not "open"

    const ageDays = Math.max(0, Math.floor((now - po.poDate.getTime()) / 86400000));
    const paymentDays = parsePaymentDays(po.vendor?.paymentTerms);
    const due = new Date(po.poDate.getTime() + paymentDays * 86400000);
    const overdueDays = Math.max(0, Math.floor((now - due.getTime()) / 86400000));

    rows.push({
      poId: po.id,
      poNumber: po.poNumber,
      vendorBillNo: po.vendorBillNo ?? "",
      vendorId: po.vendorId,
      vendorName: po.vendor?.vendorName ?? "—",
      poDate: po.poDate.toISOString(),
      grandTotal: grand,
      settled,
      credited,
      outstanding,
      ageDays,
      bucket: bucketFor(ageDays),
      paymentDays,
      dueDate: due.toISOString(),
      overdueDays,
      isOverdue: overdueDays > 0,
    });
  }
  return rows;
}

/**
 * Validate + create AP allocation rows inside the payment transaction.
 * Rules (mirror of AR createAllocations):
 *  - every PO: same firm, same vendor, status CONFIRMED
 *  - each amount > 0 and ≤ that PO's current outstanding
 *  - Σ allocations ≤ payment amount (remainder stays on account)
 * Returns compact summary for ledger narration.
 */
export async function createPaymentAllocations(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  opts: {
    firmId: string;
    paymentId: string;
    vendorId: string;
    paymentAmount: number;
    allocations: AllocationInput[];
  }
): Promise<Array<{ purchaseOrderId: string; poNumber: string; amount: number }>> {
  const wanted = opts.allocations
    .map((a) => ({ purchaseOrderId: a.invoiceId, amount: round2(a.amount) }))
    .filter((a) => a.purchaseOrderId);

  if (wanted.length === 0) return [];

  const totalAlloc = round2(wanted.reduce((s, a) => s + a.amount, 0));
  if (totalAlloc > opts.paymentAmount + 0.009) {
    throw new BusinessError(
      "ERR_ALLOCATION_EXCEEDS_PAYMENT",
      `Allocated ₹${totalAlloc.toFixed(2)} exceeds the payment amount ₹${opts.paymentAmount.toFixed(2)}`,
      422
    );
  }

  const poIds = Array.from(new Set(wanted.map((a) => a.purchaseOrderId)));
  const pos = await tx.purchaseOrder.findMany({
    where: { id: { in: poIds }, firmId: opts.firmId, vendorId: opts.vendorId },
    select: { id: true, poNumber: true, status: true, grandTotal: true },
  });
  const byId = new Map(pos.map((p) => [p.id, p]));

  const existingAlloc = await tx.paymentAllocation.groupBy({
    by: ["purchaseOrderId"],
    where: { firmId: opts.firmId, purchaseOrderId: { in: poIds } },
    _sum: { amount: true },
  });
  const allocSum = new Map(existingAlloc.map((g) => [g.purchaseOrderId, round2(g._sum.amount ?? 0)]));
  const debitNotes = await tx.purchaseReturn.groupBy({
    by: ["poId"],
    where: { firmId: opts.firmId, poId: { in: poIds } },
    _sum: { grandTotal: true },
  });
  const debitSum = new Map(
    debitNotes.filter((g) => g.poId).map((g) => [g.poId as string, round2(g._sum.grandTotal ?? 0)])
  );

  // per-PO cumulative check (handles duplicate poId entries too)
  const pending = new Map<string, number>();
  for (const a of wanted) {
    const po = byId.get(a.purchaseOrderId);
    if (!po) {
      throw new BusinessError("ERR_ALLOCATION_INVALID", "Allocation references a purchase order that does not belong to this vendor/firm", 422);
    }
    if (po.status !== "CONFIRMED") {
      throw new BusinessError("ERR_ALLOCATION_INVALID", `Purchase order ${po.poNumber} is not CONFIRMED (no goods received)`, 422);
    }
    if (a.amount <= 0) {
      throw new BusinessError("ERR_ALLOCATION_INVALID", `Allocation for ${po.poNumber} must be positive`, 422);
    }
    const already = round2((allocSum.get(a.purchaseOrderId) ?? 0) + (debitSum.get(a.purchaseOrderId) ?? 0));
    const cum = round2((pending.get(a.purchaseOrderId) ?? 0) + a.amount);
    const outstanding = round2(po.grandTotal - already);
    if (cum > outstanding + 0.009) {
      throw new BusinessError(
        "ERR_ALLOCATION_EXCEEDS_PO",
        `Allocated ₹${cum.toFixed(2)} exceeds outstanding ₹${outstanding.toFixed(2)} on ${po.poNumber}`,
        422
      );
    }
    pending.set(a.purchaseOrderId, cum);
  }

  const created: Array<{ purchaseOrderId: string; poNumber: string; amount: number }> = [];
  for (const a of wanted) {
    const po = byId.get(a.purchaseOrderId)!;
    await tx.paymentAllocation.create({
      data: {
        firmId: opts.firmId,
        paymentId: opts.paymentId,
        purchaseOrderId: a.purchaseOrderId,
        amount: a.amount,
      },
    });
    created.push({ purchaseOrderId: a.purchaseOrderId, poNumber: po.poNumber, amount: a.amount });
  }
  return created;
}

/** Sum of settled amounts for a set of POs (for register badges). */
export async function settledTotalsByPo(
  firmId: string,
  poIds: string[]
): Promise<Map<string, { settled: number; credited: number }>> {
  if (poIds.length === 0) return new Map();
  const [allocGroups, debitGroups] = await Promise.all([
    db.paymentAllocation.groupBy({
      by: ["purchaseOrderId"],
      where: { firmId, purchaseOrderId: { in: poIds } },
      _sum: { amount: true },
    }),
    db.purchaseReturn.groupBy({
      by: ["poId"],
      where: { firmId, poId: { in: poIds } },
      _sum: { grandTotal: true },
    }),
  ]);
  const map = new Map<string, { settled: number; credited: number }>();
  for (const g of allocGroups) {
    map.set(g.purchaseOrderId, { settled: round2(g._sum.amount ?? 0), credited: 0 });
  }
  for (const g of debitGroups) {
    if (!g.poId) continue;
    const cur = map.get(g.poId) ?? { settled: 0, credited: 0 };
    cur.credited = round2(g._sum.grandTotal ?? 0);
    map.set(g.poId, cur);
  }
  return map;
}
