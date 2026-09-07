// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PAYMENT CORE (vendor payments + customer receipts)
// Shared by the payment routes and the seed route (R6/R7).
// ═══════════════════════════════════════════════════════════════

import { db, dbTx } from "@/lib/db";
import { ACC, postJournal } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";
import { addCustomerLedger, addVendorLedger, updateCustomerBalance, updateVendorBalance } from "./party";
import { createAllocations, type AllocationInput } from "./settlement";
import { createPaymentAllocations } from "./settlement-ap";

export interface VendorPaymentInput {
  vendorId: string;
  paymentDate: Date;
  amount: number;
  mode: string;
  utrRef?: string;
  notes?: string;
  /** Optional per-PO settlement plan (precise AP tracking). */
  allocations?: AllocationInput[];
}

const VALID_MODES = ["NEFT", "UPI", "CHEQUE", "CASH"];

export async function createVendorPayment(
  firm: { id: string },
  input: VendorPaymentInput
) {
  const vendor = await db.vendor.findFirst({ where: { id: input.vendorId, firmId: firm.id } });
  if (!vendor) throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found for this firm", 404);

  const amount = round2(input.amount);
  if (amount <= 0) throw new BusinessError("ERR_VALIDATION", "Payment amount must be positive", 400);
  if (!VALID_MODES.includes(input.mode)) {
    throw new BusinessError("ERR_VALIDATION", "mode must be NEFT, UPI, CHEQUE or CASH", 400);
  }

  // R7: vendor payable (Cr-positive) decreases. Negative balance allowed
  // (advance payment) — surfaced as a warning in the response.
  const result = await dbTx(async (tx) => {
    const created = await tx.vendorPayment.create({
      data: {
        firmId: firm.id,
        vendorId: vendor.id,
        paymentDate: input.paymentDate,
        amount,
        mode: input.mode,
        utrRef: input.utrRef ?? "",
        notes: input.notes ?? "",
      },
    });

    // Optional per-PO settlement (validated; remainder stays on account)
    const applied = await createPaymentAllocations(tx, {
      firmId: firm.id,
      paymentId: created.id,
      vendorId: vendor.id,
      paymentAmount: amount,
      allocations: input.allocations ?? [],
    });
    const allocated = round2(applied.reduce((s, a) => s + a.amount, 0));

    const newBalance = await updateVendorBalance(tx, vendor.id, -amount);
    const adjNote = applied.length
      ? ` — adj ${applied.map((a) => `${a.poNumber} ₹${a.amount.toFixed(2)}`).join(", ")}`
      : "";
    await addVendorLedger(tx, vendor.id, {
      entryDate: input.paymentDate,
      voucherType: "PAYMENT",
      voucherNo: input.utrRef || `PAY-${created.id.slice(-6).toUpperCase()}`,
      particulars: `Payment by ${input.mode}${input.utrRef ? ` (Ref ${input.utrRef})` : ""}${adjNote}`,
      debit: amount,
      credit: 0,
    });

    return { payment: created, newBalance, applied, allocated };
  });

  const journal = await postJournal({
    firmId: firm.id,
    voucherType: "PAYMENT",
    postingDate: input.paymentDate,
    narration: `Payment to ${vendor.vendorName}${input.utrRef ? ` — Ref ${input.utrRef}` : ""}${
      result.applied.length ? ` — settled ${result.applied.length} bill${result.applied.length !== 1 ? "s" : ""}` : " — on account"
    }`,
    referenceDocId: result.payment.id,
    lines: [
      { accountCode: ACC.AP, entrySide: "DEBIT", amount },
      { accountCode: input.mode === "CASH" ? ACC.CASH : ACC.BANK, entrySide: "CREDIT", amount },
    ],
  });

  const warning =
    result.newBalance < 0
      ? `Vendor balance is now negative (₹${result.newBalance.toFixed(2)}) — advance paid to ${vendor.vendorName}`
      : undefined;

  return {
    payment: result.payment,
    vendorBalance: result.newBalance,
    applied: result.applied,
    allocatedTotal: result.allocated,
    journal,
    ...(warning ? { warning } : {}),
  };
}

export interface CustomerReceiptInput {
  customerId: string;
  receiptDate: Date;
  amount: number;
  mode: string;
  utrRef?: string;
  notes?: string;
  /** Optional per-invoice settlement plan (precise AR tracking). */
  allocations?: AllocationInput[];
}

export async function createCustomerReceipt(
  firm: { id: string },
  input: CustomerReceiptInput
) {
  const customer = await db.customer.findFirst({ where: { id: input.customerId, firmId: firm.id } });
  if (!customer) throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found for this firm", 404);

  const amount = round2(input.amount);
  if (amount <= 0) throw new BusinessError("ERR_VALIDATION", "Receipt amount must be positive", 400);
  if (!VALID_MODES.includes(input.mode)) {
    throw new BusinessError("ERR_VALIDATION", "mode must be NEFT, UPI, CHEQUE or CASH", 400);
  }

  const result = await dbTx(async (tx) => {
    const created = await tx.customerReceipt.create({
      data: {
        firmId: firm.id,
        customerId: customer.id,
        receiptDate: input.receiptDate,
        amount,
        mode: input.mode,
        utrRef: input.utrRef ?? "",
        notes: input.notes ?? "",
      },
    });

    // Optional per-invoice settlement (validated; remainder stays on account)
    const applied = await createAllocations(tx, {
      firmId: firm.id,
      receiptId: created.id,
      customerId: customer.id,
      receiptAmount: amount,
      allocations: input.allocations ?? [],
    });
    const allocated = round2(applied.reduce((s, a) => s + a.amount, 0));

    const newBalance = await updateCustomerBalance(tx, customer.id, -amount);
    const adjNote = applied.length
      ? ` — adj ${applied.map((a) => `${a.invoiceNumber} ₹${a.amount.toFixed(2)}`).join(", ")}`
      : "";
    await addCustomerLedger(tx, customer.id, {
      entryDate: input.receiptDate,
      voucherType: "RECEIPT",
      voucherNo: input.utrRef || `RCPT-${created.id.slice(-6).toUpperCase()}`,
      particulars: `Receipt by ${input.mode}${input.utrRef ? ` (Ref ${input.utrRef})` : ""}${adjNote}`,
      debit: 0,
      credit: amount,
    });

    return { receipt: created, newBalance, applied, allocated };
  });

  const narration = `Receipt from ${customer.partyName}${input.utrRef ? ` — Ref ${input.utrRef}` : ""}${
    result.applied.length ? ` — settled ${result.applied.length} invoice${result.applied.length !== 1 ? "s" : ""}` : " — on account"
  }`;

  const journal = await postJournal({
    firmId: firm.id,
    voucherType: "RECEIPT",
    postingDate: input.receiptDate,
    narration,
    referenceDocId: result.receipt.id,
    lines: [
      { accountCode: input.mode === "CASH" ? ACC.CASH : ACC.BANK, entrySide: "DEBIT", amount },
      { accountCode: ACC.AR, entrySide: "CREDIT", amount },
    ],
  });

  const warning =
    result.newBalance < 0
      ? `Customer balance is now negative (₹${result.newBalance.toFixed(2)}) — advance received from ${customer.partyName}`
      : undefined;

  return {
    receipt: result.receipt,
    customerBalance: result.newBalance,
    applied: result.applied,
    allocatedTotal: result.allocated,
    journal,
    ...(warning ? { warning } : {}),
  };
}
