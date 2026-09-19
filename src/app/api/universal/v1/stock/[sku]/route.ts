// POST /api/universal/v1/stock/[sku] — stock delta from an external
// platform (sale, return, receiving). Body: { delta: -3, reason? }.
// The delta lands on the DEFAULT warehouse — external platforms
// never see or choose warehouse placement; they only read totals.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { asRecord, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { applyWarehouseDelta } from "@/app/api/v1/inventory/_lib/inventory";
import { publicStockView, requirePortal, touchPortalSync } from "@/app/api/universal/v1/_lib/portal";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  try {
    const { portal } = await requirePortal(req);
    const sku = decodeURIComponent((await ctx.params).sku);
    const product = await db.product.findUnique({ where: { firmId_sku: { firmId: portal.firmId, sku } } });
    if (!product) throw new BusinessError("ERR_NOT_FOUND", `SKU ${sku} is not in the shared catalog`, 404);
    return ok({ sku, name: product.name, ...publicStockView(product) });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  try {
    const { portal } = await requirePortal(req);
    const sku = decodeURIComponent((await ctx.params).sku);
    const body = asRecord(await req.json().catch(() => ({})));
    if (body.warehouseId || body.warehouseCode) {
      throw new BusinessError(
        "ERR_WAREHOUSE_IS_PRIVATE",
        "Warehouse targeting is not available to external platforms — deltas land on the default warehouse",
        422
      );
    }
    const delta = round2(getNum(body.delta, NaN));
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BusinessError("ERR_VALIDATION", "delta must be a non-zero number (+receive / −sale)", 422);
    }
    const product = await db.product.findUnique({ where: { firmId_sku: { firmId: portal.firmId, sku } } });
    if (!product) throw new BusinessError("ERR_NOT_FOUND", `SKU ${sku} is not in the shared catalog`, 404);

    const reason = getStr(body.reason).trim() || `Stock delta via Universal API (${portal.name})`;
    await applyWarehouseDelta({
      firmId: portal.firmId,
      productId: product.id,
      sellableDelta: delta,
      movementType: delta > 0 ? "PURCHASE_INWARD" : "SALES_OUTWARD",
      notes: reason,
    });
    const updated = await db.product.findUnique({ where: { id: product.id } });
    await touchPortalSync(portal.id, "OK", `stock ${sku} ${delta > 0 ? "+" : ""}${delta}`);
    return ok({ sku, appliedDelta: delta, stock: updated ? publicStockView(updated) : null });
  } catch (e) {
    return handleApiError(e);
  }
}
