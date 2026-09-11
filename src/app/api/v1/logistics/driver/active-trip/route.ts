// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/driver/active-trip — staff portal home screen
// GET ?staffId= — the driver's current DISPATCHED / IN_PROGRESS trip
// with stops + load-sheet items. CRITICAL: deliveryOtp is never
// selected here — OTPs travel to the DRIVER only via the paper bill.
// Also returns the firm's UPI payment info so the driver's phone can
// show a pay-to-firm QR at collection time (no cost data attached).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import {
  TRIP_ACTIVE_STATUSES,
  getActiveStaff,
  loadTripDetail,
} from "@/app/api/v1/_lib/logistics";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const staff = await getActiveStaff(getStr(sp.get("staffId")));

    const trip = await db.trip.findFirst({
      where: {
        driverId: staff.id,
        firmId: staff.firmId, // never leak another firm's runs
        status: { in: [...TRIP_ACTIVE_STATUSES] },
      },
      orderBy: [{ dispatchedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });

    if (!trip) return ok({ trip: null, paymentInfo: null });

    // OTP-free detail — includeOtp=false keeps deliveryOtp out of the
    // response entirely (driver reads it from the customer's bill).
    const detail = await loadTripDetail(trip.id, false);
    if (!detail) return ok({ trip: null, paymentInfo: null });

    // deliveredStops convenience for the driver's progress bar.
    const deliveredStops = detail.stops.filter((s) => s.status === "DELIVERED").length;

    // Firm UPI identity for the driver's QR screen (pay from the
    // driver's phone — the customer scans it).
    const firm = await db.firm.findUnique({
      where: { id: staff.firmId },
      select: { firmName: true, upiId: true, phone: true },
    });

    return ok({
      trip: { ...detail, deliveredStops },
      paymentInfo: firm
        ? { payeeName: firm.firmName, upiId: firm.upiId, phone: firm.phone }
        : null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
