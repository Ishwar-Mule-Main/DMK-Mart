// ═══════════════════════════════════════════════════════════════
// /api/v1/dashboard — owner cockpit KPIs (engine in _lib/dashboard.ts)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { buildDashboard } from "@/app/api/v1/_lib/dashboard";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    // The selected financial year scopes every KPI window (fy injected by apiGet)
    const fy = getStr(sp.get("fy")) || null;
    const firm = await resolveFirm(firmId);
    const data = await buildDashboard(firm.id, fy);
    return ok({ ...data, firmName: firm.firmName });
  } catch (e) {
    return handleApiError(e);
  }
}
