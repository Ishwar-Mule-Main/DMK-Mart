// GET /api/universal/v1/products/[sku] — one catalog row
// (totals-only stock) for an external platform.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { publicProductView, requirePortal, touchPortalSync } from "@/app/api/universal/v1/_lib/portal";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  try {
    const { portal } = await requirePortal(req);
    const sku = decodeURIComponent((await ctx.params).sku);
    const product = await db.product.findUnique({
      where: { firmId_sku: { firmId: portal.firmId, sku } },
    });
    if (!product) throw new BusinessError("ERR_NOT_FOUND", `SKU ${sku} is not in the shared catalog`, 404);
    await touchPortalSync(portal.id, "OK", `GET product ${sku}`);
    return ok({ product: publicProductView(product) });
  } catch (e) {
    return handleApiError(e);
  }
}
