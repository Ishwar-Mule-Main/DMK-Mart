// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id] — trip detail, replan, cancel
// GET    ?firmId= — full trip + stops (+items, +bill OTP for owner)
// PATCH  {vehicleNumber?, driverId?, driverName?, stops?} — PLANNED
//        only; stops replace-and-resequence, totals recomputed.
// DELETE ?firmId= — PLANNED only → CANCELLED; stops are removed so
//        every order falls back to the unassigned pool.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db, dbTx } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  assertStopListWellFormed,
  buildStopCreateData,
  computeTripTotals,
  getTripForFirm,
  loadInvoicesForStops,
  loadTripDetail,
  validateStopsForRoute,
  type StopInvoice,
} from "@/app/api/v1/_lib/logistics";

/** Parse the [{invoiceId, sequence}] patch payload. */
function parseStopInputs(raw: unknown) {
  return asRecordArray(raw)
    .map((s, i) => ({
      invoiceId: getStr(s.invoiceId),
      sequence: Math.max(1, Math.floor(getNum(s.sequence, i + 1))),
    }))
    .filter((s) => s.invoiceId !== "");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));
    await getTripForFirm(id, firm.id);

    const detail = await loadTripDetail(id, true); // owner sees the OTP
    return ok({ trip: detail });
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
    const sp = request.nextUrl.searchParams;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId) || getStr(sp.get("firmId")));
    const trip = await getTripForFirm(id, firm.id);

    if (trip.status !== "PLANNED") {
      throw new BusinessError("ERR_INVALID_STATE", "Only planned trips can be edited", 409);
    }

    const data: { vehicleNumber?: string; driverId?: string | null; driverName?: string } = {};

    if (body.vehicleNumber !== undefined) {
      const vehicleNumber = getStr(body.vehicleNumber);
      if (!vehicleNumber) {
        throw new BusinessError("ERR_VALIDATION", "Vehicle number is required", 400);
      }
      data.vehicleNumber = vehicleNumber;
    }

    if (body.driverId !== undefined) {
      const driverId = getStr(body.driverId) || null;
      if (driverId) {
        const staff = await db.verificationStaff.findFirst({
          where: { id: driverId, firmId: firm.id, isActive: true },
        });
        if (!staff) {
          throw new BusinessError("ERR_VALIDATION", "Driver (team member) not found or inactive", 404);
        }
        data.driverId = driverId;
        data.driverName =
          body.driverName !== undefined ? getStr(body.driverName) : trip.driverName || staff.name;
      } else {
        data.driverId = null;
        data.driverName = body.driverName !== undefined ? getStr(body.driverName) : "";
      }
    } else if (body.driverName !== undefined) {
      data.driverName = getStr(body.driverName);
    }

    // ── Stop replacement (the whole desired list, resequenced) ─────
    if (body.stops !== undefined) {
      const stopInputs = parseStopInputs(body.stops);
      assertStopListWellFormed(stopInputs);

      const existingStops = await db.tripStop.findMany({ where: { tripId: trip.id } });
      // A planned trip has only PENDING stops; guard anyway so a
      // delivered stop can never be silently dropped or reordered.
      if (existingStops.some((s) => s.status !== "PENDING")) {
        throw new BusinessError("ERR_INVALID_STATE", "Delivered stops cannot be changed", 409);
      }

      const existingByInvoice = new Map(existingStops.map((s) => [s.invoiceId, s]));
      const route = await db.deliveryRoute.findUnique({ where: { id: trip.routeId } });
      if (!route) {
        throw new BusinessError("ERR_ROUTE_NOT_FOUND", "The trip's route no longer exists", 404);
      }

      // New orders (not already on THIS trip) go through the same
      // validation as trip creation.
      const newIds = stopInputs
        .filter((s) => !existingByInvoice.has(s.invoiceId))
        .map((s) => s.invoiceId);
      const newInvoices = await loadInvoicesForStops(newIds);
      const newInvoiceById = new Map<string, StopInvoice>(newInvoices.map((inv) => [inv.id, inv]));
      validateStopsForRoute(firm.id, stopInputs.filter((s) => newInvoiceById.has(s.invoiceId)), newInvoiceById, route);

      await dbTx(async (tx) => {
        // Removed stops → orders fall back to the unassigned pool.
        const keepIds = stopInputs.map((s) => s.invoiceId);
        await tx.tripStop.deleteMany({
          where: { tripId: trip.id, invoiceId: { notIn: keepIds } },
        });

        for (const s of stopInputs) {
          const existing = existingByInvoice.get(s.invoiceId);
          if (existing) {
            if (existing.sequence !== s.sequence) {
              await tx.tripStop.update({
                where: { id: existing.id },
                data: { sequence: s.sequence },
              });
            }
            continue;
          }
          const inv = newInvoiceById.get(s.invoiceId);
          if (!inv) continue; // defensive — validation guarantees a hit
          await tx.tripStop.create({
            data: { tripId: trip.id, ...buildStopCreateData(inv, s.sequence) },
          });
        }

        // Recompute trip totals from the resulting stop set.
        const stops = await tx.tripStop.findMany({
          where: { tripId: trip.id },
          select: { boxes: true, loosePieces: true, weightKg: true, amount: true, expectedMode: true },
        });
        const totals = computeTripTotals(
          stops.map((s) => ({
            agg: {
              boxes: s.boxes,
              loosePieces: s.loosePieces,
              weightKg: s.weightKg,
              amount: s.amount,
              itemCount: 0,
            },
            paymentMode: s.expectedMode,
          }))
        );
        await tx.trip.update({ where: { id: trip.id }, data: { ...data, ...totals } });
      });
    } else if (Object.keys(data).length > 0) {
      await db.trip.update({ where: { id: trip.id }, data });
    }

    const detail = await loadTripDetail(trip.id, true);
    return ok({ trip: detail });
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
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));
    const trip = await getTripForFirm(id, firm.id);

    if (trip.status !== "PLANNED") {
      throw new BusinessError(
        "ERR_INVALID_STATE",
        "Only planned trips can be cancelled — dispatched trips must be worked or closed",
        409
      );
    }

    const updated = await dbTx(async (tx) => {
      // Stops first — each order's tripStop disappears, so the order
      // returns to the unassigned pool automatically.
      await tx.tripStop.deleteMany({ where: { tripId: trip.id } });
      return tx.trip.update({ where: { id: trip.id }, data: { status: "CANCELLED" } });
    });

    return ok({ ...updated, stops: [], deliveredStops: 0 });
  } catch (e) {
    return handleApiError(e);
  }
}
