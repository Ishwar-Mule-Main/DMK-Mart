// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/stops/[stopId]/signature
// Signature fallback — the bill is misplaced / OTP unknown, so the
// shopkeeper signs instead (no OTP consumed, no lockout involved).
// POST {firmId? | staffId?, collectedMode, collectedAmount, staffId?}
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { BusinessError, asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import {
  loadStopForDelivery,
  markStopDelivered,
  parseCollectionInput,
} from "@/app/api/v1/_lib/logistics";

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

    // CASH | UPI collected on the spot; CREDIT = on-account drop (₹0).
    const { mode: collectedMode, amount: collectedAmount } = parseCollectionInput(body);

    const result = await markStopDelivered({
      trip,
      stopId: stop.id,
      proof: "SIGNATURE",
      collectedMode,
      collectedAmount,
      deliveredBy: staffId,
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
