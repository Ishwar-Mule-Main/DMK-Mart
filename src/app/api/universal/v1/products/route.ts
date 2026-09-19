// ═══════════════════════════════════════════════════════════════
// /api/universal/v1/products — THE shared catalog endpoint.
//  GET  ?since=<ISO> → full or delta catalog (totals-only stock).
//  POST → create ONE product from an external platform
//         (attribution: sourcePortal = portal name). The new
//         product instantly appears in every platform on the
//         next read/sync tick.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import { asRecord, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { applyWarehouseDelta, canonicalImageFileName } from "@/app/api/v1/inventory/_lib/inventory";
import { publicProductView, requirePortal, touchPortalSync } from "@/app/api/universal/v1/_lib/portal";

export async function GET(req: NextRequest) {
  try {
    const { portal } = await requirePortal(req);
    const sp = req.nextUrl.searchParams;
    const since = getStr(sp.get("since"));
    const limit = Math.min(1000, Math.max(1, getNum(sp.get("limit"), 200)));
    const offset = Math.max(0, getNum(sp.get("offset"), 0));

    const where = {
      firmId: portal.firmId,
      ...(sp.get("includeInactive") === "true" ? {} : { isActive: true }),
      ...(since && !Number.isNaN(new Date(since).getTime()) ? { updatedAt: { gt: new Date(since) } } : {}),
    };

    const [total, products] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
      }),
    ]);

    await touchPortalSync(portal.id, "OK", `GET products → ${products.length} rows`);

    return ok({
      version: "1.0.0",
      total,
      offset,
      limit,
      hasMore: offset + products.length < total,
      deltaSince: since || null,
      products: products.map(publicProductView),
      visibility: "TOTAL STOCK ONLY — warehouse placement is never exposed",
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { portal } = await requirePortal(req);
    const body = asRecord(await req.json().catch(() => ({})));

    const sku = getStr(body.sku).trim();
    const name = getStr(body.name).trim();
    if (!sku || !name) throw new BusinessError("ERR_VALIDATION", "sku and name are required", 422);

    const existing = await db.product.findUnique({ where: { firmId_sku: { firmId: portal.firmId, sku } } });
    if (existing) {
      throw new BusinessError("ERR_SKU_EXISTS", `SKU ${sku} already exists — use POST /api/universal/v1/products/bulk (upsert) or PATCH semantics`, 422);
    }

    const gstRate = getNum(body.gstRate, 18);
    if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
      throw new BusinessError("ERR_INVALID_GST_RATE", `gstRate must be one of ${ALLOWED_GST_RATES.join(", ")}`, 422);
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

    const brand = getStr(body.brand).trim() || "Unbranded";
    const photoUrl = getStr(body.photoUrl).trim() || null;
    const openingStock = round2(getNum(body.openingStock, 0));
    if (openingStock < 0) throw new BusinessError("ERR_VALIDATION", "openingStock cannot be negative", 422);

    const created = await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          firmId: portal.firmId,
          sku,
          name,
          brand,
          category: getStr(body.category).trim() || "General",
          unit: getStr(body.unit).trim() || "Pcs",
          hsnCode: getStr(body.hsnCode).trim() || "3924",
          gstRate,
          ...numerics,
          lowStockThreshold: round2(getNum(body.lowStockThreshold, 0)),
          piecesPerBox: Math.max(1, Math.round(getNum(body.piecesPerBox, 1))),
          barcode: getStr(body.barcode).trim() || null,
          photoUrl,
          imageFileName: canonicalImageFileName(brand, name, photoUrl),
          imageVerified: photoUrl ? "PENDING" : "NO_IMAGE",
          // applied via the invariant keeper below — create at 0
          stockQuantity: 0,
          sourcePortal: portal.name,
        },
      });
      if (openingStock > 0) {
        // External platforms never choose the warehouse — the default absorbs it.
        await applyWarehouseDelta({
          firmId: portal.firmId,
          productId: product.id,
          sellableDelta: openingStock,
          movementType: "PURCHASE_INWARD",
          notes: `Opening stock via Universal API (${portal.name})`,
          client: tx,
        });
      }
      return product.id;
    });

    // Re-read: the invariant keeper applied the opening stock inside the tx
    const final_ = await db.product.findUnique({ where: { id: created } });
    await touchPortalSync(portal.id, "OK", `POST product ${sku}`);
    return ok({ product: publicProductView(final_!), message: `${sku} is now live on every platform` }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
