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

// ─── GET: Vercel Cron ping (serverless catch-up) ─────────────────
// On Vercel the in-process scheduler cannot run (ephemeral functions),
// so vercel.json schedules this endpoint instead. It reuses the
// scheduler pass — the SAME engine, scanning every active firm for due
// autoPost templates. Idempotent: schedules advance only when posted.
//
// Auth: set CRON_SECRET in the environment and Vercel Cron will send
// `Authorization: Bearer <CRON_SECRET>` automatically (it also accepts
// ?secret=<CRON_SECRET> for manual pings). When CRON_SECRET is unset
// the endpoint is open — fine for dev/self-host; set it in production.
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET?.trim();
    if (secret) {
      const header = request.headers.get("authorization") ?? "";
      const querySecret = request.nextUrl.searchParams.get("secret") ?? "";
      if (header !== `Bearer ${secret}` && querySecret !== secret) {
        return ok({ ok: false, error: "Unauthorized cron ping" }, 401);
      }
    }

    const { runSchedulerPass } = await import("@/lib/scheduler");
    const pass = await runSchedulerPass("cron");
    return ok({
      ok: true,
      trigger: "cron",
      firmsChecked: pass.firmsChecked,
      generated: pass.generated,
      failed: pass.failed,
      skipped: pass.skipped,
      autoPosted: pass.autoPosted,
      errors: pass.errors,
      durationMs: pass.durationMs,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
