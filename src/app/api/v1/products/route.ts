// ═══════════════════════════════════════════════════════════════
// /api/v1/products — list (search/filter) + create
// R2/R12: 5-tier pricing invariant; SKU unique per firm (R1)
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
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { recordMovement } from "@/app/api/v1/_lib/party";
import {
  roundProductNumerics,
  validateProductBusinessRules,
} from "@/app/api/v1/_lib/product";
import {
  ensureVendorPrefixedName,
  resolveManufacturerVendor,
} from "@/app/api/v1/_lib/product-naming";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const search = getStr(sp.get("search"));
    const category = getStr(sp.get("category"));
    const activeOnly = sp.get("activeOnly") === "true";

    const where = {
      firmId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(category ? { category: { contains: category } } : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search } },
              { name: { contains: search } },
              { category: { contains: search } },
              { brand: { contains: search } },
            ],
          }
        : {}),
    };

    const products = await db.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: 500,
    });

    const categories = await db.product.findMany({
      where: { firmId, isActive: true },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });

    return ok({ products, categories: categories.map((c) => c.category) });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const sku = getStr(body.sku).toUpperCase();
    const name = getStr(body.name);
    if (!sku || !name) {
      throw new BusinessError("ERR_VALIDATION", "sku and name are required", 400);
    }

    const dup = await db.product.findUnique({
      where: { firmId_sku: { firmId: firm.id, sku } },
      select: { id: true },
    });
    if (dup) {
      throw new BusinessError("ERR_DUPLICATE_SKU", `SKU "${sku}" already exists in this firm`, 409);
    }

    const nums = roundProductNumerics({
      gstRate: getNum(body.gstRate, 18),
      purchaseCost: getNum(body.purchaseCost),
      tier1Distributor: getNum(body.tier1Distributor),
      tier2Wholesale: getNum(body.tier2Wholesale),
      tier3SemiWholesale: getNum(body.tier3SemiWholesale),
      tier4Retailer: getNum(body.tier4Retailer),
      tier5Mrp: getNum(body.tier5Mrp),
      openingStock: getNum(body.openingStock),
      openingDamagedStock: getNum(body.openingDamagedStock),
      lowStockThreshold: getNum(body.lowStockThreshold),
    });
    validateProductBusinessRules(nums);

    const weightGrams = body.weightGrams === undefined ? null : getNum(body.weightGrams);
    const barcode = getStr(body.barcode) || null;

    // Manufacturer link — product belongs to a MANUFACTURER vendor (R10).
    // The catalog name then starts with the vendor's name automatically.
    const mfrVendor = await resolveManufacturerVendor(firm.id, body.manufacturerVendorId);
    const finalName = mfrVendor ? ensureVendorPrefixedName(name, mfrVendor.vendorName) : name;

    const product = await db.product.create({
      data: {
        firmId: firm.id,
        sku,
        name: finalName,
        category: getStr(body.category) || "General",
        brand: getStr(body.brand) || mfrVendor?.brand || "",
        unit: getStr(body.unit) || "Pcs",
        hsnCode: getStr(body.hsnCode) || "3924",
        gstRate: nums.gstRate,
        purchaseCost: nums.purchaseCost,
        tier1Distributor: nums.tier1Distributor,
        tier2Wholesale: nums.tier2Wholesale,
        tier3SemiWholesale: nums.tier3SemiWholesale,
        tier4Retailer: nums.tier4Retailer,
        tier5Mrp: nums.tier5Mrp,
        stockQuantity: nums.openingStock,
        damagedStock: nums.openingDamagedStock,
        lowStockThreshold: nums.lowStockThreshold,
        manufacturerVendorId: mfrVendor?.id ?? null,
        weightGrams,
        barcode,
        isActive: true,
      },
    });

    // Opening movements — audit trail for the starting stock pools
    if (nums.openingStock > 0) {
      await recordMovement(db, {
        firmId: firm.id,
        productId: product.id,
        movementType: "OPENING",
        quantity: nums.openingStock,
        targetPool: "SELLABLE",
        direction: "IN",
        referenceNo: "OPENING",
        notes: `Opening sellable stock for ${sku}`,
      });
    }
    if (nums.openingDamagedStock > 0) {
      await recordMovement(db, {
        firmId: firm.id,
        productId: product.id,
        movementType: "OPENING",
        quantity: nums.openingDamagedStock,
        targetPool: "DAMAGED",
        direction: "IN",
        referenceNo: "OPENING",
        notes: `Opening damaged stock for ${sku}`,
      });
    }

    return ok(product, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
