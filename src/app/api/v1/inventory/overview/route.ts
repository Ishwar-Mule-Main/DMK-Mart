// ═══════════════════════════════════════════════════════════════
// GET /api/v1/inventory/overview — dashboard rollup for the
// Universal Inventory portal: catalog size, stock health, image
// verification status, warehouse footprint, sync heartbeat.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { ensureDefaultWarehouse } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const firmId = firm.id;
    await ensureDefaultWarehouse(firmId);

    const [
      totalSkus,
      activeSkus,
      brandCount,
      categoryCount,
      stockAgg,
      lowStock,
      outOfStock,
      verifyAgg,
      warehouseCount,
      portals,
      syncSetting,
      lastLogs,
      recentMovements,
    ] = await Promise.all([
      db.product.count({ where: { firmId } }),
      db.product.count({ where: { firmId, isActive: true } }),
      db.product.groupBy({ by: ["brand"], where: { firmId, isActive: true } }),
      db.product.groupBy({ by: ["category"], where: { firmId, isActive: true } }),
      db.product.aggregate({ where: { firmId, isActive: true }, _sum: { stockQuantity: true, damagedStock: true, reservedQty: true, purchaseCost: true } }),
      db.product.count({ where: { firmId, isActive: true, AND: [{ lowStockThreshold: { gt: 0 } }, { stockQuantity: { lte: db.product.fields.lowStockThreshold } }, { stockQuantity: { gt: 0 } }] } }),
      db.product.count({ where: { firmId, isActive: true, stockQuantity: { lte: 0 } } }),
      db.product.groupBy({ by: ["imageVerified"], where: { firmId, isActive: true }, _count: true }),
      db.warehouse.count({ where: { firmId, isActive: true } }),
      db.integrationPortal.findMany({ where: { firmId }, select: { id: true, name: true, kind: true, status: true, lastSyncAt: true, lastSyncStatus: true, autoSync: true } }),
      db.inventorySyncSetting.findUnique({ where: { firmId } }),
      db.syncLog.findMany({ where: { firmId }, orderBy: { startedAt: "desc" }, take: 6 }),
      db.inventoryMovement.findMany({
        where: { firmId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { product: { select: { sku: true, name: true } } },
      }),
    ]);

    const verifyMap: Record<string, number> = {};
    for (const v of verifyAgg) verifyMap[v.imageVerified] = v._count;

    // Stock value at cost: Σ(stockQuantity × purchaseCost) — exact SQL sum.
    const valueAgg = await db.$queryRaw<Array<{ value: bigint | number | null }>>`
      SELECT SUM("stockQuantity" * "purchaseCost") AS value
      FROM "Product" WHERE "firmId" = ${firmId} AND "isActive" = true
    `;
    const stockValue = Number(valueAgg[0]?.value ?? 0);

    return ok({
      firm: { id: firm.id, firmName: firm.firmName, firmCode: firm.firmCode, gstin: firm.gstin },
      catalog: {
        totalSkus,
        activeSkus,
        inactiveSkus: totalSkus - activeSkus,
        brands: brandCount.length,
        categories: categoryCount.length,
      },
      stock: {
        totalSellable: stockAgg._sum.stockQuantity ?? 0,
        totalDamaged: stockAgg._sum.damagedStock ?? 0,
        totalReserved: stockAgg._sum.reservedQty ?? 0,
        stockValueAtCost: stockValue,
        lowStock,
        outOfStock,
      },
      imageVerification: {
        pending: verifyMap["PENDING"] ?? 0,
        noImage: verifyMap["NO_IMAGE"] ?? 0,
        matched: verifyMap["MATCHED"] ?? 0,
        mismatch: verifyMap["MISMATCH"] ?? 0,
      },
      warehouses: warehouseCount,
      integrations: {
        total: portals.length,
        active: portals.filter((p) => p.status === "ACTIVE").length,
        portals,
      },
      sync: {
        intervalMin: syncSetting?.intervalMin ?? 30,
        autoSync: syncSetting?.autoSync ?? true,
        lastRunAt: syncSetting?.lastRunAt ?? null,
        nextRunAt: syncSetting?.nextRunAt ?? null,
        recentLogs: lastLogs,
      },
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        at: m.createdAt,
        sku: m.product.sku,
        name: m.product.name,
        type: m.movementType,
        pool: m.targetPool,
        direction: m.direction,
        quantity: m.quantity,
        referenceNo: m.referenceNo,
        notes: m.notes,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
