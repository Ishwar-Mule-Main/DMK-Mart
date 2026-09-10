// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/towns — town catalog for the route builder
// GET ?firmId= → { towns:[{name, customerCount, unassignedCount,
//                usedInRoutes[]}] }
// Candidates = distinct non-empty Customer.city (grouped
// case-insensitively onto the most common original casing) PLUS every
// town already listed on a route. unassignedCount counts POSTED
// non-counter invoices with no TripStop per town — the number the
// planner can actually pick up. Alphabetical order.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    // ── 1. Customer-city candidates, grouped case-insensitively ──
    // Prisma groupBy can't fold "pune" and "Pune" together, so fetch the
    // cities and reduce here: the lowercase key carries the count and the
    // display name is the most common original casing.
    const customers = await db.customer.findMany({
      where: { firmId },
      select: { city: true },
    });
    interface TownAgg {
      name: string;
      count: number;
      casings: Map<string, number>;
    }
    const byKey = new Map<string, TownAgg>();
    for (const c of customers) {
      const raw = c.city.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const agg = byKey.get(key) ?? { name: raw, count: 0, casings: new Map<string, number>() };
      agg.count += 1;
      agg.casings.set(raw, (agg.casings.get(raw) ?? 0) + 1);
      byKey.set(key, agg);
    }

    // ── 2. Route towns join the catalog (routes may cover towns that no
    // customer carries yet) and each town records which routes use it ──
    const routes = await db.deliveryRoute.findMany({
      where: { firmId },
      select: { name: true, towns: true },
      orderBy: { name: "asc" },
    });
    const usedIn = new Map<string, Set<string>>(); // lowercase town → route names
    for (const r of routes) {
      for (const t of r.towns.split(",")) {
        const raw = t.trim();
        if (!raw) continue;
        const key = raw.toLowerCase();
        const set = usedIn.get(key) ?? new Set<string>();
        set.add(r.name);
        usedIn.set(key, set);
        if (!byKey.has(key)) byKey.set(key, { name: raw, count: 0, casings: new Map<string, number>() });
      }
    }

    // Display name = most common original casing (ties → first seen).
    const towns = [...byKey.entries()].map(([key, agg]) => {
      let best: string | null = null;
      let bestN = -1;
      for (const [casing, n] of agg.casings) {
        if (n > bestN) {
          best = casing;
          bestN = n;
        }
      }
      return { key, name: best ?? agg.name, customerCount: agg.count };
    });

    // ── 3. Unassigned-order counts per town — one query, then reduce ──
    const unassigned = await db.invoice.findMany({
      where: {
        firmId,
        status: "POSTED",
        isCounterSale: false,
        tripStop: { is: null },
      },
      select: { customer: { select: { city: true } } },
    });
    const unassignedByKey = new Map<string, number>();
    for (const inv of unassigned) {
      const raw = (inv.customer?.city ?? "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      unassignedByKey.set(key, (unassignedByKey.get(key) ?? 0) + 1);
    }

    return ok({
      towns: towns
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({
          name: t.name,
          customerCount: t.customerCount,
          unassignedCount: unassignedByKey.get(t.key) ?? 0,
          usedInRoutes: [...(usedIn.get(t.key) ?? new Set<string>())],
        })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
