// POST /api/v1/inventory/stock/adjust — portal stock operations:
// ADD / REMOVE / DAMAGE / REQUEUE / SET (cycle-count style), always
// through the warehouse↔total invariant keeper.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { asRecord, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { applyWarehouseDelta } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const OPERATIONS = ["ADD", "REMOVE", "DAMAGE", "REQUEUE", "SET"] as const;
type Operation = (typeof OPERATIONS)[number];

export async function POST(req: NextRequest) {
  try {
    const { session, firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const productId = getStr(body.productId).trim();
    const op = getStr(body.operation).trim().toUpperCase() as Operation;
    const qty = round2(getNum(body.quantity, 0));
    if (qty <= 0 && op !== "SET") throw new BusinessError("ERR_VALIDATION", "quantity must be positive", 422);

    const product = await db.product.findFirst({ where: { id: productId, firmId: firm.id } });
    if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);

    const notes = getStr(body.notes).trim() || `Stock ${op.toLowerCase()} by ${session.username}`;
    const warehouseId = getStr(body.warehouseId).trim() || undefined;

    if (op === "SET") {
      // Cycle count: place the declared sellable quantity on ONE
      // warehouse; the delta vs the current total reconciles everywhere else.
      if (qty < 0) throw new BusinessError("ERR_VALIDATION", "quantity cannot be negative", 422);
      const delta = round2(qty - product.stockQuantity);
      if (delta === 0) return ok({ product, appliedDelta: 0, message: "Counted quantity matches book stock — no change" });
      const result = await applyWarehouseDelta({
        firmId: firm.id,
        productId,
        warehouseId,
        sellableDelta: delta,
        movementType: "STOCK_ADJUSTMENT",
        notes: `${notes} — cycle count set ${qty} (was ${product.stockQuantity})`,
      });
      const updated = await db.product.findUnique({ where: { id: productId } });
      return ok({ product: updated, appliedDelta: delta, warehouse: result.warehouse.code });
    }

    const map: Record<Exclude<Operation, "SET">, { sellable?: number; damaged?: number; type: "PURCHASE_INWARD" | "SALES_OUTWARD" | "DAMAGE_QUARANTINE" | "STOCK_ADJUSTMENT" | "WRITE_OFF" }> = {
      ADD: { sellable: qty, type: "STOCK_ADJUSTMENT" },
      REMOVE: { sellable: -qty, type: "WRITE_OFF" },
      DAMAGE: { sellable: -qty, damaged: qty, type: "DAMAGE_QUARANTINE" },
      REQUEUE: { damaged: -qty, sellable: qty, type: "STOCK_ADJUSTMENT" },
    };
    const plan = map[op as Exclude<Operation, "SET">];
    const result = await applyWarehouseDelta({
      firmId: firm.id,
      productId,
      warehouseId,
      sellableDelta: plan.sellable,
      damagedDelta: plan.damaged,
      movementType: plan.type,
      notes,
    });
    const updated = await db.product.findUnique({ where: { id: productId } });
    return ok({ product: updated, warehouse: result.warehouse.code, operation: op });
  } catch (e) {
    return handleApiError(e);
  }
}
