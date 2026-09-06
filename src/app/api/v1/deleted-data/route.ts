// ═══════════════════════════════════════════════════════════════
// GET /api/v1/deleted-data — the Deleted Data (recycle bin) register.
// Returns every snapshotted deletion for the firm: in-bin items first
// (newest first), then already-restored history when ?includeRestored.
// A per-type summary block powers the folder chips in the UI.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getBool, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const type = getStr(sp.get("type")); // optional entity-type filter
    const includeRestored = getBool(sp.get("includeRestored"), false);
    const search = getStr(sp.get("search"));

    const rows = await db.deletedRecord.findMany({
      where: {
        firmId,
        ...(type ? { entityType: type } : {}),
        ...(includeRestored ? {} : { restoredAt: null }),
        ...(search
          ? {
              OR: [
                { label: { contains: search } },
                { meta: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ restoredAt: "asc" }, { createdAt: "desc" }],
      take: 500,
    });

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
      items: rows,
      summary,
      inBin,
      restoredCount: await db.deletedRecord.count({ where: { firmId, restoredAt: { not: null } } }),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
