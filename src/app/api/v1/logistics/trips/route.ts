// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips — trip register + planner
// GET  ?firmId=&status=&search= — newest-first register with stop
//      progress; word-wise over [tripNumber, route, driver, vehicle].
// POST {firmId, routeId, driverId?, driverName?, vehicleNumber,
//       stops:[{invoiceId, sequence}], allowOffRoute?} — validates the
//      route's town ownership of every order (allowOffRoute=true lets
//      non-route orders ride along with an Off-route flag instead of
//      failing), snapshots stop + load aggregates.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db, dbTx } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getBool,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  assertStopListWellFormed,
  buildStopCreateData,
  computeOrderAgg,
  computeTripTotals,
  loadInvoicesForStops,
  loadTripDetail,
  nextTripNumber,
  validateStopsForRoute,
} from "@/app/api/v1/_lib/logistics";
import { containsArms, rankSearch } from "@/lib/search-rank";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);
    const status = getStr(sp.get("status"));
    const search = getStr(sp.get("search"));

    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { tripNumber: { contains: v } },
        { routeName: { contains: v } },
        { driverName: { contains: v } },
        { vehicleNumber: { contains: v } },
      ]);

    const trips = await db.trip.findMany({
      where: {
        firmId,
        ...(status ? { status } : {}),
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      include: { stops: { orderBy: { sequence: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Chronological rank keeps the newest-first register order.
    const ranked = rankSearch(trips, search, (t) => [
      t.tripNumber,
      t.routeName,
      t.driverName,
      t.vehicleNumber,
    ], { chronological: true });

    return ok({
      trips: ranked.map((t) => ({
        ...t,
        deliveredStops: t.stops.filter((s) => s.status === "DELIVERED").length,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const route = await db.deliveryRoute.findFirst({
      where: { id: getStr(body.routeId), firmId: firm.id },
    });
    if (!route) throw new BusinessError("ERR_ROUTE_NOT_FOUND", "Route not found for this firm", 404);

    const vehicleNumber = getStr(body.vehicleNumber);
    if (!vehicleNumber) {
      throw new BusinessError("ERR_VALIDATION", "Vehicle number is required", 400);
    }

    // Driver: optional VerificationStaff link (name denormalized).
    let driverId = getStr(body.driverId) || null;
    let driverName = getStr(body.driverName);
    if (driverId) {
      const staff = await db.verificationStaff.findFirst({
        where: { id: driverId, firmId: firm.id, isActive: true },
      });
      if (!staff) {
        throw new BusinessError("ERR_VALIDATION", "Driver (team member) not found or inactive", 404);
      }
      if (!driverName) driverName = staff.name;
    }

    // Stops: [{invoiceId, sequence}] — well-formed + business-valid.
    const stopInputs = asRecordArray(body.stops)
      .map((s, i) => ({
        invoiceId: getStr(s.invoiceId),
        sequence: Math.max(1, Math.floor(getNum(s.sequence, i + 1))),
      }))
      .filter((s) => s.invoiceId !== "");
    assertStopListWellFormed(stopInputs);

    const invoices = await loadInvoicesForStops(stopInputs.map((s) => s.invoiceId));
    const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
    const allowOffRoute = getBool(body.allowOffRoute, false);
    const offRouteIds = validateStopsForRoute(firm.id, stopInputs, invoiceById, route, { allowOffRoute });

    const tripNumber = await nextTripNumber(firm.id, firm.invoicePrefix);

    // Load aggregates per order + trip-level totals/expected collections.
    const totals = computeTripTotals(
      stopInputs.map((s) => {
        const inv = invoiceById.get(s.invoiceId)!;
        return { agg: computeOrderAgg(inv), paymentMode: inv.paymentMode };
      })
    );

    const tripId = await dbTx(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          firmId: firm.id,
          tripNumber,
          routeId: route.id,
          routeName: route.name, // denormalized for register/print
          driverId,
          driverName,
          vehicleNumber,
          status: "PLANNED",
          ...totals,
          stops: {
            create: stopInputs.map((s) =>
              buildStopCreateData(invoiceById.get(s.invoiceId)!, s.sequence, offRouteIds.has(s.invoiceId))
            ),
          },
        },
      });
      return trip.id;
    });

    // Re-fetch through the shared detail loader (items + owner OTP view).
    const detail = await loadTripDetail(tripId, true);
    return ok({ trip: detail }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
