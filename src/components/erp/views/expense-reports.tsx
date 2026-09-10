"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — EXPENSE REPORTS — monthly operational expense summary
// Coded against:
//   GET /api/v1/expenses?firmId=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=500
//     → { expenses, count, summary:{ total, count, byCategory, bySource } }
//   GET /api/v1/expenses/categories?firmId= → trilingual category master
// Summary totals come from the server for the whole month; the filter
// bar narrows the voucher table client-side. CSV export is client-side.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Landmark,
  PieChart,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorText,
  LoadingRows,
  PageHeader,
  SearchInput,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types (mirror of the API contract) ──────────────────────────

type PaymentSource = "CASH_DRAWER" | "BANK_CURRENT" | "BANK_CC";
type Lang = "en" | "hi" | "mr";

interface CategoryNames {
  nameEnglish: string;
  nameHindi: string;
  nameMarathi: string;
}

interface ExpenseCategory {
  id: string;
  code: string;
  nameEnglish: string;
  nameHindi: string;
  nameMarathi: string;
  accountCode: string;
}

interface ExpenseRow {
  id: string;
  voucherNumber: string;
  expenseDate: string;
  amount: number;
  paymentSource: PaymentSource;
  paidTo: string | null;
  vehicleNumber: string | null;
  narration: string | null;
  receiptFileUrl: string | null;
  category: ExpenseCategory;
  journalEntry?: { id: string; voucherNumber: string } | null;
}

interface ExpensesResponse {
  expenses: ExpenseRow[];
  count: number;
  summary: {
    total: number;
    count: number;
    byCategory: Array<CategoryNames & { code: string; total: number; count: number; percent: number }>;
    bySource: Record<PaymentSource, number>;
  };
}

const SOURCE_TONE: Record<PaymentSource, "warning" | "info" | "danger"> = {
  CASH_DRAWER: "warning",
  BANK_CURRENT: "info",
  BANK_CC: "danger",
};

const BAR_CLASSES = ["bg-dmk-success", "bg-dmk-warning", "bg-dmk-danger"];

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from: toISODate(from), to: toISODate(to) };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  const locale = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Category name in the current UI language (falls back to English). */
function catMain(c: CategoryNames, lang: Lang): string {
  if (lang === "hi") return c.nameHindi || c.nameEnglish;
  if (lang === "mr") return c.nameMarathi || c.nameEnglish;
  return c.nameEnglish || c.nameHindi;
}

/** The other-language names shown as the muted subline (all words visible). */
function catOthers(c: CategoryNames, lang: Lang): string {
  const main = catMain(c, lang);
  const parts: string[] = [];
  for (const n of [c.nameEnglish, c.nameHindi, c.nameMarathi]) {
    if (n && n !== main && !parts.includes(n)) parts.push(n);
  }
  return parts.join(" · ");
}

export default function ExpenseReportsView() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [month, setMonth] = React.useState(() => toISODate(new Date()).slice(0, 7));
  const [data, setData] = React.useState<ExpensesResponse | null>(null);
  const [categories, setCategories] = React.useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filters — client-side narrowing of the month's vouchers
  const [catFilter, setCatFilter] = React.useState("ALL");
  const [srcFilter, setSrcFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");

  // Animated bars re-run for every month load
  const [barsIn, setBarsIn] = React.useState(false);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const { from, to } = monthRange(month);
    Promise.allSettled([
      apiGet<ExpensesResponse>("/api/v1/expenses", { firmId: activeFirmId, from, to, limit: 500 }),
      apiGet<ExpenseCategory[]>("/api/v1/expenses/categories", { firmId: activeFirmId }),
    ]).then(([res, cats]) => {
      if (!alive) return;
      if (res.status === "fulfilled") {
        setData(res.value);
      } else {
        setData(null);
        setError(res.reason instanceof Error ? res.reason.message : "Failed to load expense report");
      }
      if (cats.status === "fulfilled") setCategories(cats.value ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [activeFirmId, month]);

  // Fresh month → reset the client-side filters
  React.useEffect(() => {
    setCatFilter("ALL");
    setSrcFilter("ALL");
    setQuery("");
  }, [month]);

  React.useEffect(() => {
    setBarsIn(false);
    const id = window.setTimeout(() => setBarsIn(true), 40);
    return () => window.clearTimeout(id);
  }, [data]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.expenses ?? []).filter((v) => {
      if (catFilter !== "ALL" && v.category.id !== catFilter) return false;
      if (srcFilter !== "ALL" && v.paymentSource !== srcFilter) return false;
      if (q) {
        const hay = `${v.voucherNumber} ${v.paidTo ?? ""} ${v.narration ?? ""} ${v.vehicleNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, catFilter, srcFilter, query]);

  const summary = data?.summary;
  const byCategory = summary?.byCategory ?? [];
  const bySource = summary?.bySource;

  const SPLIT_TILES: Array<{ key: PaymentSource; labelKey: string; subKey: string; icon: LucideIcon; cls: string }> = [
    { key: "CASH_DRAWER", labelKey: "exp.cashOutflow", subKey: "exp.cashDrawer", icon: Wallet, cls: "text-dmk-warning" },
    { key: "BANK_CURRENT", labelKey: "exp.bankOnline", subKey: "exp.bankUpi", icon: Landmark, cls: "text-dmk-success" },
    { key: "BANK_CC", labelKey: "exp.ccDebt", subKey: "exp.bankCc", icon: CreditCard, cls: "text-dmk-danger" },
  ];

  function exportCsv() {
    if (!data || data.expenses.length === 0) {
      toast({ title: t("exp.noData"), variant: "destructive" });
      return;
    }
    const rows: (string | number)[][] = [
      [
        t("cmn.date"),
        t("exp.colVoucher"),
        t("exp.category"),
        t("exp.colPaidTo"),
        t("exp.colVehicle"),
        t("exp.colSource"),
        t("cmn.amount"),
        t("exp.colNarration"),
      ],
      ...data.expenses.map((v) => [
        toISODate(v.expenseDate),
        v.voucherNumber,
        `${v.category.code} ${catMain(v.category, lang)}`,
        v.paidTo ?? "",
        v.vehicleNumber ?? "",
        v.paymentSource,
        v.amount,
        v.narration ?? "",
      ]),
    ];
    downloadCSV(`expenses-${month}.csv`, rows);
  }

  return (
    <div className="space-y-4 dmk-enter-stagger">
      <PageHeader
        title={t("exp.reportTitle")}
        icon={PieChart}
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              className="h-10 w-10 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              aria-label={t("exp.prevMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className={cn("h-10 w-[150px] bg-dmk-input-well border-dmk-border-subtle text-[12.5px] dmk-input [color-scheme:dark]")}
              aria-label={monthLabel(month, lang)}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              className="h-10 w-10 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              aria-label={t("exp.nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={exportCsv}
              className="h-10 gap-1.5 border-dmk-border-subtle bg-dmk-input-well px-3.5 text-[12px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
              aria-label={t("exp.exportCsv")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t("exp.exportCsv")}
            </Button>
          </div>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={8} />
        </div>
      ) : !data || !summary ? (
        <EmptyState icon={PieChart} title={t("exp.noData")} hint={monthLabel(month, lang)} />
      ) : (
        <>
          {/* Big month total + category breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="dmk-card p-6 flex flex-col justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                  {t("exp.totalThisMonth")}
                </p>
                <p className="mt-2 font-money text-[38px] leading-none font-bold text-dmk-gold tabular-nums">
                  {formatINR(summary.total)}
                </p>
                <p className="mt-2.5 text-[12px] text-dmk-text-muted">
                  {summary.count} {t("exp.vouchers")} · {monthLabel(month, lang)}
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-dmk-border-subtle bg-dmk-input-well">
                <Wallet className="h-5 w-5 text-dmk-yellow" strokeWidth={1.75} aria-hidden="true" />
              </div>
            </div>

            <div className="dmk-card p-4 sm:p-6 lg:col-span-2">
              <h2 className="text-[11px] uppercase tracking-wider font-bold text-dmk-text-muted">
                {t("exp.categoryBreakdown")}
              </h2>
              {byCategory.length === 0 ? (
                <p className="py-10 text-center text-[13px] text-dmk-text-muted">{t("exp.noData")}</p>
              ) : (
                <div className="mt-3 divide-y divide-dmk-border-subtle">
                  {byCategory.map((row, i) => (
                    <div key={row.code} className="flex items-center gap-3 py-2.5">
                      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-dmk-text-muted">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[13px] font-medium text-dmk-text-primary">{catMain(row, lang)}</span>
                          <span className="dmk-badge bg-dmk-input-well font-mono text-[9.5px] text-dmk-text-muted">
                            {row.code}
                          </span>
                          <span className="text-[10.5px] text-dmk-text-muted">× {row.count}</span>
                        </div>
                        {catOthers(row, lang) && (
                          <p className="mt-0.5 truncate text-[10.5px] text-dmk-text-muted">
                            {catOthers(row, lang)}
                          </p>
                        )}
                        <div className="mt-1.5 h-1.5 rounded-full bg-dmk-input-well overflow-hidden" aria-hidden="true">
                          <div
                            className={cn("h-full rounded-full transition-[width] duration-500 ease-out", BAR_CLASSES[i % 3])}
                            style={{ width: `${barsIn ? Math.max(2, Math.min(100, row.percent)) : 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-money text-[13px] font-semibold text-dmk-text-primary">
                          {formatINR(row.total)}
                        </p>
                        <p className="text-[10.5px] text-dmk-text-muted">{row.percent}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Payment source split */}
          <div className="dmk-card p-4 sm:p-6">
            <h2 className="text-[11px] uppercase tracking-wider font-bold text-dmk-text-muted">
              {t("exp.sourceSplit")}
            </h2>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SPLIT_TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.key} className="dmk-well p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                        {t(tile.labelKey)}
                      </p>
                      <Icon className={cn("h-4 w-4 shrink-0", tile.cls)} strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <p className={cn("mt-2 font-money text-[20px] font-semibold tabular-nums", tile.cls)}>
                      {formatINR(bySource?.[tile.key] ?? 0)}
                    </p>
                    <p className="mt-1 text-[10.5px] text-dmk-text-muted">{t(tile.subKey)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Filter bar */}
          <div className="dmk-card p-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger
                  className="h-10 w-full sm:w-[210px] border-dmk-border-subtle bg-dmk-input-well text-[12.5px] text-dmk-text-primary"
                  aria-label={t("exp.allCategories")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                  <SelectItem value="ALL">{t("exp.allCategories")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="text-[12.5px]">
                        {c.code} · {catMain(c, lang)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={srcFilter} onValueChange={setSrcFilter}>
                <SelectTrigger
                  className="h-10 w-full sm:w-[170px] border-dmk-border-subtle bg-dmk-input-well text-[12.5px] text-dmk-text-primary"
                  aria-label={t("exp.allSources")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                  <SelectItem value="ALL">{t("exp.allSources")}</SelectItem>
                  <SelectItem value="CASH_DRAWER">{t("exp.cashDrawer")}</SelectItem>
                  <SelectItem value="BANK_CURRENT">{t("exp.bankUpi")}</SelectItem>
                  <SelectItem value="BANK_CC">{t("exp.bankCc")}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1 [&_input]:h-10">
                <SearchInput value={query} onChange={setQuery} placeholder={t("exp.searchPh")} />
              </div>
            </div>
          </div>

          {/* Voucher table */}
          <div className="dmk-card overflow-hidden">
            {filtered.length === 0 ? (
              <EmptyState icon={CalendarDays} title={t("exp.noData")} hint={monthLabel(month, lang)} />
            ) : (
              <>
                <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
                  <table className="dmk-table min-w-[820px]">
                    <thead>
                      <tr>
                        <th>{t("cmn.date")}</th>
                        <th>{t("exp.colVoucher")}</th>
                        <th>{t("exp.category")}</th>
                        <th>{t("exp.colPaidTo")}</th>
                        <th>{t("exp.colVehicle")}</th>
                        <th>{t("exp.colSource")}</th>
                        <th className="num text-right">{t("cmn.amount")}</th>
                        <th>{t("exp.colJournal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((v) => (
                        <tr key={v.id}>
                          <td>
                            <span className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">
                              {formatDate(v.expenseDate)}
                            </span>
                          </td>
                          <td className="font-money text-[12.5px] whitespace-nowrap">{v.voucherNumber}</td>
                          <td>
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate text-[12.5px]">{catMain(v.category, lang)}</span>
                              <span className="dmk-badge bg-dmk-input-well font-mono text-[9.5px] text-dmk-text-muted shrink-0">
                                {v.category.code}
                              </span>
                            </span>
                          </td>
                          <td className="max-w-[200px]">
                            <span className="block truncate text-[12.5px] text-dmk-text-secondary" title={v.paidTo ?? ""}>
                              {v.paidTo || "—"}
                            </span>
                          </td>
                          <td>
                            {v.vehicleNumber ? (
                              <span className="dmk-badge max-w-[150px] truncate bg-dmk-input-well text-[9.5px] text-dmk-text-secondary">
                                {v.vehicleNumber}
                              </span>
                            ) : (
                              <span className="text-[12px] text-dmk-text-disabled">—</span>
                            )}
                          </td>
                          <td>
                            <Badge tone={SOURCE_TONE[v.paymentSource] ?? "neutral"}>{v.paymentSource}</Badge>
                          </td>
                          <td className="num text-right font-money text-[13px] text-dmk-text-primary">
                            {formatINR(v.amount)}
                          </td>
                          <td>
                            <span
                              className="font-mono text-[11px] text-dmk-text-muted whitespace-nowrap"
                              title={v.journalEntry?.voucherNumber ?? ""}
                            >
                              {v.journalEntry?.voucherNumber ?? "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="dmk-well border-t border-dmk-border-subtle px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-dmk-text-muted">
                  <span>
                    {filtered.length} / {data.expenses.length} {t("exp.vouchers")}
                  </span>
                  <span className="font-money">
                    Σ {formatINR(filtered.reduce((s, v) => s + v.amount, 0))}
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
