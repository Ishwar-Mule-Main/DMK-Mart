// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/settlement-entries
// Owner additions to a trip's cash settlement — money collected on the
// run that the driver's per-stop records don't show (extra cash handed
// over at the office, a UPI that landed after the last stop, …).
//
// POST   {firmId, mode: CASH|UPI, amount > 0, customerId, note?}
//        — customerId REQUIRED and must belong to one of the trip's
//          stops (every rupee on a delivery run belongs to a visited
//          shop; the receipt engine needs an AR side to stay balanced).
// DELETE {firmId, entryId} — remove an addition before the trip closes.
// Both refuse CLOSED / CANCELLED trips — settlement is frozen then.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { getTripForFirm, loadTripDetail } from "@/app/api/v1/_lib/logistics";
import { round2 } from "@/lib/gst";

const SETTLEMENT_MODES = ["CASH", "UPI"] as const;
type SettlementMode = (typeof SETTLEMENT_MODES)[number];

/** Entries are only editable before the books freeze. */
function assertTripEditable(status: string) {
  if (status === "CLOSED" || status === "CANCELLED") {
    throw new BusinessError(
      "ERR_INVALID_STATE",
      `Trip is ${status} — its settlement can no longer change`,
      409
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const trip = await getTripForFirm(id, firm.id);
    assertTripEditable(trip.status);

    const mode = getStr(body.mode).toUpperCase() as SettlementMode;
    if (!SETTLEMENT_MODES.includes(mode)) {
      throw new BusinessError("ERR_VALIDATION", "mode must be CASH or UPI", 400);
    }
    const amount = round2(getNum(body.amount));
    if (amount <= 0) {
      throw new BusinessError("ERR_VALIDATION", "Amount must be greater than zero", 400);
    }

    const customerId = getStr(body.customerId);
    if (!customerId) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Pick the shop this money belongs to — every collection on a trip maps to a visited customer",
        400
      );
    }

    // The shop must be one of this trip's stops (by the stop snapshot).
    const stops = await db.tripStop.findMany({
      where: { tripId: trip.id },
      select: { shopName: true, invoice: { select: { customerId: true } } },
    });
    const stopForCustomer = stops.find((s) => s.invoice.customerId === customerId);
    if (!stopForCustomer) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "That customer is not on this trip — choose one of the visited shops",
        400
      );
    }

    const entry = await db.tripSettlementEntry.create({
      data: {
        tripId: trip.id,
        mode,
        amount,
        customerId,
        customerName: stopForCustomer.shopName,
        note: getStr(body.note),
      },
    });

    const detail = await loadTripDetail(trip.id, true);
    return ok({ entry, trip: detail }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const trip = await getTripForFirm(id, firm.id);
    assertTripEditable(trip.status);

    const entryId = getStr(body.entryId);
    const entry = await db.tripSettlementEntry.findFirst({
      where: { id: entryId, tripId: trip.id },
    });
    if (!entry) {
      throw new BusinessError("ERR_NOT_FOUND", "Settlement entry not found on this trip", 404);
    }

    await db.tripSettlementEntry.delete({ where: { id: entry.id } });

    const detail = await loadTripDetail(trip.id, true);
    return ok({ trip: detail });
  } catch (e) {
    return handleApiError(e);
  }
}
