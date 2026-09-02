// ═══════════════════════════════════════════════════════════════
// /api/v1/ai/chat — DMK Mart ERP Copilot (backend-only LLM call)
// Grounds the model strictly in a JSON snapshot of the firm's live data.
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

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const message = getStr(body.message);

    const firm = await resolveFirm(firmId);
    if (!message) {
      return ok({ reply: "Ask me anything about your firm's sales, stock, receivables or books." });
    }

    const now = new Date();
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
      return ok({ reply: "I could not generate a response from the current data. Please try again." });
    }
    return ok({ reply });
  } catch (e) {
    return handleApiError(e);
  }
}
