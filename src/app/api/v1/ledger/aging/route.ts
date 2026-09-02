// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/aging — AR/AP buckets (0-30 / 31-60 / 61-90 / 90+)
// Oldest-first allocation engine shared with /dashboard in _lib/aging.ts
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { computeAPAging, computeARAging } from "@/app/api/v1/_lib/aging";
import {
  BusinessError,
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const type = getStr(sp.get("type")).toUpperCase() || "AR";
    if (!["AR", "AP"].includes(type)) {
      throw new BusinessError("ERR_VALIDATION", "type must be AR or AP", 400);
    }
    const asOf = getDateOrNull(sp.get("asOf")) ?? new Date();

    const result = type === "AR" ? await computeARAging(firmId, asOf) : await computeAPAging(firmId, asOf);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
