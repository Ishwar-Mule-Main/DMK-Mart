// POST /api/universal/v1/products/bulk — upsert up to 500 rows by
// SKU from an external platform. Created rows are attributed to the
// calling portal (sourcePortal); updates never touch stock.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { asRecord, asRecordArray, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { applyWarehouseDelta, canonicalImageFileName } from "@/app/api/v1/inventory/_lib/inventory";
import { publicProductView, requirePortal, touchPortalSync } from "@/app/api/universal/v1/_lib/portal";

export async function POST(req: NextRequest) {
  try {
    const { portal } = await requirePortal(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const rows = asRecordArray(body.rows);
    if (rows.length === 0) throw new BusinessError("ERR_VALIDATION", "rows[] is required", 422);
    if (rows.length > 500) throw new BusinessError("ERR_VALIDATION", "Maximum 500 rows per batch", 422);

    let created = 0, updated = 0;
    const errors: Array<{ index: number; sku: string; error: string }> = [];
    const createdSkus: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sku = getStr(r.sku).trim();
      const name = getStr(r.name).trim();
      if (!sku || !name) {
        errors.push({ index: i, sku: sku || "(missing)", error: "sku and name are required" });
        continue;
      }
      const gstRate = getNum(r.gstRate, 18);
      if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
        errors.push({ index: i, sku, error: `gstRate must be one of ${ALLOWED_GST_RATES.join(", ")}` });
        continue;
      }
      try {
        const existing = await db.product.findUnique({ where: { firmId_sku: { firmId: portal.firmId, sku } } });
        if (existing) {
          await db.product.update({
            where: { id: existing.id },
            data: {
              name,
              brand: getStr(r.brand).trim() || existing.brand,
              category: getStr(r.category).trim() || existing.category,
              unit: getStr(r.unit).trim() || existing.unit,
              hsnCode: getStr(r.hsnCode).trim() || existing.hsnCode,
              gstRate,
              purchaseCost: r.purchaseCost === undefined ? existing.purchaseCost : round2(getNum(r.purchaseCost, 0)),
              tier1Distributor: r.tier1Distributor === undefined ? existing.tier1Distributor : round2(getNum(r.tier1Distributor, 0)),
              tier2Wholesale: r.tier2Wholesale === undefined ? existing.tier2Wholesale : round2(getNum(r.tier2Wholesale, 0)),
              tier3SemiWholesale: r.tier3SemiWholesale === undefined ? existing.tier3SemiWholesale : round2(getNum(r.tier3SemiWholesale, 0)),
              tier4Retailer: r.tier4Retailer === undefined ? existing.tier4Retailer : round2(getNum(r.tier4Retailer, 0)),
              tier5Mrp: r.tier5Mrp === undefined ? existing.tier5Mrp : round2(getNum(r.tier5Mrp, 0)),
              photoUrl: r.photoUrl === undefined ? existing.photoUrl : getStr(r.photoUrl).trim() || null,
              isActive: r.isActive === undefined ? existing.isActive : Boolean(r.isActive),
            },
          });
          updated += 1;
        } else {
          const brand = getStr(r.brand).trim() || "Unbranded";
          const photoUrl = getStr(r.photoUrl).trim() || null;
          const openingStock = round2(getNum(r.openingStock, 0));
          const product = await db.$transaction(async (tx) => {
            const p = await tx.product.create({
              data: {
                firmId: portal.firmId,
                sku,
                name,
                brand,
                category: getStr(r.category).trim() || "General",
                unit: getStr(r.unit).trim() || "Pcs",
                hsnCode: getStr(r.hsnCode).trim() || "3924",
                gstRate,
                purchaseCost: round2(getNum(r.purchaseCost, 0)),
                tier1Distributor: round2(getNum(r.tier1Distributor, 0)),
                tier2Wholesale: round2(getNum(r.tier2Wholesale, 0)),
                tier3SemiWholesale: round2(getNum(r.tier3SemiWholesale, 0)),
                tier4Retailer: round2(getNum(r.tier4Retailer, 0)),
                tier5Mrp: round2(getNum(r.tier5Mrp, 0)),
                lowStockThreshold: round2(getNum(r.lowStockThreshold, 0)),
                piecesPerBox: Math.max(1, Math.round(getNum(r.piecesPerBox, 1))),
                barcode: getStr(r.barcode).trim() || null,
                photoUrl,
                imageFileName: canonicalImageFileName(brand, name, photoUrl),
                imageVerified: photoUrl ? "PENDING" : "NO_IMAGE",
                // applied via the invariant keeper below — create at 0
                stockQuantity: 0,
                sourcePortal: portal.name,
              },
            });
            if (openingStock > 0) {
              await applyWarehouseDelta({
                firmId: portal.firmId,
                productId: p.id,
                sellableDelta: openingStock,
                movementType: "PURCHASE_INWARD",
                notes: `Bulk upsert via Universal API (${portal.name})`,
                client: tx,
              });
            }
            return p;
          });
          created += 1;
          createdSkus.push(product.sku);
        }
      } catch (e) {
        errors.push({ index: i, sku, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await touchPortalSync(portal.id, errors.length === 0 ? "OK" : "PARTIAL", `bulk upsert +${created}/~${updated}/${errors.length} errors`);
    return ok({ created, updated, errors, createdSkus }, errors.length > 0 ? 207 : 200);
  } catch (e) {
    return handleApiError(e);
  }
}
