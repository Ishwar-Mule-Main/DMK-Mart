// POST /api/v1/inventory/sync/run — run the universal reconciliation
// right now (the same engine the automatic 30/60-min tick uses).

import { NextRequest } from "next/server";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { runUniversalReconcile } from "@/lib/inventory-sync";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const summary = await runUniversalReconcile(firm.id, "MANUAL");
    return ok({ summary, message: `Reconciled: ${summary.renamed} renamed · rollup ${summary.rollupFixed}/${summary.rollupChecked} fixed · ${summary.pushedTo.length} portal(s)` });
  } catch (e) {
    return handleApiError(e);
  }
}
