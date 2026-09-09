// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/stops/[stopId]/signature
// Signature fallback — the bill is misplaced / OTP unknown, so the
// shopkeeper signs instead (no OTP consumed, no lockout involved).
// POST {firmId? | staffId?, collectedMode, collectedAmount, staffId?}
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { BusinessError, asRecord, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { loadStopForDelivery, markStopDelivered } from "@/app/api/v1/_lib/logistics";
import { round2 } from "@/lib/gst";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const { id, stopId } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const staffId = getStr(body.staffId);

    const { trip, stop } = await loadStopForDelivery({ tripId: id, stopId, firmId, staffId });

    const collectedMode = getStr(body.collectedMode).toUpperCase();
    if (collectedMode !== "CASH" && collectedMode !== "UPI") {
      throw new BusinessError("ERR_VALIDATION", "collectedMode must be CASH or UPI", 400);
    }
    const collectedAmount = getNum(body.collectedAmount);
    if (collectedAmount < 0) {
      throw new BusinessError("ERR_VALIDATION", "collectedAmount cannot be negative", 400);
    }

    const result = await markStopDelivered({
      trip,
      stopId: stop.id,
      proof: "SIGNATURE",
      collectedMode,
      collectedAmount: round2(collectedAmount),
      deliveredBy: staffId,
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
