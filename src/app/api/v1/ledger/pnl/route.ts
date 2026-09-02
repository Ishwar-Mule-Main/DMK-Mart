// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/pnl — trading account window (revenue → net profit)
// Engine shared with /ai/chat in _lib/pnl.ts
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  getDateOrNull,
  endOfDay,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";
import { computePnl } from "@/app/api/v1/_lib/pnl";

/** FY "2025-26" → April 1 start. */
function fyStart(fy: string): Date {
  const year = parseInt(fy.slice(0, 4), 10);
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  return new Date(y, 3, 1, 0, 0, 0, 0);
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const dateFrom = getDateOrNull(sp.get("dateFrom")) ?? fyStart(firm.financialYear);
    const dateTo = getDateOrNull(sp.get("dateTo")) ?? new Date();

    const pnl = await computePnl(firmId, startOfDay(dateFrom), endOfDay(dateTo));
    return ok(pnl);
  } catch (e) {
    return handleApiError(e);
  }
}
