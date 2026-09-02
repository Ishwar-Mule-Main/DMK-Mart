// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PROFIT & LOSS ENGINE
// revenue (credit-natural) − sales returns (contra) − COGS − expenses.
// Shared by /ledger/pnl and /ai/chat and /ledger/balance-sheet.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { ACC } from "@/lib/journal";
import { round2 } from "@/lib/gst";

export interface PnlLine {
  code: string;
  name: string;
  amount: number;
}

export interface PnlResult {
  dateFrom: string;
  dateTo: string;
  revenue: number;
  salesReturns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: PnlLine[];
  totalExpenses: number;
  netProfit: number;
}

interface AccountAgg {
  [accountId: string]: { code: string; name: string; cls: string; dr: number; cr: number };
}

/**
 * Aggregate journal lines for REVENUE + EXPENSE class accounts in a window.
 * Pass `asOfOnly` with no dateFrom to compute all-time (balance-sheet use).
 */
export async function computePnl(
  firmId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<PnlResult> {
  const accounts = await db.chartOfAccount.findMany({
    where: { firmId, accountClass: { in: ["REVENUE", "EXPENSE"] }, isActive: true },
  });

  const lines = await db.journalLine.findMany({
    where: {
      accountId: { in: accounts.map((a) => a.id) },
      journal: {
        firmId,
        ...(dateFrom || dateTo
          ? {
              postingDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
    },
    select: { accountId: true, debitAmount: true, creditAmount: true },
  });

  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const agg: AccountAgg = {};
  for (const line of lines) {
    const acc = accMap.get(line.accountId);
    if (!acc) continue;
    const cur = agg[line.accountId] ?? { code: acc.accountCode, name: acc.accountName, cls: acc.accountClass, dr: 0, cr: 0 };
    cur.dr = round2(cur.dr + line.debitAmount);
    cur.cr = round2(cur.cr + line.creditAmount);
    agg[line.accountId] = cur;
  }

  const all = Object.values(agg);

  // Revenue (credit-natural), excluding the contra returns account
  const revenue = round2(
    all
      .filter((a) => a.cls === "REVENUE" && a.code !== ACC.SALES_RETURNS)
      .reduce((s, a) => s + a.cr - a.dr, 0)
  );
  // Sales returns account is a DEBIT-natural contra
  const salesReturns = round2(
    all.filter((a) => a.code === ACC.SALES_RETURNS).reduce((s, a) => s + a.dr - a.cr, 0)
  );
  const netRevenue = round2(revenue - salesReturns);

  const cogs = round2(
    all.filter((a) => a.code === ACC.COGS).reduce((s, a) => s + a.dr - a.cr, 0)
  );

  const expenses: PnlLine[] = all
    .filter((a) => a.cls === "EXPENSE" && a.code !== ACC.COGS)
    .map((a) => ({ code: a.code, name: a.name, amount: round2(a.dr - a.cr) }))
    .filter((e) => Math.abs(e.amount) > 0.009)
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));

  const grossProfit = round2(netRevenue - cogs);
  const netProfit = round2(grossProfit - totalExpenses);

  return {
    dateFrom: dateFrom ? dateFrom.toISOString() : "",
    dateTo: dateTo ? dateTo.toISOString() : "",
    revenue,
    salesReturns,
    netRevenue,
    cogs,
    grossProfit,
    expenses,
    totalExpenses,
    netProfit,
  };
}
