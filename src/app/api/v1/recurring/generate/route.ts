// ═══════════════════════════════════════════════════════════════
// /api/v1/recurring/generate — run due recurring templates through
// the shared invoice engine (createInvoice). Each template bills at
// its own nextRunDate; schedules advance frequency-by-frequency
// (UTC-safe month addition, day clamped) until they pass `asOf`.
// A failing template (credit lock / stock / inactive product) is
// recorded as a failure and never rolls back other templates.
// Body: { firmId, templateId? (omit = run ALL due), asOf? (ISO) }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  addDays,
  asRecord,
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { createInvoice } from "@/app/api/v1/_lib/invoice";

const MAX_ITERATIONS = 24;

/** UTC-safe month addition — clamps day-of-month to the target month length. */
function addMonthsUTC(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const x = new Date(d.getTime());
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const daysInTarget = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, daysInTarget));
  return x;
}

function advance(cursor: Date, frequency: string): Date {
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

interface RunResult {
  templateId: string;
  templateName: string;
  ok: boolean;
  invoiceNumber?: string;
  grandTotal?: number;
  invoices?: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const templateId = getStr(body.templateId);
    const asOfDate = getDateOrNull(body.asOf) ?? new Date();

    // ── Collect templates to run ─────────────────────────────────
    const where = {
      firmId: firm.id,
      ...(templateId ? { id: templateId } : {}),
      // Batch runs target due templates only; an explicit templateId is
      // a manual override ("Run now") and may fire a future cycle early.
      ...(templateId
        ? {}
        : {
            isActive: true,
            nextRunDate: { lte: asOfDate },
          }),
    };

    const templates = await db.recurringTemplate.findMany({
      where,
      include: { items: true, customer: true },
      orderBy: { nextRunDate: "asc" },
    });

    const runs: RunResult[] = [];
    let generated = 0;
    let failed = 0;

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
            invoiceDate: new Date(cursor),
            lines,
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

    return ok({ runs, generated, failed });
  } catch (e) {
    return handleApiError(e);
  }
}
