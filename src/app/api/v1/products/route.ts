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
import { containsArms, rankSearch } from "@/lib/search-rank";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const search = getStr(sp.get("search"));
    const category = getStr(sp.get("category"));
    const brand = getStr(sp.get("brand"));
    const activeOnly = sp.get("activeOnly") === "true";

    // Word-wise SQL prefilter: every query word must hit at least one
    // searchable column (AND across words, OR across columns). Case variants
    // keep the prefilter a superset on Postgres AND SQLite — the exact
    // case-insensitive word-wise ranking happens right after with rankSearch.
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { sku: { contains: v } },
        { name: { contains: v } },
        { category: { contains: v } },
        { brand: { contains: v } },
        { barcode: { contains: v } },
      ]);

    const where = {
      firmId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(category ? { category: { contains: category } } : {}),
      ...(brand ? { brand: { equals: brand } } : {}),
      ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
    };

    const products = await db.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: 500,
    });

    // Word-wise / text-wise relevance on top of the SQL prefilter —
    // word-start matches rank above mid-string, SKU/name lead the fields.
    const ranked = rankSearch(products, search, (p) => [p.sku, p.name, p.brand, p.category, p.barcode]);

    // /sales portal isolation: purchase costs and margin data NEVER leave
    // the server for sales staff — selling tiers + stock quantities only.
    const salesPortal = sp.get("salesPortal") === "1";
    const visibleProducts = salesPortal
      ? ranked.map((p) => {
          const { purchaseCost: _cost, ...rest } = p;
          return rest;
        })
      : ranked;

    const distinct = await db.product.findMany({
      where: { firmId, isActive: true },
      select: { category: true, brand: true },
      // distinct on two columns isn't supported by the connector — dedupe in JS
    });
    const categories = [...new Set(distinct.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
    const brands = [...new Set(distinct.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));

    return ok({ products: visibleProducts, categories, brands });
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
