// ═══════════════════════════════════════════════════════════════
// /api/v1/invoices — list + create (B2B credit + B2C counter POS)
// Full engine in _lib/invoice.ts (pricing, GST, credit lock, stock,
// ledger, journals). This route parses input and delegates.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  asRecordArray,
  getDate,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { createInvoice } from "@/app/api/v1/_lib/invoice";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const search = getStr(sp.get("search"));
    const customerId = getStr(sp.get("customerId"));
    const counterParam = getStr(sp.get("isCounterSale"));

    const invoices = await db.invoice.findMany({
      where: {
        firmId,
        ...(customerId ? { customerId } : {}),
        ...(counterParam !== "" ? { isCounterSale: counterParam === "true" } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search } },
                { walkInName: { contains: search } },
                { walkInPhone: { contains: search } },
                { customer: { partyName: { contains: search } } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, partyName: true, customerType: true, stateCode: true } },
      },
      orderBy: { invoiceDate: "desc" },
      take: 200,
    });
    return ok(invoices);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const lines = asRecordArray(body.lines).map((l) => ({
      productId: getStr(l.productId),
      quantity: getNum(l.quantity),
      manualDiscountPct: l.manualDiscountPct !== undefined ? getNum(l.manualDiscountPct) : undefined,
    }));

    const result = await createInvoice(firm, {
      firmId: firm.id,
      customerId: getStr(body.customerId) || null,
      isCounterSale: body.isCounterSale === true,
      walkInName: getStr(body.walkInName),
      walkInPhone: getStr(body.walkInPhone),
      invoiceDate: getDate(body.invoiceDate),
      paymentMode: getStr(body.paymentMode) || "CREDIT",
      lines,
    });

    return ok(result.invoice, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
