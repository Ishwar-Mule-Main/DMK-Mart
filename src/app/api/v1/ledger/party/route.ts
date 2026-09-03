// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/party — full party statement (R7)
// opening → LedgerEntry rows (chronological, running balanceAfter) → closing
// PLUS settlement context: RECEIPT / PAYMENT rows carry a voucherNo
// that deterministically maps back to the receipt/payment record
// (writer formula: utrRef || RCPT-/PAY- + id suffix), so the UI can
// drill into exactly which invoices / POs each settlement closed —
// per-invoice (ReceiptAllocation) and per-PO (PaymentAllocation).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export interface SettlementLine {
  docNumber: string; // invoice number (AR) or PO number (AP)
  docDate: string;
  docTotal: number;
  allocated: number;
}

export interface SettlementDetail {
  id: string;
  date: string;
  amount: number;
  mode: string;
  ref: string;
  notes: string;
  lines: SettlementLine[];
  allocatedTotal: number;
  unapplied: number;
}

/** The exact voucherNo formula the payment writers use. */
function receiptVoucherNo(utrRef: string, id: string): string {
  return utrRef || `RCPT-${id.slice(-6).toUpperCase()}`;
}
function paymentVoucherNo(utrRef: string, id: string): string {
  return utrRef || `PAY-${id.slice(-6).toUpperCase()}`;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const partyType = getStr(sp.get("partyType")).toUpperCase();
    const partyId = getStr(sp.get("partyId"));
    if (!["CUSTOMER", "VENDOR"].includes(partyType)) {
      throw new BusinessError("ERR_VALIDATION", "partyType must be CUSTOMER or VENDOR", 400);
    }
    if (!partyId) throw new BusinessError("ERR_VALIDATION", "partyId is required", 400);

    if (partyType === "CUSTOMER") {
      const party = await db.customer.findFirst({ where: { id: partyId, firmId } });
      if (!party) throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found", 404);
      const [entries, receipts] = await Promise.all([
        db.ledgerEntry.findMany({
          where: { firmId, customerId: partyId },
          orderBy: { entryDate: "asc" },
        }),
        // Settlement context for RECEIPT rows (per-invoice allocations, cycle 13)
        db.customerReceipt.findMany({
          where: { firmId, customerId: partyId },
          include: {
            allocations: {
              include: { invoice: { select: { invoiceNumber: true, invoiceDate: true, grandTotal: true } } },
            },
          },
        }),
      ]);

      const settlements: Record<string, SettlementDetail> = {};
      for (const r of receipts) {
        const lines = r.allocations.map((a) => ({
          docNumber: a.invoice.invoiceNumber,
          docDate: a.invoice.invoiceDate.toISOString(),
          docTotal: a.invoice.grandTotal,
          allocated: a.amount,
        }));
        const allocatedTotal = lines.reduce((s, l) => s + l.allocated, 0);
        settlements[receiptVoucherNo(r.utrRef, r.id)] = {
          id: r.id,
          date: r.receiptDate.toISOString(),
          amount: r.amount,
          mode: r.mode,
          ref: r.utrRef,
          notes: r.notes,
          lines,
          allocatedTotal,
          unapplied: Math.round((r.amount - allocatedTotal) * 100) / 100,
        };
      }

      return ok({
        partyType,
        party: {
          id: party.id,
          name: party.partyName,
          customerType: party.customerType,
          stateCode: party.stateCode,
          creditLimit: party.creditLimit,
          creditDays: party.creditDays,
        },
        opening: party.openingBalance,
        entries,
        closing: party.closingBalance,
        settlements,
      });
    }

    const party = await db.vendor.findFirst({ where: { id: partyId, firmId } });
    if (!party) throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found", 404);
    const [entries, payments] = await Promise.all([
      db.ledgerEntry.findMany({
        where: { firmId, vendorId: partyId },
        orderBy: { entryDate: "asc" },
      }),
      // Settlement context for PAYMENT rows (per-PO allocations, cycle 14)
      db.vendorPayment.findMany({
        where: { firmId, vendorId: partyId },
        include: {
          allocations: {
            include: { purchaseOrder: { select: { poNumber: true, poDate: true, grandTotal: true } } },
          },
        },
      }),
    ]);

    const settlements: Record<string, SettlementDetail> = {};
    for (const p of payments) {
      const lines = p.allocations.map((a) => ({
        docNumber: a.purchaseOrder.poNumber,
        docDate: a.purchaseOrder.poDate.toISOString(),
        docTotal: a.purchaseOrder.grandTotal,
        allocated: a.amount,
      }));
      const allocatedTotal = lines.reduce((s, l) => s + l.allocated, 0);
      settlements[paymentVoucherNo(p.utrRef, p.id)] = {
        id: p.id,
        date: p.paymentDate.toISOString(),
        amount: p.amount,
        mode: p.mode,
        ref: p.utrRef,
        notes: p.notes,
        lines,
        allocatedTotal,
        unapplied: Math.round((p.amount - allocatedTotal) * 100) / 100,
      };
    }

    return ok({
      partyType,
      party: {
        id: party.id,
        name: party.vendorName,
        vendorType: party.vendorType,
        brand: party.brand,
        stateCode: party.stateCode,
        paymentTerms: party.paymentTerms,
      },
      opening: party.openingBalance,
      entries,
      closing: party.closingBalance,
      settlements,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
