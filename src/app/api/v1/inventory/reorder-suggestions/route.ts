// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/reorder-suggestions — low-stock reorder assist
// GET ?firmId= → per-SKU reorder advice: 30-day velocity, days of
// cover, suggested qty, preferred vendor (most recent confirmed PO
// carrying the SKU), last cost (WAC engine, same as valuation /
// profitability), estimated cost. Sorted by urgency.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { addDays, getStr, handleApiError, ok, resolveFirm, startOfDay } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const since = startOfDay(addDays(new Date(), -30));

    const [products, soldLines, poItems, confirmedPos] = await Promise.all([
      db.product.findMany({
        where: { firmId, isActive: true, lowStockThreshold: { gt: 0 } },
        select: {
          id: true, sku: true, name: true, unit: true,
          stockQuantity: true, lowStockThreshold: true, purchaseCost: true,
        },
        orderBy: { sku: "asc" },
      }),
      // 30-day sales velocity: line quantities on POSTED invoices
      db.invoiceLineItem.findMany({
        where: { invoice: { firmId, status: "POSTED", invoiceDate: { gte: since } } },
        select: { productId: true, quantity: true },
      }),
      // WAC inputs (identical engine to valuation / profitability)
      db.purchaseOrderItem.findMany({
        where: { po: { firmId, status: "CONFIRMED" } },
        select: { productId: true, receivedQty: true, unitCost: true },
      }),
      // Preferred vendor = supplier of the most recent CONFIRMED PO
      // that contains the product (rows ordered poDate desc → first hit wins)
      db.purchaseOrder.findMany({
        where: { firmId, status: "CONFIRMED" },
        select: {
          poDate: true,
          vendor: { select: { id: true, vendorName: true } },
          items: { select: { productId: true } },
        },
        orderBy: { poDate: "desc" },
        take: 2000,
      }),
    ]);

    // Σ sold qty per product over the last 30 days
    const soldAgg = new Map<string, number>();
    for (const l of soldLines) {
      soldAgg.set(l.productId, (soldAgg.get(l.productId) ?? 0) + Number(l.quantity));
    }

    // WAC per product (receipt-history weighted average)
    const costAgg = new Map<string, { qty: number; value: number }>();
    for (const it of poItems) {
      const cur = costAgg.get(it.productId) ?? { qty: 0, value: 0 };
      cur.qty += it.receivedQty;
      cur.value += it.receivedQty * it.unitCost;
      costAgg.set(it.productId, cur);
    }

    // Most recent confirmed PO per product → preferred vendor
    const vendorOf = new Map<string, { id: string; vendorName: string }>();
    for (const po of confirmedPos) {
      for (const it of po.items) {
        if (!vendorOf.has(it.productId)) vendorOf.set(it.productId, po.vendor);
      }
    }

    const suggestions = products
      .filter((p) => p.stockQuantity <= p.lowStockThreshold)
      .map((p) => {
        const avgDailySales = round2((soldAgg.get(p.id) ?? 0) / 30);
        const daysCover =
          avgDailySales > 0 ? Math.round((p.stockQuantity / avgDailySales) * 10) / 10 : null;
        // Suggested qty = max(restock to 2× threshold, cover 30 days of
        // sales, at least the threshold) — floored at 1 unit, integer.
        const suggestedQty = Math.max(
          Math.ceil(p.lowStockThreshold * 2 - p.stockQuantity),
          Math.ceil(avgDailySales * 30) - Math.ceil(p.stockQuantity),
          Math.ceil(p.lowStockThreshold),
          1
        );
        const a = costAgg.get(p.id);
        const lastCost = a && a.qty > 0 ? round2(a.value / a.qty) : round2(p.purchaseCost);
        const estCost = round2(suggestedQty * lastCost);
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          stockQuantity: round2(p.stockQuantity),
          lowStockThreshold: round2(p.lowStockThreshold),
          avgDailySales,
          daysCover,
          suggestedQty,
          vendor: vendorOf.get(p.id) ?? null,
          lastCost,
          estCost,
        };
      })
      .sort((x, y) => {
        // daysCover ascending (nulls last), then estCost descending
        if (x.daysCover === null && y.daysCover === null) return y.estCost - x.estCost;
        if (x.daysCover === null) return 1;
        if (y.daysCover === null) return -1;
        if (x.daysCover !== y.daysCover) return x.daysCover - y.daysCover;
        return y.estCost - x.estCost;
      });

    const vendorIds = new Set(
      suggestions.map((s) => s.vendor?.id).filter((v): v is string => Boolean(v))
    );

    return ok({
      suggestions,
      totals: {
        items: suggestions.length,
        estTotal: round2(suggestions.reduce((s, r) => s + r.estCost, 0)),
        vendors: vendorIds.size,
      },
      basis:
        "avg daily sales = units sold on POSTED invoices over the last 30 days ÷ 30 · days cover = sellable stock ÷ avg daily sales · suggested qty = max(2 × threshold − stock, 30-day sales − stock, threshold), min 1 · last cost = WAC from confirmed receipts (fallback last purchase cost) · preferred vendor = supplier of the most recent confirmed PO carrying the SKU",
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
