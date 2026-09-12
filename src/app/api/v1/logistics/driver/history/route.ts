// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/driver/history — staff portal "my past runs"
// GET ?staffId= — last 10 COMPLETED / CLOSED trips for the driver,
// stops included. OTP-free by construction (deliveryOtp never selected).
// Carries the firm's UPI info too, so the collection QR works even on
// the keep-screen for a COMPLETED-not-yet-settled run.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { TRIP_HISTORY_STATUSES, getActiveStaff } from "@/app/api/v1/_lib/logistics";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const staff = await getActiveStaff(getStr(sp.get("staffId")));

    const trips = await db.trip.findMany({
      where: {
        driverId: staff.id,
        firmId: staff.firmId, // never leak another firm's runs
        status: { in: [...TRIP_HISTORY_STATUSES] },
      },
      include: { stops: { orderBy: { sequence: "asc" } } },
      orderBy: [{ dispatchedAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    });

    const firm = await db.firm.findUnique({
      where: { id: staff.firmId },
      select: { firmName: true, upiId: true, upiQrUrl: true, phone: true },
    });

    return ok({
      trips: trips.map((t) => ({
        ...t,
        deliveredStops: t.stops.filter((s) => s.status === "DELIVERED").length,
      })),
      paymentInfo: firm
        ? { payeeName: firm.firmName, upiId: firm.upiId, upiQrUrl: firm.upiQrUrl, phone: firm.phone }
        : null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
