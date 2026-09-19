// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/products/[id] — detail / edit / delete
// PATCH can also re-stamp the canonical image file name after a
// rename ("Brand Name + Product Name" standard).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import { asRecord, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { canonicalImageFileName } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

async function loadProduct(req: NextRequest, id: string) {
  const { firm } = await requireInvAuth(req);
  const product = await db.product.findFirst({
    where: { id, firmId: firm.id },
    include: {
      warehouseStocks: { include: { warehouse: { select: { code: true, name: true, type: true } } } },
    },
  });
  if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);
  return { firm, product };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { product } = await loadProduct(req, (await ctx.params).id);
    return ok({
      product: {
        ...product,
        warehouseBreakdown: product.warehouseStocks.map((w) => ({
          warehouseId: w.warehouseId,
          code: w.warehouse.code,
          name: w.warehouse.name,
          type: w.warehouse.type,
          quantity: w.quantity,
          reservedQty: w.reservedQty,
          damagedQty: w.damagedQty,
        })),
        warehouseStocks: undefined,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm } = await requireInvAuth(req);
    const id = (await ctx.params).id;
    const existing = await db.product.findFirst({ where: { id, firmId: firm.id } });
    if (!existing) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);
    const body = asRecord(await req.json().catch(() => ({})));

    const name = body.name === undefined ? existing.name : getStr(body.name).trim() || existing.name;
    const brand = body.brand === undefined ? existing.brand : getStr(body.brand).trim();
    const photoUrl = body.photoUrl === undefined ? existing.photoUrl : getStr(body.photoUrl).trim() || null;

    const gstRate = body.gstRate === undefined ? existing.gstRate : getNum(body.gstRate, existing.gstRate);
    if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
      throw new BusinessError("ERR_INVALID_GST_RATE", `GST rate must be one of ${ALLOWED_GST_RATES.join(", ")}`, 422);
    }

    const numerics = {
      purchaseCost: round2(body.purchaseCost === undefined ? existing.purchaseCost : getNum(body.purchaseCost, 0)),
      tier1Distributor: round2(body.tier1Distributor === undefined ? existing.tier1Distributor : getNum(body.tier1Distributor, 0)),
      tier2Wholesale: round2(body.tier2Wholesale === undefined ? existing.tier2Wholesale : getNum(body.tier2Wholesale, 0)),
      tier3SemiWholesale: round2(body.tier3SemiWholesale === undefined ? existing.tier3SemiWholesale : getNum(body.tier3SemiWholesale, 0)),
      tier4Retailer: round2(body.tier4Retailer === undefined ? existing.tier4Retailer : getNum(body.tier4Retailer, 0)),
      tier5Mrp: round2(body.tier5Mrp === undefined ? existing.tier5Mrp : getNum(body.tier5Mrp, 0)),
    };
    const tierError = validateTierOrder(numerics);
    if (tierError) throw new BusinessError("ERR_INVALID_TIER_HIERARCHY", tierError, 422);

    const restampImage =
      body.restampImageFileName === true ||
      name !== existing.name ||
      brand !== existing.brand ||
      photoUrl !== existing.photoUrl;

    const updated = await db.product.update({
      where: { id },
      data: {
        name,
        brand,
        category: body.category === undefined ? existing.category : getStr(body.category).trim() || existing.category,
        unit: body.unit === undefined ? existing.unit : getStr(body.unit).trim() || existing.unit,
        hsnCode: body.hsnCode === undefined ? existing.hsnCode : getStr(body.hsnCode).trim() || existing.hsnCode,
        gstRate,
        ...numerics,
        lowStockThreshold: round2(body.lowStockThreshold === undefined ? existing.lowStockThreshold : getNum(body.lowStockThreshold, 0)),
        weightGrams: body.weightGrams === undefined ? existing.weightGrams : getNum(body.weightGrams, 0),
        piecesPerBox: body.piecesPerBox === undefined ? existing.piecesPerBox : Math.max(1, Math.round(getNum(body.piecesPerBox, 1))),
        barcode: body.barcode === undefined ? existing.barcode : getStr(body.barcode).trim() || null,
        photoUrl,
        isActive: body.isActive === undefined ? existing.isActive : Boolean(body.isActive),
        imageFileName: restampImage ? canonicalImageFileName(brand, name, photoUrl) : existing.imageFileName,
        imageVerified: photoUrl && !existing.photoUrl ? "PENDING" : existing.imageVerified,
      },
    });
    return ok({ product: updated });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm } = await requireInvAuth(req);
    const id = (await ctx.params).id;
    const existing = await db.product.findFirst({ where: { id, firmId: firm.id } });
    if (!existing) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);

    // Soft-deactivate when the product is referenced by books
    // (invoices/POs/orders) — hard delete only for pristine rows.
    const [invoices, poItems, soItems, movements] = await Promise.all([
      db.invoiceLineItem.count({ where: { productId: id } }),
      db.purchaseOrderItem.count({ where: { productId: id } }),
      db.salesOrderItem.count({ where: { productId: id } }),
      db.inventoryMovement.count({ where: { productId: id } }),
    ]);
    if (invoices || poItems || soItems || movements) {
      const deactivated = await db.product.update({ where: { id }, data: { isActive: false } });
      return ok({
        product: deactivated,
        mode: "DEACTIVATED",
        message: `${existing.sku} is referenced by books — deactivated instead of deleted`,
      });
    }
    await db.warehouseStock.deleteMany({ where: { productId: id } });
    await db.product.delete({ where: { id } });
    return ok({ mode: "DELETED", message: `${existing.sku} removed from the universal catalog` });
  } catch (e) {
    return handleApiError(e);
  }
}
