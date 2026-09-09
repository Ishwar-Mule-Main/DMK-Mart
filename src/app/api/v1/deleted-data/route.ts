// ═══════════════════════════════════════════════════════════════
// GET /api/v1/deleted-data — the Deleted Data (recycle bin) register.
// Returns every snapshotted deletion for the firm: in-bin items first
// (newest first), then already-restored history when ?includeRestored.
// A per-type summary block powers the folder chips in the UI.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getBool, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { containsArms, rankSearch } from "@/lib/search-rank";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const type = getStr(sp.get("type")); // optional entity-type filter
    const includeRestored = getBool(sp.get("includeRestored"), false);
    const search = getStr(sp.get("search"));

    // Word-wise SQL prefilter: every query word must hit label or meta
    // (meta carries name/SKU/phone across item types). Case variants keep
    // the prefilter a superset on Postgres AND SQLite.
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { label: { contains: v } },
        { meta: { contains: v } },
      ]);

    const rows = await db.deletedRecord.findMany({
      where: {
        firmId,
        ...(type ? { entityType: type } : {}),
        ...(includeRestored ? {} : { restoredAt: null }),
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      orderBy: [{ restoredAt: "asc" }, { createdAt: "desc" }],
      take: 500,
    });

    // Word-wise matching (chronological — bin order preserved).
    const filtered = rankSearch(rows, search, (r) => [r.label, r.meta], { chronological: true });

    // Fresh rows (no restoredAt) sort first by createdAt desc; restored
    // rows trail after — SQLite orders nulls first on asc, which gives
    // exactly that split with the composite orderBy above.

    const counts = await db.deletedRecord.groupBy({
      by: ["entityType"],
      where: { firmId, restoredAt: null },
      _count: { _all: true },
    });
    const summary: Record<string, number> = {};
    let inBin = 0;
    for (const g of counts) {
      summary[g.entityType] = g._count._all;
      inBin += g._count._all;
    }

    return ok({
      items: filtered,
      summary,
      inBin,
      restoredCount: await db.deletedRecord.count({ where: { firmId, restoredAt: { not: null } } }),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
