// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/balance-sheet — financial position as of date
// Assets Dr-positive; Liabilities/Equity Cr-positive; all-time net
// profit injected into Equity as "Current Period Profit".
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  endOfDay,
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { computePnl } from "@/app/api/v1/_lib/pnl";

interface BsRow {
  accountCode: string;
  accountName: string;
  accountGroup: string;
  amount: number;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const asOf = getDateOrNull(sp.get("asOf")) ?? new Date();
    const asOfEnd = endOfDay(asOf);

    const accounts = await db.chartOfAccount.findMany({
      where: { firmId, isActive: true, accountClass: { in: ["ASSET", "LIABILITY", "EQUITY"] } },
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

    const assets: BsRow[] = [];
    const liabilities: BsRow[] = [];
    const equity: BsRow[] = [];

    for (const acc of accounts) {
      const a = agg.get(acc.id);
      const dr = a?.dr ?? 0;
      const cr = a?.cr ?? 0;
      const balance = round2(acc.openingBalance + dr - cr);
      const row = {
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountGroup: acc.accountGroup,
        amount: 0,
      };
      if (acc.accountClass === "ASSET") {
        row.amount = balance; // debit-positive
        if (Math.abs(row.amount) > 0.009) assets.push(row);
      } else {
        row.amount = round2(-balance); // credit-positive
        if (Math.abs(row.amount) > 0.009) {
          if (acc.accountClass === "LIABILITY") liabilities.push(row);
          else equity.push(row);
        }
      }
    }

    // All-time profit up to asOf (revenue − returns − cogs − expenses)
    const pnl = await computePnl(firmId, undefined, asOfEnd);
    if (Math.abs(pnl.netProfit) > 0.009) {
      equity.push({
        accountCode: "NP",
        accountName: "Current Period Profit",
        accountGroup: "Equity",
        amount: pnl.netProfit,
      });
    }

    const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
    const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
    const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
    const equityPlusProfit = round2(totalLiabilities + totalEquity);

    return ok({
      firmId,
      firmName: firm.firmName,
      asOf: asOfEnd.toISOString(),
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        equityPlusProfit,
        balanced: Math.abs(round2(totalAssets - equityPlusProfit)) < 0.01,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
