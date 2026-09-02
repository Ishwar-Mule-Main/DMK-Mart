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

    // ── Optional cash+bank movement trend (last N days ending on
    //    the selected day) — powers the Day Book flow mini-chart. ──
    let trend: Array<{
      date: string;
      label: string;
      cashIn: number;
      cashOut: number;
      bankIn: number;
      bankOut: number;
      in: number;
      out: number;
      net: number;
    }> = [];
    const trendDays = Math.min(Math.max(Number(sp.get("trendDays")) || 0, 0), 60);
    if (trendDays > 0) {
      const windowStart = addDays(dayStart, -(trendDays - 1));
      const accounts = await db.chartOfAccount.findMany({
        where: { firmId, accountCode: { in: [ACC.CASH, ACC.BANK] } },
        select: { id: true, accountCode: true },
      });
      const cashId = accounts.find((a) => a.accountCode === ACC.CASH)?.id;
      const bankId = accounts.find((a) => a.accountCode === ACC.BANK)?.id;
      const lines = await db.journalLine.findMany({
        where: {
          accountId: { in: [cashId, bankId].filter((v): v is string => Boolean(v)) },
          journal: { postingDate: { gte: windowStart, lt: dayEnd } },
        },
        select: { accountId: true, debitAmount: true, creditAmount: true, journal: { select: { postingDate: true } } },
      });
      const buckets = new Map<string, { cashIn: number; cashOut: number; bankIn: number; bankOut: number }>();
      for (let i = 0; i < trendDays; i++) {
        const d = addDays(windowStart, i);
        buckets.set(toKey(d), { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 });
      }
      for (const l of lines) {
        const key = toKey(l.journal.postingDate);
        const b = buckets.get(key);
        if (!b) continue;
        const isCash = l.accountId === cashId;
        if (l.debitAmount) {
          if (isCash) b.cashIn = round2(b.cashIn + l.debitAmount);
          else b.bankIn = round2(b.bankIn + l.debitAmount);
        }
        if (l.creditAmount) {
          if (isCash) b.cashOut = round2(b.cashOut + l.creditAmount);
          else b.bankOut = round2(b.bankOut + l.creditAmount);
        }
      }
      trend = [...buckets.entries()].map(([key, b]) => {
        const d = new Date(`${key}T00:00:00`);
        return {
          date: key,
          label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
          cashIn: b.cashIn,
          cashOut: b.cashOut,
          bankIn: b.bankIn,
          bankOut: b.bankOut,
          in: round2(b.cashIn + b.bankIn),
          out: round2(b.cashOut + b.bankOut),
          net: round2(b.cashIn + b.bankIn - b.cashOut - b.bankOut),
        };
      });
    }

    return ok({
      firmId,
      firmName: firm.firmName,
      date: dayStart.toISOString().slice(0, 10),
      journals,
      cash,
      bank,
      ...(trendDays > 0 ? { trend } : {}),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

function toKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}
