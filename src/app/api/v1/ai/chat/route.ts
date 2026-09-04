// ═══════════════════════════════════════════════════════════════
// /api/v1/ai/chat — DMK Mart ERP Copilot (backend-only LLM call)
// Grounds the model strictly in a JSON snapshot of the firm's live
// data. Every reply also carries a `chart` — an intent-derived
// visualization built from the SAME snapshot, rendered by the
// dashboard copilot's right column.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  addDays,
  asRecord,
  endOfDay,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";
import { buildDashboard } from "@/app/api/v1/_lib/dashboard";
import { computePnl } from "@/app/api/v1/_lib/pnl";
import type { CopilotChart } from "@/types/erp";

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: string } }>;
}

const DAY_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function shortDay(iso: string): string {
  return DAY_FMT.format(new Date(`${iso}T00:00:00`));
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// ── Chart builders (one per intent; all fed from the live snapshot) ──

function salesTrendChart(trend: Array<{ date: string; total: number }>): CopilotChart {
  return {
    kind: "line",
    topic: "SALES",
    title: "Sales · last 7 days",
    subtitle: "Posted invoice totals per day",
    unit: "inr",
    points: trend.map((t) => ({ label: shortDay(t.date), value: t.total })),
  };
}

interface ChartContext {
  trend: Array<{ date: string; total: number }>;
  topProducts: Array<{ sku: string; name: string; qty: number; value: number }>;
  lowStock: Array<{ sku: string; name: string; stockQuantity: number; lowStockThreshold: number }>;
  damaged: Array<{ sku: string; name: string; damagedStock: number; damagedValue: number }>;
  arAging: { d0_30: number; d31_60: number; d61_90: number; d90plus: number; total: number };
  cash: number;
  bank: number;
  pnl: {
    netRevenue: number;
    cogs: number;
    totalExpenses: number;
    netProfit: number;
  };
}

/**
 * Deterministic intent → chart mapping. The chart always comes from the
 * same grounded snapshot the LLM reads, so the visual can never disagree
 * with the text answer.
 */
export function buildCopilotChart(message: string, ctx: ChartContext): CopilotChart {
  const m = message.toLowerCase();

  const asksDamaged = /damaged|breakag|wast|spoilt|scrap|mend/.test(m);
  const asksLowStock = /low.{0,4}stock|shortage|reorder|below threshold|restock|out of stock|running low|running short/.test(m);
  const asksTopProducts =
    /(top|best|fast.?mov|most|highest).*(product|item|sku|sell)|product.*(top|best|most)/.test(m);
  const asksPnl = /profit|p\s*&\s*l|pnl|expense|margin|revenue|loss|cogs/.test(m);
  const asksReceivables = /overdue|receivab|outstanding|debtor|aging|unpaid/.test(m);
  const asksCash = /cash|bank|liquid|position|balance/.test(m);

  if (asksDamaged) {
    return {
      kind: "hbar",
      topic: "DAMAGED",
      title: "Damaged stock value",
      subtitle: "Top 5 products sitting in the damaged pool, at cost",
      unit: "inr",
      items: ctx.damaged.map((d) => ({
        label: d.name,
        value: d.damagedValue,
        hint: `${d.damagedStock} units · ${d.sku}`,
      })),
    };
  }

  if (asksLowStock) {
    return {
      kind: "hbar",
      topic: "STOCK",
      title: "Low stock products",
      subtitle: "Sellable quantity on hand — reorder before these run out",
      unit: "qty",
      items: ctx.lowStock.map((p) => ({
        label: p.name,
        value: p.stockQuantity,
        hint: `${p.sku} · threshold ${p.lowStockThreshold}`,
      })),
    };
  }

  if (asksTopProducts) {
    return {
      kind: "hbar",
      topic: "PRODUCTS",
      title: "Top sellers · last 30 days",
      subtitle: "Units sold — bracket shows billed value",
      unit: "qty",
      items: ctx.topProducts.map((p) => ({
        label: p.name,
        value: p.qty,
        hint: `${p.sku} · ${inr(p.value)} billed`,
      })),
    };
  }

  if (asksPnl) {
    return {
      kind: "hbar",
      topic: "P&L",
      title: "P&L · last 30 days",
      subtitle: "Revenue, costs and bottom line from live journals",
      unit: "inr",
      items: [
        { label: "Net revenue", value: ctx.pnl.netRevenue, color: "#ffc300" },
        { label: "COGS", value: ctx.pnl.cogs, color: "#38bdf8" },
        { label: "Expenses", value: ctx.pnl.totalExpenses, color: "#eab308" },
        {
          label: "Net profit",
          value: ctx.pnl.netProfit,
          color: ctx.pnl.netProfit >= 0 ? "#22c55e" : "#ef4444",
        },
      ],
    };
  }

  if (asksReceivables) {
    return {
      kind: "donut",
      topic: "RECEIVABLES",
      title: "Receivables by age",
      subtitle: "Outstanding invoices grouped by days since billing",
      unit: "inr",
      centerLabel: "Total receivable",
      centerValue: ctx.arAging.total,
      slices: [
        { label: "0–30 days", value: ctx.arAging.d0_30, color: "#22c55e" },
        { label: "31–60 days", value: ctx.arAging.d31_60, color: "#ffc300" },
        { label: "61–90 days", value: ctx.arAging.d61_90, color: "#eab308" },
        { label: "90+ days", value: ctx.arAging.d90plus, color: "#ef4444" },
      ],
    };
  }

  if (asksCash) {
    return {
      kind: "donut",
      topic: "CASH & BANK",
      title: "Liquid position",
      subtitle: "Funds across the counter and bank accounts",
      unit: "inr",
      centerLabel: "Total liquid",
      centerValue: round2(ctx.cash + ctx.bank),
      slices: [
        { label: "Cash in hand", value: ctx.cash, color: "#ffc300" },
        { label: "Bank balance", value: ctx.bank, color: "#38bdf8" },
      ],
    };
  }

  // Default — sales is the most-asked topic, so the trend line is the
  // fallback (also used for the container's resting state).
  return salesTrendChart(ctx.trend);
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const message = getStr(body.message);

    const firm = await resolveFirm(firmId);
    const now = new Date();

    if (!message) {
      // Empty ask — the dashboard hero uses this to get its resting
      // visual (7-day sales trend) without spending an LLM call.
      const kpis = await buildDashboard(firmId);
      return ok({
        reply: "Ask me anything about your firm's sales, stock, receivables or books.",
        chart: salesTrendChart(kpis.salesTrend),
      });
    }

    const [kpis, activeProducts, debtors, recentInvoices, pnl, damaged] = await Promise.all([
      buildDashboard(firmId),
      db.product.findMany({
        where: { firmId, isActive: true },
        orderBy: { stockQuantity: "asc" },
        select: { sku: true, name: true, stockQuantity: true, lowStockThreshold: true, damagedStock: true },
      }),
      db.customer.findMany({
        where: { firmId, closingBalance: { gt: 0 } },
        orderBy: { closingBalance: "desc" },
        take: 5,
        select: { partyName: true, closingBalance: true, creditLimit: true, creditDays: true },
      }),
      db.invoice.findMany({
        where: { firmId, status: "POSTED" },
        orderBy: { invoiceDate: "desc" },
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
      computePnl(firmId, startOfDay(addDays(now, -30)), endOfDay(now)),
      db.product.findMany({
        where: { firmId, damagedStock: { gt: 0 } },
        orderBy: { damagedStock: "desc" },
        take: 5,
        select: { sku: true, name: true, damagedStock: true, purchaseCost: true },
      }),
    ]);

    const lowStock = activeProducts
      .filter((p) => p.stockQuantity <= p.lowStockThreshold)
      .slice(0, 10);

    const snapshot = {
      firm: {
        name: firm.firmName,
        code: firm.firmCode,
        gstin: firm.gstin,
        stateCode: firm.stateCode,
        financialYear: firm.financialYear,
      },
      snapshotDate: now.toISOString().slice(0, 10),
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
      },
      damagedStockTop5: damaged.map((d) => ({
        ...d,
        damagedValue: round2(d.damagedStock * d.purchaseCost),
      })),
    };

    const chart = buildCopilotChart(message, {
      trend: kpis.salesTrend,
      topProducts: kpis.topProducts.slice(0, 5),
      lowStock,
      damaged: snapshot.damagedStockTop5,
      arAging: kpis.arAging,
      cash: kpis.cash,
      bank: kpis.bank,
      pnl: {
        netRevenue: pnl.netRevenue,
        cogs: pnl.cogs,
        totalExpenses: pnl.totalExpenses,
        netProfit: pnl.netProfit,
      },
    });

    const systemPrompt = [
      "You are the DMK Mart ERP Copilot, an expert business assistant for an Indian trading firm (plastic goods distribution).",
      "Answer ONLY from the provided data snapshot. Figures are INR.",
      "Be concise, use bullet lists, quote exact numbers.",
      "If the answer is not in the data, say so.",
      "",
      "DATA SNAPSHOT (JSON):",
      JSON.stringify(snapshot),
    ].join("\n");

    const zai = await ZAI.create();
    const completion = (await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    })) as ChatCompletionShape;

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return ok({ reply: "I could not generate a response from the current data. Please try again.", chart });
    }
    return ok({ reply, chart });
  } catch (e) {
    return handleApiError(e);
  }
}
