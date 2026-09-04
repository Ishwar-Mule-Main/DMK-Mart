// ═══════════════════════════════════════════════════════════════
// RECURRING ENGINE — shared by /api/v1/recurring/generate (manual)
// and the in-process auto-post scheduler (src/lib/scheduler.ts).
// Each template bills at its own nextRunDate; schedules advance
// frequency-by-frequency (UTC-safe month addition, day clamped)
// until they pass `asOf`. A failing template (credit lock / stock /
// inactive product) is recorded as a failure and never rolls back
// other templates. Hold windows (skipUntil) forgive cycles inside
// the window — never back-billing.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { addDays, resolveFirm } from "./api";
import { createInvoice } from "./invoice";

const MAX_ITERATIONS = 24;

/** UTC-safe month addition — clamps day-of-month to the target month length. */
export function addMonthsUTC(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const x = new Date(d.getTime());
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const daysInTarget = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, daysInTarget));
  return x;
}

export function advance(cursor: Date, frequency: string): Date {
  switch (frequency) {
    case "WEEKLY":
      return addDays(cursor, 7);
    case "BIMONTHLY":
      return addMonthsUTC(cursor, 2);
    case "QUARTERLY":
      return addMonthsUTC(cursor, 3);
    case "MONTHLY":
    default:
      return addMonthsUTC(cursor, 1);
  }
}

export interface EngineRunResult {
  templateId: string;
  templateName: string;
  ok: boolean;
  invoiceNumber?: string;
  grandTotal?: number;
  invoices?: number;
  /** true = template was on a skip-window hold and cycles inside it were forgiven */
  skipped?: boolean;
  skippedCycles?: number;
  holdUntil?: string;
  error?: string;
}

export interface GenerationReport {
  runs: EngineRunResult[];
  generated: number;
  failed: number;
  skipped: number;
}

export interface RunOptions {
  firmId: string;
  /** Explicit template = manual "Run now" override (may fire a future cycle). */
  templateId?: string;
  /** Defaults to now. */
  asOf?: Date;
  /**
   * true → batch collection only picks templates with autoPost enabled
   * (used by the scheduler). Manual runs bill every due template.
   */
  autoPostOnly?: boolean;
}

export async function runRecurringGeneration(opts: RunOptions): Promise<GenerationReport> {
  const asOfDate = opts.asOf ?? new Date();
  const templateId = opts.templateId;
  // Engine resolves the firm itself so the scheduler can call it
  // without HTTP round-trips or pre-resolved rows.
  const firm = await resolveFirm(opts.firmId);

  // ── Collect templates to run ─────────────────────────────────
  const where = {
    firmId: opts.firmId,
    ...(templateId ? { id: templateId } : {}),
    // Batch runs target due templates only; an explicit templateId is
    // a manual override ("Run now") and may fire a future cycle early.
    ...(templateId
      ? {}
      : {
          isActive: true,
          nextRunDate: { lte: asOfDate },
          ...(opts.autoPostOnly ? { autoPost: true } : {}),
        }),
  };

  const templates = await db.recurringTemplate.findMany({
    where,
    include: { items: true, customer: true },
    orderBy: { nextRunDate: "asc" },
  });

  const runs: EngineRunResult[] = [];
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  for (const t of templates) {
    const base = {
      templateId: t.id,
      templateName: t.name,
    };

    if (!templateId && !t.isActive) continue; // safety (also enforced by where)

    // Schedule ended: next cycle is past the template's end date
    if (t.endDate && t.nextRunDate.getTime() > t.endDate.getTime()) {
      if (templateId) {
        runs.push({ ...base, ok: false, error: "Schedule has ended (next run is past the end date)" });
        failed++;
      }
      continue;
    }

    // ── Hold window (skipUntil): cycles due inside the window are
    // forgiven — the schedule advances past the hold WITHOUT billing
    // (no surprise back-billing when the hold lifts, even if
    // generation is only run after the hold has passed). Cycles after
    // the window still bill normally in the same run.
    if (t.skipUntil && t.nextRunDate.getTime() <= t.skipUntil.getTime()) {
      const holdCursor = new Date(t.nextRunDate.getTime());
      let skippedCycles = 0;
      let iterations = 0;
      while (holdCursor.getTime() <= t.skipUntil.getTime() && iterations < 60) {
        holdCursor.setTime(advance(holdCursor, t.frequency).getTime());
        skippedCycles++;
        iterations++;
      }
      if (iterations >= 60) {
        // Absurd hold window — refuse rather than silently mangle the schedule
        runs.push({
          ...base,
          ok: false,
          error: "Hold window is too long for the template's frequency — edit the schedule or clear the hold",
        });
        failed++;
        continue;
      }
      // A hold that pushes nextRunDate past the end date ends the schedule
      const scheduleEnded = !!t.endDate && holdCursor.getTime() > t.endDate.getTime();
      await db.recurringTemplate.update({
        where: { id: t.id },
        data: {
          nextRunDate: holdCursor,
          lastRunDate: asOfDate,
          // Schedule over → retire the hold so the UI stops flagging it
          ...(scheduleEnded ? { skipUntil: null } : {}),
        },
      });
      runs.push({
        ...base,
        ok: true,
        skipped: true,
        skippedCycles,
        holdUntil: t.skipUntil.toISOString(),
      });
      skipped++;
      // Explicit run-now on a held template = "skip what's due, don't
      // bill" (matches the action's tooltip; no surprise future-dated
      // invoices). Batch runs fall through so already-due post-hold
      // cycles catch up in the same pass.
      if (templateId) continue;
      if (scheduleEnded) continue;
      // Fall through: bill the first post-hold cycle onwards in this run
      t.nextRunDate = holdCursor;
    }

    // Explicit single runs bill exactly one cycle even if not yet due
    const effAsOf = templateId
      ? new Date(Math.max(asOfDate.getTime(), t.nextRunDate.getTime()))
      : asOfDate;

    const lines = t.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      manualDiscountPct: i.manualDiscountPct ?? undefined,
    }));

    let cursor = new Date(t.nextRunDate.getTime());
    let lastInvoiceId = "";
    let lastInvoiceNumber = "";
    let lastGrandTotal = 0;
    let count = 0;
    let error: string | null = null;
    let iterations = 0;

    while (cursor.getTime() <= effAsOf.getTime() && iterations < MAX_ITERATIONS) {
      try {
        const result = await createInvoice(firm, {
          firmId: firm.id,
          customerId: t.customerId,
          paymentMode: t.paymentMode,
          // NEVER post-date the books: an explicit run-now on a not-yet-due
          // template bills today (this was the "3 Nov 2026" journals bug).
          invoiceDate: new Date(Math.min(cursor.getTime(), asOfDate.getTime())),
          lines,
          templateId: t.id,
        });
        lastInvoiceId = result.invoice?.id ?? "";
        lastInvoiceNumber = result.invoice?.invoiceNumber ?? "";
        lastGrandTotal = result.invoice?.grandTotal ?? 0;
        count++;
      } catch (e) {
        // Per-template failure — never roll back other templates.
        // The failed cycle stays due (nextRunDate not advanced).
        error = e instanceof Error ? e.message : "Unexpected error while generating invoice";
        break;
      }
      cursor = advance(cursor, t.frequency);
      iterations++;
    }

    if (error) {
      runs.push({
        ...base,
        ok: false,
        error,
        ...(count > 0 ? { invoiceNumber: lastInvoiceNumber, grandTotal: lastGrandTotal, invoices: count } : {}),
      });
      failed++;
      // persist progress made before the failure, keep failed cycle due
      if (count > 0) {
        await db.recurringTemplate.update({
          where: { id: t.id },
          data: {
            nextRunDate: cursor,
            lastRunDate: asOfDate,
            lastInvoiceId,
          },
        });
      }
      continue;
    }

    if (count === 0) continue; // nothing was due (batch mode edge)

    await db.recurringTemplate.update({
      where: { id: t.id },
      data: {
        nextRunDate: cursor,
        lastRunDate: asOfDate,
        lastInvoiceId,
      },
    });

    runs.push({
      ...base,
      ok: true,
      invoiceNumber: lastInvoiceNumber,
      grandTotal: lastGrandTotal,
      invoices: count,
    });
    generated++;
  }

  return { runs, generated, failed, skipped };
}
