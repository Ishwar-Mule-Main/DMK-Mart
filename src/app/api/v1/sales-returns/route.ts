// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-returns — customer returns (R4: broken goods → DAMAGED)
// DAMAGED stock ↑, customer receivable ↓ (Dr-positive), CREDIT_NOTE
// journal: Dr SALES_RETURNS + Dr GST output reversal, Cr AR (R6/R7)
// Engine shared with seed in _lib/salesReturn.ts
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  asRecordArray,
  BusinessError,
  getDate,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { createSalesReturn } from "@/app/api/v1/_lib/salesReturn";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const returns = await db.salesReturn.findMany({
      where: { firmId },
      include: {
        customer: { select: { id: true, partyName: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
      orderBy: { returnDate: "desc" },
      take: 200,
    });
    return ok(returns);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const items = asRecordArray(body.items).map((i) => ({
      productId: getStr(i.productId),
      damagedQty: getNum(i.damagedQty),
      unitPrice: i.unitPrice !== undefined ? getNum(i.unitPrice) : undefined,
      defectType: getStr(i.defectType) || undefined,
    }));

    // ── B2B-ONLY RULE ─────────────────────────────────────────────
    // We do not collect damaged/broken/problem products from B2C
    // counter buyers — a return must reference a B2B customer.
    const customerId = getStr(body.customerId);
    const invoiceId = getStr(body.invoiceId);
    if (customerId) {
      const customer = await db.customer.findFirst({
        where: { id: customerId, firmId: firm.id },
        select: { partyName: true, customerType: true },
      });
      if (customer && customer.customerType === "B2C_COUNTER") {
        throw new BusinessError(
          "ERR_B2C_RETURN_NOT_ALLOWED",
          `Sales returns are B2B only — damaged/broken goods are not collected from B2C counter buyer "${customer.partyName}"`,
          422,
        );
      }
    } else if (invoiceId) {
      const inv = await db.invoice.findFirst({
        where: { id: invoiceId, firmId: firm.id },
        select: { customer: { select: { partyName: true, customerType: true } } },
      });
      if (inv?.customer && inv.customer.customerType === "B2C_COUNTER") {
        throw new BusinessError(
          "ERR_B2C_RETURN_NOT_ALLOWED",
          `Sales returns are B2B only — invoice ${getStr(body.invoiceRef) || "reference"} belongs to B2C counter buyer "${inv.customer.partyName}"`,
          422,
        );
      }
    }

    const result = await createSalesReturn(firm, {
      customerId: customerId || null,
      invoiceId: invoiceId || null,
      invoiceRef: getStr(body.invoiceRef),
      returnDate: getDate(body.returnDate),
      notes: getStr(body.notes),
      items,
      refundMode: getStr(body.refundMode) === "UPI_NEFT" || getStr(body.refundMode) === "CASH" ? (getStr(body.refundMode) as "UPI_NEFT" | "CASH") : "CREDIT",
    });

    return ok(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
