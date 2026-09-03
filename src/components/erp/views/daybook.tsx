"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — DAY BOOK — one day's vouchers + cash/bank flow
// Coded against GET /api/v1/ledger/day-book?firmId=&date=
// Opening derives from journal history (OPENING journal carries
// firm openingCash/openingBank — no double count).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  NotebookTabs,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api-client";
import { formatINR, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

interface DayJournalLine {
  id: string;
  accountId: string;
  accountName: string;
  entrySide: "DEBIT" | "CREDIT";
  debitAmount: number;
  creditAmount: number;
  narration: string;
}

interface DayJournal {
  id: string;
  voucherNumber: string;
  voucherType: string;
  postingDate: string;
  narration: string;
  totalDebit: number;
  totalCredit: number;
  lines: DayJournalLine[];
}

interface Flow {
  opening: number;
  in: number;
  out: number;
  closing: number;
}

interface TrendDay {
  date: string;
  label: string;
  cashIn: number;
  cashOut: number;
  bankIn: number;
  bankOut: number;
  in: number;
  out: number;
  net: number;
}

interface DayBookResponse {
  firmId: string;
  firmName: string;
  date: string;
  journals: DayJournal[];
  cash: Flow;
  bank: Flow;
  trend?: TrendDay[];
}

const TYPE_TONE: Record<string, BadgeTone> = {
  SALES: "success",
  PURCHASE: "info",
  RECEIPT: "dr",
  PAYMENT: "cr",
  CREDIT_NOTE: "warning",
  DEBIT_NOTE: "warning",
  JOURNAL: "neutral",
  CONTRA: "info",
  OPENING: "dr",
};

const TYPE_LABEL: Record<string, string> = {
  CREDIT_NOTE: "CR NOTE",
  DEBIT_NOTE: "DR NOTE",
};

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function FlowStrip({ icon: Icon, label, flow }: { icon: LucideIcon; label: string; flow: Flow }) {
  const steps = [
    { key: "Opening", value: flow.opening, cls: "text-dmk-text-primary" },
    { key: "In", value: flow.in, cls: "text-dmk-success" },
    { key: "Out", value: flow.out, cls: "text-dmk-danger" },
    { key: "Closing", value: flow.closing, cls: "text-dmk-gold" },
  ];
  return (
    <div className="dmk-card p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="h-4 w-4 text-dmk-text-muted" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-dmk-text-secondary">{label} Flow</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="relative">
            {i > 0 && (
              <ChevronRight
                className="hidden sm:block absolute -left-[15px] top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dmk-text-muted"
                aria-hidden
              />
            )}
            <div className="dmk-well px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted font-semibold">{s.key}</p>
              <p className={cn("font-money text-[13.5px] font-semibold tabular-nums truncate", s.cls)} title={formatINR(s.value)}>
                {formatINR(s.value)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DaybookView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [date, setDate] = React.useState(() => toISODate(new Date()));
  const [data, setData] = React.useState<DayBookResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<DayBookResponse>("/api/v1/ledger/day-book", { firmId: activeFirmId, date, trendDays: 14 })
      .then((res) => {
        if (alive) {
          setData(res);
          setExpanded(new Set());
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load day book");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, date]);

  // Group vouchers chronologically by voucherType
  const groups = React.useMemo(() => {
    const map = new Map<string, DayJournal[]>();
    for (const j of data?.journals ?? []) {
      const list = map.get(j.voucherType) ?? [];
      list.push(j);
      map.set(j.voucherType, list);
    }
    return Array.from(map.entries());
  }, [data]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Day Book"
        subtitle="Chronological vouchers of the day with cash & bank movement"
        icon={NotebookTabs}
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate((d) => shiftDate(d, -1))}
              className="h-9 w-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className={cn("h-9 w-40 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] dmk-input [color-scheme:dark]")}
              aria-label="Day book date"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDate((d) => shiftDate(d, 1))}
              className="h-9 w-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDate(toISODate(new Date()))}
              className="h-9 gap-1.5 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
            >
              <CalendarDays className="h-3.5 w-3.5" /> Today
            </Button>
          </div>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : !data ? (
        <EmptyState icon={NotebookTabs} title="Day book unavailable" hint="Try another date." />
      ) : (
        <>
          {/* Cash & Bank flow strips */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <FlowStrip icon={Wallet} label="Cash" flow={data.cash} />
            <FlowStrip icon={Banknote} label="Bank" flow={data.bank} />
          </div>

          {/* Cash-flow movement trend (last 14 days ending on selected date) */}
          <FlowTrendChart trend={data.trend ?? []} selectedDate={data.date} />

          {/* Vouchers */}
          {data.journals.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No vouchers posted on this day"
              hint="Pick another date with the arrows, or post sales/purchases to see them here."
            />
          ) : (
            <div className="space-y-4">
              {groups.map(([type, journals]) => (
                <div key={type} className="dmk-card overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-dmk-border-subtle bg-dmk-input-well/50">
                    <div className="flex items-center gap-2.5">
                      <Badge tone={TYPE_TONE[type] ?? "neutral"}>{TYPE_LABEL[type] ?? type}</Badge>
                      <span className="text-[12px] text-dmk-text-muted">
                        {journals.length} voucher{journals.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <span className="font-money text-[12.5px] text-dmk-text-secondary">
                      Σ {formatINR(journals.reduce((s, j) => s + j.totalDebit, 0))}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="dmk-table">
                      <thead>
                        <tr>
                          <th className="w-8" />
                          <th>Voucher #</th>
                          <th>Time</th>
                          <th>Narration</th>
                          <th className="num text-right">Debit (₹)</th>
                          <th className="num text-right">Credit (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journals.map((j) => {
                          const isOpen = expanded.has(j.id);
                          return (
                            <React.Fragment key={j.id}>
                              <tr className="cursor-pointer" onClick={() => toggle(j.id)}>
                                <td className="text-dmk-text-muted">
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </td>
                                <td className="font-money text-[12.5px] whitespace-nowrap">{j.voucherNumber}</td>
                                <td>
                                  <span className="text-[12px] text-dmk-text-muted whitespace-nowrap">
                                    {new Date(j.postingDate).toLocaleTimeString("en-IN", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </td>
                                <td className="max-w-[280px] lg:max-w-[420px]">
                                  <span className="block truncate text-dmk-text-secondary text-[12.5px]" title={j.narration}>
                                    {j.narration || "—"}
                                  </span>
                                </td>
                                <td className="num text-right text-dmk-yellow">{formatINR(j.totalDebit)}</td>
                                <td className="num text-right text-dmk-info">{formatINR(j.totalCredit)}</td>
                              </tr>
                              {isOpen && (
                                <tr>
                                  <td colSpan={6} className="bg-dmk-input-well/60 px-0 py-0">
                                    <div className="px-4 sm:px-10 py-3">
                                      <div className="dmk-well overflow-hidden">
                                        <table className="dmk-table">
                                          <thead>
                                            <tr>
                                              <th>Account</th>
                                              <th className="num text-right">Debit (₹)</th>
                                              <th className="num text-right">Credit (₹)</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {j.lines.map((l) => (
                                              <tr key={l.id}>
                                                <td>
                                                  <span className="flex items-center gap-2">
                                                    <Badge tone={l.entrySide === "DEBIT" ? "dr" : "cr"}>
                                                      {l.entrySide === "DEBIT" ? "Dr" : "Cr"}
                                                    </Badge>
                                                    <span className="text-[12.5px]">{l.accountName}</span>
                                                  </span>
                                                </td>
                                                <td className="num text-right text-dmk-yellow">
                                                  {l.debitAmount ? formatINR(l.debitAmount) : "—"}
                                                </td>
                                                <td className="num text-right text-dmk-info">
                                                  {l.creditAmount ? formatINR(l.creditAmount) : "—"}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CASH-FLOW TREND — 14-day money in/out bars + net line (cycle 18)
// ═══════════════════════════════════════════════════════════════

const TREND_GREEN = "#10B981";
const TREND_RED = "#EF4444";
const TREND_GOLD = "#F59E0B";
const TREND_TOOLTIP: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-medium)",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 8px 24px rgba(2,6,17,0.6)",
};

function compactINR(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v.toFixed(0)}`;
}

function FlowTrendChart({ trend, selectedDate }: { trend: TrendDay[]; selectedDate: string }) {
  const totalIn = trend.reduce((s, t) => s + t.in, 0);
  const totalOut = trend.reduce((s, t) => s + t.out, 0);
  const net = Math.round((totalIn - totalOut) * 100) / 100;
  const activeDays = trend.filter((t) => t.in > 0 || t.out > 0).length;

  return (
    <div className="dmk-card p-4 dmk-enter">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-dmk-text-primary">Cash &amp; Bank Movement</h2>
          <p className="text-[11px] text-dmk-text-muted">
            Last {trend.length} days ending {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · {activeDays} active day{activeDays === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-money">
          <span className="dmk-badge bg-dmk-success/10 text-dmk-success">IN {compactINR(totalIn)}</span>
          <span className="dmk-badge bg-dmk-danger/10 text-dmk-danger">OUT {compactINR(totalOut)}</span>
          <span className={cn("dmk-badge font-semibold", net >= 0 ? "bg-dmk-gold/15 text-dmk-gold" : "bg-dmk-warning/15 text-dmk-warning")}>
            NET {net >= 0 ? "+" : "−"}{compactINR(Math.abs(net))}
          </span>
        </div>
      </div>
      {activeDays === 0 ? (
        <p className="text-[12px] text-dmk-text-muted py-8 text-center">
          No money movement in the last {trend.length} days.
        </p>
      ) : (
        <div className="h-[190px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1E2D4A" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                axisLine={{ stroke: "#1E2D4A" }}
                tickLine={false}
                dy={6}
                interval="preserveStartEnd"
                minTickGap={18}
              />
              <YAxis
                tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={54}
                tickFormatter={(v) => compactINR(Number(v))}
              />
              <Tooltip
                contentStyle={TREND_TOOLTIP}
                labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
                formatter={(value, name) => [formatINR(Number(value)), String(name)]}
                cursor={{ fill: "rgba(245,158,11,0.06)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                formatter={(value) => <span style={{ color: "var(--text-secondary)" }}>{value}</span>}
              />
              <Bar dataKey="in" name="Money in" fill={TREND_GREEN} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="out" name="Money out" fill={TREND_RED} radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Line
                type="monotone"
                dataKey="net"
                name="Net flow"
                stroke={TREND_GOLD}
                strokeWidth={2}
                dot={{ r: 2.5, fill: TREND_GOLD, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
