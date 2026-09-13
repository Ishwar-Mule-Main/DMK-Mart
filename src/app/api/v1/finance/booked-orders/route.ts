// ═══════════════════════════════════════════════════════════════
// /api/v1/finance/booked-orders — unbilled order register (Finance)
// READ-ONLY register over the sales order book: BOOKED + CONFIRMED
// sales orders that have not been converted to a tax invoice yet.
// Invoicing stays manual by design (owner decision) — the GL sees
// nothing at booking; journals post only when each order is billed
// (trip auto-bill or the Sales Orders action). This register gives
// Finance visibility of that committed-revenue pipeline.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));

    const orders = await db.salesOrder.findMany({
      where: {
        firmId: firm.id,
        status: { in: ["BOOKED", "CONFIRMED"] },
        convertedInvoiceId: null,
      },
      include: {
        customer: { select: { partyName: true, city: true, phone: true } },
        salesMember: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    const rows = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      status: o.status,
      customerName: o.customer?.partyName ?? "—",
      town: o.customer?.city ?? "",
      phone: o.customer?.phone ?? "",
      itemCount: o._count.items,
      estimatedTotal: round2(o.estimatedTotal),
      billDiscountPct: o.billDiscountPct,
      billDiscountAmt: o.billDiscountAmt,
      stockReserved: o.stockReserved,
      salesMemberName: o.salesMember?.fullName ?? "",
      notes: o.notes,
    }));

    const totals = {
      count: rows.length,
      booked: rows.filter((r) => r.status === "BOOKED").length,
      confirmed: rows.filter((r) => r.status === "CONFIRMED").length,
      estimatedAmount: round2(rows.reduce((s, r) => s + r.estimatedTotal, 0)),
    };

    return ok({ orders: rows, totals });
  } catch (e) {
    return handleApiError(e);
  }
}
