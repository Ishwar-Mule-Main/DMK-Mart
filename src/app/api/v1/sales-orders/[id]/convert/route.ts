// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-orders/[id]/convert — office billing.
// Converts a BOOKED/CONFIRMED sales order into a real tax invoice
// WITHOUT a truck (the Order Book's "Bill now" action). Uses the
// exact same engine as trip-time auto-bill: tier pricing snapshot,
// stock decrement, ledger + journal postings, Delivery OTP carried,
// order marked CONVERTED. Body: { firmId, paymentMode?: CREDIT|CASH|UPI }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { convertSalesOrderToInvoice } from "@/app/api/v1/_lib/salesOrder";

const PAY_MODES = new Set(["CREDIT", "CASH", "UPI"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const paymentMode = getStr(body.paymentMode) || "CREDIT";
    if (!PAY_MODES.has(paymentMode)) {
      throw new BusinessError("ERR_VALIDATION", "paymentMode must be CREDIT, CASH or UPI", 400);
    }

    const result = await convertSalesOrderToInvoice(firm, id, { paymentMode });
    return ok(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
