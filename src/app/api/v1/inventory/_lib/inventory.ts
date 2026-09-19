// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY — SHARED LIBRARY
// · Canonical image file naming: every product image file name is
//   derived from "Brand Name + Product Name" (the universal naming
//   standard) — shown in the portal, stamped on downloads.
// · Warehouse↔Total invariant: every stock touch goes through
//   applyWarehouseDelta / moveWarehouseStock so
//   Σ WarehouseStock.quantity == Product.stockQuantity ALWAYS.
// · External portals never target a warehouse — their deltas land
//   on the firm's default warehouse automatically.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import type { DbClient } from "@/app/api/v1/_lib/party";
import { recordMovement } from "@/app/api/v1/_lib/party";
import { BusinessError } from "@/app/api/v1/_lib/api";

// ─── Canonical naming ─────────────────────────────────────────────

export function slugifyFileName(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** "Brand Name + Product Name" slug with the original extension. */
export function canonicalImageFileName(brand: string, name: string, photoUrl?: string | null): string {
  const base = slugifyFileName([brand, name].filter(Boolean).join(" ")) || "product";
  let ext = "webp";
  if (photoUrl) {
    const clean = photoUrl.split("?")[0];
    const m = clean.toLowerCase().match(/\.(png|jpe?g|webp|gif|bmp|avif)$/);
    if (m) ext = m[1] === "jpeg" ? "jpg" : m[1];
  }
  return `${base}.${ext}`;
}

// ─── Default warehouse (lazy) ─────────────────────────────────────

export async function ensureDefaultWarehouse(firmId: string) {
  const existing = await db.warehouse.findFirst({ where: { firmId, isDefault: true } });
  if (existing) return existing;
  const anyActive = await db.warehouse.findFirst({ where: { firmId, isActive: true }, orderBy: { createdAt: "asc" } });
  if (anyActive) {
    return db.warehouse.update({ where: { id: anyActive.id }, data: { isDefault: true } });
  }
  return db.warehouse.create({
    data: {
      firmId,
      code: "WH-MAIN",
      name: "Main Warehouse",
      type: "MAIN",
      isDefault: true,
      address: "Default receiving warehouse",
    },
  });
}

// ─── The invariant keepers ────────────────────────────────────────

const MOVEMENT_TYPES = [
  "PURCHASE_INWARD", "SALES_OUTWARD", "DAMAGE_QUARANTINE", "SALES_RETURN_DAMAGE",
  "PURCHASE_RETURN_DAMAGE", "STOCK_ADJUSTMENT", "WRITE_OFF", "OPENING", "WAREHOUSE_TRANSFER",
] as const;
type MovementType = (typeof MOVEMENT_TYPES)[number];

interface DeltaInput {
  firmId: string;
  productId: string;
  warehouseId?: string; // falls back to the default warehouse
  sellableDelta?: number; // ± sellable units
  damagedDelta?: number; // ± damaged/quarantine units
  movementType?: MovementType;
  notes?: string;
  referenceNo?: string;
  client?: DbClient; // run inside a caller transaction
}

/**
 * Apply a stock delta to a warehouse row AND mirror it on the
 * Product total in the SAME transaction. Warehouse placement is an
 * internal detail — callers outside this portal omit warehouseId
 * and the default warehouse absorbs the units.
 */
export async function applyWarehouseDelta(input: DeltaInput) {
  const run = async (tx: DbClient) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);

    const warehouse = input.warehouseId
      ? await tx.warehouse.findFirst({ where: { id: input.warehouseId, firmId: input.firmId } })
      : await ensureDefaultWarehouse(input.firmId);
    if (!warehouse) throw new BusinessError("ERR_WAREHOUSE_NOT_FOUND", "Warehouse not found", 404);

    const sellableDelta = round2(input.sellableDelta ?? 0);
    const damagedDelta = round2(input.damagedDelta ?? 0);
    if (sellableDelta === 0 && damagedDelta === 0) {
      throw new BusinessError("ERR_VALIDATION", "Nothing to apply — sellable/damaged delta is zero", 422);
    }

    const existingRow = await tx.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: input.productId } },
    });
    const newSellable = round2((existingRow?.quantity ?? 0) + sellableDelta);
    const newDamaged = round2((existingRow?.damagedQty ?? 0) + damagedDelta);
    if (newSellable < 0) {
      throw new BusinessError(
        "ERR_INSUFFICIENT_WAREHOUSE_STOCK",
        `Warehouse "${warehouse.name}" has only ${existingRow?.quantity ?? 0} sellable units of ${product.sku}`,
        422
      );
    }
    if (newDamaged < 0) {
      throw new BusinessError(
        "ERR_INSUFFICIENT_WAREHOUSE_DAMAGED",
        `Warehouse "${warehouse.name}" has only ${existingRow?.damagedQty ?? 0} damaged units of ${product.sku}`,
        422
      );
    }

    await tx.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: input.productId } },
      create: {
        firmId: input.firmId,
        warehouseId: warehouse.id,
        productId: input.productId,
        quantity: newSellable,
        damagedQty: newDamaged,
      },
      update: { quantity: newSellable, damagedQty: newDamaged },
    });

    const updated = await tx.product.update({
      where: { id: input.productId },
      data: {
        stockQuantity: round2(product.stockQuantity + sellableDelta),
        damagedStock: round2(product.damagedStock + damagedDelta),
      },
    });

    // Audit trail parity with every other stock touch in the ERP.
    if (sellableDelta !== 0) {
      await recordMovement(tx, {
        firmId: input.firmId,
        productId: input.productId,
        movementType: (input.movementType ?? "STOCK_ADJUSTMENT") as MovementType,
        quantity: Math.abs(sellableDelta),
        targetPool: "SELLABLE",
        direction: sellableDelta > 0 ? "IN" : "OUT",
        referenceNo: input.referenceNo ?? "",
        notes: `[${warehouse.code}] ${input.notes ?? "Universal inventory adjustment"}`,
      });
    }
    if (damagedDelta !== 0) {
      await recordMovement(tx, {
        firmId: input.firmId,
        productId: input.productId,
        movementType: (input.movementType ?? "DAMAGE_QUARANTINE") as MovementType,
        quantity: Math.abs(damagedDelta),
        targetPool: "DAMAGED",
        direction: damagedDelta > 0 ? "IN" : "OUT",
        referenceNo: input.referenceNo ?? "",
        notes: `[${warehouse.code}] ${input.notes ?? "Universal inventory adjustment"}`,
      });
    }

    return { warehouse, product: updated, sellableDelta, damagedDelta };
  };

  return input.client ? run(input.client) : db.$transaction(run);
}

/** Move sellable units between two warehouses (total unchanged). */
export async function moveWarehouseStock(opts: {
  firmId: string;
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  notes?: string;
}) {
  const qty = round2(opts.quantity);
  if (qty <= 0) throw new BusinessError("ERR_VALIDATION", "Transfer quantity must be positive", 422);
  if (opts.fromWarehouseId === opts.toWarehouseId) {
    throw new BusinessError("ERR_VALIDATION", "Source and destination warehouse are the same", 422);
  }
  return db.$transaction(async (tx) => {
    const [fromRow, toWh] = await Promise.all([
      tx.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId: opts.fromWarehouseId, productId: opts.productId } },
      }),
      tx.warehouse.findFirst({ where: { id: opts.toWarehouseId, firmId: opts.firmId } }),
    ]);
    if (!toWh) throw new BusinessError("ERR_WAREHOUSE_NOT_FOUND", "Destination warehouse not found", 404);
    if ((fromRow?.quantity ?? 0) < qty) {
      throw new BusinessError(
        "ERR_INSUFFICIENT_WAREHOUSE_STOCK",
        `Source warehouse has only ${fromRow?.quantity ?? 0} sellable units to transfer`,
        422
      );
    }
    await tx.warehouseStock.update({
      where: { warehouseId_productId: { warehouseId: opts.fromWarehouseId, productId: opts.productId } },
      data: { quantity: round2((fromRow?.quantity ?? 0) - qty) },
    });
    const toRow = await tx.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: opts.toWarehouseId, productId: opts.productId } },
    });
    await tx.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: opts.toWarehouseId, productId: opts.productId } },
      create: { firmId: opts.firmId, warehouseId: opts.toWarehouseId, productId: opts.productId, quantity: qty },
      update: { quantity: round2((toRow?.quantity ?? 0) + qty) },
    });
    const product = await tx.product.findUnique({ where: { id: opts.productId } });
    if (product) {
      await recordMovement(tx, {
        firmId: opts.firmId,
        productId: opts.productId,
        movementType: "WAREHOUSE_TRANSFER" as MovementType,
        quantity: qty,
        targetPool: "SELLABLE",
        direction: "OUT",
        referenceNo: "",
        notes: opts.notes ?? `Transfer to ${toWh.code} (total unchanged)`,
      });
      await recordMovement(tx, {
        firmId: opts.firmId,
        productId: opts.productId,
        movementType: "WAREHOUSE_TRANSFER" as MovementType,
        quantity: qty,
        targetPool: "SELLABLE",
        direction: "IN",
        referenceNo: "",
        notes: opts.notes ?? `Transfer from ${fromRow ? "warehouse" : "unassigned"} (total unchanged)`,
      });
    }
    return { ok: true, quantity: qty };
  });
}

/**
 * Reconcile Product totals against Σ warehouse rows (the 30-min
 * consistency guarantee). Two phases:
 *   1. BOOTSTRAP — products with NO placement rows get anchored on
 *      the default warehouse (batched, `limit` per pass).
 *   2. DRIFT_AUDIT — once everyone has rows, a rotating slice is
 *      checked for drift (Σ rows ≠ total) and re-anchored.
 */
export async function reconcileWarehouseRollup(firmId: string, limit = 500) {
  const select = { id: true, sku: true, stockQuantity: true, damagedStock: true } as const;

  // Phase 1 — SKUs with no placement rows yet
  const withRows = await db.warehouseStock.findMany({
    where: { firmId },
    select: { productId: true },
    distinct: ["productId"],
  });
  const haveIds = withRows.map((r) => r.productId);
  let products = await db.product.findMany({
    where: { firmId, id: { notIn: haveIds } },
    select,
    take: limit,
    orderBy: { id: "asc" },
  });
  let phase = "BOOTSTRAP";

  // Phase 2 — rotating drift audit across the whole catalog
  if (products.length === 0) {
    phase = "DRIFT_AUDIT";
    const total = await db.product.count({ where: { firmId } });
    const pages = Math.max(1, Math.ceil(total / limit));
    const skip = Math.floor(Math.random() * pages) * limit;
    products = await db.product.findMany({
      where: { firmId },
      select,
      skip,
      take: limit,
      orderBy: { id: "asc" },
    });
  }

  if (products.length === 0) return { checked: 0, fixed: 0, phase };

  // ONE aggregate query for the whole slice (no N+1 over the WAN)
  const ids = products.map((p) => p.id);
  const rows = await db.warehouseStock.findMany({
    where: { firmId, productId: { in: ids } },
    select: { productId: true, quantity: true, damagedQty: true },
  });
  const sums = new Map<string, { q: number; d: number }>();
  for (const r of rows) {
    const cur = sums.get(r.productId) ?? { q: 0, d: 0 };
    cur.q += r.quantity;
    cur.d += r.damagedQty;
    sums.set(r.productId, cur);
  }

  let fixed = 0;
  for (const p of products) {
    const sellableSum = round2(sums.get(p.id)?.q ?? 0);
    const damagedSum = round2(sums.get(p.id)?.d ?? 0);
    const totalSellable = round2(p.stockQuantity);
    const totalDamaged = round2(p.damagedStock);
    if (sellableSum !== totalSellable || damagedSum !== totalDamaged) {
      const wh = await ensureDefaultWarehouse(firmId);
      await db.warehouseStock.upsert({
        where: { warehouseId_productId: { warehouseId: wh.id, productId: p.id } },
        create: { firmId, warehouseId: wh.id, productId: p.id, quantity: totalSellable, damagedQty: totalDamaged },
        update: { quantity: totalSellable, damagedQty: totalDamaged },
      });
      fixed += 1;
    }
  }
  return { checked: products.length, fixed, phase };
}
