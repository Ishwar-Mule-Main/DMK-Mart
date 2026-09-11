// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — DASHBOARD KPI ENGINE
// Shared by /dashboard route and /ai/chat (firm snapshot).
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { ACC, fyLabelForDate } from "@/lib/journal";
import { fyDateRange } from "@/lib/fy";
import { round2 } from "@/lib/gst";
import { addDays, endOfDay, startOfDay } from "./api";
import { computeARAging } from "./aging";

export interface DashboardData {
  firmId: string;
  todaySales: number;
  monthSales: number;
  receivables: number;
  receivablesAdvances: number;
  payables: number;
  payablesCredits: number;
  cash: number;
  bank: number;
  inventoryValue: number;
  damagedValue: number;
  lowStockCount: number;
  salesTrend: Array<{ date: string; total: number }>;
  monthTrend: Array<{ date: string; total: number }>;
  topProducts: Array<{ productId: string; sku: string; name: string; qty: number; value: number }>;
  arAging: { d0_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  recentTransactions: Array<{
    type: string;
    number: string;
    date: string;
    amount: number;
    party: string;
  }>;
}

/** Balance of a single account (debit-positive) from journal lines. */
export async function accountBalance(firmId: string, accountCode: string, upto?: Date): Promise<number> {
  const account = await db.chartOfAccount.findFirst({
    where: { firmId, accountCode },
    select: { id: true, openingBalance: true },
  });
  if (!account) return 0;
  const agg = await db.journalLine.aggregate({
    where: {
      accountId: account.id,
      ...(upto ? { journal: { postingDate: { lte: upto } } } : {}),
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return round2(account.openingBalance + (agg._sum.debitAmount ?? 0) - (agg._sum.creditAmount ?? 0));
}

export async function buildDashboard(firmId: string, fy?: string | null): Promise<DashboardData> {
  const now = new Date();
  // FY anchoring: the current year looks at live "today/month" windows; a
  // historical year is anchored at its END (31 Mar) so every window, trend
  // and balance reads as-of that year instead of leaking the current month.
  const selectedFy = fy || fyLabelForDate(now);
  const isCurrentFy = selectedFy === fyLabelForDate(now);
  const { startDate: fyStart, endDate: fyEnd } = fyDateRange(selectedFy);
  const anchor = isCurrentFy ? now : fyEnd < now ? fyEnd : fyStart;

  const todayStart = startOfDay(anchor);
  const tomorrowStart = addDays(todayStart, 1);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const weekStart = startOfDay(addDays(anchor, -6));
  const month30Start = startOfDay(addDays(anchor, -29));

  const [todayInvoices, monthAgg, customerBalances, vendorBalances, products] = await Promise.all([
    db.invoice.aggregate({
      where: { firmId, status: "POSTED", invoiceDate: { gte: todayStart, lt: tomorrowStart } },
      _sum: { grandTotal: true },
    }),
    db.invoice.aggregate({
      where: { firmId, status: "POSTED", invoiceDate: { gte: monthStart, lte: fyEnd } },
      _sum: { grandTotal: true },
    }),
    // Full balance lists (NOT positive-only): a negative customer balance is
    // an advance we hold; a negative vendor balance is a credit note balance.
    // Netting them matches the GL (Sundry Debtors/Creditors) and the BS —
    // dropping them overstated the KPIs vs the trial balance.
    db.customer.findMany({ where: { firmId }, select: { closingBalance: true } }),
    db.vendor.findMany({ where: { firmId }, select: { closingBalance: true } }),
    db.product.findMany({
      where: { firmId },
      select: { stockQuantity: true, damagedStock: true, purchaseCost: true, lowStockThreshold: true, isActive: true },
    }),
  ]);

  const sumBalances = (rows: Array<{ closingBalance: number }>) => ({
    net: round2(rows.reduce((s, r) => s + r.closingBalance, 0)),
    negative: round2(-rows.filter((r) => r.closingBalance < 0).reduce((s, r) => s + r.closingBalance, 0)),
  });
  const cust = sumBalances(customerBalances);
  const vend = sumBalances(vendorBalances);

  // Receivables / payables for the SELECTED year: the current year reads the
  // live party balances; a historical year reads the GL as of 31 Mar of that
  // year (party closingBalance is always the present-day number).
  let receivables = cust.net;
  let receivablesAdvances = cust.negative;
  let payables = vend.net;
  let payablesCredits = vend.negative;
  if (!isCurrentFy) {
    const glAr = await accountBalance(firmId, ACC.AR, fyEnd);
    const glAp = round2(-(await accountBalance(firmId, ACC.AP, fyEnd)));
    receivables = glAr;
    receivablesAdvances = glAr < 0 ? round2(-glAr) : 0;
    payables = glAp;
    payablesCredits = glAp < 0 ? round2(-glAp) : 0;
  }

  const inventoryValue = round2(
    products.filter((p) => p.isActive).reduce((s, p) => s + p.stockQuantity * p.purchaseCost, 0)
  );
  const damagedValue = round2(
    products.filter((p) => p.isActive).reduce((s, p) => s + p.damagedStock * p.purchaseCost, 0)
  );
  const lowStockCount = products.filter(
    (p) => p.isActive && p.stockQuantity <= p.lowStockThreshold
  ).length;

  // Sales trend — last 7 days of the selected year (ending at the anchor)
  const weekInvoices = await db.invoice.findMany({
    where: { firmId, status: "POSTED", invoiceDate: { gte: weekStart, lte: fyEnd } },
    select: { invoiceDate: true, grandTotal: true },
  });
  const salesTrend: Array<{ date: string; total: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(addDays(anchor, -i));
    const dayEnd = addDays(dayStart, 1);
    const total = round2(
      weekInvoices
        .filter((inv) => inv.invoiceDate >= dayStart && inv.invoiceDate < dayEnd)
        .reduce((s, inv) => s + inv.grandTotal, 0)
    );
    salesTrend.push({ date: dayStart.toISOString().slice(0, 10), total });
  }

  // Month-to-date trend — daily totals for the sparkline on the Month Sales KPI
  const monthInvoices = await db.invoice.findMany({
    where: { firmId, status: "POSTED", invoiceDate: { gte: monthStart, lte: fyEnd } },
    select: { invoiceDate: true, grandTotal: true },
  });
  const monthTrend: Array<{ date: string; total: number }> = [];
  for (let i = 0; i <= anchor.getDate() - 1; i++) {
    const dayStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1 + i);
    const dayEnd = addDays(dayStart, 1);
    const total = round2(
      monthInvoices
        .filter((inv) => inv.invoiceDate >= dayStart && inv.invoiceDate < dayEnd)
        .reduce((s, inv) => s + inv.grandTotal, 0)
    );
    monthTrend.push({ date: dayStart.toISOString().slice(0, 10), total });
  }

  // Top products — last 30 days of the selected year by qty & value
  const lines = await db.invoiceLineItem.findMany({
    where: {
      invoice: { firmId, status: "POSTED", invoiceDate: { gte: month30Start, lte: fyEnd } },
    },
    select: {
      productId: true,
      sku: true,
      productName: true,
      quantity: true,
      totalAmount: true,
    },
  });
  const prodAgg = new Map<string, { productId: string; sku: string; name: string; qty: number; value: number }>();
  for (const l of lines) {
    const cur = prodAgg.get(l.productId) ?? {
      productId: l.productId,
      sku: l.sku,
      name: l.productName,
      qty: 0,
      value: 0,
    };
    cur.qty = round2(cur.qty + l.quantity);
    cur.value = round2(cur.value + l.totalAmount);
    prodAgg.set(l.productId, cur);
  }
  const topProducts = [...prodAgg.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

  // AR aging buckets (as of the anchor — FY end for historical years)
  const ar = await computeARAging(firmId, anchor);

  // Recent transactions — invoices + POs + payments + receipts, scoped to the year
  const [invoices, pos, payments, receipts] = await Promise.all([
    db.invoice.findMany({
      where: { firmId, invoiceDate: { gte: fyStart, lte: fyEnd } },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { customer: { select: { partyName: true } } },
    }),
    db.purchaseOrder.findMany({
      where: { firmId, poDate: { gte: fyStart, lte: fyEnd } },
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { vendor: { select: { vendorName: true } } },
    }),
    db.vendorPayment.findMany({
      where: { firmId, paymentDate: { gte: fyStart, lte: fyEnd } },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { vendor: { select: { vendorName: true } } },
    }),
    db.customerReceipt.findMany({
      where: { firmId, receiptDate: { gte: fyStart, lte: fyEnd } },
      orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
      take: 10,
      include: { customer: { select: { partyName: true } } },
    }),
  ]);

  const recent = [
    ...invoices.map((i) => ({
      type: "INVOICE",
      number: i.invoiceNumber,
      date: i.invoiceDate,
      amount: i.grandTotal,
      party: (i.customer?.partyName ?? i.walkInName) || "Counter Sale",
    })),
    ...pos.map((p) => ({
      type: "PURCHASE_ORDER",
      number: p.poNumber,
      date: p.poDate,
      amount: p.grandTotal,
      party: p.vendor.vendorName,
    })),
    ...payments.map((p) => ({
      type: "VENDOR_PAYMENT",
      number: p.utrRef || p.mode,
      date: p.paymentDate,
      amount: p.amount,
      party: p.vendor.vendorName,
    })),
    ...receipts.map((r) => ({
      type: "CUSTOMER_RECEIPT",
      number: r.utrRef || r.mode,
      date: r.receiptDate,
      amount: r.amount,
      party: r.customer.partyName,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10)
    .map((t) => ({ ...t, date: t.date.toISOString(), amount: round2(t.amount) }));

  const [cash, bank] = await Promise.all([
    accountBalance(firmId, ACC.CASH, isCurrentFy ? undefined : fyEnd),
    accountBalance(firmId, ACC.BANK, isCurrentFy ? undefined : fyEnd),
  ]);

  return {
    firmId,
    todaySales: round2(todayInvoices._sum.grandTotal ?? 0),
    monthSales: round2(monthAgg._sum.grandTotal ?? 0),
    receivables,
    receivablesAdvances,
    payables,
    payablesCredits,
    cash,
    bank,
    inventoryValue,
    damagedValue,
    lowStockCount,
    salesTrend,
    monthTrend,
    topProducts,
    arAging: ar.totals,
    recentTransactions: recent,
  };
}

/** Small helper re-exported for day-book style flows. */
export { endOfDay };
