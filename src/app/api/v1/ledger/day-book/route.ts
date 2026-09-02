// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/day-book — one day's journals + cash/bank flow
// Opening/closing balances derive from journal lines only — the OPENING
// journal already carries firm.openingCash/openingBank into the accounts,
// so adding them again would double-count.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  addDays,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";

interface FlowResult {
  opening: number;
  in: number;
  out: number;
  closing: number;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const dateParam = getStr(sp.get("date"));
    const date = dateParam ? new Date(dateParam) : new Date();
    const dayStart = startOfDay(Number.isNaN(date.getTime()) ? new Date() : date);
    const dayEnd = addDays(dayStart, 1);

    const journals = await db.journalEntry.findMany({
      where: { firmId, postingDate: { gte: dayStart, lt: dayEnd } },
      include: { lines: { orderBy: [{ entrySide: "desc" }, { accountName: "asc" }] } },
      orderBy: { createdAt: "asc" },
    });

    async function flow(accountCode: string): Promise<FlowResult> {
      const account = await db.chartOfAccount.findFirst({
        where: { firmId, accountCode },
        select: { id: true, openingBalance: true },
      });
      if (!account) return { opening: 0, in: 0, out: 0, closing: 0 };

      const before = await db.journalLine.aggregate({
        where: { accountId: account.id, journal: { postingDate: { lt: dayStart } } },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const during = await db.journalLine.aggregate({
        where: { accountId: account.id, journal: { postingDate: { gte: dayStart, lt: dayEnd } } },
        _sum: { debitAmount: true, creditAmount: true },
      });

      const opening = round2(
        account.openingBalance + (before._sum.debitAmount ?? 0) - (before._sum.creditAmount ?? 0)
      );
      const cashIn = round2(during._sum.debitAmount ?? 0);
      const cashOut = round2(during._sum.creditAmount ?? 0);
      return { opening, in: cashIn, out: cashOut, closing: round2(opening + cashIn - cashOut) };
    }

    const [cash, bank] = await Promise.all([flow(ACC.CASH), flow(ACC.BANK)]);

    return ok({
      firmId,
      firmName: firm.firmName,
      date: dayStart.toISOString().slice(0, 10),
      journals,
      cash,
      bank,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
