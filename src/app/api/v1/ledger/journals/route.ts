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
import { containsArms, rankSearch } from "@/lib/search-rank";

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

    // Word-wise SQL prefilter: every query word must hit at least one
    // searchable column (AND across words, OR across columns — narration,
    // voucher number and journal-line account names/notes). Case variants
    // keep the prefilter a superset on Postgres AND SQLite.
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { narration: { contains: v } },
        { voucherNumber: { contains: v } },
        { lines: { some: { OR: [{ accountName: { contains: v } }, { narration: { contains: v } }] } } },
      ]);

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
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      include: { lines: { orderBy: { entrySide: "desc" } } },
      orderBy: [{ postingDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    // Word-wise matching (chronological — newest-first register order kept).
    const ranked = rankSearch(journals, search, (j) => [
      j.narration,
      j.voucherNumber,
      j.lines.map((l) => l.accountName).join(" "),
      j.lines.map((l) => l.narration).join(" "),
    ], { chronological: true });
    return ok(ranked);
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
