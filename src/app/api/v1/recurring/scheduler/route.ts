// ═══════════════════════════════════════════════════════════════
// /api/v1/recurring/scheduler — heartbeat + status surface for the
// in-process auto-post scheduler (src/lib/scheduler.ts).
// GET  → { status } (alive, heartbeat, passes, recent ring buffer)
// POST → { action: "run-now" } triggers an immediate pass (QA/demo)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { asRecord, BusinessError, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { getSchedulerStatus, runSchedulerPass } from "@/lib/scheduler";

export async function GET() {
  try {
    return ok({ status: getSchedulerStatus() });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const action = getStr(body.action);
    if (action !== "run-now") {
      throw new BusinessError("ERR_VALIDATION", 'action must be "run-now"', 400);
    }
    const pass = await runSchedulerPass("manual");
    return ok({ pass, status: getSchedulerStatus() });
  } catch (e) {
    return handleApiError(e);
  }
}
