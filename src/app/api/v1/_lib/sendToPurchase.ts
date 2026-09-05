// ═══════════════════════════════════════════════════════════════
// Shared planner for "send sales returns → purchase returns".
// GOLDEN RULE (user command): a purchase return may ONLY be raised
// against sales-return quantity that has NOT already been sent to
// the vendor. Nothing is ever swept "on its own" from leftover
// damaged-pool stock — every planned unit traces back to one
// specific SalesReturnItem line, and that line is marked
// `sentToVendorQty` when the debit note is booked, so it can never
// be sent twice.
// Used by GET (preview for the selection dialog) and POST (execution)
// of /api/v1/sales-returns/send-to-purchase.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { calculateGST, round2, sumGstSplits } from "@/lib/gst";

export interface EligibleLine {
  itemId: string;
  salesReturnId: string;
  creditNoteNo: string;
  returnDate: Date;
  customerName: string | null;
  productId: string;
  sku: string;
  productName: string;
  damagedQty: number; // original returned qty on the credit note line
  sentToVendorQty: number; // already recovered to the vendor
  eligibleQty: number; // damagedQty - sentToVendorQty
  sendableQty: number; // min(eligibleQty, remaining damaged pool)
  poolQty: number; // damaged pool still available for this product at planning time
  vendorId: string | null;
  vendorName: string | null;
  unitCost: number; // latest CONFIRMED PO cost, fallback purchaseCost
  gstRate: number;
  estTaxable: number;
  estTotal: number; // incl. GST at the vendor's state
  poolBlocked: boolean; // sendableQty < eligibleQty (damaged stock short)
}

export interface PlannedSource {
  itemId: string;
  qty: number;
}

export interface PlannedLine {
  productId: string;
  qty: number;
  unitCost: number;
  gstRate: number;
  reason: string;
  sources: PlannedSource[];
  vendorId: string | null;
  taxable: number;
  gst: ReturnType<typeof calculateGST>;
  total: number;
}

export interface SendPlan {
  lines: EligibleLine[]; // every NOT-yet-fully-sent SR line (sendableQty may be 0 when pool is short)
  groups: Map<string, Map<string, PlannedLine>>; // vendorKey ("__none__" allowed) → productId → executable lines
  skipped: Array<{ creditNoteNo: string; sku: string; asked: number; available: number }>;
  totals: { lines: number; qty: number; taxable: number; value: number }; // over executable lines
  fullySentCount: number; // SR lines already fully recovered (context messaging)
  allRecovered: boolean; // sales returns exist but every line is fully recovered
}

export async function planSendToPurchase(
  firmId: string,
  firmStateCode: string,
  opts?: { selectedItemIds?: string[] },
): Promise<SendPlan> {
  const selected = opts?.selectedItemIds ? new Set(opts.selectedItemIds) : null;

  // ── 1. Every sales return of this firm, newest first ──────────
  const salesReturns = await db.salesReturn.findMany({
    where: { firmId },
    include: {
      items: true,
      customer: { select: { partyName: true } },
    },
    orderBy: { returnDate: "desc" },
  });

  const products = await db.product.findMany({ where: { firmId } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // ── 2. Vendor per product: vendor of the latest CONFIRMED PO ──
  const confirmedPos = await db.purchaseOrder.findMany({
    where: { firmId, status: "CONFIRMED" },
    orderBy: { poDate: "desc" },
    select: {
      id: true,
      poNumber: true,
      vendorId: true,
      items: { select: { productId: true, unitCost: true } },
    },
  });
  const vendorByProduct = new Map<string, { vendorId: string; unitCost: number; poNumber: string }>();
  for (const po of confirmedPos) {
    for (const pi of po.items) {
      if (!vendorByProduct.has(pi.productId)) {
        vendorByProduct.set(pi.productId, {
          vendorId: po.vendorId,
          unitCost: pi.unitCost,
          poNumber: po.poNumber,
        });
      }
    }
  }
  const vendorIds = [...new Set([...vendorByProduct.values()].map((v) => v.vendorId))];
  const vendors = await db.vendor.findMany({
    where: { id: { in: vendorIds }, firmId },
    select: { id: true, vendorName: true, stateCode: true },
  });
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  // ── 3. Plan ONLY from not-yet-sent sales-return quantity ──────
  const pool = new Map<string, number>(); // productId → remaining damaged qty
  const lines: EligibleLine[] = [];
  const planned = new Map<string, Map<string, PlannedLine>>();
  const skipped: Array<{ creditNoteNo: string; sku: string; asked: number; available: number }> = [];
  let fullySentCount = 0;

  for (const sr of salesReturns) {
    for (const item of sr.items) {
      const product = productMap.get(item.productId);
      const remaining = round2(item.damagedQty - item.sentToVendorQty);

      if (remaining <= 0) {
        fullySentCount += 1;
        continue; // ALREADY recovered to the vendor — never planned again
      }
      if (selected && !selected.has(item.id)) continue; // user left this line out

      if (!product) continue;

      const available = pool.get(product.id) ?? product.damagedStock;
      const qty = round2(Math.min(remaining, available));
      pool.set(product.id, round2(available - qty));

      const src = vendorByProduct.get(product.id) ?? null;
      const vendor = src ? vendorMap.get(src.vendorId) ?? null : null;
      const unitCost = src?.unitCost ?? product.purchaseCost;
      const sellerState = vendor?.stateCode ?? firmStateCode;
      const estTaxable = round2(qty * unitCost);
      const estGst = calculateGST(estTaxable, product.gstRate, sellerState, firmStateCode);
      const estTotal = round2(estTaxable + estGst.cgst + estGst.sgst + estGst.igst);

      if (qty <= 0) {
        skipped.push({ creditNoteNo: sr.creditNoteNo, sku: product.sku, asked: remaining, available });
      }

      lines.push({
        itemId: item.id,
        salesReturnId: sr.id,
        creditNoteNo: sr.creditNoteNo,
        returnDate: sr.returnDate,
        customerName: sr.customer?.partyName ?? null,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        damagedQty: item.damagedQty,
        sentToVendorQty: item.sentToVendorQty,
        eligibleQty: remaining,
        sendableQty: qty,
        poolQty: available,
        vendorId: src?.vendorId ?? null,
        vendorName: vendor?.vendorName ?? null,
        unitCost,
        gstRate: product.gstRate,
        estTaxable,
        estTotal,
        poolBlocked: qty < remaining,
      });

      if (qty <= 0) continue;

      const groupKey = src?.vendorId ?? "__none__";
      if (!planned.has(groupKey)) planned.set(groupKey, new Map());
      const group = planned.get(groupKey)!;
      const existing = group.get(product.id);
      if (existing) {
        existing.qty = round2(existing.qty + qty);
        existing.sources.push({ itemId: item.id, qty });
        existing.taxable = round2(existing.qty * existing.unitCost);
        existing.gst = calculateGST(existing.taxable, existing.gstRate, sellerState, firmStateCode);
        existing.total = round2(existing.taxable + existing.gst.cgst + existing.gst.sgst + existing.gst.igst);
      } else {
        group.set(product.id, {
          productId: product.id,
          qty,
          unitCost,
          gstRate: product.gstRate,
          reason: `Sales return recovery (${item.defectType})`,
          sources: [{ itemId: item.id, qty }],
          vendorId: src?.vendorId ?? null,
          taxable: estTaxable,
          gst: estGst,
          total: estTotal,
        });
      }
    }
  }

  const executable = [...planned.values()].flatMap((m) => [...m.values()]);
  const totals = {
    lines: executable.length,
    qty: round2(executable.reduce((s, l) => s + l.qty, 0)),
    taxable: round2(executable.reduce((s, l) => s + l.taxable, 0)),
    value: round2(executable.reduce((s, l) => s + l.total, 0)),
  };

  return {
    lines,
    groups: planned,
    skipped,
    totals,
    fullySentCount,
    allRecovered: fullySentCount > 0 && lines.length === 0,
  };
}

// GST split sum helper re-exported for the route's journal lines
export function planGstSplits(lines: PlannedLine[]) {
  return sumGstSplits(lines.map((l) => ({ cgst: l.gst.cgst, sgst: l.gst.sgst, igst: l.gst.igst })));
}
