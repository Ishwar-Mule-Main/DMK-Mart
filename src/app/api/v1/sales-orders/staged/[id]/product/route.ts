// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-orders/staged/[id]/product — Quick-Add modal
// "ADD UNLISTED PRODUCT TO DMK CATALOG" → save a brand-new SKU from
// the PDF line and map it onto the staged row in one click.
// { stagedItemId, name, category?, unit?, hsnCode?, gstRate?,
//   purchasePrice?, wholesaleRate?, retailRate?, openingStock? }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  BusinessError,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { generateUniqueSku, shapeStagedOrder } from "@/app/api/v1/_lib/stagedOrders";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const staged = await db.stagedOrderUpload.findUnique({ where: { id } });
    if (!staged) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);
    if (staged.status !== "NEEDS_REVIEW") {
      throw new BusinessError("ERR_INVALID_STATE", "This upload has already been processed", 409);
    }

    const stagedItemId = getStr(body.stagedItemId);
    const line = stagedItemId
      ? await db.stagedItem.findFirst({ where: { id: stagedItemId, stagedOrderId: id } })
      : null;
    if (!line) throw new BusinessError("ERR_VALIDATION", "stagedItemId does not belong to this upload", 400);

    const name = getStr(body.name) || line.rawName;
    if (!name) throw new BusinessError("ERR_VALIDATION", "Product name is required", 400);

    const sku = await generateUniqueSku(staged.firmId, name);
    const wholesale = Math.max(0, getNum(body.wholesaleRate, 0));
    const retail = Math.max(0, getNum(body.retailRate, 0));
    const openingStock = Math.max(0, getNum(body.openingStock, 0));

    const product = await db.product.create({
      data: {
        firmId: staged.firmId,
        sku,
        name: name.slice(0, 140),
        category: getStr(body.category, "General").slice(0, 60) || "General",
        unit: getStr(body.unit, "Pcs").slice(0, 16) || "Pcs",
        hsnCode: getStr(body.hsnCode, "3924").slice(0, 12) || "3924",
        gstRate: Math.min(28, Math.max(0, getNum(body.gstRate, 18))),
        purchaseCost: Math.max(0, getNum(body.purchasePrice, 0)),
        tier2Wholesale: wholesale,
        tier4Retailer: retail > 0 ? retail : wholesale,
        tier5Mrp: Math.max(retail, Math.max(0, getNum(body.mrp, 0))),
        stockQuantity: openingStock,
        isActive: true,
      },
      select: { id: true, sku: true, name: true },
    });

    // Map the new SKU onto the staged line (and relock its price from
    // the linked customer's tier).
    let appliedPrice = line.appliedPrice;
    if (staged.matchedCustomerId) {
      const c = await db.customer.findUnique({
        where: { id: staged.matchedCustomerId },
        select: { assignedTier: true },
      });
      const tierKeys = ["tier1Distributor", "tier2Wholesale", "tier3SemiWholesale", "tier4Retailer", "tier5Mrp"];
      const tier = c && tierKeys.includes(c.assignedTier) ? c.assignedTier : "tier4Retailer";
      const fresh = await db.product.findUnique({ where: { id: product.id } });
      const tierPrice = fresh ? ((fresh[tier as keyof typeof fresh] as number) || 0) : 0;
      appliedPrice = tierPrice > 0 ? tierPrice : line.statedPrice;
    }

    await db.stagedItem.update({
      where: { id: line.id },
      data: {
        matchedSkuId: product.id,
        isUnlisted: false,
        matchConfidence: 1,
        matchMethod: "NEW",
        appliedPrice,
      },
    });

    const detail = await shapeStagedOrder(id);
    return ok({ product, staged: detail }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
