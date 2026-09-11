// ═══════════════════════════════════════════════════════════════
// copilotContext — builds the LLM grounding snapshot for /ai/chat.
// Two accuracy guarantees:
//   1. Every figure is computed from the live books (same engines the
//      dashboard/reports use — buildDashboard, computePnl, real
//      invoice/GSTR-2B/PO aggregates). The model never invents numbers
//      because every number it may quote is in the prompt.
//   2. Coverage matches what owners actually ask: the suggested
//      questions cover GST, purchases and expenses — so the snapshot
//      includes gstSummaryThisMonth, recentPurchases, topCustomers
//      and the expense breakdown, not just KPIs.
// Speed: the snapshot is firm-scoped and cached in memory for 30s
// (keyed by firmId), so a burst of questions reuses one DB pass —
// the DB phase is ~50ms warm but this keeps it off the critical path
// entirely for follow-ups.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  addDays,
  endOfDay,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";
import { buildDashboard } from "@/app/api/v1/_lib/dashboard";
import { computePnl } from "@/app/api/v1/_lib/pnl";

export interface CopilotChartContext {
  trend: Array<{ date: string; total: number }>;
  topProducts: Array<{ sku: string; name: string; qty: number; value: number }>;
  lowStock: Array<{
    sku: string;
    name: string;
    stockQuantity: number;
    lowStockThreshold: number;
  }>;
  damaged: Array<{ sku: string; name: string; damagedStock: number; damagedValue: number }>;
  arAging: { d0_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  cash: number;
  bank: number;
  gst: {
    outputTotal: number;
    itcTotal: number;
    period: string;
  };
  recentPurchases: Array<{
    poNumber: string;
    date: string;
    vendor: string;
    grandTotal: number;
    status: string;
  }>;
  pnl: {
    netRevenue: number;
    cogs: number;
    totalExpenses: number;
    netProfit: number;
  };
}

export interface CopilotContext {
  snapshot: Record<string, unknown>;
  chartContext: CopilotChartContext;
  builtAt: Date;
  cached: boolean;
}

interface CacheEntry {
  ctx: CopilotContext;
  ts: number;
}

const CACHE_TTL_MS = 90_000;
const cache = new Map<string, CacheEntry>();

/** Test/dev hook — drop the in-memory snapshot cache. */
export function clearCopilotContextCache(): void {
  cache.clear();
}

function currentGstPeriod(now: Date): string {
  // GSTR-2B "period" strings are "YYYY-MM" return months.
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function buildCopilotContextUncached(firmId: string, now: Date): Promise<CopilotContext> {
  const d30Start = startOfDay(addDays(now, -30));
  const todayEnd = endOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const gstPeriod = currentGstPeriod(now);

  const [firm, kpis, activeProducts, debtors, recentInvoices, damaged, pnl, gstOut, g2bItc, recentPos, topCustomerAgg] =
    await Promise.all([
      resolveFirm(firmId),

      buildDashboard(firmId),

      db.product.findMany({
        where: { firmId, isActive: true },
        orderBy: { stockQuantity: "asc" },
        select: {
          sku: true,
          name: true,
          stockQuantity: true,
          lowStockThreshold: true,
          damagedStock: true,
        },
      }),

      db.customer.findMany({
        where: { firmId, closingBalance: { gt: 0 } },
        orderBy: { closingBalance: "desc" },
        take: 5,
        select: { partyName: true, closingBalance: true, creditLimit: true, creditDays: true },
      }),

      db.invoice.findMany({
        where: { firmId, status: "POSTED" },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: {
          invoiceNumber: true,
          invoiceDate: true,
          grandTotal: true,
          paymentMode: true,
          customer: { select: { partyName: true } },
          walkInName: true,
        },
      }),

      db.product.findMany({
        where: { firmId, damagedStock: { gt: 0 } },
        orderBy: { damagedStock: "desc" },
        take: 5,
        select: { sku: true, name: true, damagedStock: true, purchaseCost: true },
      }),

      computePnl(firmId, d30Start, todayEnd),

      // Output GST: POSTED sales invoices this month
      db.invoice.aggregate({
        where: { firmId, status: "POSTED", invoiceDate: { gte: monthStart, lte: todayEnd } },
        _sum: { totalCgst: true, totalSgst: true, totalIgst: true, grandTotal: true },
        _count: true,
      }),

      // Input tax credit: GSTR-2B records for the current period (available ITC only)
      db.gstr2bRecord.aggregate({
        where: { firmId, period: gstPeriod, itcAvailable: true },
        _sum: { cgst: true, sgst: true, igst: true, taxableValue: true },
      }),

      // Recent purchase orders (vendor, date, total, status)
      db.purchaseOrder.findMany({
        where: { firmId },
        orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
        take: 6,
        select: {
          poNumber: true,
          poDate: true,
          status: true,
          grandTotal: true,
          vendorBillNo: true,
          vendor: { select: { vendorName: true } },
        },
      }),

      // Best customers by billed value, last 30 days
      db.invoice.groupBy({
        by: ["customerId"],
        where: { firmId, status: "POSTED", invoiceDate: { gte: d30Start }, customerId: { not: null } },
        _sum: { grandTotal: true },
        _count: true,
        orderBy: { _sum: { grandTotal: "desc" } },
        take: 5,
      }),
    ]);

  const lowStock = activeProducts
    .filter((p) => p.stockQuantity <= p.lowStockThreshold)
    .slice(0, 10);

  // Resolve top-customer names from the groupBy keys
  const custIds = topCustomerAgg.map((r) => r.customerId).filter((v): v is string => !!v);
  const custRows = custIds.length
    ? await db.customer.findMany({
        where: { id: { in: custIds } },
        select: { id: true, partyName: true },
      })
    : [];
  const custName = new Map(custRows.map((c) => [c.id, c.partyName]));

  const outCgst = round2(gstOut._sum.totalCgst ?? 0);
  const outSgst = round2(gstOut._sum.totalSgst ?? 0);
  const outIgst = round2(gstOut._sum.totalIgst ?? 0);
  const itcCgst = round2(g2bItc._sum.cgst ?? 0);
  const itcSgst = round2(g2bItc._sum.sgst ?? 0);
  const itcIgst = round2(g2bItc._sum.igst ?? 0);

  const snapshot = {
    firm: {
      name: firm.firmName,
      code: firm.firmCode,
      gstin: firm.gstin,
      stateCode: firm.stateCode,
      financialYear: firm.financialYear,
    },
    today: now.toISOString().slice(0, 10),
    kpis: {
      todaySales: kpis.todaySales,
      monthSales: kpis.monthSales,
      receivables: kpis.receivables,
      payables: kpis.payables,
      cash: kpis.cash,
      bank: kpis.bank,
      inventoryValue: kpis.inventoryValue,
      damagedValue: kpis.damagedValue,
      lowStockCount: kpis.lowStockCount,
    },
    salesTrendLast7Days: kpis.salesTrend,
    topProductsLast30Days: kpis.topProducts.slice(0, 5),
    arAging: kpis.arAging,
    lowStockAlerts: lowStock,
    topDebtors: debtors.map((d) => ({
      ...d,
      closingBalance: round2(d.closingBalance),
      utilisationPct: d.creditLimit > 0 ? round2((d.closingBalance / d.creditLimit) * 100) : null,
    })),
    recentInvoices: recentInvoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      date: i.invoiceDate.toISOString().slice(0, 10),
      party: (i.customer?.partyName ?? i.walkInName) || "Counter Sale",
      grandTotal: i.grandTotal,
      paymentMode: i.paymentMode,
    })),
    pnlLast30Days: {
      revenue: pnl.revenue,
      salesReturns: pnl.salesReturns,
      netRevenue: pnl.netRevenue,
      cogs: pnl.cogs,
      grossProfit: pnl.grossProfit,
      totalExpenses: pnl.totalExpenses,
      netProfit: pnl.netProfit,
      expenseBreakdown: pnl.expenses.slice(0, 6),
    },
    gstSummaryThisMonth: {
      period: gstPeriod,
      outputTaxFromInvoices: { cgst: outCgst, sgst: outSgst, igst: outIgst, total: round2(outCgst + outSgst + outIgst) },
      invoicesPosted: gstOut._count,
      inputTaxCreditFromGstr2b: { cgst: itcCgst, sgst: itcSgst, igst: itcIgst, total: round2(itcCgst + itcSgst + itcIgst) },
      approximateNetPayable: round2(outCgst + outSgst + outIgst - (itcCgst + itcSgst + itcIgst)),
      note: "Net payable is an estimate: posted sales output tax minus available GSTR-2B ITC for the period.",
    },
    recentPurchases: recentPos.map((p) => ({
      poNumber: p.poNumber,
      date: p.poDate.toISOString().slice(0, 10),
      vendor: p.vendor.vendorName,
      grandTotal: p.grandTotal,
      status: p.status,
      vendorBillNo: p.vendorBillNo || null,
    })),
    topCustomersLast30Days: topCustomerAgg.map((r) => ({
      party: r.customerId ? custName.get(r.customerId) ?? "Unknown" : "Counter Sale",
      billed: round2(r._sum.grandTotal ?? 0),
      invoices: r._count,
    })),
    damagedStockTop5: damaged.map((d) => ({
      ...d,
      damagedValue: round2(d.damagedStock * d.purchaseCost),
    })),
  };

  const chartContext: CopilotChartContext = {
    trend: kpis.salesTrend,
    topProducts: kpis.topProducts.slice(0, 5),
    lowStock,
    damaged: snapshot.damagedStockTop5 as CopilotChartContext["damaged"],
    arAging: kpis.arAging,
    cash: kpis.cash,
    bank: kpis.bank,
    gst: {
      outputTotal: round2(outCgst + outSgst + outIgst),
      itcTotal: round2(itcCgst + itcSgst + itcIgst),
      period: gstPeriod,
    },
    recentPurchases: snapshot.recentPurchases as CopilotChartContext["recentPurchases"],
    pnl: {
      netRevenue: pnl.netRevenue,
      cogs: pnl.cogs,
      totalExpenses: pnl.totalExpenses,
      netProfit: pnl.netProfit,
    },
  };

  return { snapshot, chartContext, builtAt: now, cached: false };
}

/**
 * Firm-scoped copilot snapshot with a 90s in-memory cache.
 * Cached entries return `cached: true`. The TTL is deliberately
 * generous: the copilot is conversational — sub-two-minute-old
 * figures are fine (the snapshot's age is disclosed to the model and
 * the DB round trips it saves matter on high-latency links, e.g.
 * cross-region dev against Neon). A cache-miss rebuild happens once
 * per TTL window per firm; writes elsewhere are not invalidated
 * (worst case: figures up to 90s stale in chat answers).
 */
export async function buildCopilotContext(firmId: string): Promise<CopilotContext> {
  const hit = cache.get(firmId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { ...hit.ctx, cached: true };
  }

  const ctx = await buildCopilotContextUncached(firmId, new Date());
  // Bound the cache — firms are few, but stay defensive.
  if (cache.size > 16) cache.clear();
  cache.set(firmId, { ctx, ts: Date.now() });
  return ctx;
}
