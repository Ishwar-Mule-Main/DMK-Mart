// ═══════════════════════════════════════════════════════════════
// GET+PATCH /api/v1/sales-orders/[id] — one SO detail + status moves.
// PATCH { status: "CANCELLED" } is allowed only while BOOKED; a
// CONVERTED order is permanently tied to its tax invoice.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { releaseOrderReservationOnCancel } from "@/app/api/v1/_lib/salesOrder";

const ORDER_INCLUDE = {
  customer: { select: { id: true, partyName: true, phone: true, city: true, address: true } },
  salesMember: { select: { id: true, fullName: true, username: true } },
  items: true,
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await db.salesOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new BusinessError("ERR_NOT_FOUND", "Sales order not found", 404);
    return ok(order);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const existing = await db.salesOrder.findUnique({ where: { id } });
    if (!existing) throw new BusinessError("ERR_NOT_FOUND", "Sales order not found", 404);

    const status = getStr(body.status);
    if (status === "CANCELLED") {
      if (existing.status !== "BOOKED" && existing.status !== "CONFIRMED") {
        throw new BusinessError(
          "ERR_INVALID_STATUS",
          existing.status === "CONVERTED"
            ? "This order is already converted to a tax invoice and cannot be cancelled"
            : "This order is already cancelled",
          409
        );
      }
      // CONFIRMED orders hold reserved stock — give it back first.
      if (existing.status === "CONFIRMED" && existing.stockReserved) {
        await releaseOrderReservationOnCancel(id);
      }
      const order = await db.salesOrder.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: ORDER_INCLUDE,
      });
      return ok(order);
    }
    if (status === "CONVERTED") {
      // Reserved for the office conversion flow (set by the invoice pipeline).
      throw new BusinessError("ERR_INVALID_STATUS", "Orders are converted by billing an invoice, not directly", 409);
    }
    if (body.notes !== undefined) {
      const order = await db.salesOrder.update({
        where: { id },
        data: { notes: getStr(body.notes) },
        include: ORDER_INCLUDE,
      });
      return ok(order);
    }
    throw new BusinessError("ERR_VALIDATION", "Nothing to update — send status or notes", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
