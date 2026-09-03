// ═══════════════════════════════════════════════════════════════
// /api/v1/purchase-returns — damaged goods back to vendor (R5)
// DAMAGED stock ↓, vendor payable ↓, DEBIT_NOTE journal (R6/R7)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, nextDocNumber, postJournal } from "@/lib/journal";
import { calculateGST, round2, sumGstSplits } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getDate,
  getNum,
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

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const returns = await db.purchaseReturn.findMany({
      where: { firmId },
      include: {
        vendor: { select: { id: true, vendorName: true } },
        items: true,
      },
      orderBy: { returnDate: "desc" },
      take: 200,
    });
    return ok(returns);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const vendorId = getStr(body.vendorId) || null;
    const poId = getStr(body.poId) || null;
    const returnDate = getDate(body.returnDate);

    const rawItems = asRecordArray(body.items);
    if (rawItems.length === 0) {
      throw new BusinessError("ERR_EMPTY_ITEMS", "Purchase return requires at least one item", 400);
    }

    const vendor = vendorId
      ? await db.vendor.findFirst({ where: { id: vendorId, firmId: firm.id } })
      : null;
    if (vendorId && !vendor) {
      throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found for this firm", 404);
    }
    const po = poId
      ? await db.purchaseOrder.findFirst({ where: { id: poId, firmId: firm.id } })
      : null;

    const productIds = [...new Set(rawItems.map((i) => getStr(i.productId)))];
    const products = await db.product.findMany({
      where: { firmId: firm.id, id: { in: productIds } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // ── Compute lines ──────────────────────────────────────────────
    // Seller = vendor state (fallback firm), buyer = firm
    const sellerState = vendor?.stateCode ?? firm.stateCode;
    interface ComputedReturnItem {
      productId: string;
      damagedQty: number;
      unitCost: number;
      gstRate: number;
      taxableAmount: number;
      cgstAmount: number;
      sgstAmount: number;
      igstAmount: number;
      totalAmount: number;
      reason: string;
    }
    const items: ComputedReturnItem[] = [];

    for (const raw of rawItems) {
      const product = productMap.get(getStr(raw.productId));
      if (!product) {
        throw new BusinessError("ERR_PRODUCT_NOT_FOUND", `Product ${getStr(raw.productId)} not found`, 404);
      }
      const damagedQty = getNum(raw.damagedQty);
      if (damagedQty <= 0) {
        throw new BusinessError("ERR_VALIDATION", `Return quantity must be positive for ${product.sku}`, 400);
      }
      // R3: returns come out of the DAMAGED pool only
      if (product.damagedStock < damagedQty) {
        throw new BusinessError(
          "ERR_NEGATIVE_STOCK",
          `Damaged stock for "${product.name}" cannot go negative (available ${product.damagedStock}, returning ${damagedQty})`,
          422
        );
      }
      const unitCost = raw.unitCost !== undefined ? round2(getNum(raw.unitCost)) : round2(product.purchaseCost);
      const taxable = round2(damagedQty * unitCost);
      const gst = calculateGST(taxable, product.gstRate, sellerState, firm.stateCode);
      items.push({
        productId: product.id,
        damagedQty,
        unitCost,
        gstRate: product.gstRate,
        taxableAmount: taxable,
        cgstAmount: gst.cgst,
        sgstAmount: gst.sgst,
        igstAmount: gst.igst,
        totalAmount: round2(taxable + gst.cgst + gst.sgst + gst.igst),
        reason: getStr(raw.reason) || "Transit Damage",
      });
    }

    const subtotal = round2(items.reduce((s, i) => s + i.taxableAmount, 0));
    const tax = sumGstSplits(items.map((i) => ({ cgst: i.cgstAmount, sgst: i.sgstAmount, igst: i.igstAmount })));
    const totalTax = round2(tax.cgst + tax.sgst + tax.igst);
    const grandTotal = round2(subtotal + totalTax);

    const debitNoteNo = await nextDocNumber("DN", firm.id, firm.invoicePrefix, firm.financialYear);

    const returnId = await db.$transaction(async (tx) => {
      const created = await tx.purchaseReturn.create({
        data: {
          firmId: firm.id,
          debitNoteNo,
          poRef: po?.poNumber ?? "",
          poId: po?.id ?? null,
          vendorId: vendor?.id ?? null,
          returnDate,
          subtotal,
          totalTax,
          grandTotal,
          notes: getStr(body.notes),
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              damagedQty: i.damagedQty,
              unitCost: i.unitCost,
              gstRate: i.gstRate,
              totalAmount: i.totalAmount,
              reason: i.reason,
            })),
          },
        },
        select: { id: true },
      });

      for (const item of items) {
        const product = productMap.get(item.productId)!;
        await drawDamaged(tx, product, item.damagedQty);
        await recordMovement(tx, {
          firmId: firm.id,
          productId: item.productId,
          movementType: "PURCHASE_RETURN_DAMAGE",
          quantity: item.damagedQty,
          targetPool: "DAMAGED",
          direction: "OUT",
          referenceDocId: created.id,
          referenceNo: debitNoteNo,
          notes: `Returned to vendor (${item.reason}) — ${debitNoteNo}`,
        });
      }

      if (vendor) {
        await updateVendorBalance(tx, vendor.id, -grandTotal);
        await addVendorLedger(tx, vendor.id, {
          entryDate: returnDate,
          voucherType: "DEBIT_NOTE",
          voucherNo: debitNoteNo,
          particulars: `Purchase return — debit note ${debitNoteNo}`,
          debit: grandTotal,
          credit: 0,
        });
      }

      return created.id;
    });

    const journal = await postJournal({
      firmId: firm.id,
      voucherType: "DEBIT_NOTE",
      postingDate: returnDate,
      narration: `Debit note ${debitNoteNo} — purchase return${vendor ? ` to ${vendor.vendorName}` : ""}`,
      referenceDocId: returnId,
      lines: [
        { accountCode: ACC.AP, entrySide: "DEBIT", amount: grandTotal },
        { accountCode: ACC.PURCHASES, entrySide: "CREDIT", amount: subtotal },
        ...(tax.cgst > 0 ? [{ accountCode: ACC.GST_CGST, entrySide: "CREDIT" as const, amount: tax.cgst }] : []),
        ...(tax.sgst > 0 ? [{ accountCode: ACC.GST_SGST, entrySide: "CREDIT" as const, amount: tax.sgst }] : []),
        ...(tax.igst > 0 ? [{ accountCode: ACC.GST_IGST, entrySide: "CREDIT" as const, amount: tax.igst }] : []),
      ],
    });

    const created = await db.purchaseReturn.findUnique({
      where: { id: returnId },
      include: { items: true, vendor: { select: { id: true, vendorName: true, closingBalance: true } } },
    });

    return ok({ purchaseReturn: created, journal }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
