// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/trial-balance — per-account Dr/Cr balance as of date
// debit-natural: opening + ΣDr − ΣCr; negative → credit column
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  getDateOrNull,
  endOfDay,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const asOf = getDateOrNull(sp.get("asOf")) ?? new Date();
    const asOfEnd = endOfDay(asOf);

    const accounts = await db.chartOfAccount.findMany({
      where: { firmId, isActive: true },
      orderBy: { accountCode: "asc" },
    });
    const lines = await db.journalLine.findMany({
      where: { journal: { firmId, postingDate: { lte: asOfEnd } } },
      select: { accountId: true, debitAmount: true, creditAmount: true },
    });

    const agg = new Map<string, { dr: number; cr: number }>();
    for (const line of lines) {
      const cur = agg.get(line.accountId) ?? { dr: 0, cr: 0 };
      cur.dr = round2(cur.dr + line.debitAmount);
      cur.cr = round2(cur.cr + line.creditAmount);
      agg.set(line.accountId, cur);
    }

    const rows: Array<{
      accountCode: string;
      accountName: string;
      accountGroup: string;
      accountClass: string;
      debit: number;
      credit: number;
    }> = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const acc of accounts) {
      const a = agg.get(acc.id);
      const dr = a?.dr ?? 0;
      const cr = a?.cr ?? 0;
      const balance = round2(acc.openingBalance + dr - cr);
      // Include accounts with any balance OR a non-zero opening
      if (Math.abs(balance) < 0.009 && Math.abs(acc.openingBalance) < 0.009 && !a) continue;
      const debit = balance >= 0 ? balance : 0;
      const credit = balance < 0 ? -balance : 0;
      if (debit === 0 && credit === 0) continue;
      rows.push({
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountGroup: acc.accountGroup,
        accountClass: acc.accountClass,
        debit,
        credit,
      });
      totalDebit = round2(totalDebit + debit);
      totalCredit = round2(totalCredit + credit);
    }

    return ok({
      firmId,
      firmName: firm.firmName,
      asOf: asOfEnd.toISOString(),
      rows,
      totalDebit,
      totalCredit,
      balanced: Math.abs(round2(totalDebit - totalCredit)) < 0.01,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
