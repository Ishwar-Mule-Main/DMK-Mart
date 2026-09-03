// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/movements — append-only stock audit trail (R3/R4)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getNum, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const productId = getStr(sp.get("productId"));
    const movementType = getStr(sp.get("movementType"));
    const limit = Math.min(300, Math.max(1, Math.round(getNum(sp.get("limit"), 100))));

    const movements = await db.inventoryMovement.findMany({
      where: {
        firmId,
        ...(productId ? { productId } : {}),
        ...(movementType ? { movementType } : {}),
      },
      include: { product: { select: { id: true, sku: true, name: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok(movements);
  } catch (e) {
    return handleApiError(e);
  }
}
