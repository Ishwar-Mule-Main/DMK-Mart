// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/warehouses — list (with rollups) + create
// Warehouse placement is PRIVATE to this portal: other platforms
// only ever receive totals from the universal API.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, BusinessError, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { ensureDefaultWarehouse } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const WAREHOUSE_TYPES = ["MAIN", "SATELLITE", "TRANSIT", "QC_DAMAGED", "FRANCHISE"] as const;

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    await ensureDefaultWarehouse(firm.id);
    const warehouses = await db.warehouse.findMany({
      where: { firmId: firm.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { stocks: { select: { quantity: true, damagedQty: true, reservedQty: true } } },
    });
    return ok({
      warehouses: warehouses.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        type: w.type,
        address: w.address,
        city: w.city,
        manager: w.manager,
        phone: w.phone,
        isDefault: w.isDefault,
        isActive: w.isActive,
        skuCount: w.stocks.filter((s) => s.quantity > 0 || s.damagedQty > 0).length,
        totalSellable: w.stocks.reduce((a, s) => a + s.quantity, 0),
        totalDamaged: w.stocks.reduce((a, s) => a + s.damagedQty, 0),
        totalReserved: w.stocks.reduce((a, s) => a + s.reservedQty, 0),
      })),
      // The portal-level visibility rule, restated for clients:
      visibility: "WAREHOUSE_BREAKDOWN_IS_PORTAL_PRIVATE",
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const code = getStr(body.code).trim().toUpperCase();
    const name = getStr(body.name).trim();
    if (!code || !name) throw new BusinessError("ERR_VALIDATION", "code and name are required", 422);
    const type = getStr(body.type).trim().toUpperCase() || "SATELLITE";
    if (!WAREHOUSE_TYPES.includes(type as (typeof WAREHOUSE_TYPES)[number])) {
      throw new BusinessError("ERR_VALIDATION", `type must be one of ${WAREHOUSE_TYPES.join(", ")}`, 422);
    }
    const dup = await db.warehouse.findUnique({ where: { firmId_code: { firmId: firm.id, code } } });
    if (dup) throw new BusinessError("ERR_WAREHOUSE_CODE_EXISTS", `Warehouse code ${code} already exists`, 422);

    const makeDefault = Boolean(body.isDefault);
    const warehouse = await db.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.warehouse.updateMany({ where: { firmId: firm.id, isDefault: true }, data: { isDefault: false } });
      }
      return tx.warehouse.create({
        data: {
          firmId: firm.id,
          code,
          name,
          type,
          address: getStr(body.address).trim(),
          city: getStr(body.city).trim(),
          manager: getStr(body.manager).trim(),
          phone: getStr(body.phone).trim(),
          isDefault: makeDefault,
        },
      });
    });
    return ok({ warehouse }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
