// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/routes/[id] — patch / delete a delivery route
// DELETE is a hard delete, refused while any trip references the
// route (Trip.routeId FK is restrictive — history must survive).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";

async function getRouteForFirm(id: string, firmId: string) {
  const route = await db.deliveryRoute.findFirst({ where: { id, firmId } });
  if (!route) throw new BusinessError("ERR_ROUTE_NOT_FOUND", "Route not found for this firm", 404);
  return route;
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
    const route = await getRouteForFirm(id, firm.id);

    const name = body.name !== undefined ? getStr(body.name) : route.name;
    if (!name) throw new BusinessError("ERR_VALIDATION", "Route name is required", 400);
    if (name !== route.name) {
      const dup = await db.deliveryRoute.findUnique({
        where: { firmId_name: { firmId: firm.id, name } },
        select: { id: true },
      });
      if (dup) {
        throw new BusinessError("ERR_VALIDATION", `Route "${name}" already exists in this firm`, 409);
      }
    }

    const updated = await db.deliveryRoute.update({
      where: { id: route.id },
      data: {
        name,
        ...(body.towns !== undefined ? { towns: getStr(body.towns) } : {}),
        ...(body.startFrom !== undefined ? { startFrom: getStr(body.startFrom) } : {}),
        ...(body.endTo !== undefined ? { endTo: getStr(body.endTo) } : {}),
        ...(body.isActive !== undefined
          ? { isActive: body.isActive === true || body.isActive === "true" }
          : {}),
      },
    });
    return ok(updated);
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
    const route = await getRouteForFirm(id, firm.id);

    // Any trip on this route (cancelled included) keeps the FK alive —
    // deactivate instead of deleting when history exists.
    const tripCount = await db.trip.count({ where: { routeId: route.id } });
    if (tripCount > 0) {
      throw new BusinessError(
        "ERR_ROUTE_IN_USE",
        `Route has ${tripCount} trip${tripCount !== 1 ? "s" : ""} on record — deactivate it instead`,
        409
      );
    }

    await db.deliveryRoute.delete({ where: { id: route.id } });
    return ok({ deleted: true, id: route.id });
  } catch (e) {
    return handleApiError(e);
  }
}
