// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — INVOICE SETTLEMENT ENGINE (per-invoice AR tracking)
// Precise outstanding per credit invoice:
//   outstanding = grandTotal − Σ(ReceiptAllocation) − Σ(CreditNotes)
// Powers: /ledger/aging-invoices, receipt allocation, invoice register.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";

export interface AllocationInput {
  invoiceId: string;
  amount: number;
}

export interface OpenInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  partyName: string;
  invoiceDate: string;
  grandTotal: number;
  settled: number; // Σ allocations
  credited: number; // Σ credit notes against this invoice
  outstanding: number;
  ageDays: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  creditDays: number;
  dueDate: string;
  overdueDays: number;
  isOverdue: boolean;
}

function bucketFor(ageDays: number): OpenInvoiceRow["bucket"] {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

/**
 * Precise outstanding per posted CREDIT invoice (optionally one customer).
 * Outstanding = grandTotal − Σ receipt allocations − Σ credit notes.
 * Rows sorted oldest-first (date, then number).
 */
export async function computeOpenInvoices(
  firmId: string,
  customerId?: string,
  asOf: Date = new Date()
): Promise<OpenInvoiceRow[]> {
  const invoices = await db.invoice.findMany({
    where: {
      firmId,
      status: "POSTED",
      paymentMode: "CREDIT",
      ...(customerId ? { customerId } : {}),
    },
    include: {
      customer: { select: { id: true, partyName: true, creditDays: true } },
    },
    orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
  });
  if (invoices.length === 0) return [];

  const ids = invoices.map((i) => i.id);

  const [allocGroups, creditGroups] = await Promise.all([
    db.receiptAllocation.groupBy({
      by: ["invoiceId"],
      where: { firmId, invoiceId: { in: ids } },
      _sum: { amount: true },
    }),
    db.salesReturn.groupBy({
      by: ["invoiceId"],
      where: { firmId, invoiceId: { in: ids }, customerId: { not: null } },
      _sum: { grandTotal: true },
    }),
  ]);

  const allocMap = new Map(allocGroups.map((g) => [g.invoiceId, round2(g._sum.amount ?? 0)]));
  const creditMap = new Map(
    creditGroups.filter((g) => g.invoiceId).map((g) => [g.invoiceId as string, round2(g._sum.grandTotal ?? 0)])
  );

  const now = asOf.getTime();
  const rows: OpenInvoiceRow[] = [];
  for (const inv of invoices) {
    const grand = round2(inv.grandTotal);
    const settled = round2(allocMap.get(inv.id) ?? 0);
    const credited = round2(creditMap.get(inv.id) ?? 0);
    const outstanding = round2(Math.max(0, grand - settled - credited));
    if (outstanding <= 0.009) continue; // fully settled — not "open"

    const ageDays = Math.max(0, Math.floor((now - inv.invoiceDate.getTime()) / 86400000));
    const creditDays = inv.customer?.creditDays ?? 30;
    const due = new Date(inv.invoiceDate.getTime() + creditDays * 86400000);
    const overdueDays = Math.max(0, Math.floor((now - due.getTime()) / 86400000));

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerId: inv.customerId,
      partyName: inv.customer?.partyName ?? (inv.isCounterSale ? inv.walkInName || "Counter" : "—"),
      invoiceDate: inv.invoiceDate.toISOString(),
      grandTotal: grand,
      settled,
      credited,
      outstanding,
      ageDays,
      bucket: bucketFor(ageDays),
      creditDays,
      dueDate: due.toISOString(),
      overdueDays,
      isOverdue: overdueDays > 0,
    });
  }
  return rows;
}

/**
 * Validate + create allocation rows inside the receipt transaction.
 * Rules:
 *  - every invoice: same firm, same customer, POSTED, paymentMode CREDIT
 *  - each amount > 0 and ≤ that invoice's current outstanding
 *  - Σ allocations ≤ receipt amount (remainder stays on account)
 * Returns compact summary for ledger narration.
 */
export async function createAllocations(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  opts: {
    firmId: string;
    receiptId: string;
    customerId: string;
    receiptAmount: number;
    allocations: AllocationInput[];
  }
): Promise<Array<{ invoiceId: string; invoiceNumber: string; amount: number }>> {
  const wanted = opts.allocations
    .map((a) => ({ invoiceId: a.invoiceId, amount: round2(a.amount) }))
    .filter((a) => a.invoiceId);

  if (wanted.length === 0) return [];

  const totalAlloc = round2(wanted.reduce((s, a) => s + a.amount, 0));
  if (totalAlloc > opts.receiptAmount + 0.009) {
    throw new BusinessError(
      "ERR_ALLOCATION_EXCEEDS_RECEIPT",
      `Allocated ₹${totalAlloc.toFixed(2)} exceeds the receipt amount ₹${opts.receiptAmount.toFixed(2)}`,
      422
    );
  }

  const invoiceIds = Array.from(new Set(wanted.map((a) => a.invoiceId)));
  const invoices = await tx.invoice.findMany({
    where: { id: { in: invoiceIds }, firmId: opts.firmId, customerId: opts.customerId },
    select: { id: true, invoiceNumber: true, status: true, paymentMode: true, grandTotal: true },
  });
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const existingAlloc = await tx.receiptAllocation.groupBy({
    by: ["invoiceId"],
    where: { firmId: opts.firmId, invoiceId: { in: invoiceIds } },
    _sum: { amount: true },
  });
  const allocSum = new Map(existingAlloc.map((g) => [g.invoiceId, round2(g._sum.amount ?? 0)]));
  const creditNotes = await tx.salesReturn.groupBy({
    by: ["invoiceId"],
    where: { firmId: opts.firmId, invoiceId: { in: invoiceIds }, customerId: { not: null } },
    _sum: { grandTotal: true },
  });
  const creditSum = new Map(
    creditNotes.filter((g) => g.invoiceId).map((g) => [g.invoiceId as string, round2(g._sum.grandTotal ?? 0)])
  );

  // per-invoice cumulative check (handles duplicate invoiceId entries too)
  const pending = new Map<string, number>();
  for (const a of wanted) {
    const inv = byId.get(a.invoiceId);
    if (!inv) {
      throw new BusinessError("ERR_ALLOCATION_INVALID", "Allocation references an invoice that does not belong to this customer/firm", 422);
    }
    if (inv.status !== "POSTED" || inv.paymentMode !== "CREDIT") {
      throw new BusinessError("ERR_ALLOCATION_INVALID", `Invoice ${inv.invoiceNumber} is not an open credit invoice`, 422);
    }
    if (a.amount <= 0) {
      throw new BusinessError("ERR_ALLOCATION_INVALID", `Allocation for ${inv.invoiceNumber} must be positive`, 422);
    }
    const already = round2((allocSum.get(a.invoiceId) ?? 0) + (creditSum.get(a.invoiceId) ?? 0));
    const cum = round2((pending.get(a.invoiceId) ?? 0) + a.amount);
    const outstanding = round2(inv.grandTotal - already);
    if (cum > outstanding + 0.009) {
      throw new BusinessError(
        "ERR_ALLOCATION_EXCEEDS_INVOICE",
        `Allocated ₹${cum.toFixed(2)} exceeds outstanding ₹${outstanding.toFixed(2)} on ${inv.invoiceNumber}`,
        422
      );
    }
    pending.set(a.invoiceId, cum);
  }

  const created: Array<{ invoiceId: string; invoiceNumber: string; amount: number }> = [];
  for (const a of wanted) {
    const inv = byId.get(a.invoiceId)!;
    await tx.receiptAllocation.create({
      data: {
        firmId: opts.firmId,
        receiptId: opts.receiptId,
        invoiceId: a.invoiceId,
        amount: a.amount,
      },
    });
    created.push({ invoiceId: a.invoiceId, invoiceNumber: inv.invoiceNumber, amount: a.amount });
  }
  return created;
}

/** Sum of settled amounts for a set of invoices (for register badges). */
export async function settledTotalsByInvoice(
  firmId: string,
  invoiceIds: string[]
): Promise<Map<string, { settled: number; credited: number }>> {
  if (invoiceIds.length === 0) return new Map();
  const [allocGroups, creditGroups] = await Promise.all([
    db.receiptAllocation.groupBy({
      by: ["invoiceId"],
      where: { firmId, invoiceId: { in: invoiceIds } },
      _sum: { amount: true },
    }),
    db.salesReturn.groupBy({
      by: ["invoiceId"],
      where: { firmId, invoiceId: { in: invoiceIds }, customerId: { not: null } },
      _sum: { grandTotal: true },
    }),
  ]);
  const map = new Map<string, { settled: number; credited: number }>();
  for (const g of allocGroups) {
    map.set(g.invoiceId, { settled: round2(g._sum.amount ?? 0), credited: 0 });
  }
  for (const g of creditGroups) {
    if (!g.invoiceId) continue;
    const cur = map.get(g.invoiceId) ?? { settled: 0, credited: 0 };
    cur.credited = round2(g._sum.grandTotal ?? 0);
    map.set(g.invoiceId, cur);
  }
  return map;
}
