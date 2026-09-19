// GET /api/v1/inventory/warehouses/[id]/stock — per-SKU stock rows
// for ONE warehouse (portal-only view).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm } = await requireInvAuth(req);
    const warehouse = await db.warehouse.findFirst({
      where: { id: (await ctx.params).id, firmId: firm.id },
    });
    if (!warehouse) throw new BusinessError("ERR_WAREHOUSE_NOT_FOUND", "Warehouse not found", 404);
    const sp = req.nextUrl.searchParams;
    const search = getStr(sp.get("search"));
    const page = Math.max(1, getNum(sp.get("page"), 1));
    const pageSize = Math.min(200, Math.max(10, getNum(sp.get("pageSize"), 50)));

    const where = {
      warehouseId: warehouse.id,
      ...(search
        ? { product: { OR: [{ sku: { contains: search } }, { name: { contains: search } }, { brand: { contains: search } }] } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.warehouseStock.count({ where }),
      db.warehouseStock.findMany({
        where,
        orderBy: [{ quantity: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: { select: { sku: true, name: true, brand: true, unit: true, photoUrl: true, imageFileName: true } } },
      }),
    ]);
    return ok({
      warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name, type: warehouse.type },
      total,
      page,
      pageSize,
      rows: rows.map((r) => ({
        productId: r.productId,
        sku: r.product.sku,
        name: r.product.name,
        brand: r.product.brand,
        unit: r.product.unit,
        photoUrl: r.product.photoUrl,
        imageFileName: r.product.imageFileName,
        quantity: r.quantity,
        reservedQty: r.reservedQty,
        damagedQty: r.damagedQty,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
