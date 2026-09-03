// ═══════════════════════════════════════════════════════════════
// /api/v1/customer-receipts — collection against receivables (R7)
// Customer balance (Dr-positive) ↓; Journal: Dr CASH/BANK, Cr AR
// Engine shared with seed in _lib/payments.ts
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
import { createCustomerReceipt } from "@/app/api/v1/_lib/payments";
import { round2 } from "@/lib/gst";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const customerId = getStr(sp.get("customerId"));
    const receipts = await db.customerReceipt.findMany({
      where: { firmId, ...(customerId ? { customerId } : {}) },
      include: {
        customer: { select: { id: true, partyName: true } },
        allocations: {
          include: { invoice: { select: { id: true, invoiceNumber: true } } },
        },
      },
      orderBy: { receiptDate: "desc" },
      take: 200,
    });
    return ok(
      receipts.map((r) => ({
        ...r,
        allocatedTotal: round2(r.allocations.reduce((s, a) => s + a.amount, 0)),
        allocations: r.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          invoiceNumber: a.invoice.invoiceNumber,
          amount: a.amount,
        })),
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const result = await createCustomerReceipt(firm, {
      customerId: getStr(body.customerId),
      receiptDate: getDate(body.receiptDate),
      amount: getNum(body.amount),
      mode: getStr(body.mode) || "NEFT",
      utrRef: getStr(body.utrRef),
      notes: getStr(body.notes),
      allocations: asRecordArray(body.allocations).map((a) => ({
        invoiceId: getStr(a.invoiceId),
        amount: getNum(a.amount),
      })),
    });

    return ok(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
