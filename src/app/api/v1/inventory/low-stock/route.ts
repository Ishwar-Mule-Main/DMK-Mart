// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/low-stock — R19 threshold alerts
// Sorted by (stock − threshold) ascending = most urgent first
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const products = await db.product.findMany({
      where: { firmId, isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        brand: true,
        unit: true,
        stockQuantity: true,
        damagedStock: true,
        purchaseCost: true,
        lowStockThreshold: true,
        tier4Retailer: true,
      },
    });

    const lowStock = products
      .filter((p) => p.stockQuantity <= p.lowStockThreshold)
      .map((p) => ({
        ...p,
        shortfall: round2(p.lowStockThreshold - p.stockQuantity),
        urgency: round2(p.stockQuantity - p.lowStockThreshold), // most negative = urgent
        stockValue: round2(p.stockQuantity * p.purchaseCost),
      }))
      .sort((a, b) => a.urgency - b.urgency);

    return ok(lowStock);
  } catch (e) {
    return handleApiError(e);
  }
}
