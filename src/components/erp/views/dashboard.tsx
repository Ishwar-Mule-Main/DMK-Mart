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
  Banknote,
  Boxes,
  CalendarDays,
  HandCoins,
  IndianRupee,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { PageHeader, KpiCard, Badge, Money, LoadingRows, ErrorText } from "../shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

// ─── Actual API response types ──────────────────────────────────

interface DashboardResponse {
  firmId: string;
  firmName: string;
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

interface LowStockMini {
  id: string;
  sku: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number;
  shortfall: number;
  purchaseCost: number;
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

const TXN_LABEL: Record<string, string> = {
  INVOICE: "SALES",
  PURCHASE_ORDER: "PURCHASE",
  CUSTOMER_RECEIPT: "RECEIPT",
  VENDOR_PAYMENT: "PAYMENT",
  CREDIT_NOTE: "CR NOTE",
  DEBIT_NOTE: "DR NOTE",
};

export default function DashboardView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
  const setView = useErpStore((s) => s.setView);

  const [data, setData] = React.useState<DashboardResponse | null>(null);
  const [lowStock, setLowStock] = React.useState<LowStockMini[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setLoading(true);
    setError(null);
    try {
      const [dash, low] = await Promise.all([
        apiGet<DashboardResponse>("/api/v1/dashboard", { firmId: activeFirmId }),
        apiGet<LowStockMini[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId }).catch(
          () => [] as LowStockMini[]
        ),
      ]);
      setData(dash);
      setLowStock(Array.isArray(low) ? low : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [activeFirmId]);

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
        title="Dashboard"
        subtitle={`${activeFirm?.firmName ?? data?.firmName ?? "—"} · Executive cockpit`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

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
            <KpiCard label="Today's Sales" value={formatINR(data.todaySales)} tone="orange" icon={IndianRupee}
              spark={trendSpark} sparkColor="#FF6B00"
              onClick={() => setView("sales/invoices")} drillHint="Invoice Register" />
            <KpiCard label="Month Sales" value={formatINR(data.monthSales)} tone="blue" icon={CalendarDays}
              spark={monthSpark} sparkColor="#2563EB"
              onClick={() => setView("reports")} drillHint="Sales Report" />
            <KpiCard
              label="Receivables"
              value={formatINR(data.receivables)}
              tone="orange"
              sub="Dr — owed by customers"
              icon={HandCoins}
              onClick={() => setView("finance/aging")}
              drillHint="AR Aging"
            />
            <KpiCard
              label="Payables"
              value={formatINR(data.payables)}
              tone="info"
              sub="Cr — owed to vendors"
              icon={Banknote}
              onClick={() => setView("finance/aging")}
              drillHint="AP Aging"
            />
            <KpiCard
              label="Cash + Bank"
              value={formatINR(data.cash + data.bank)}
              tone="success"
              sub={`Cash ${formatINR(data.cash)} · Bank ${formatINR(data.bank)}`}
              icon={Wallet}
              onClick={() => setView("finance/daybook")}
              drillHint="Day Book"
            />
            <KpiCard
              label="Inventory Value"
              value={formatINR(data.inventoryValue)}
              tone="default"
              sub={`Damaged: ${formatINR(data.damagedValue)}`}
              icon={Boxes}
              onClick={() => setView("inventory/stock")}
              drillHint="Stock Levels"
            />
          </div>

          {/* ── Trend + AR aging ────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="dmk-card p-4 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">Sales Trend</h2>
                  <p className="text-[11px] text-dmk-text-muted">Last 7 days · posted invoices</p>
                </div>
                <Badge tone="info">7 DAYS</Badge>
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
                      name="Sales"
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
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">AR Aging</h2>
                  <p className="text-[11px] text-dmk-text-muted">
                    Total outstanding {formatINR(data.arAging.total)}
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
                    <Bar dataKey="amount" name="Receivable" radius={[0, 4, 4, 0]} barSize={20}>
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
                  <h2 className="text-[15px] font-semibold text-dmk-text-primary">Top Products</h2>
                  <p className="text-[11px] text-dmk-text-muted">Last 30 days · by quantity sold</p>
                </div>
                <ShoppingBag className="h-4 w-4 text-dmk-text-muted" />
              </div>
              {data.topProducts.length === 0 ? (
                <p className="py-10 text-center text-[12.5px] text-dmk-text-muted">
                  No sales recorded in the last 30 days.
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
                    Low Stock Alerts
                    {data.lowStockCount > 0 && <Badge tone="danger">{data.lowStockCount}</Badge>}
                  </h2>
                  <p className="text-[11px] text-dmk-text-muted">Products at or below reorder threshold</p>
                </div>
                <AlertTriangle
                  className={cn("h-4 w-4", data.lowStockCount > 0 ? "text-dmk-warning" : "text-dmk-text-muted")}
                />
              </div>
              {lowStockRail.length === 0 ? (
                <p className="py-10 text-center text-[12.5px] text-dmk-text-muted">
                  All stock levels healthy.
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
                          {item.sku} · stock {item.stockQuantity}/{item.lowStockThreshold}
                        </p>
                      </div>
                      <Badge tone="warning">−{item.shortfall}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-[11.5px] border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
                        onClick={() => setView("inventory/low-stock")}
                      >
                        Reorder
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
                  View all {lowStock.length} alerts →
                </button>
              )}
            </div>
          </div>

          {/* ── Recent transactions ─────────────────────── */}
          <div className="dmk-card">
            <div className="flex items-center justify-between p-4 pb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-dmk-text-primary">Recent Transactions</h2>
                <p className="text-[11px] text-dmk-text-muted">Latest 10 documents across the ledger</p>
              </div>
              <TrendingUp className="h-4 w-4 text-dmk-text-muted" />
            </div>
            {data.recentTransactions.length === 0 ? (
              <p className="pb-8 text-center text-[12.5px] text-dmk-text-muted">No transactions yet.</p>
            ) : (
              <ul className="max-h-[360px] overflow-y-auto border-t border-dmk-border-subtle">
                {data.recentTransactions.map((t, i) => (
                  <li
                    key={`${t.type}-${t.number}-${i}`}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-dmk-border-subtle last:border-0 hover:bg-dmk-hover transition-colors"
                  >
                    <Badge tone={TXN_TONE[t.type] ?? "neutral"}>{TXN_LABEL[t.type] ?? t.type}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-dmk-text-primary truncate font-money">
                        {t.number}
                      </p>
                      <p className="text-[11px] text-dmk-text-muted truncate">{t.party}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <Money value={t.amount} className="text-[13px] text-dmk-text-primary" />
                      <p className="text-[10.5px] text-dmk-text-muted">{formatDate(t.date)}</p>
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
