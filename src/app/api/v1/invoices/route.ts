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
import { settledTotalsByInvoice } from "@/app/api/v1/_lib/settlement";
import { round2 } from "@/lib/gst";

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

    // Attach settlement info for credit invoices (register "outstanding" column)
    const creditIds = invoices.filter((i) => i.paymentMode === "CREDIT").map((i) => i.id);
    const settledMap = await settledTotalsByInvoice(firmId, creditIds);
    const rows = invoices.map((inv) => {
      if (inv.paymentMode !== "CREDIT" || inv.status !== "POSTED") return inv;
      // No allocation/credit-note rows → fully outstanding
      const s = settledMap.get(inv.id) ?? { settled: 0, credited: 0 };
      const outstanding = round2(Math.max(0, round2(inv.grandTotal) - s.settled - s.credited));
      return { ...inv, settled: s.settled, credited: s.credited, outstanding };
    });

    return ok(rows);
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
