// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/products — Universal Inventory catalog
// GET  — paginated list with search/filters + optional per-warehouse
//        breakdown (portal-only; external portals NEVER see it).
// POST — create a single product (portal authority). Opening stock
//        lands on the chosen (or default) warehouse and mirrors the
//        Product total in one transaction. The canonical image file
//        name "Brand Name + Product Name" is stamped automatically.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import { asRecord, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { containsArms } from "@/lib/search-rank";
import { applyWarehouseDelta, canonicalImageFileName } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const VERIFICATION_STATES = ["PENDING", "NO_IMAGE", "MATCHED", "MISMATCH"] as const;

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const firmId = firm.id;
    const sp = req.nextUrl.searchParams;
    const search = getStr(sp.get("search"));
    const brand = getStr(sp.get("brand"));
    const category = getStr(sp.get("category"));
    const verified = getStr(sp.get("verified"));
    const activeOnly = sp.get("activeOnly") !== "false";
    const withWarehouses = sp.get("withWarehouses") === "true";
    const page = Math.max(1, getNum(sp.get("page"), 1));
    const pageSize = Math.min(200, Math.max(10, getNum(sp.get("pageSize"), 40)));

    const where = {
      firmId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(brand ? { brand } : {}),
      ...(category ? { category } : {}),
      ...(VERIFICATION_STATES.includes(verified as (typeof VERIFICATION_STATES)[number])
        ? { imageVerified: verified }
        : {}),
      ...(search
        ? {
            OR: containsArms(search, (v) => [
              { sku: { contains: v } },
              { name: { contains: v } },
              { brand: { contains: v } },
              { category: { contains: v } },
              { barcode: { contains: v } },
            ]),
          }
        : {}),
    };

    const baseSelect = {
      id: true, sku: true, name: true, brand: true, category: true, unit: true, hsnCode: true, gstRate: true,
      purchaseCost: true, tier1Distributor: true, tier2Wholesale: true, tier3SemiWholesale: true,
      tier4Retailer: true, tier5Mrp: true, stockQuantity: true, reservedQty: true, damagedStock: true,
      lowStockThreshold: true, photoUrl: true, imageFileName: true, imageVerified: true, imageMatchName: true,
      imageVerifiedAt: true, sourcePortal: true, isActive: true, updatedAt: true, barcode: true, piecesPerBox: true,
    } as const;

    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      withWarehouses
        ? db.product.findMany({
            where,
            orderBy: [{ name: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: { warehouseStocks: { include: { warehouse: { select: { code: true, name: true } } } } },
          })
        : db.product.findMany({ where, orderBy: [{ name: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: baseSelect }),
    ]);

    return ok({
      total,
      page,
      pageSize,
      products: rows.map((p) => ({
        ...p,
        // available for promising = total sellable minus reserved
        available: round2(p.stockQuantity - p.reservedQty),
        warehouseBreakdown: withWarehouses
          ? ("warehouseStocks" in p
            ? (p as { warehouseStocks: Array<{ warehouseId: string; warehouse: { code: string; name: string }; quantity: number; reservedQty: number; damagedQty: number }> }).warehouseStocks.map((w) => ({
                warehouseId: w.warehouseId,
                code: w.warehouse.code,
                name: w.warehouse.name,
                quantity: w.quantity,
                reservedQty: w.reservedQty,
                damagedQty: w.damagedQty,
              }))
            : [])
          : undefined,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { session, firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));

    const sku = getStr(body.sku).trim();
    const name = getStr(body.name).trim();
    if (!sku || !name) throw new BusinessError("ERR_VALIDATION", "sku and name are required", 422);

    const dup = await db.product.findUnique({ where: { firmId_sku: { firmId: firm.id, sku } } });
    if (dup) throw new BusinessError("ERR_SKU_EXISTS", `SKU ${sku} already exists in the catalog`, 422);

    const gstRate = getNum(body.gstRate, 18);
    if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
      throw new BusinessError("ERR_INVALID_GST_RATE", `GST rate must be one of ${ALLOWED_GST_RATES.join(", ")}`, 422);
    }
    const numerics = {
      purchaseCost: round2(getNum(body.purchaseCost, 0)),
      tier1Distributor: round2(getNum(body.tier1Distributor, 0)),
      tier2Wholesale: round2(getNum(body.tier2Wholesale, 0)),
      tier3SemiWholesale: round2(getNum(body.tier3SemiWholesale, 0)),
      tier4Retailer: round2(getNum(body.tier4Retailer, 0)),
      tier5Mrp: round2(getNum(body.tier5Mrp, 0)),
    };
    const tierError = validateTierOrder(numerics);
    if (tierError) throw new BusinessError("ERR_INVALID_TIER_HIERARCHY", tierError, 422);

    const photoUrl = getStr(body.photoUrl).trim() || null;
    const brand = getStr(body.brand).trim() || firm.firmName;
    const openingStock = round2(getNum(body.openingStock, 0));
    const openingDamaged = round2(getNum(body.openingDamagedStock, 0));
    if (openingStock < 0 || openingDamaged < 0) {
      throw new BusinessError("ERR_VALIDATION", "Opening stock cannot be negative", 422);
    }

    const createdId = await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          firmId: firm.id,
          sku,
          name,
          brand,
          category: getStr(body.category).trim() || "General",
          unit: getStr(body.unit).trim() || "Pcs",
          hsnCode: getStr(body.hsnCode).trim() || "3924",
          gstRate,
          ...numerics,
          lowStockThreshold: round2(getNum(body.lowStockThreshold, 0)),
          weightGrams: body.weightGrams == null ? null : getNum(body.weightGrams, 0),
          piecesPerBox: Math.max(1, Math.round(getNum(body.piecesPerBox, 1))),
          barcode: getStr(body.barcode).trim() || null,
          photoUrl,
          imageFileName: canonicalImageFileName(brand, name, photoUrl),
          imageVerified: photoUrl ? "PENDING" : "NO_IMAGE",
          // stock is applied THROUGH the warehouse invariant keeper below —
          // creating at 0 avoids double-counting the opening units
          stockQuantity: 0,
          damagedStock: 0,
          sourcePortal: "INVENTORY",
        },
      });

      if (openingStock > 0 || openingDamaged > 0) {
        await applyWarehouseDelta({
          firmId: firm.id,
          productId: product.id,
          warehouseId: getStr(body.warehouseId).trim() || undefined,
          sellableDelta: openingStock,
          damagedDelta: openingDamaged,
          movementType: "OPENING",
          notes: `Opening stock on create (by ${session.username})`,
          client: tx,
        });
      }
      return product.id;
    });

    // Re-read: the warehouse invariant keeper applied the opening stock in-tx
    const created = await db.product.findUnique({ where: { id: createdId } });
    return ok({ product: created, message: `Product ${sku} added to the universal catalog` }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
