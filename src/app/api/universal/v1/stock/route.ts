// ═══════════════════════════════════════════════════════════════
// /api/universal/v1/stock — TOTAL stock map for every platform.
// GOLDEN RULE: totals only. Warehouse placement never leaves this
// server — not in this response, not in any field, ever.
//  GET ?sku=a,b,c → { [sku]: totals }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asStringArray, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { publicStockView, requirePortal, touchPortalSync } from "@/app/api/universal/v1/_lib/portal";

export async function GET(req: NextRequest) {
  try {
    const { portal } = await requirePortal(req);
    const sp = req.nextUrl.searchParams;
    const skuList = asStringArray(sp.get("sku")?.split(",") ?? []);
    const where = {
      firmId: portal.firmId,
      isActive: true,
      ...(skuList.length ? { sku: { in: skuList } } : {}),
    };
    const products = await db.product.findMany({
      where,
      select: {
        sku: true, name: true, stockQuantity: true, reservedQty: true,
        damagedStock: true, lowStockThreshold: true, updatedAt: true,
      },
      take: 5000,
    });
    const stock: Record<string, unknown> = {};
    for (const p of products) {
      stock[p.sku] = { name: p.name, updatedAt: p.updatedAt.toISOString(), ...publicStockView(p) };
    }
    await touchPortalSync(portal.id, "OK", `GET stock → ${products.length} SKUs`);
    return ok({ stock, count: products.length, visibility: "TOTALS ONLY — no warehouse breakdown" });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST() {
  return ok({ error: "Use POST /api/universal/v1/stock/{sku} for stock deltas" }, 405);
}
