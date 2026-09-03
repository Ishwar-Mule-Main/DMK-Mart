// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — RECURRING AUTO-POST SCHEDULER
// In-process scheduler started from src/instrumentation.ts (nodejs
// runtime only, never during build). Every 5 minutes it looks for
// DUE recurring templates with autoPost enabled across ALL active
// firms and pushes them through the exact same engine the manual
// "Generate due now" button uses (pricing → GST → credit control →
// stock → AR → balanced journal, R6/R12/R13 all enforced).
//
// Design notes:
// · Singleton via globalThis — survives dev hot-reload double-calls.
// · Failures are isolated per template inside the engine; a pass
//   never throws — everything lands in the status ring buffer.
// · In-memory state is the heartbeat/audit surface for Settings;
//   the DURABLE audit trail is the stamped invoices themselves
//   (Invoice.templateId + invoiceDate).
// · DMK_SCHEDULER=off env kill-switch for tests/QA.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { runRecurringGeneration } from "@/app/api/v1/_lib/recurring-engine";

export const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const START_DELAY_MS = 45 * 1000; // catch-up pass shortly after boot
const RING_SIZE = 20;

export interface AutoPostRecord {
  templateName: string;
  invoiceNumber: string;
  grandTotal: number;
}

export interface SchedulerPass {
  at: string;
  firmsChecked: number;
  generated: number;
  failed: number;
  skipped: number;
  autoPosted: AutoPostRecord[];
  errors: string[];
  durationMs: number;
}

interface SchedulerState {
  startedAt: string | null;
  lastHeartbeat: string | null;
  passes: number;
  running: boolean;
  lastError: string | null;
  recent: SchedulerPass[];
  timer: ReturnType<typeof setInterval> | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
}

// Global singleton — dev hot-reload can re-run register() in the
// same process; without the guard we would stack duplicate intervals.
const g = globalThis as unknown as { __dmkScheduler?: SchedulerState };

function state(): SchedulerState {
  if (!g.__dmkScheduler) {
    g.__dmkScheduler = {
      startedAt: null,
      lastHeartbeat: null,
      passes: 0,
      running: false,
      lastError: null,
      recent: [],
      timer: null,
      startupTimer: null,
    };
  }
  return g.__dmkScheduler;
}

/** One scheduler pass: run due autoPost templates for every active firm. */
export async function runSchedulerPass(trigger: "interval" | "boot" | "manual" = "interval"): Promise<SchedulerPass> {
  const s = state();
  const t0 = Date.now();
  const pass: SchedulerPass = {
    at: new Date().toISOString(),
    firmsChecked: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
    autoPosted: [],
    errors: [],
    durationMs: 0,
  };

  if (s.running) {
    pass.errors.push("Previous pass still in progress — skipped");
    pass.durationMs = Date.now() - t0;
    return pass;
  }
  s.running = true;
  try {
    // Firms that actually have a due autoPost template — the common
    // case is zero, so the pass is one light indexed query.
    const due = await db.recurringTemplate.findMany({
      where: {
        isActive: true,
        autoPost: true,
        nextRunDate: { lte: new Date() },
        firm: { isActive: true },
      },
      select: { firmId: true },
      distinct: ["firmId"],
    });
    pass.firmsChecked = due.length;

    for (const { firmId } of due) {
      try {
        const report = await runRecurringGeneration({ firmId, autoPostOnly: true });
        pass.generated += report.generated;
        pass.failed += report.failed;
        pass.skipped += report.skipped;
        for (const r of report.runs) {
          if (r.ok && r.invoiceNumber) {
            pass.autoPosted.push({
              templateName: r.templateName,
              invoiceNumber: r.invoiceNumber,
              grandTotal: r.grandTotal ?? 0,
            });
          }
          if (!r.ok && r.error) pass.errors.push(`${r.templateName}: ${r.error}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown engine error";
        pass.errors.push(`firm ${firmId}: ${msg}`);
        pass.failed++;
      }
    }

    if (pass.errors.length > 0) s.lastError = pass.errors[0];
    else s.lastError = null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown scheduler error";
    pass.errors.push(msg);
    s.lastError = msg;
  } finally {
    s.running = false;
  }

  pass.durationMs = Date.now() - t0;
  s.passes++;
  s.lastHeartbeat = new Date().toISOString();
  s.recent.unshift(pass);
  if (s.recent.length > RING_SIZE) s.recent.length = RING_SIZE;

  if (pass.generated > 0 || pass.failed > 0) {
    console.log(
      `[scheduler] ${trigger} pass: ${pass.generated} invoice(s) auto-posted, ${pass.failed} failed, ${pass.skipped} skipped (${pass.durationMs}ms)`
    );
    for (const a of pass.autoPosted) {
      console.log(`[scheduler]   → ${a.invoiceNumber} ₹${a.grandTotal.toFixed(2)} · ${a.templateName}`);
    }
  }
  return pass;
}

/** Start the scheduler (idempotent). Returns false when disabled/already running. */
export function startScheduler(): boolean {
  if (process.env.DMK_SCHEDULER === "off") {
    console.log("[scheduler] disabled via DMK_SCHEDULER=off");
    return false;
  }
  const s = state();
  if (s.timer) return false; // already started
  s.startedAt = new Date().toISOString();
  // Boot catch-up: if the server was down when cycles fell due, post
  // them shortly after boot (engine advances schedules idempotently).
  s.startupTimer = setTimeout(() => {
    void runSchedulerPass("boot").catch(() => {});
  }, START_DELAY_MS);
  s.timer = setInterval(() => {
    void runSchedulerPass("interval").catch(() => {});
  }, SCHEDULER_INTERVAL_MS);
  console.log(`[scheduler] recurring auto-post scheduler started — every ${SCHEDULER_INTERVAL_MS / 60000} min (boot pass in ${START_DELAY_MS / 1000}s)`);
  return true;
}

export interface SchedulerStatus {
  alive: boolean;
  startedAt: string | null;
  lastHeartbeat: string | null;
  intervalMinutes: number;
  passes: number;
  running: boolean;
  lastError: string | null;
  recent: SchedulerPass[];
}

export function getSchedulerStatus(): SchedulerStatus {
  const s = state();
  return {
    alive: !!s.timer,
    startedAt: s.startedAt,
    lastHeartbeat: s.lastHeartbeat,
    intervalMinutes: SCHEDULER_INTERVAL_MS / 60000,
    passes: s.passes,
    running: s.running,
    lastError: s.lastError,
    recent: s.recent,
  };
}
