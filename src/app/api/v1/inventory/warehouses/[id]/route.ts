// /api/v1/inventory/warehouses/[id] — edit / deactivate a warehouse.
// Deleting a warehouse with stock is refused — transfer the stock
// first (moveWarehouseStock keeps the Product totals untouched).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, BusinessError, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { WAREHOUSE_TYPES } from "@/app/api/v1/inventory/_lib/warehouses-constants";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

async function loadWh(req: NextRequest, id: string) {
  const { firm } = await requireInvAuth(req);
  const warehouse = await db.warehouse.findFirst({ where: { id, firmId: firm.id } });
  if (!warehouse) throw new BusinessError("ERR_WAREHOUSE_NOT_FOUND", "Warehouse not found", 404);
  return { firm, warehouse };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm, warehouse } = await loadWh(req, (await ctx.params).id);
    const body = asRecord(await req.json().catch(() => ({})));
    const type = body.type === undefined ? warehouse.type : getStr(body.type).trim().toUpperCase();
    if (!WAREHOUSE_TYPES.includes(type as (typeof WAREHOUSE_TYPES)[number])) {
      throw new BusinessError("ERR_VALIDATION", `type must be one of ${WAREHOUSE_TYPES.join(", ")}`, 422);
    }
    const updated = await db.$transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.warehouse.updateMany({ where: { firmId: firm.id, isDefault: true }, data: { isDefault: false } });
      }
      return tx.warehouse.update({
        where: { id: warehouse.id },
        data: {
          name: body.name === undefined ? warehouse.name : getStr(body.name).trim() || warehouse.name,
          type,
          address: body.address === undefined ? warehouse.address : getStr(body.address).trim(),
          city: body.city === undefined ? warehouse.city : getStr(body.city).trim(),
          manager: body.manager === undefined ? warehouse.manager : getStr(body.manager).trim(),
          phone: body.phone === undefined ? warehouse.phone : getStr(body.phone).trim(),
          isDefault: body.isDefault === undefined ? warehouse.isDefault : Boolean(body.isDefault),
          isActive: body.isActive === undefined ? warehouse.isActive : Boolean(body.isActive),
        },
      });
    });
    return ok({ warehouse: updated });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { warehouse } = await loadWh(req, (await ctx.params).id);
    if (warehouse.isDefault) {
      throw new BusinessError("ERR_DEFAULT_WAREHOUSE", "The default warehouse cannot be deleted — set another one as default first", 422);
    }
    const stockAgg = await db.warehouseStock.aggregate({
      where: { warehouseId: warehouse.id },
      _sum: { quantity: true, damagedQty: true },
    });
    if ((stockAgg._sum.quantity ?? 0) > 0 || (stockAgg._sum.damagedQty ?? 0) > 0) {
      throw new BusinessError(
        "ERR_WAREHOUSE_NOT_EMPTY",
        `Warehouse still holds ${stockAgg._sum.quantity ?? 0} sellable / ${stockAgg._sum.damagedQty ?? 0} damaged units — transfer them out first`,
        422
      );
    }
    await db.warehouse.delete({ where: { id: warehouse.id } });
    return ok({ deleted: true, code: warehouse.code });
  } catch (e) {
    return handleApiError(e);
  }
}
