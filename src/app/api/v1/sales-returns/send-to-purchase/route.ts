// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-returns/send-to-purchase — ONE-CLICK bulk recovery
// Sends EVERY sales-return line (all credit notes) back to the
// vendor as purchase-return debit notes:
//   · lines grouped by the vendor the product was last bought from
//     (latest CONFIRMED PO per product; fallback = no vendor)
//   · qty capped by the product's available DAMAGED pool —
//     lines that cannot be covered are skipped, never negative stock
//   · per vendor group: DAMAGED stock ↓, vendor payable ↓,
//     DEBIT_NOTE journal — the same pipeline as a manual debit note
// Body: { firmId, returnDate? }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, nextDocNumber, postJournal } from "@/lib/journal";
import { calculateGST, round2, sumGstSplits } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getDate,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  addVendorLedger,
  drawDamaged,
  recordMovement,
  updateVendorBalance,
} from "@/app/api/v1/_lib/party";

interface PlannedLine {
  productId: string;
  damagedQty: number;
  unitCost: number;
  gstRate: number;
  reason: string;
  creditNotes: string[];
  vendorId: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const returnDate = getDate(body.returnDate);

    // ── 1. Every sales return of this firm, newest first ──────────
    const salesReturns = await db.salesReturn.findMany({
      where: { firmId: firm.id },
      include: { items: true },
      orderBy: { returnDate: "desc" },
    });
    if (salesReturns.length === 0) {
      throw new BusinessError("ERR_EMPTY_ITEMS", "No sales returns to send back to vendors", 400);
    }

    const products = await db.product.findMany({ where: { firmId: firm.id } });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // ── 2. Vendor per product: vendor of the latest CONFIRMED PO ──
    const confirmedPos = await db.purchaseOrder.findMany({
      where: { firmId: firm.id, status: "CONFIRMED" },
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

    // ── 3. Plan lines — cap by available damaged pool ─────────────
    const pool = new Map<string, number>(); // productId → remaining damaged qty
    const planned = new Map<string, Map<string, PlannedLine>>(); // vendorId → productId → line
    const skipped: Array<{ sku: string; asked: number; available: number }> = [];

    for (const sr of salesReturns) {
      for (const item of sr.items) {
        const product = productMap.get(item.productId);
        if (!product) continue;
        const available = pool.get(product.id) ?? product.damagedStock;
        const qty = Math.min(item.damagedQty, available);
        pool.set(product.id, available - qty);

        if (qty <= 0) {
          skipped.push({ sku: product.sku, asked: item.damagedQty, available });
          continue;
        }

        const src = vendorByProduct.get(product.id) ?? null;
        const groupKey = src?.vendorId ?? "__none__";
        if (!planned.has(groupKey)) planned.set(groupKey, new Map());
        const group = planned.get(groupKey)!;
        const existing = group.get(product.id);
        if (existing) {
          existing.damagedQty = round2(existing.damagedQty + qty);
          if (!existing.creditNotes.includes(sr.creditNoteNo)) existing.creditNotes.push(sr.creditNoteNo);
        } else {
          group.set(product.id, {
            productId: product.id,
            damagedQty: qty,
            unitCost: src?.unitCost ?? product.purchaseCost,
            gstRate: product.gstRate,
            reason: `Sales return recovery (${item.defectType})`,
            creditNotes: [sr.creditNoteNo],
            vendorId: src?.vendorId ?? null,
          });
        }
      }
    }

    if (planned.size === 0) {
      throw new BusinessError(
        "ERR_NOTHING_TO_SEND",
        skipped.length > 0
          ? "All returned qty has already been recovered — damaged pools are empty"
          : "Nothing eligible to send",
        409
      );
    }

    const vendorIds = [...planned.keys()].filter((k) => k !== "__none__");
    const vendors = await db.vendor.findMany({
      where: { id: { in: vendorIds }, firmId: firm.id },
    });
    const vendorMap = new Map(vendors.map((v) => [v.id, v]));

    // ── 4. One debit note per vendor group ─────────────────────────
    const created: Array<{
      debitNoteNo: string;
      vendorName: string | null;
      items: number;
      qty: number;
      total: number;
    }> = [];

    for (const [groupKey, linesMap] of planned) {
      const lines = [...linesMap.values()];
      const vendor = groupKey === "__none__" ? null : vendorMap.get(groupKey) ?? null;
      const sellerState = vendor?.stateCode ?? firm.stateCode;

      const computed = lines.map((l) => {
        const taxable = round2(l.damagedQty * l.unitCost);
        const gst = calculateGST(taxable, l.gstRate, sellerState, firm.stateCode);
        return { ...l, taxable, gst, total: round2(taxable + gst.cgst + gst.sgst + gst.igst) };
      });
      const subtotal = round2(computed.reduce((s, c) => s + c.taxable, 0));
      const tax = sumGstSplits(computed.map((c) => ({ cgst: c.gst.cgst, sgst: c.gst.sgst, igst: c.gst.igst })));
      const totalTax = round2(tax.cgst + tax.sgst + tax.igst);
      const grandTotal = round2(subtotal + totalTax);

      const debitNoteNo = await nextDocNumber("DN", firm.id, firm.invoicePrefix, firm.financialYear);
      const notes = `Auto: all sales returns sent to vendor — sources ${computed
        .flatMap((c) => c.creditNotes)
        .slice(0, 8)
        .join(", ")}`;

      const returnId = await db.$transaction(async (tx) => {
        const row = await tx.purchaseReturn.create({
          data: {
            firmId: firm.id,
            debitNoteNo,
            poRef: "",
            vendorId: vendor?.id ?? null,
            returnDate,
            subtotal,
            totalTax,
            grandTotal,
            notes,
            items: {
              create: computed.map((c) => ({
                productId: c.productId,
                damagedQty: c.damagedQty,
                unitCost: c.unitCost,
                gstRate: c.gstRate,
                totalAmount: c.total,
                reason: c.reason,
              })),
            },
          },
          select: { id: true },
        });

        for (const c of computed) {
          const product = productMap.get(c.productId)!;
          await drawDamaged(tx, product, c.damagedQty);
          await recordMovement(tx, {
            firmId: firm.id,
            productId: c.productId,
            movementType: "PURCHASE_RETURN_DAMAGE",
            quantity: c.damagedQty,
            targetPool: "DAMAGED",
            direction: "OUT",
            referenceDocId: row.id,
            referenceNo: debitNoteNo,
            notes: `Bulk sales-return recovery — ${debitNoteNo}`,
          });
        }

        if (vendor) {
          await updateVendorBalance(tx, vendor.id, -grandTotal);
          await addVendorLedger(tx, vendor.id, {
            entryDate: returnDate,
            voucherType: "DEBIT_NOTE",
            voucherNo: debitNoteNo,
            particulars: `Bulk purchase return from sales returns — ${debitNoteNo}`,
            debit: grandTotal,
            credit: 0,
          });
        }

        return row.id;
      });

      await postJournal({
        firmId: firm.id,
        voucherType: "DEBIT_NOTE",
        postingDate: returnDate,
        narration: `Debit note ${debitNoteNo} — bulk recovery of sales returns${vendor ? ` from ${vendor.vendorName}` : ""}`,
        referenceDocId: returnId,
        lines: [
          { accountCode: ACC.AP, entrySide: "DEBIT", amount: grandTotal },
          { accountCode: ACC.PURCHASES, entrySide: "CREDIT", amount: subtotal },
          ...(tax.cgst > 0 ? [{ accountCode: ACC.GST_CGST, entrySide: "CREDIT" as const, amount: tax.cgst }] : []),
          ...(tax.sgst > 0 ? [{ accountCode: ACC.GST_SGST, entrySide: "CREDIT" as const, amount: tax.sgst }] : []),
          ...(tax.igst > 0 ? [{ accountCode: ACC.GST_IGST, entrySide: "CREDIT" as const, amount: tax.igst }] : []),
        ],
      });

      created.push({
        debitNoteNo,
        vendorName: vendor?.vendorName ?? null,
        items: computed.length,
        qty: round2(computed.reduce((s, c) => s + c.damagedQty, 0)),
        total: grandTotal,
      });
    }

    const totalValue = round2(created.reduce((s, c) => s + c.total, 0));

    return ok(
      {
        created,
        skipped,
        totals: {
          debitNotes: created.length,
          items: created.reduce((s, c) => s + c.items, 0),
          qty: round2(created.reduce((s, c) => s + c.qty, 0)),
          value: totalValue,
        },
        message:
          `${created.length} debit note${created.length === 1 ? "" : "s"} created — ` +
          `damaged stock drawn down${skipped.length > 0 ? `, ${skipped.length} line(s) skipped (pool empty)` : ""}`,
      },
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
