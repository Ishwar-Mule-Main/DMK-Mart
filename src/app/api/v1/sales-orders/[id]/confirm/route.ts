// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-orders/[id]/confirm — confirm a BOOKED draft.
// A draft SO (saved from staging or booked at the sales counter)
// becomes CONFIRMED: sellable stock RESERVED, 4-digit Delivery OTP
// stamped, order lands in the Trip Planner's unassigned pool.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  BusinessError,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { confirmSalesOrder } from "@/app/api/v1/_lib/salesOrder";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const order = await db.salesOrder.findFirst({ where: { id, firmId: firm.id } });
    if (!order) throw new BusinessError("ERR_NOT_FOUND", "Sales order not found", 404);

    const result = await confirmSalesOrder(firm.id, id);
    const fresh = await db.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, partyName: true, phone: true, city: true } },
        items: true,
      },
    });
    return ok({ ...result, salesOrder: fresh });
  } catch (e) {
    return handleApiError(e);
  }
}
