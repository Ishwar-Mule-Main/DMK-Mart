// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-returns/send-to-purchase — selective recovery
//
//   GET  → preview: every sales-return line NOT yet sent to the
//          vendor (eligibleQty = damagedQty − sentToVendorQty),
//          capped by the product's available damaged pool, with a
//          per-vendor value estimate. Powers the selection dialog —
//          the user sees and picks exactly what will be sent.
//   POST → body { firmId, returnDate?, itemIds? }:
//          · plans ONLY from the selected unsent lines (nothing is
//            swept from leftover damaged-pool stock on its own)
//          · lines grouped by the vendor the product was last
//            bought from (latest CONFIRMED PO; fallback no vendor)
//          · per vendor group: DEBIT_NOTE, DAMAGED stock ↓, vendor
//            payable ↓, and each source SalesReturnItem is marked
//            sentToVendorQty += qty INSIDE the same transaction so
//            a line can never be recovered twice
//          · if every line is already recovered → 409, nothing is
//            created
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, nextDocNumber, postJournal } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  asRecord,
  asStringArray,
  BusinessError,
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
import { planGstSplits, planSendToPurchase } from "@/app/api/v1/_lib/sendToPurchase";

// ─── GET — preview what CAN be sent (no side effects) ───────────
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));
    const plan = await planSendToPurchase(firm.id, firm.stateCode);

    return ok({
      lines: plan.lines.map((l) => ({ ...l, returnDate: l.returnDate.toISOString() })),
      skipped: plan.skipped,
      totals: plan.totals,
      fullySentCount: plan.fullySentCount,
      allRecovered: plan.allRecovered,
      message: plan.allRecovered
        ? "Every sales-return quantity has already been sent to vendors — nothing left to recover."
        : plan.lines.length === 0
          ? "No sales returns recorded yet."
          : `${plan.lines.length} sales-return line${plan.lines.length === 1 ? "" : "s"} pending vendor recovery.`,
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── POST — execute the selected lines only ─────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const returnDate = getDate(body.returnDate);
    const itemIds = asStringArray(body.itemIds);

    const plan = await planSendToPurchase(firm.id, firm.stateCode, {
      selectedItemIds: itemIds.length > 0 ? itemIds : undefined,
    });

    if (plan.groups.size === 0) {
      if (plan.allRecovered) {
        throw new BusinessError(
          "ERR_NOTHING_TO_SEND",
          "Every sales-return quantity has already been sent to vendors — nothing left to recover.",
          409,
        );
      }
      if (plan.totals.qty <= 0) {
        throw new BusinessError(
          "ERR_NOTHING_TO_SEND",
          "Damaged stock is empty for every pending line — those returned goods are no longer in the damaged pool (already recovered or written off).",
          409,
        );
      }
      throw new BusinessError("ERR_NOTHING_TO_SEND", "Nothing selected to send to vendors", 409);
    }

    const vendorKeys = [...plan.groups.keys()].filter((k) => k !== "__none__");
    const vendors = await db.vendor.findMany({
      where: { id: { in: vendorKeys }, firmId: firm.id },
    });
    const vendorMap = new Map(vendors.map((v) => [v.id, v]));

    // ── One debit note per vendor group ─────────────────────────────
    const created: Array<{
      debitNoteNo: string;
      vendorName: string | null;
      items: number;
      qty: number;
      total: number;
    }> = [];

    for (const [groupKey, linesMap] of plan.groups) {
      const lines = [...linesMap.values()];
      const vendor = groupKey === "__none__" ? null : vendorMap.get(groupKey) ?? null;

      const subtotal = round2(lines.reduce((s, l) => s + l.taxable, 0));
      const tax = planGstSplits(lines);
      const totalTax = round2(tax.cgst + tax.sgst + tax.igst);
      const grandTotal = round2(subtotal + totalTax);

      const debitNoteNo = await nextDocNumber("DN", firm.id, firm.invoicePrefix, firm.financialYear);
      const sourceCreditNotes = [
        ...new Set(
          plan.lines
            .filter((l) => lines.some((pl) => pl.sources.some((s) => s.itemId === l.itemId)))
            .map((l) => l.creditNoteNo),
        ),
      ];
      const notes = `Auto: selected sales returns sent to vendor — sources ${sourceCreditNotes.slice(0, 8).join(", ")}`;

      const returnId = await db.$transaction(async (tx) => {
        const products = await db.product.findMany({
          where: { id: { in: lines.map((l) => l.productId) } },
          select: { id: true, name: true, damagedStock: true },
        });
        const pmap = new Map(products.map((p) => [p.id, p]));

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
              create: lines.map((l) => ({
                productId: l.productId,
                damagedQty: l.qty,
                unitCost: l.unitCost,
                gstRate: l.gstRate,
                totalAmount: l.total,
                reason: l.reason,
              })),
            },
          },
          select: { id: true },
        });

        for (const l of lines) {
          const product = pmap.get(l.productId);
          if (!product) continue;
          await drawDamaged(tx, product, l.qty);
          await recordMovement(tx, {
            firmId: firm.id,
            productId: l.productId,
            movementType: "PURCHASE_RETURN_DAMAGE",
            quantity: l.qty,
            targetPool: "DAMAGED",
            direction: "OUT",
            referenceDocId: row.id,
            referenceNo: debitNoteNo,
            notes: `Sales-return recovery — ${debitNoteNo}`,
          });
        }

        // MARK the source lines as recovered — inside the same transaction,
        // so a sales-return line can never be sent to the vendor twice
        for (const l of lines) {
          for (const s of l.sources) {
            await tx.salesReturnItem.update({
              where: { id: s.itemId },
              data: { sentToVendorQty: { increment: s.qty } },
            });
          }
        }

        if (vendor) {
          await updateVendorBalance(tx, vendor.id, -grandTotal);
          await addVendorLedger(tx, vendor.id, {
            entryDate: returnDate,
            voucherType: "DEBIT_NOTE",
            voucherNo: debitNoteNo,
            particulars: `Purchase return from sales returns — ${debitNoteNo}`,
            debit: grandTotal,
            credit: 0,
          });
        }

        return row.id;
      });

      void returnId;

      await postJournal({
        firmId: firm.id,
        voucherType: "DEBIT_NOTE",
        postingDate: returnDate,
        narration: `Debit note ${debitNoteNo} — recovery of sales returns${vendor ? ` from ${vendor.vendorName}` : ""}`,
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
        items: lines.length,
        qty: round2(lines.reduce((s, l) => s + l.qty, 0)),
        total: grandTotal,
      });
    }

    const totalValue = round2(created.reduce((s, c) => s + c.total, 0));

    return ok(
      {
        created,
        skipped: plan.skipped,
        totals: {
          debitNotes: created.length,
          items: created.reduce((s, c) => s + c.items, 0),
          qty: round2(created.reduce((s, c) => s + c.qty, 0)),
          value: totalValue,
        },
        message:
          `${created.length} debit note${created.length === 1 ? "" : "s"} created — ` +
          `damaged stock drawn down${plan.skipped.length > 0 ? `, ${plan.skipped.length} line(s) short of damaged stock` : ""}`,
      },
      201,
    );
  } catch (e) {
    return handleApiError(e);
  }
}
