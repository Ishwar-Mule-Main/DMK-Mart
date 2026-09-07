// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PURCHASE ORDER CORE (create + GRN confirm)
// Shared by /purchase-orders routes and the seed route.
// Confirm effects: stock split (sellable + damaged quarantine), vendor
// payable, vendor ledger row, balanced PURCHASE journal (R6).
// ═══════════════════════════════════════════════════════════════

import { db, dbTx } from "@/lib/db";
import { ACC, fyLabelForDate, nextDocNumber, postJournal } from "@/lib/journal";
import { calculateGST, round2, sumGstSplits } from "@/lib/gst";
import { BusinessError } from "./api";
import { addVendorLedger, recordMovement, updateVendorBalance } from "./party";

export interface PoItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface ComputedPoItem {
  productId: string;
  sku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  unitCost: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface PoTotals {
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  hsnCode: string;
  gstRate: number;
};

/** Per-item taxable + GST split (seller = vendor state, buyer = firm state). */
export function computePoItems(
  products: ProductRow[],
  items: PoItemInput[],
  sellerStateCode: string,
  buyerStateCode: string
): { items: ComputedPoItem[] } & PoTotals {
  const byId = new Map(products.map((p) => [p.id, p]));
  const computed: ComputedPoItem[] = [];

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      throw new BusinessError("ERR_PRODUCT_NOT_FOUND", `Product ${item.productId} not found`, 404);
    }
    if (item.quantity <= 0) {
      throw new BusinessError("ERR_VALIDATION", `Quantity must be positive for ${product.sku}`, 400);
    }
    if (item.unitCost < 0) {
      throw new BusinessError("ERR_VALIDATION", `Unit cost cannot be negative for ${product.sku}`, 400);
    }
    const taxable = round2(item.quantity * item.unitCost);
    const gst = calculateGST(taxable, product.gstRate, sellerStateCode, buyerStateCode);
    computed.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      hsnCode: product.hsnCode,
      quantity: item.quantity,
      unitCost: round2(item.unitCost),
      taxableAmount: taxable,
      gstRate: product.gstRate,
      cgstAmount: gst.cgst,
      sgstAmount: gst.sgst,
      igstAmount: gst.igst,
      totalAmount: round2(taxable + gst.cgst + gst.sgst + gst.igst),
    });
  }

  if (computed.length === 0) {
    throw new BusinessError("ERR_EMPTY_ITEMS", "Purchase order requires at least one item", 400);
  }

  const subtotal = round2(computed.reduce((s, i) => s + i.taxableAmount, 0));
  const tax = sumGstSplits(computed.map((i) => ({ cgst: i.cgstAmount, sgst: i.sgstAmount, igst: i.igstAmount })));
  return {
    items: computed,
    subtotal,
    totalCgst: tax.cgst,
    totalSgst: tax.sgst,
    totalIgst: tax.igst,
    grandTotal: round2(subtotal + tax.cgst + tax.sgst + tax.igst),
  };
}

/** Create a PENDING purchase order (no stock / journal side effects). */
export async function createPurchaseOrder(input: {
  firmId: string;
  firmStateCode: string;
  vendorId: string;
  poDate: Date;
  notes?: string;
  vendorBillNo?: string;
  vendorBillDate?: Date | null;
  items: PoItemInput[];
  invoicePrefix: string;
  financialYear: string;
}) {
  const vendor = await db.vendor.findFirst({
    where: { id: input.vendorId, firmId: input.firmId },
  });
  if (!vendor) {
    throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found for this firm", 404);
  }

  const products = await db.product.findMany({
    where: { firmId: input.firmId, id: { in: input.items.map((i) => i.productId) } },
  });

  // Seller = vendor, buyer = the firm itself
  const totals = computePoItems(products, input.items, vendor.stateCode, input.firmStateCode);

  // PO number carries the FY of the PO date.
  const poNumber = await nextDocNumber("PO", input.firmId, input.invoicePrefix, fyLabelForDate(input.poDate));

  return db.purchaseOrder.create({
    data: {
      firmId: input.firmId,
      vendorId: vendor.id,
      poNumber,
      poDate: input.poDate,
      status: "PENDING",
      subtotal: totals.subtotal,
      totalCgst: totals.totalCgst,
      totalSgst: totals.totalSgst,
      totalIgst: totals.totalIgst,
      grandTotal: totals.grandTotal,
      notes: input.notes ?? "",
      vendorBillNo: (input.vendorBillNo ?? "").trim(),
      vendorBillDate: input.vendorBillDate ?? null,
      items: {
        create: totals.items.map((i) => ({
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          hsnCode: i.hsnCode,
          quantity: i.quantity,
          unitCost: i.unitCost,
          taxableAmount: i.taxableAmount,
          gstRate: i.gstRate,
          cgstAmount: i.cgstAmount,
          sgstAmount: i.sgstAmount,
          igstAmount: i.igstAmount,
          totalAmount: i.totalAmount,
        })),
      },
    },
    include: { items: true, vendor: { select: { id: true, vendorName: true } } },
  });
}

// ─── GRN / Confirm ───────────────────────────────────────────────

export interface ReceivedInput {
  itemId: string;
  acceptedQty: number;
  damagedQty: number;
}

export async function confirmPurchaseOrder(
  poId: string,
  opts: {
    received?: ReceivedInput[];
    receivedDate?: Date;
    note?: string;
    vendorBillNo?: string;
    vendorBillDate?: Date | null;
  } = {}
) {
  const po = await db.purchaseOrder.findUnique({
    where: { id: poId },
    include: { vendor: true, items: true },
  });
  if (!po) throw new BusinessError("ERR_NOT_FOUND", "Purchase order not found", 404);
  if (po.status !== "PENDING") {
    throw new BusinessError(
      "ERR_INVALID_STATUS",
      `PO ${po.poNumber} is ${po.status} — only PENDING orders can be received`,
      409
    );
  }

  const receivedMap = new Map((opts.received ?? []).map((r) => [r.itemId, r]));
  const receivedDate = opts.receivedDate ?? new Date();
  const note = opts.note ?? "";

  // Pre-validate received quantities
  for (const item of po.items) {
    const r = receivedMap.get(item.id);
    const accepted = r ? r.acceptedQty : item.quantity;
    const damaged = r ? r.damagedQty : 0;
    if (accepted < 0 || damaged < 0) {
      throw new BusinessError("ERR_VALIDATION", `Received quantities cannot be negative (${item.sku})`, 400);
    }
  }

  await dbTx(async (tx) => {
    for (const item of po.items) {
      const r = receivedMap.get(item.id);
      const accepted = r ? r.acceptedQty : item.quantity;
      const damaged = r ? r.damagedQty : 0;
      const receivedQty = round2(accepted + damaged);

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty },
      });

      if (accepted > 0) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: round2(accepted) } },
        });
        await recordMovement(tx, {
          firmId: po.firmId,
          productId: item.productId,
          movementType: "PURCHASE_INWARD",
          quantity: accepted,
          targetPool: "SELLABLE",
          direction: "IN",
          referenceDocId: po.id,
          referenceNo: po.poNumber,
          notes: `Goods received against PO ${po.poNumber}`,
        });
      }

      if (damaged > 0) {
        await tx.product.update({
          where: { id: item.productId },
          data: { damagedStock: { increment: round2(damaged) } },
        });
        await recordMovement(tx, {
          firmId: po.firmId,
          productId: item.productId,
          movementType: "DAMAGE_QUARANTINE",
          quantity: damaged,
          targetPool: "DAMAGED",
          direction: "IN",
          referenceDocId: po.id,
          referenceNo: po.poNumber,
          notes: `Damaged quantity quarantined from PO ${po.poNumber}`,
        });
      }
    }

    // Vendor payable (Cr-positive) increases by the invoice value
    await updateVendorBalance(tx, po.vendorId, po.grandTotal);
    await addVendorLedger(tx, po.vendorId, {
      entryDate: receivedDate,
      voucherType: "PURCHASE",
      voucherNo: po.poNumber,
      particulars: `Goods received against PO ${po.poNumber}`,
      debit: 0,
      credit: po.grandTotal,
    });

    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: {
        status: "CONFIRMED",
        receivedNote: note,
        // Bill identity can be captured at GRN time (bill arrives with goods)
        ...(opts.vendorBillNo !== undefined ? { vendorBillNo: opts.vendorBillNo.trim() } : {}),
        ...(opts.vendorBillDate !== undefined ? { vendorBillDate: opts.vendorBillDate } : {}),
      },
    });
  });

  // Journal posted after the mutation transaction commits (postJournal
  // uses the global Prisma client — never call it inside $transaction).
  const journal = await postJournal({
    firmId: po.firmId,
    voucherType: "PURCHASE",
    postingDate: receivedDate,
    narration: `PO ${po.poNumber} — goods receipt from ${po.vendor.vendorName}`,
    referenceDocId: po.id,
    lines: [
      { accountCode: ACC.INVENTORY, entrySide: "DEBIT", amount: po.subtotal },
      { accountCode: ACC.ITC, entrySide: "DEBIT", amount: round2(po.totalCgst + po.totalSgst + po.totalIgst) },
      { accountCode: ACC.AP, entrySide: "CREDIT", amount: po.grandTotal },
    ],
  });

  const updated = await db.purchaseOrder.findUnique({
    where: { id: po.id },
    include: { items: true, vendor: { select: { id: true, vendorName: true, closingBalance: true } } },
  });

  return { po: updated, journal };
}
