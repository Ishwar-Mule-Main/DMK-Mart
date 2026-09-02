// ═══════════════════════════════════════════════════════════════
// /api/v1/purchase-orders/[id] — detail + re-edit (PENDING only)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { computePoItems } from "@/app/api/v1/_lib/po";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const po = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, vendorName: true, vendorType: true, brand: true, stateCode: true, gstin: true } },
        items: true,
      },
    });
    if (!po) throw new BusinessError("ERR_NOT_FOUND", "Purchase order not found", 404);
    return ok(po);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const po = await db.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
    if (!po) throw new BusinessError("ERR_NOT_FOUND", "Purchase order not found", 404);
    if (po.status !== "PENDING") {
      throw new BusinessError(
        "ERR_NOT_EDITABLE",
        `PO ${po.poNumber} is ${po.status} and can no longer be edited`,
        409
      );
    }

    const body = asRecord(await request.json().catch(() => ({})));
    const data: Record<string, string | Date> = {};
    const poDate = getDateOrNull(body.poDate);
    if (poDate) data.poDate = poDate;
    if (body.notes !== undefined) data.notes = getStr(body.notes);

    const rawItems = asRecordArray(body.items);
    if (rawItems.length > 0) {
      const items = rawItems.map((i) => ({
        productId: getStr(i.productId),
        quantity: getNum(i.quantity),
        unitCost: getNum(i.unitCost),
      }));
      const products = await db.product.findMany({
        where: { firmId: po.firmId, id: { in: items.map((i) => i.productId) } },
      });
      // Seller = vendor state, buyer = firm state
      const firm = await db.firm.findUnique({ where: { id: po.firmId } });
      const totals = computePoItems(products, items, po.vendor.stateCode, firm?.stateCode ?? "27");

      await db.$transaction([
        db.purchaseOrderItem.deleteMany({ where: { poId: po.id } }),
        db.purchaseOrder.update({
          where: { id: po.id },
          data: {
            ...data,
            subtotal: totals.subtotal,
            totalCgst: totals.totalCgst,
            totalSgst: totals.totalSgst,
            totalIgst: totals.totalIgst,
            grandTotal: totals.grandTotal,
          },
        }),
        db.purchaseOrderItem.createMany({
          data: totals.items.map((i) => ({
            poId: po.id,
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
        }),
      ]);
    } else {
      await db.purchaseOrder.update({ where: { id: po.id }, data });
    }

    const updated = await db.purchaseOrder.findUnique({
      where: { id: po.id },
      include: { items: true, vendor: { select: { id: true, vendorName: true } } },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
