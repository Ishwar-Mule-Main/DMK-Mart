// ═══════════════════════════════════════════════════════════════
// /api/v1/firms/[id]/financial-years — FY registry per firm
//
// GET  → list the firm's book years (ordered by start date).
// POST → open a year: { label, auto?, activate? }.
//        · label must be a valid Apr–Mar year label
//        · duplicate requests return the existing row (idempotent)
//        · activate:true also makes the year the firm's default
//          (used by the lock gate and the 1-Apr auto-open)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, getBool, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { fyDateRange, fyLabelForDate, isValidFyLabel, nextFyLabel } from "@/lib/fy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const firm = await db.firm.findUnique({ where: { id } });
    if (!firm) throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found", 404);
    const years = await db.financialYear.findMany({
      where: { firmId: id },
      orderBy: { startDate: "asc" },
    });
    return ok({
      years,
      currentFy: fyLabelForDate(new Date()),
      suggestedNext: nextFyLabel(years.at(-1)?.label ?? fyLabelForDate(new Date())),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const firm = await db.firm.findUnique({ where: { id } });
    if (!firm) throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found", 404);

    const body = asRecord(await request.json().catch(() => ({})));
    const label = getStr(body.label);
    const auto = getBool(body.auto);
    const activate = body.activate === undefined ? true : getBool(body.activate);

    if (!isValidFyLabel(label)) {
      throw new BusinessError("ERR_VALIDATION", "Financial year must look like 2026-27 and start in April", 400);
    }
    const { startDate, endDate } = fyDateRange(label);

    const existing = await db.financialYear.findUnique({
      where: { firmId_label: { firmId: id, label } },
    });
    if (existing) {
      if (activate && firm.financialYear !== label) {
        await db.firm.update({ where: { id }, data: { financialYear: label } });
      }
      return ok({ year: existing, created: false });
    }

    const year = await db.financialYear.create({
      data: { firmId: id, label, startDate, endDate, autoCreated: auto, isClosed: false },
    });
    if (activate && firm.financialYear !== label) {
      await db.firm.update({ where: { id }, data: { financialYear: label } });
    }
    return ok({ year, created: true });
  } catch (e) {
    return handleApiError(e);
  }
}
