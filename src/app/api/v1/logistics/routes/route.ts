// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/routes — delivery routes (master data)
// A route owns a comma-separated town list; one town belongs to
// exactly one route, which makes trip planning unambiguous.
// GET  ?firmId=&search=  — routes by name with live trip counts
// POST {firmId, name, towns, startFrom?, endTo?}
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
import { containsArms, rankSearch } from "@/lib/search-rank";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);
    const search = getStr(sp.get("search"));

    // Word-wise SQL prefilter over [name, towns] (case variants keep it a
    // superset on Postgres + SQLite; the JS ranker decides matches).
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [{ name: { contains: v } }, { towns: { contains: v } }]);

    const routes = await db.deliveryRoute.findMany({
      where: {
        firmId,
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      orderBy: { name: "asc" },
      // tripCount ignores cancelled runs — they never occupied the route.
      include: {
        _count: { select: { trips: { where: { status: { not: "CANCELLED" } } } } },
      },
    });

    const ranked = rankSearch(routes, search, (r) => [r.name, r.towns]);

    return ok({
      routes: ranked.map((r) => ({
        ...r,
        tripCount: r._count.trips,
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

    const name = getStr(body.name);
    const towns = getStr(body.towns);
    if (!name) throw new BusinessError("ERR_VALIDATION", "Route name is required", 400);

    const dup = await db.deliveryRoute.findUnique({
      where: { firmId_name: { firmId: firm.id, name } },
      select: { id: true },
    });
    if (dup) {
      throw new BusinessError("ERR_VALIDATION", `Route "${name}" already exists in this firm`, 409);
    }

    const created = await db.deliveryRoute.create({
      data: {
        firmId: firm.id,
        name,
        towns,
        startFrom: getStr(body.startFrom),
        endTo: getStr(body.endTo),
      },
    });
    return ok({ ...created, tripCount: 0 }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
