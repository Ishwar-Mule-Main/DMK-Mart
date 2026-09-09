// ═══════════════════════════════════════════════════════════════
// buildCopilotChart — deterministic intent → chart mapping.
// The chart always comes from the same grounded snapshot the LLM
// reads, so the visual can never disagree with the text answer.
// ═══════════════════════════════════════════════════════════════

import { round2 } from "@/lib/gst";
import type { CopilotChart } from "@/types/erp";
import type { CopilotChartContext } from "@/app/api/v1/_lib/copilotContext";

const DAY_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

function shortDay(iso: string): string {
  return DAY_FMT.format(new Date(`${iso}T00:00:00`));
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function salesTrendChart(trend: Array<{ date: string; total: number }>): CopilotChart {
  return {
    kind: "line",
    topic: "SALES",
    title: "Sales · last 7 days",
    subtitle: "Posted invoice totals per day",
    unit: "inr",
    points: trend.map((t) => ({ label: shortDay(t.date), value: t.total })),
  };
}

export function buildCopilotChart(message: string, ctx: CopilotChartContext): CopilotChart {
  const m = message.toLowerCase();

  const asksDamaged = /damaged|breakag|wast|spoilt|scrap|mend/.test(m);
  const asksLowStock = /low.{0,4}stock|shortage|reorder|below threshold|restock|out of stock|running low|running short/.test(m);
  const asksTopProducts =
    /(top|best|fast.?mov|most|highest).*(product|item|sku|sell)|product.*(top|best|most)/.test(m);
  const asksPnl = /profit|p\s*&\s*l|pnl|expense|margin|revenue|loss|cogs/.test(m);
  const asksReceivables = /overdue|receivab|outstanding|debtor|aging|unpaid/.test(m);
  const asksCash = /cash|bank|liquid|position|balance/.test(m);
  const asksGst = /\bgst\b|tax payable|input credit|output tax|gstr/.test(m);
  const asksPurchases = /purchas|\bpo\b|purchase order|bought|supplier|vendor bill/.test(m);

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

  if (asksGst) {
    const g = ctx.gst;
    return {
      kind: "hbar",
      topic: "GST",
      title: "GST · this month",
      subtitle: "Output tax on posted invoices vs available GSTR-2B ITC",
      unit: "inr",
      items: [
        { label: "Output tax", value: g.outputTotal, color: "#ffc300" },
        { label: "Available ITC", value: g.itcTotal, color: "#22c55e" },
        { label: "Est. net payable", value: round2(g.outputTotal - g.itcTotal), color: "#ef4444" },
      ],
    };
  }

  if (asksPurchases) {
    return {
      kind: "hbar",
      topic: "PURCHASES",
      title: "Recent purchase orders",
      subtitle: "Latest POs with vendor and billed value",
      unit: "inr",
      items: ctx.recentPurchases.map((p) => ({
        label: `${p.vendor}`,
        value: p.grandTotal,
        hint: `${p.poNumber} · ${p.date} · ${p.status}`,
      })),
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
