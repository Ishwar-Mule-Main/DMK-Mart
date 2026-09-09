// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/dispatch — truck leaves the yard
// POST {firmId} — PLANNED → DISPATCHED (dispatchedAt = now).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { getTripForFirm, loadTripDetail } from "@/app/api/v1/_lib/logistics";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const trip = await getTripForFirm(id, firm.id);

    if (trip.status !== "PLANNED") {
      throw new BusinessError(
        "ERR_INVALID_STATE",
        `Trip is ${trip.status} — only PLANNED trips can be dispatched`,
        409
      );
    }

    await db.trip.update({
      where: { id: trip.id },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });

    const detail = await loadTripDetail(trip.id, true);
    return ok({ trip: detail });
  } catch (e) {
    return handleApiError(e);
  }
}
