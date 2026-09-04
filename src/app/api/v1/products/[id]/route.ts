// ═══════════════════════════════════════════════════════════════
// /api/v1/products/[id] — detail (+ last 50 movements), patch, soft delete
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { roundProductNumerics, validateProductBusinessRules } from "@/app/api/v1/_lib/product";
import { ensureVendorPrefixedName, resolveManufacturerVendor } from "@/app/api/v1/_lib/product-naming";

async function getProductOr404(id: string) {
  const product = await db.product.findUnique({ where: { id } });
  if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);
  return product;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = await getProductOr404(id);
    const movements = await db.inventoryMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok({ product, movements });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = await getProductOr404(id);
    const body = asRecord(await request.json().catch(() => ({})));

    const sku = body.sku !== undefined ? getStr(body.sku).toUpperCase() : product.sku;
    if (sku !== product.sku) {
      const dup = await db.product.findUnique({
        where: { firmId_sku: { firmId: product.firmId, sku } },
        select: { id: true },
      });
      if (dup) {
        throw new BusinessError("ERR_DUPLICATE_SKU", `SKU "${sku}" already exists in this firm`, 409);
      }
    }

    const nums = roundProductNumerics({
      gstRate: getNum(body.gstRate, product.gstRate),
      purchaseCost: getNum(body.purchaseCost, product.purchaseCost),
      tier1Distributor: getNum(body.tier1Distributor, product.tier1Distributor),
      tier2Wholesale: getNum(body.tier2Wholesale, product.tier2Wholesale),
      tier3SemiWholesale: getNum(body.tier3SemiWholesale, product.tier3SemiWholesale),
      tier4Retailer: getNum(body.tier4Retailer, product.tier4Retailer),
      tier5Mrp: getNum(body.tier5Mrp, product.tier5Mrp),
      // stock pools are mutated only via transactions — not patchable here
      openingStock: 0,
      openingDamagedStock: 0,
      lowStockThreshold: getNum(body.lowStockThreshold, product.lowStockThreshold),
    });
    validateProductBusinessRules(nums);

    const data: Record<string, string | number | boolean | null> = {
      sku,
      gstRate: nums.gstRate,
      purchaseCost: nums.purchaseCost,
      tier1Distributor: nums.tier1Distributor,
      tier2Wholesale: nums.tier2Wholesale,
      tier3SemiWholesale: nums.tier3SemiWholesale,
      tier4Retailer: nums.tier4Retailer,
      tier5Mrp: nums.tier5Mrp,
      lowStockThreshold: nums.lowStockThreshold,
    };
    if (body.name !== undefined) data.name = getStr(body.name);
    if (body.category !== undefined) data.category = getStr(body.category);
    if (body.brand !== undefined) data.brand = getStr(body.brand);
    if (body.unit !== undefined) data.unit = getStr(body.unit);
    if (body.hsnCode !== undefined) data.hsnCode = getStr(body.hsnCode);
    if (body.weightGrams !== undefined) data.weightGrams = body.weightGrams === null ? null : getNum(body.weightGrams);
    if (body.barcode !== undefined) data.barcode = getStr(body.barcode) || null;
    if (body.isActive !== undefined) data.isActive = body.isActive === true || body.isActive === "true";

    // Manufacturer link changes — keep the vendor-prefixed name convention
    if (body.manufacturerVendorId !== undefined) {
      const mfrVendor = await resolveManufacturerVendor(product.firmId, body.manufacturerVendorId);
      data.manufacturerVendorId = mfrVendor?.id ?? null;
      if (mfrVendor) {
        const baseName = body.name !== undefined ? getStr(body.name) : product.name;
        data.name = ensureVendorPrefixedName(baseName, mfrVendor.vendorName);
        if (!getStr(body.brand) && !data.brand) data.brand = mfrVendor.brand;
      }
    }

    const updated = await db.product.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const product = await getProductOr404(id);
    // Soft delete — products are referenced by invoices/movements forever
    const updated = await db.product.update({
      where: { id },
      data: { isActive: false },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
