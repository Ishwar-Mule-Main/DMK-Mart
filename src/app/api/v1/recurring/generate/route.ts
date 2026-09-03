// ═══════════════════════════════════════════════════════════════
// /api/v1/recurring/generate — run due recurring templates through
// the shared invoice engine (createInvoice). Thin HTTP wrapper —
// the actual logic lives in _lib/recurring-engine.ts so the
// in-process auto-post scheduler (src/lib/scheduler.ts) can run
// the exact same code without HTTP self-calls.
// Body: { firmId, templateId? (omit = run ALL due), asOf? (ISO) }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { runRecurringGeneration } from "@/app/api/v1/_lib/recurring-engine";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const templateId = getStr(body.templateId) || undefined;
    const asOfDate = getDateOrNull(body.asOf) ?? undefined;

    const report = await runRecurringGeneration({ firmId, templateId, asOf: asOfDate });
    return ok(report);
  } catch (e) {
    return handleApiError(e);
  }
}
