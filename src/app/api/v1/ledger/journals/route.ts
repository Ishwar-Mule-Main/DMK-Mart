// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/journals — journal list + manual JOURNAL/CONTRA entry
// R6: every entry posts through the balanced postJournal engine
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { postJournal, type VoucherType } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  endOfDay,
  fyRange,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const type = getStr(sp.get("type"));
    const search = getStr(sp.get("search"));
    // FY window applies when no explicit date range is given — explicit always wins.
    const fy = fyRange(sp.get("fy"));
    const dateFrom = getDateOrNull(sp.get("dateFrom")) ?? fy?.gte ?? null;
    const dateTo = getDateOrNull(sp.get("dateTo")) ?? fy?.lte ?? null;

    const journals = await db.journalEntry.findMany({
      where: {
        firmId,
        ...(type ? { voucherType: type } : {}),
        ...(dateFrom || dateTo
          ? {
              postingDate: {
                ...(dateFrom ? { gte: startOfDay(dateFrom) } : {}),
                ...(dateTo ? { lte: endOfDay(dateTo) } : {}),
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { narration: { contains: search } },
                { voucherNumber: { contains: search } },
              ],
            }
          : {}),
      },
      include: { lines: { orderBy: { entrySide: "desc" } } },
      orderBy: { postingDate: "desc" },
      take: 200,
    });
    return ok(journals);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const voucherType = getStr(body.voucherType) || "JOURNAL";
    if (!["JOURNAL", "CONTRA"].includes(voucherType)) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Manual entries accept voucherType JOURNAL or CONTRA only (auto vouchers post via documents)",
        400
      );
    }

    const rawLines = asRecordArray(body.lines).map((l) => ({
      accountCode: getStr(l.accountCode),
      entrySide: getStr(l.entrySide).toUpperCase() as "DEBIT" | "CREDIT",
      amount: round2(getNum(l.amount)),
      narration: getStr(l.narration) || undefined,
    }));

    if (rawLines.length < 2) {
      throw new BusinessError("ERR_VALIDATION", "A journal entry requires at least two lines", 400);
    }
    for (const l of rawLines) {
      if (!l.accountCode) throw new BusinessError("ERR_VALIDATION", "accountCode is required on every line", 400);
      if (!["DEBIT", "CREDIT"].includes(l.entrySide)) {
        throw new BusinessError("ERR_VALIDATION", "entrySide must be DEBIT or CREDIT", 400);
      }
      if (l.amount <= 0) {
        throw new BusinessError("ERR_VALIDATION", "Line amounts must be positive", 400);
      }
    }

    const postingDate = getDateOrNull(body.postingDate) ?? new Date();
    const journal = await postJournal({
      firmId: firm.id,
      voucherType: voucherType as VoucherType,
      postingDate,
      narration: getStr(body.narration) || "Manual journal entry",
      lines: rawLines,
    });

    return ok(journal, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
