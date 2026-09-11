"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Dashboard — executive cockpit
// KPIs · 7-day sales trend · AR aging · top products · low-stock rail
// Coded against actual GET /api/v1/dashboard response shape.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  CalendarClock,
  CalendarDays,
  FileCheck2,
  HandCoins,
  IndianRupee,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";

import { PageHeader, KpiCard, Badge, Money, LoadingRows, ErrorText } from "../shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { requestAgingTab } from "@/lib/settle-bus";
import { useT, type TFn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DashboardAiChat } from "./dashboard-ai-chat";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

// ─── Actual API response types ──────────────────────────────────

interface DashboardResponse {
  firmId: string;
  firmName: string;
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
  monthTrend?: Array<{ date: string; total: number }>;
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

/** Slice of GET /ledger/aging-invoices used by the overdue-receivables pulse. */
interface OverduePulse {
  openInvoices: number;
  outstanding: number;
  overdueInvoices: number;
  overdue: number;
  worstOverdueDays: number;
  topOverdueParty: string | null;
  nextDueDate: string | null;
  unappliedReceipts: number;
}

/** Slice of GET /ledger/aging-pos used by the overdue-payables pulse. */
interface ApOverduePulse {
  openPOs: number;
  outstanding: number;
  overduePOs: number;
  overdue: number;
  worstOverdueDays: number;
  topOverdueVendor: string | null;
  nextDueDate: string | null;
}

interface LowStockMini {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number;
  shortfall: number;
  purchaseCost: number;
}

interface Gstr2bPulse {
  period: string;
  records2b: number;
  matched: number;
  mismatches: number;
  missingInBooks: number;
  missingIn2b: number;
  itc2b: number;
  itcBooks: number;
  matchedItc: number;
  missingItc: number;
  extraTax: number;
  netItcRisk: number;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Chart constants (Midnight Ledger palette) ──────────────────

const CHART_BLUE = "#2563EB";
const AGING_COLORS = ["#2563EB", "#FFCC00", "#F59E0B", "#EF4444"];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-medium)",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 8px 24px rgba(2,6,17,0.6)",
};

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 11 };

function compactINR(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v.toFixed(0)}`;
}

const TXN_TONE: Record<string, BadgeTone> = {
  INVOICE: "success",
  PURCHASE_ORDER: "info",
  CUSTOMER_RECEIPT: "dr",
  VENDOR_PAYMENT: "dr",
  CREDIT_NOTE: "warning",
  DEBIT_NOTE: "warning",
};

const TXN_LABEL_KEY: Record<string, string> = {
  INVOICE: "dash.txnSales",
  PURCHASE_ORDER: "dash.txnPurchase",
  CUSTOMER_RECEIPT: "dash.txnReceipt",
  VENDOR_PAYMENT: "dash.txnPayment",
  CREDIT_NOTE: "dash.txnCrNote",
  DEBIT_NOTE: "dash.txnDrNote",
};

export default function DashboardView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
  const setView = useErpStore((s) => s.setView);
  const { t } = useT();

  const [data, setData] = React.useState<DashboardResponse | null>(null);
  const [lowStock, setLowStock] = React.useState<LowStockMini[]>([]);
  const [gstPulse, setGstPulse] = React.useState<Gstr2bPulse | null>(null);
  const [overduePulse, setOverduePulse] = React.useState<OverduePulse | null>(null);
  const [apPulse, setApPulse] = React.useState<ApOverduePulse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setLoading(true);
    setError(null);
    try {
      const [dash, low, gst, aging, ap] = await Promise.all([
        apiGet<DashboardResponse>("/api/v1/dashboard", { firmId: activeFirmId }),
        apiGet<LowStockMini[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId }).catch(
          () => [] as LowStockMini[]
        ),
        apiGet<{ summary: Gstr2bPulse }>("/api/v1/gstr2b", {
          firmId: activeFirmId,
          period: currentPeriod(),
        })
          .then((r) => r.summary ?? null)
          .catch(() => null),
        apiGet<{
          totals: { openInvoices: number; outstanding: number; overdueInvoices: number; overdue: number };
          rows: Array<{ isOverdue: boolean; overdueDays: number; partyName: string; dueDate: string }>;
          reconciliation?: { unappliedReceipts: number };
        }>("/api/v1/ledger/aging-invoices", { firmId: activeFirmId }).catch(() => null),
        apiGet<{
          totals: { openPOs: number; outstanding: number; overduePOs: number; overdue: number };
          rows: Array<{ isOverdue: boolean; overdueDays: number; vendorName: string; dueDate: string }>;
        }>("/api/v1/ledger/aging-pos", { firmId: activeFirmId }).catch(() => null),
      ]);
      setData(dash);
      setLowStock(Array.isArray(low) ? low : []);
      setGstPulse(gst);

      if (aging) {
        const overdueRows = aging.rows.filter((r) => r.isOverdue);
        setOverduePulse({
          openInvoices: aging.totals.openInvoices,
          outstanding: aging.totals.outstanding,
          overdueInvoices: aging.totals.overdueInvoices,
          overdue: aging.totals.overdue,
          worstOverdueDays: overdueRows.reduce((m, r) => Math.max(m, r.overdueDays), 0),
          topOverdueParty:
            overdueRows.length > 0
              ? [...overdueRows].sort((a, b) => b.overdueDays - a.overdueDays)[0]?.partyName ?? null
              : null,
          nextDueDate:
            aging.rows.length > 0 ? aging.rows.map((r) => r.dueDate).sort()[0] ?? null : null,
          unappliedReceipts: aging.reconciliation?.unappliedReceipts ?? 0,
        });
      } else {
        setOverduePulse(null);
      }

      // AP pulse — mirror of the AR pulse from the PO-wise aging
      if (ap) {
        const apOverdueRows = ap.rows.filter((r) => r.isOverdue);
        const upcoming = ap.rows
          .map((r) => r.dueDate)
          .filter(Boolean)
          .sort();
        setApPulse({
          openPOs: ap.totals.openPOs,
          outstanding: ap.totals.outstanding,
          overduePOs: ap.totals.overduePOs,
          overdue: ap.totals.overdue,
          worstOverdueDays: apOverdueRows.reduce((m, r) => Math.max(m, r.overdueDays), 0),
          topOverdueVendor:
            apOverdueRows.length > 0
              ? [...apOverdueRows].sort((a, b) => b.overdueDays - a.overdueDays)[0]?.vendorName ?? null
              : null,
          nextDueDate: upcoming[0] ?? null,
        });
      } else {
        setApPulse(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dash.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeFirmId, t]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const trendData = React.useMemo(
    () =>
      (data?.salesTrend ?? []).map((p) => ({
        label: new Date(`${p.date}T00:00:00`).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        }),
        total: p.total,
      })),
    [data]
  );

  const agingRows = React.useMemo(() => {
    const a = data?.arAging;
    if (!a) return [];
    return [
      { bucket: "0-30", amount: a.d0_30 },
      { bucket: "31-60", amount: a.d31_60 },
      { bucket: "61-90", amount: a.d61_90 },
      { bucket: "90+", amount: a.d90plus },
    ];
  }, [data]);

  // Sparkline series for the sales KPI cards
  const trendSpark = React.useMemo(
    () => (data?.salesTrend ?? []).map((p) => p.total),
    [data]
  );
  const monthSpark = React.useMemo(
    () => (data?.monthTrend ?? []).map((p) => p.total),
    [data]
  );

  const lowStockRail = lowStock.slice(0, 5);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={t("dash.subtitle", { firm: activeFirm?.firmName ?? data?.firmName ?? "—" })}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("cmn.refresh")}
          </Button>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {/* ── DMK AI Copilot — the first container on the dashboard ── */}
      <DashboardAiChat />

      {!data && loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-[10px] bg-dmk-input-well" />
            ))}
          </div>
          <LoadingRows rows={5} />
        </div>
      ) : data ? (
        <>
          {/* ── KPI row (click to drill down) ───────────── */}
          <div className="dmk-enter-stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label={t("dash.kpiTodaySales")} value={formatINR(data.todaySales)} tone="orange" icon={IndianRupee}
              spark={trendSpark} sparkColor="#FF6B00"
              onClick={() => setView("sales/invoices")} drillHint={t("nav.invoices")} />
            <KpiCard label={t("dash.kpiMonthSales")} value={formatINR(data.monthSales)} tone="blue" icon={CalendarDays}
              spark={monthSpark} sparkColor="#2563EB"
              onClick={() => setView("reports")} drillHint={t("dash.drillSalesReport")} />
            <KpiCard
              label={t("dash.kpiReceivables")}
              value={formatINR(data.receivables)}
              tone="orange"
              sub={data.receivablesAdvances > 0.009 ? t("dash.subNetAdvances", { amt: formatINR(data.receivablesAdvances) }) : t("dash.subDrOwed")}
              icon={HandCoins}
              onClick={() => setView("finance/aging")}
              drillHint={t("dash.drillArAging")}
            />
            <KpiCard
              label={t("dash.kpiPayables")}
              value={formatINR(data.payables)}
              tone="info"
              sub={data.payablesCredits > 0.009 ? t("dash.subNetCredits", { amt: formatINR(data.payablesCredits) }) : t("dash.subCrOwed")}
              icon={Banknote}
              onClick={() => setView("finance/aging")}
              drillHint={t("dash.drillApAging")}
            />
            <KpiCard
              label={t("dash.kpiCashBank")}
              value={formatINR(data.cash + data.bank)}
              tone="success"
              sub={t("dash.subCashBank", { cash: formatINR(data.cash), bank: formatINR(data.bank) })}
              icon={Wallet}
              onClick={() => setView("finance/daybook")}
              drillHint={t("nav.daybook")}
            />
            <KpiCard
              label={t("dash.kpiInventory")}
              value={formatINR(data.inventoryValue)}
              tone="default"
              sub={t("dash.subDamaged", { amt: formatINR(data.damagedValue) })}
              icon={Boxes}
              onClick={() => setView("inventory/stock")}
              drillHint={t("nav.stock")}
            />
          </div>

          {/* ── Compliance + collections pulses (GSTR-2B · overdue AR) ── */}
          {gstPulse && <GstPulseCard pulse={gstPulse} onDrill={() => setView("finance/gstr2b")} t={t} />}
          {overduePulse && (
            <OverduePulseCard
              pulse={overduePulse}
              t={t}
              onDrill={() => {
                requestAgingTab("inv");
                setView("finance/aging");
              }}
            />
          )}
          {apPulse && (
            <ApOverduePulseCard
              pulse={apPulse}
              t={t}
              onDrill={() => {
                requestAgingTab("po");
                setView("finance/aging");
              }}
            />
          )}

          {/* ── Trend + AR aging ────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="dmk-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("dash.trendTitle")}</h2>
                  <p className="text-[11px] text-dmk-text-muted">{t("dash.trendSub")}</p>
                </div>
                <Badge tone="info">{t("dash.badge7d")}</Badge>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dmkSalesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(37,99,235,0.25)" />
                        <stop offset="100%" stopColor="rgba(37,99,235,0)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1E2D4A" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      axisLine={{ stroke: "#1E2D4A" }}
                      tickLine={false}
                      dy={6}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      tickFormatter={(v) => compactINR(Number(v))}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
                      itemStyle={{ color: "var(--text-primary)", fontFamily: "var(--font-jetbrains)" }}
                      formatter={(value) => formatINR(Number(value))}
                      cursor={{ stroke: "#2A3F66", strokeDasharray: "3 3" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name={t("dash.seriesSales")}
                      stroke="#2563EB"
                      strokeWidth={2}
                      fill="url(#dmkSalesGradient)"
                      activeDot={{ r: 4, fill: "#2563EB", stroke: "#0A0F1D", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="dmk-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("dash.drillArAging")}</h2>
                  <p className="text-[11px] text-dmk-text-muted">
                    {t("dash.arTotalOutstanding", { amt: formatINR(data.arAging.total) })}
                  </p>
                </div>
                <Badge tone="dr">Dr</Badge>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingRows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1E2D4A" strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={AXIS_TICK}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => compactINR(Number(v))}
                    />
                    <YAxis
                      type="category"
                      dataKey="bucket"
                      tick={AXIS_TICK}
                      axisLine={{ stroke: "#1E2D4A" }}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
                      itemStyle={{ color: "var(--text-primary)", fontFamily: "var(--font-jetbrains)" }}
                      formatter={(value) => formatINR(Number(value))}
                      cursor={{ fill: "rgba(37,99,235,0.08)" }}
                    />
                    <Bar dataKey="amount" name={t("dash.seriesReceivable")} radius={[0, 4, 4, 0]} barSize={20}>
                      {agingRows.map((row, i) => (
                        <Cell key={row.bucket} fill={AGING_COLORS[i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* ── Top products + low-stock rail ───────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="dmk-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("dash.topProducts")}</h2>
                  <p className="text-[11px] text-dmk-text-muted">{t("dash.topProductsSub")}</p>
                </div>
                <ShoppingBag className="h-4 w-4 text-dmk-text-muted" />
              </div>
              {data.topProducts.length === 0 ? (
                <p className="py-10 text-center text-[12.5px] text-dmk-text-muted">
                  {t("dash.topProductsEmpty")}
                </p>
              ) : (
                <ul className="max-h-[300px] overflow-y-auto space-y-1 pr-1">
                  {data.topProducts.map((p, i) => (
                    <li
                      key={p.productId}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-dmk-hover transition-colors"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-dmk-input-well border border-dmk-border-subtle font-money text-[11px] text-dmk-text-secondary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-dmk-text-primary truncate">{p.name}</p>
                        <p className="text-[10.5px] text-dmk-text-muted font-money">{p.sku}</p>
                      </div>
                      <span className="shrink-0 text-[12px] text-dmk-text-secondary font-money">
                        ×{Number.isInteger(p.qty) ? p.qty : p.qty.toFixed(2)}
                      </span>
                      <Money value={p.value} className="shrink-0 text-[13px] text-dmk-text-primary" />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="dmk-card p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary flex items-center gap-2">
                    {t("nav.lowStock")}
                    {data.lowStockCount > 0 && <Badge tone="danger">{data.lowStockCount}</Badge>}
                  </h2>
                  <p className="text-[11px] text-dmk-text-muted">{t("dash.lowStockSub")}</p>
                </div>
                <AlertTriangle
                  className={cn("h-4 w-4", data.lowStockCount > 0 ? "text-dmk-warning" : "text-dmk-text-muted")}
                />
              </div>
              {lowStockRail.length === 0 ? (
                <p className="py-10 text-center text-[12.5px] text-dmk-text-muted">
                  {t("dash.lowStockHealthy")}
                </p>
              ) : (
                <ul className="space-y-1 flex-1">
                  {lowStockRail.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-dmk-hover transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-dmk-text-primary truncate">{item.name}</p>
                        <p className="text-[10.5px] text-dmk-text-muted font-money">
                          {t("dash.stockOf", { sku: item.sku, qty: item.stockQuantity, thr: item.lowStockThreshold })}
                        </p>
                      </div>
                      <Badge tone="warning">−{item.shortfall}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-[11.5px] border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
                        onClick={() => setView("inventory/low-stock")}
                      >
                        {t("dash.reorder")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {lowStock.length > 5 && (
                <button
                  onClick={() => setView("inventory/low-stock")}
                  className="mt-3 self-start text-[12px] font-medium text-dmk-blue hover:underline"
                >
                  {t("dash.viewAllAlerts", { n: lowStock.length })}
                </button>
              )}
            </div>
          </div>

          {/* ── Recent transactions ─────────────────────── */}
          <div className="dmk-card">
            <div className="flex items-center justify-between p-4 pb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("dash.recentTxns")}</h2>
                <p className="text-[11px] text-dmk-text-muted">{t("dash.recentTxnsSub")}</p>
              </div>
              <TrendingUp className="h-4 w-4 text-dmk-text-muted" />
            </div>
            {data.recentTransactions.length === 0 ? (
              <p className="pb-8 text-center text-[12.5px] text-dmk-text-muted">{t("dash.noTxns")}</p>
            ) : (
              <ul className="max-h-[360px] overflow-y-auto border-t border-dmk-border-subtle">
                {data.recentTransactions.map((txn, i) => (
                  <li
                    key={`${txn.type}-${txn.number}-${i}`}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-dmk-border-subtle last:border-0 hover:bg-dmk-hover transition-colors"
                  >
                    <Badge tone={TXN_TONE[txn.type] ?? "neutral"}>
                      {TXN_LABEL_KEY[txn.type] ? t(TXN_LABEL_KEY[txn.type]) : txn.type}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-dmk-text-primary truncate font-money">
                        {txn.number}
                      </p>
                      <p className="text-[11px] text-dmk-text-muted truncate">{txn.party}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Money value={txn.amount} className="text-[13px] text-dmk-text-primary" />
                      <p className="text-[10.5px] text-dmk-text-muted">{formatDate(txn.date)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GST compliance pulse — GSTR-2B vs books for the current period
// Status ribbon: clean → green, exceptions → amber/red, no data →
// neutral import prompt. Whole card drills into the recon view.
// ═══════════════════════════════════════════════════════════════

function GstPulseCard({ pulse, onDrill, t }: { pulse: Gstr2bPulse; onDrill: () => void; t: TFn }) {
  const noData = pulse.records2b === 0 && pulse.missingIn2b === 0;
  const clean = !noData && pulse.netItcRisk <= 0.009 && pulse.missingInBooks === 0 && pulse.mismatches === 0;
  const atRisk = pulse.missingInBooks > 0 || pulse.netItcRisk > 0.009;
  const warn = !noData && !clean && !atRisk; // mismatches / books-only extras

  const status = noData
    ? { label: t("dash.gstStatusNoData"), tone: "neutral" as const, dot: "bg-dmk-text-muted", ring: "border-dmk-border-subtle" }
    : clean
      ? { label: t("dash.gstStatusClean"), tone: "success" as const, dot: "bg-dmk-success", ring: "border-dmk-success/30" }
      : atRisk
        ? { label: t("dash.gstStatusRisk"), tone: "danger" as const, dot: "bg-dmk-danger", ring: "border-dmk-danger/35" }
        : { label: t("dash.gstStatusReview"), tone: "warning" as const, dot: "bg-dmk-warning", ring: "border-dmk-warning/35" };

  const matchRate = pulse.records2b > 0 ? Math.round((pulse.matched / pulse.records2b) * 100) : 0;

  const stats = [
    { label: t("dash.gstItcBooks"), value: formatINR(pulse.itcBooks), cls: "text-dmk-text-primary" },
    { label: t("dash.gstItc2b"), value: formatINR(pulse.itc2b), cls: "text-dmk-text-primary" },
    { label: t("dash.gstMatched"), value: t("dash.gstMatchedVal", { m: pulse.matched, n: pulse.records2b }), cls: "text-dmk-success" },
    {
      label: t("dash.gstAtRisk"),
      value: formatINR(Math.max(0, pulse.netItcRisk)),
      cls: atRisk ? "text-dmk-danger" : "text-dmk-text-secondary",
    },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("dash.gstAria", { label: status.label })}
      onClick={onDrill}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDrill();
        }
      }}
      className={cn(
        "dmk-card p-4 dmk-kpi-clickable relative overflow-hidden border",
        status.ring,
        "dmk-enter"
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Status block */}
        <div className="flex items-center gap-3 min-w-0 lg:w-[280px] shrink-0">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            noData
              ? "bg-dmk-input-well border-dmk-border-subtle"
              : clean
                ? "bg-[rgba(34,197,94,0.1)] border-dmk-success/30"
                : atRisk
                  ? "bg-[rgba(239,68,68,0.1)] border-dmk-danger/30"
                  : "bg-[rgba(245,158,11,0.1)] border-dmk-warning/30"
          )}>
            {noData ? (
              <FileCheck2 className="h-5 w-5 text-dmk-text-muted" strokeWidth={1.75} />
            ) : clean ? (
              <ShieldCheck className="h-5 w-5 text-dmk-success" strokeWidth={1.75} />
            ) : (
              <AlertTriangle className={cn("h-5 w-5", atRisk ? "text-dmk-danger" : "text-dmk-warning")} strokeWidth={1.75} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
              {t("dash.gstHeader")}
            </p>
            <p className="text-[14.5px] font-bold text-dmk-text-primary flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", status.dot)} />
              {status.label}
            </p>
            <p className="text-[10.5px] text-dmk-text-muted font-money">{t("dash.gstPeriod", { p: pulse.period })}</p>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">{s.label}</p>
              <p className={cn("font-money text-[14px] font-semibold mt-0.5 truncate", s.cls)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Match-rate meter + drill */}
        <div className="lg:w-[190px] shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">
            <span>{t("dash.gstMatchRate")}</span>
            <span className="font-money text-dmk-text-secondary">{matchRate}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-dmk-input-well overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                matchRate >= 100 ? "bg-dmk-success" : matchRate >= 60 ? "bg-dmk-warning" : "bg-dmk-danger"
              )}
              style={{ width: `${matchRate}%` }}
            />
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-dmk-blue/80 mt-0.5">
            {t("nav.gstr2b")} <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {noData && (
        <p className="mt-3 text-[11.5px] text-dmk-text-muted border-t border-dmk-border-subtle pt-2.5">
          {t("dash.gstNoDataNote")}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Overdue receivables pulse — mirror of the GST compliance pulse.
// Answers "who owes me past their credit terms, how much, how
// late?" at a glance. Drills into the invoice-wise AR aging tab.
// ═══════════════════════════════════════════════════════════════

function OverduePulseCard({ pulse, onDrill, t }: { pulse: OverduePulse; onDrill: () => void; t: TFn }) {
  const noOpen = pulse.openInvoices === 0;
  const allClean = !noOpen && pulse.overdueInvoices === 0;
  // ≥40% of the open book overdue → red, otherwise amber
  const overdueShare = pulse.outstanding > 0 ? pulse.overdue / pulse.outstanding : 0;
  const severe = overdueShare >= 0.4;

  const status = noOpen
    ? { label: t("dash.arNoOpen"), tone: "neutral" as const, dot: "bg-dmk-text-muted", ring: "border-dmk-border-subtle" }
    : allClean
      ? { label: t("dash.allWithinTerms"), tone: "success" as const, dot: "bg-dmk-success", ring: "border-dmk-success/30" }
      : severe
        ? { label: t("dash.overdueCount", { n: pulse.overdueInvoices }), tone: "danger" as const, dot: "bg-dmk-danger", ring: "border-dmk-danger/35" }
        : { label: t("dash.overdueCount", { n: pulse.overdueInvoices }), tone: "warning" as const, dot: "bg-dmk-warning", ring: "border-dmk-warning/35" };

  const stats = [
    { label: t("dash.arOpenBook"), value: formatINR(pulse.outstanding), cls: "text-dmk-text-primary" },
    {
      label: t("dash.arOverdueLabel"),
      value: formatINR(pulse.overdue),
      cls: pulse.overdueInvoices > 0 ? "text-dmk-danger" : "text-dmk-success",
    },
    { label: t("dash.arOpenInvoices"), value: String(pulse.openInvoices), cls: "text-dmk-text-primary" },
    {
      label: pulse.overdueInvoices > 0 ? t("dash.worstPastDue") : t("dash.nextDue"),
      value:
        pulse.overdueInvoices > 0
          ? `${pulse.worstOverdueDays}d${pulse.topOverdueParty ? ` · ${pulse.topOverdueParty.split(" ")[0]}` : ""}`
          : pulse.nextDueDate
            ? formatDate(pulse.nextDueDate)
            : "—",
      cls: pulse.overdueInvoices > 0 ? "text-dmk-warning" : "text-dmk-text-secondary",
    },
  ];

  const meterPct = Math.min(100, Math.round(overdueShare * 100));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("dash.arAria", { label: status.label })}
      onClick={onDrill}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDrill();
        }
      }}
      className={cn(
        "dmk-card p-4 dmk-kpi-clickable relative overflow-hidden border",
        status.ring,
        "dmk-enter"
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Status block */}
        <div className="flex items-center gap-3 min-w-0 lg:w-[280px] shrink-0">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            noOpen
              ? "bg-dmk-input-well border-dmk-border-subtle"
              : allClean
                ? "bg-[rgba(34,197,94,0.1)] border-dmk-success/30"
                : severe
                  ? "bg-[rgba(239,68,68,0.1)] border-dmk-danger/30"
                  : "bg-[rgba(245,158,11,0.1)] border-dmk-warning/30"
          )}>
            {noOpen ? (
              <HandCoins className="h-5 w-5 text-dmk-text-muted" strokeWidth={1.75} />
            ) : allClean ? (
              <CalendarClock className="h-5 w-5 text-dmk-success" strokeWidth={1.75} />
            ) : (
              <CalendarClock className={cn("h-5 w-5", severe ? "text-dmk-danger" : "text-dmk-warning")} strokeWidth={1.75} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
              {t("dash.arHeader")}
            </p>
            <p className="text-[14.5px] font-bold text-dmk-text-primary flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", status.dot)} />
              {status.label}
            </p>
            <p className="text-[10.5px] text-dmk-text-muted truncate">
              {allClean && pulse.nextDueDate
                ? t("dash.arNextPaymentDue", { date: formatDate(pulse.nextDueDate) })
                : t("dash.arAgedNote")}
            </p>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">{s.label}</p>
              <p className={cn("font-money text-[14px] font-semibold mt-0.5 truncate", s.cls)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Overdue-share meter + drill */}
        <div className="lg:w-[190px] shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">
            <span>{t("dash.arOverdueShare")}</span>
            <span className="font-money text-dmk-text-secondary">{meterPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-dmk-input-well overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                meterPct === 0 ? "bg-dmk-success" : meterPct < 40 ? "bg-dmk-warning" : "bg-dmk-danger"
              )}
              style={{ width: `${Math.max(meterPct, meterPct === 0 ? 0 : 4)}%` }}
            />
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-dmk-blue/80 mt-0.5">
            {t("dash.arAgingLink")} <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {allClean && (
        <p className="mt-3 text-[11.5px] text-dmk-text-muted border-t border-dmk-border-subtle pt-2.5">
          {t("dash.arCleanNote")}
          {pulse.unappliedReceipts > 0.009 && (
            <> {t("dash.arCleanNoteUnapplied", { amt: formatINR(pulse.unappliedReceipts) })}</>
          )}
        </p>
      )}
      {severe && (
        <p className="mt-3 text-[11.5px] text-dmk-warning border-t border-dmk-border-subtle pt-2.5">
          {t("dash.arSevereNote", {
            pct: Math.round(overdueShare * 100),
            party: pulse.topOverdueParty ?? t("dash.arSevereFallback"),
          })}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Overdue payables pulse — mirror of the receivables pulse.
// Answers "who do I owe past vendor terms, how much, how late?"
// from the precise PO-wise AP aging. Drills into the PO aging tab.
// ═══════════════════════════════════════════════════════════════

function ApOverduePulseCard({ pulse, onDrill, t }: { pulse: ApOverduePulse; onDrill: () => void; t: TFn }) {
  const noOpen = pulse.openPOs === 0;
  const allClean = !noOpen && pulse.overduePOs === 0;
  const overdueShare = pulse.outstanding > 0 ? pulse.overdue / pulse.outstanding : 0;
  const severe = overdueShare >= 0.4;

  const status = noOpen
    ? { label: t("dash.apNoOpen"), dot: "bg-dmk-text-muted", ring: "border-dmk-border-subtle" }
    : allClean
      ? { label: t("dash.allWithinTerms"), dot: "bg-dmk-success", ring: "border-dmk-success/30" }
      : severe
        ? { label: t("dash.overdueCount", { n: pulse.overduePOs }), dot: "bg-dmk-danger", ring: "border-dmk-danger/35" }
        : { label: t("dash.overdueCount", { n: pulse.overduePOs }), dot: "bg-dmk-warning", ring: "border-dmk-warning/35" };

  const stats = [
    { label: t("dash.apOpenPayables"), value: formatINR(pulse.outstanding), cls: "text-dmk-text-primary" },
    {
      label: t("dash.apPastTerms"),
      value: formatINR(pulse.overdue),
      cls: pulse.overduePOs > 0 ? "text-dmk-danger" : "text-dmk-success",
    },
    { label: t("dash.apOpenPOs"), value: String(pulse.openPOs), cls: "text-dmk-text-primary" },
    {
      label: pulse.overduePOs > 0 ? t("dash.worstPastDue") : t("dash.apNextDueLabel"),
      value:
        pulse.overduePOs > 0
          ? `${pulse.worstOverdueDays}d${pulse.topOverdueVendor ? ` · ${pulse.topOverdueVendor.split(" ")[0]}` : ""}`
          : pulse.nextDueDate
            ? formatDate(pulse.nextDueDate)
            : "—",
      cls: pulse.overduePOs > 0 ? "text-dmk-warning" : "text-dmk-text-secondary",
    },
  ];

  const meterPct = Math.min(100, Math.round(overdueShare * 100));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("dash.apAria", { label: status.label })}
      onClick={onDrill}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDrill();
        }
      }}
      className={cn(
        "dmk-card p-4 dmk-kpi-clickable relative overflow-hidden border",
        status.ring,
        "dmk-enter"
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Status block */}
        <div className="flex items-center gap-3 min-w-0 lg:w-[280px] shrink-0">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            noOpen
              ? "bg-dmk-input-well border-dmk-border-subtle"
              : allClean
                ? "bg-[rgba(34,197,94,0.1)] border-dmk-success/30"
                : severe
                  ? "bg-[rgba(239,68,68,0.1)] border-dmk-danger/30"
                  : "bg-[rgba(245,158,11,0.1)] border-dmk-warning/30"
          )}>
            <Truck
              className={cn(
                "h-5 w-5",
                noOpen ? "text-dmk-text-muted" : allClean ? "text-dmk-success" : severe ? "text-dmk-danger" : "text-dmk-warning"
              )}
              strokeWidth={1.75}
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
              {t("dash.apHeader")}
            </p>
            <p className="text-[14.5px] font-bold text-dmk-text-primary flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", status.dot)} />
              {status.label}
            </p>
            <p className="text-[10.5px] text-dmk-text-muted truncate">
              {allClean && pulse.nextDueDate
                ? t("dash.apVendorNextDue", { date: formatDate(pulse.nextDueDate) })
                : t("dash.apAgedNote")}
            </p>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-w-0">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">{s.label}</p>
              <p className={cn("font-money text-[14px] font-semibold mt-0.5 truncate", s.cls)}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Overdue-share meter + drill */}
        <div className="lg:w-[190px] shrink-0 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">
            <span>{t("dash.apPastTermsShare")}</span>
            <span className="font-money text-dmk-text-secondary">{meterPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-dmk-input-well overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                meterPct === 0 ? "bg-dmk-success" : meterPct < 40 ? "bg-dmk-warning" : "bg-dmk-danger"
              )}
              style={{ width: `${Math.max(meterPct, meterPct === 0 ? 0 : 4)}%` }}
            />
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-dmk-blue/80 mt-0.5">
            {t("dash.apAgingLink")} <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {allClean && (
        <p className="mt-3 text-[11.5px] text-dmk-text-muted border-t border-dmk-border-subtle pt-2.5">
          {t("dash.apCleanNote")}
        </p>
      )}
      {severe && (
        <p className="mt-3 text-[11.5px] text-dmk-warning border-t border-dmk-border-subtle pt-2.5">
          {t("dash.apSevereNote", {
            pct: Math.round(overdueShare * 100),
            vendor: pulse.topOverdueVendor ?? t("dash.apSevereFallback"),
          })}
        </p>
      )}
    </div>
  );
}
