// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-orders/staged/[id] — one staged upload
// GET    → full staging-terminal payload (matched masters, live
//          availability, customer tier + ledger status)
// PATCH  → { customerId } relink · { items } full line replace
//          (inline edits, manual SKU mapping, deletions) ·
//          { status: "DISCARDED" } reject the upload
// DELETE → discard (alias of PATCH status)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  asRecordArray,
  BusinessError,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { shapeStagedOrder } from "@/app/api/v1/_lib/stagedOrders";

type RouteCtx = { params: Promise<{ id: string }> };

async function loadStaged(id: string) {
  const order = await db.stagedOrderUpload.findUnique({ where: { id } });
  if (!order) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);
  return order;
}

export async function GET(_request: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const detail = await shapeStagedOrder(id);
    return ok({ staged: detail });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const staged = await loadStaged(id);
    if (staged.status !== "NEEDS_REVIEW") {
      throw new BusinessError("ERR_INVALID_STATE", "This upload has already been processed", 409);
    }

    // ── Relink customer ───────────────────────────────────────────
    if (body.customerId !== undefined) {
      const customerId = getStr(body.customerId);
      if (customerId) {
        const customer = await db.customer.findFirst({
          where: { id: customerId, firmId: staged.firmId },
          select: { id: true },
        });
        if (!customer) throw new BusinessError("ERR_VALIDATION", "Customer not found in this firm", 422);
      }
      await db.stagedOrderUpload.update({
        where: { id },
        data: {
          matchedCustomerId: customerId || null,
          customerMatchMethod: customerId ? "MANUAL" : "",
          customerMatchScore: customerId ? 1 : 0,
        },
      });
      // Customer tier may change the locked prices → relock matched lines.
      await relockAppliedPrices(id);
      const detail = await shapeStagedOrder(id);
      return ok({ staged: detail });
    }

    // ── Replace line items (inline edits / mapping / deletions) ──
    if (body.items !== undefined) {
      const rawItems = asRecordArray(body.items);
      if (rawItems.length === 0) {
        throw new BusinessError("ERR_VALIDATION", "Keep at least one line item", 400);
      }
      const productIds = [...new Set(rawItems.map((i) => getStr(i.matchedSkuId)).filter(Boolean))];
      const products = productIds.length
        ? await db.product.findMany({ where: { id: { in: productIds }, firmId: staged.firmId } })
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));

      await db.stagedItem.deleteMany({ where: { stagedOrderId: id } });
      await db.stagedItem.createMany({
        data: rawItems.map((i, idx) => {
          const skuId = getStr(i.matchedSkuId);
          const product = skuId ? productById.get(skuId) : undefined;
          if (skuId && !product) {
            throw new BusinessError("ERR_VALIDATION", "One of the mapped products does not exist", 422);
          }
          return {
            stagedOrderId: id,
            rawName: getStr(i.rawName).slice(0, 160) || `Line ${idx + 1}`,
            matchedSkuId: skuId || null,
            quantity: Math.max(0, getNum(i.quantity)),
            uom: getStr(i.uom, "Pcs").slice(0, 16) || "Pcs",
            statedPrice: Math.max(0, getNum(i.statedPrice)),
            appliedPrice: Math.max(0, getNum(i.appliedPrice, getNum(i.statedPrice))),
            discountPercent: Math.min(100, Math.max(0, getNum(i.discountPercent))),
            isUnlisted: !skuId,
            matchConfidence: skuId ? 1 : 0,
            matchMethod: skuId ? "MANUAL" : "",
            linePosition: idx,
          };
        }),
      });
      const detail = await shapeStagedOrder(id);
      return ok({ staged: detail });
    }

    // ── Discard ───────────────────────────────────────────────────
    if (getStr(body.status) === "DISCARDED") {
      await db.stagedOrderUpload.update({ where: { id }, data: { status: "DISCARDED" } });
      const detail = await shapeStagedOrder(id);
      return ok({ staged: detail });
    }

    throw new BusinessError("ERR_VALIDATION", "Nothing to update — send customerId, items or status", 400);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const staged = await loadStaged(id);
    if (staged.status !== "NEEDS_REVIEW") {
      throw new BusinessError("ERR_INVALID_STATE", "This upload has already been processed", 409);
    }
    await db.stagedOrderUpload.update({ where: { id }, data: { status: "DISCARDED" } });
    const detail = await shapeStagedOrder(id);
    return ok({ staged: detail });
  } catch (e) {
    return handleApiError(e);
  }
}

/** Relock appliedPrice on matched lines from the linked customer's tier. */
async function relockAppliedPrices(stagedId: string) {
  const staged = await db.stagedOrderUpload.findUnique({
    where: { id: stagedId },
    include: { items: true },
  });
  if (!staged) return;
  const tierKeys = ["tier1Distributor", "tier2Wholesale", "tier3SemiWholesale", "tier4Retailer", "tier5Mrp"];
  let tier = "tier4Retailer";
  if (staged.matchedCustomerId) {
    const c = await db.customer.findUnique({
      where: { id: staged.matchedCustomerId },
      select: { assignedTier: true },
    });
    if (c && tierKeys.includes(c.assignedTier)) tier = c.assignedTier;
  }
  const skuIds = staged.items.map((i) => i.matchedSkuId).filter((x): x is string => Boolean(x));
  const products = skuIds.length
    ? await db.product.findMany({
        where: { id: { in: skuIds } },
        select: {
          id: true,
          tier1Distributor: true,
          tier2Wholesale: true,
          tier3SemiWholesale: true,
          tier4Retailer: true,
          tier5Mrp: true,
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const item of staged.items) {
    if (!item.matchedSkuId) continue;
    const p = byId.get(item.matchedSkuId);
    if (!p) continue;
    const tierPrice = (p[tier as keyof typeof p] as number) || 0;
    const next = tierPrice > 0 ? tierPrice : item.statedPrice;
    if (Math.abs(next - item.appliedPrice) > 0.001) {
      await db.stagedItem.update({ where: { id: item.id }, data: { appliedPrice: next } });
    }
  }
}
