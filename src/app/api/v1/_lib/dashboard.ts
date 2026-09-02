// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — DASHBOARD KPI ENGINE
// Shared by /dashboard route and /ai/chat (firm snapshot).
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { ACC } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import { addDays, endOfDay, startOfDay } from "./api";
import { computeARAging } from "./aging";

export interface DashboardData {
  firmId: string;
  todaySales: number;
  monthSales: number;
  receivables: number;
  payables: number;
  cash: number;
  bank: number;
  inventoryValue: number;
  damagedValue: number;
  lowStockCount: number;
  salesTrend: Array<{ date: string; total: number }>;
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

export async function buildDashboard(firmId: string): Promise<DashboardData> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = startOfDay(addDays(now, -6));
  const month30Start = startOfDay(addDays(now, -29));

  const [todayInvoices, monthAgg, receivablesAgg, payablesAgg, products] = await Promise.all([
    db.invoice.aggregate({
      where: { firmId, status: "POSTED", invoiceDate: { gte: todayStart, lt: tomorrowStart } },
      _sum: { grandTotal: true },
    }),
    db.invoice.aggregate({
      where: { firmId, status: "POSTED", invoiceDate: { gte: monthStart } },
      _sum: { grandTotal: true },
    }),
    db.customer.aggregate({ where: { firmId, closingBalance: { gt: 0 } }, _sum: { closingBalance: true } }),
    db.vendor.aggregate({ where: { firmId, closingBalance: { gt: 0 } }, _sum: { closingBalance: true } }),
    db.product.findMany({
      where: { firmId },
      select: { stockQuantity: true, damagedStock: true, purchaseCost: true, lowStockThreshold: true, isActive: true },
    }),
  ]);

  const inventoryValue = round2(
    products.filter((p) => p.isActive).reduce((s, p) => s + p.stockQuantity * p.purchaseCost, 0)
  );
  const damagedValue = round2(
    products.filter((p) => p.isActive).reduce((s, p) => s + p.damagedStock * p.purchaseCost, 0)
  );
  const lowStockCount = products.filter(
    (p) => p.isActive && p.stockQuantity <= p.lowStockThreshold
  ).length;

  // Sales trend — last 7 days
  const weekInvoices = await db.invoice.findMany({
    where: { firmId, status: "POSTED", invoiceDate: { gte: weekStart } },
    select: { invoiceDate: true, grandTotal: true },
  });
  const salesTrend: Array<{ date: string; total: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(addDays(now, -i));
    const dayEnd = addDays(dayStart, 1);
    const total = round2(
      weekInvoices
        .filter((inv) => inv.invoiceDate >= dayStart && inv.invoiceDate < dayEnd)
        .reduce((s, inv) => s + inv.grandTotal, 0)
    );
    salesTrend.push({ date: dayStart.toISOString().slice(0, 10), total });
  }

  // Top products — last 30 days by qty & value
  const lines = await db.invoiceLineItem.findMany({
    where: {
      invoice: { firmId, status: "POSTED", invoiceDate: { gte: month30Start } },
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

  // AR aging buckets
  const ar = await computeARAging(firmId, now);

  // Recent transactions — invoices + POs + payments + receipts
  const [invoices, pos, payments, receipts] = await Promise.all([
    db.invoice.findMany({
      where: { firmId },
      orderBy: { invoiceDate: "desc" },
      take: 10,
      include: { customer: { select: { partyName: true } } },
    }),
    db.purchaseOrder.findMany({
      where: { firmId },
      orderBy: { poDate: "desc" },
      take: 10,
      include: { vendor: { select: { vendorName: true } } },
    }),
    db.vendorPayment.findMany({
      where: { firmId },
      orderBy: { paymentDate: "desc" },
      take: 10,
      include: { vendor: { select: { vendorName: true } } },
    }),
    db.customerReceipt.findMany({
      where: { firmId },
      orderBy: { receiptDate: "desc" },
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
    accountBalance(firmId, ACC.CASH),
    accountBalance(firmId, ACC.BANK),
  ]);

  return {
    firmId,
    todaySales: round2(todayInvoices._sum.grandTotal ?? 0),
    monthSales: round2(monthAgg._sum.grandTotal ?? 0),
    receivables: round2(receivablesAgg._sum.closingBalance ?? 0),
    payables: round2(payablesAgg._sum.closingBalance ?? 0),
    cash,
    bank,
    inventoryValue,
    damagedValue,
    lowStockCount,
    salesTrend,
    topProducts,
    arAging: ar.totals,
    recentTransactions: recent,
  };
}

/** Small helper re-exported for day-book style flows. */
export { endOfDay };
