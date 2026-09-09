// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/driver/history — staff portal "my past runs"
// GET ?staffId= — last 10 COMPLETED / CLOSED trips for the driver,
// stops included. OTP-free by construction (deliveryOtp never selected).
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
      orderBy: { dispatchedAt: "desc" },
      take: 10,
    });

    return ok({
      trips: trips.map((t) => ({
        ...t,
        deliveredStops: t.stops.filter((s) => s.status === "DELIVERED").length,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
