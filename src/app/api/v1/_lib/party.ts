// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PARTY / STOCK MUTATION HELPERS
// R7: party closing balances + LedgerEntry rows with running balanceAfter
// R3/R4: dual-stock pools + append-only InventoryMovement audit trail
// All helpers accept a Prisma transaction client (or the global db)
// so callers can compose atomic multi-table effects.
// ═══════════════════════════════════════════════════════════════

import { Prisma, PrismaClient } from "@prisma/client";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";

export type DbClient = PrismaClient | Prisma.TransactionClient;

// ─── Party balances ──────────────────────────────────────────────
// Customer: Dr-positive (they owe us). deltaDr > 0 increases receivable.
// Vendor:   Cr-positive (we owe them). deltaCr > 0 increases payable.

export async function updateCustomerBalance(
  client: DbClient,
  customerId: string,
  deltaDr: number
): Promise<number> {
  const c = await client.customer.update({
    where: { id: customerId },
    data: { closingBalance: { increment: round2(deltaDr) } },
  });
  return round2(c.closingBalance);
}

export async function updateVendorBalance(
  client: DbClient,
  vendorId: string,
  deltaCr: number
): Promise<number> {
  const v = await client.vendor.update({
    where: { id: vendorId },
    data: { closingBalance: { increment: round2(deltaCr) } },
  });
  return round2(v.closingBalance);
}

// ─── Party ledger rows ───────────────────────────────────────────
// balanceAfter is derived from the party's CURRENT closingBalance —
// callers MUST update the balance first (or twice for paired rows).

export interface LedgerEntryInput {
  entryDate: Date;
  voucherType: string;
  voucherNo?: string;
  particulars?: string;
  debit?: number;
  credit?: number;
}

export async function addCustomerLedger(
  client: DbClient,
  customerId: string,
  input: LedgerEntryInput
) {
  const c = await client.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { firmId: true, closingBalance: true },
  });
  return client.ledgerEntry.create({
    data: {
      firmId: c.firmId,
      partyType: "CUSTOMER",
      customerId,
      entryDate: input.entryDate,
      voucherType: input.voucherType,
      voucherNo: input.voucherNo ?? "",
      particulars: input.particulars ?? "",
      debitAmount: round2(input.debit ?? 0),
      creditAmount: round2(input.credit ?? 0),
      balanceAfter: round2(c.closingBalance),
    },
  });
}

export async function addVendorLedger(
  client: DbClient,
  vendorId: string,
  input: LedgerEntryInput
) {
  const v = await client.vendor.findUniqueOrThrow({
    where: { id: vendorId },
    select: { firmId: true, closingBalance: true },
  });
  return client.ledgerEntry.create({
    data: {
      firmId: v.firmId,
      partyType: "VENDOR",
      vendorId,
      entryDate: input.entryDate,
      voucherType: input.voucherType,
      voucherNo: input.voucherNo ?? "",
      particulars: input.particulars ?? "",
      debitAmount: round2(input.debit ?? 0),
      creditAmount: round2(input.credit ?? 0),
      balanceAfter: round2(v.closingBalance),
    },
  });
}

// ─── Inventory movements (append-only audit trail) ───────────────

export interface MovementInput {
  firmId: string;
  productId: string;
  movementType:
    | "PURCHASE_INWARD"
    | "SALES_OUTWARD"
    | "DAMAGE_QUARANTINE"
    | "SALES_RETURN_DAMAGE"
    | "PURCHASE_RETURN_DAMAGE"
    | "STOCK_ADJUSTMENT"
    | "WRITE_OFF"
    | "OPENING";
  quantity: number;
  targetPool: "SELLABLE" | "DAMAGED";
  direction: "IN" | "OUT";
  referenceDocId?: string;
  referenceNo?: string;
  notes?: string;
}

export async function recordMovement(client: DbClient, m: MovementInput) {
  return client.inventoryMovement.create({
    data: {
      firmId: m.firmId,
      productId: m.productId,
      movementType: m.movementType,
      quantity: round2(m.quantity),
      targetPool: m.targetPool,
      direction: m.direction,
      referenceDocId: m.referenceDocId ?? "",
      referenceNo: m.referenceNo ?? "",
      notes: m.notes ?? "",
    },
  });
}

// ─── Stock pool guards (R3/R4 — never negative) ──────────────────

export async function drawSellable(
  client: DbClient,
  product: { id: string; name: string; stockQuantity: number },
  qty: number
): Promise<void> {
  if (qty <= 0) return;
  if (product.stockQuantity < qty) {
    throw new BusinessError(
      "ERR_INSUFFICIENT_SELLABLE_STOCK",
      `Insufficient sellable stock for "${product.name}" (available ${product.stockQuantity}, requested ${qty})`,
      422
    );
  }
  await client.product.update({
    where: { id: product.id },
    data: { stockQuantity: { decrement: round2(qty) } },
  });
}

export async function drawDamaged(
  client: DbClient,
  product: { id: string; name: string; damagedStock: number },
  qty: number
): Promise<void> {
  if (qty <= 0) return;
  if (product.damagedStock < qty) {
    throw new BusinessError(
      "ERR_NEGATIVE_STOCK",
      `Damaged stock for "${product.name}" cannot go negative (available ${product.damagedStock}, requested ${qty})`,
      422
    );
  }
  await client.product.update({
    where: { id: product.id },
    data: { damagedStock: { decrement: round2(qty) } },
  });
}
