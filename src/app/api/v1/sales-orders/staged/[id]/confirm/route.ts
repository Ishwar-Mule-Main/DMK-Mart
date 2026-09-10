// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-orders/staged/[id]/confirm — the big button.
// { mode: "DRAFT" | "CONFIRMED" }  (default CONFIRMED)
//   DRAFT      → SalesOrder BOOKED (no stock/OTP impact yet)
//   CONFIRMED  → SalesOrder CONFIRMED: sellable stock RESERVED,
//                4-digit Delivery OTP stamped, order lands in the
//                Trip Planner's unassigned pool (route-tagged)
// Guards: customer attached · every line mapped to a catalog SKU ·
// quantities > 0. Shortfalls come back as warnings (pre-orders).
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
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { bookOrder } from "@/app/api/v1/_lib/salesOrder";
import { tierKeyOr, tierPriceFor } from "@/app/api/v1/_lib/stagedOrders";
import { round2 } from "@/lib/gst";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const mode = getStr(body.mode, "CONFIRMED").toUpperCase() === "DRAFT" ? "DRAFT" : "CONFIRMED";

    const staged = await db.stagedOrderUpload.findUnique({
      where: { id },
      include: { items: { orderBy: { linePosition: "asc" } } },
    });
    if (!staged) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);
    if (staged.status !== "NEEDS_REVIEW") {
      throw new BusinessError("ERR_INVALID_STATE", "This upload has already been processed", 409);
    }
    if (!staged.matchedCustomerId) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Attach the customer first — match an existing one or quick-add the new buyer",
        400
      );
    }

    const bookable = staged.items.filter((i) => i.matchedSkuId && i.quantity > 0);
    if (bookable.length === 0) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Every line needs a catalog product and a quantity — add the unlisted items first",
        400
      );
    }
    const unlisted = staged.items.filter((i) => !i.matchedSkuId);
    if (unlisted.length > 0) {
      throw new BusinessError(
        "ERR_VALIDATION",
        `${unlisted.length} line${unlisted.length === 1 ? " is" : "s are"} still unmapped — quick-add "${unlisted[0].rawName}" to the catalog or delete the row`,
        400
      );
    }

    // Lock the unit price per line: customer tier price, unless the
    // staging terminal pinned an override (appliedPrice ≠ tier price).
    const customer = await db.customer.findUnique({
      where: { id: staged.matchedCustomerId },
      select: { assignedTier: true },
    });
    const tier = tierKeyOr(customer?.assignedTier);
    const skuIds = bookable.map((i) => i.matchedSkuId!);
    const products = await db.product.findMany({ where: { id: { in: skuIds } } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const items = bookable.map((i) => {
      const product = byId.get(i.matchedSkuId!)!;
      const tierPrice = tierPriceFor(product as unknown as Record<string, unknown>, tier);
      const unitPrice = i.appliedPrice > 0 ? i.appliedPrice : tierPrice || i.statedPrice;
      return {
        productId: product.id,
        quantity: i.quantity,
        unitPrice: round2(unitPrice),
        notes: `Scanned as "${i.rawName}"`,
      };
    });

    const firm = await resolveFirm(staged.firmId);
    const result = await bookOrder({
      firm,
      customerId: staged.matchedCustomerId,
      items,
      notes:
        (staged.scanNote ? `${staged.scanNote} ` : "") +
        `Deep-scanned from ${staged.originalFileName || staged.source.toLowerCase()}${staged.extractedGstin ? ` · GSTIN ${staged.extractedGstin}` : ""}`,
      stagedUploadId: staged.id,
      mode,
    });

    await db.stagedOrderUpload.update({
      where: { id },
      data: { status: "BOOKED", confirmedSalesOrderId: result.orderId, confirmedAt: new Date() },
    });

    return ok(
      {
        salesOrder: result.order,
        orderNumber: result.orderNumber,
        status: result.status,
        deliveryOtp: result.deliveryOtp,
        estimatedTotal: result.estimatedTotal,
        reservations: result.reservations,
        warnings: result.warnings,
      },
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
