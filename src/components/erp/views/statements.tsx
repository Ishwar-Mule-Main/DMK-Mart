"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — STATEMENTS: Trial Balance · Profit & Loss · Balance Sheet
// Coded against /ledger/trial-balance, /ledger/pnl, /ledger/balance-sheet.
// All money font-money right-aligned; Dr orange / Cr info.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { BarChart3, Download, FileSpreadsheet, RefreshCw, Scale } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

// ─── API shapes ─────────────────────────────────────────────────

interface TbRowShape {
  accountCode: string;
  accountName: string;
  accountClass: string;
  debit: number;
  credit: number;
}
interface TbResponse {
  rows: TbRowShape[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

interface PnlLine {
  code: string;
  name: string;
  amount: number;
}
interface PnlResponse {
  revenue: number;
  salesReturns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  expenses: PnlLine[];
  totalExpenses: number;
  netProfit: number;
}

interface BsRow {
  accountCode: string;
  accountName: string;
  accountGroup: string;
  amount: number;
}
interface BsResponse {
  assets: BsRow[];
  liabilities: BsRow[];
  equity: BsRow[];
  totals: { assets: number; liabilities: number; equity: number; equityPlusProfit: number; balanced: boolean };
}

const CLASS_TONE: Record<string, BadgeTone> = {
  ASSET: "info",
  LIABILITY: "warning",
  EQUITY: "dr",
  REVENUE: "success",
  EXPENSE: "danger",
};

/** FY "2025-26" → "2025-04-01" (Apr–Mar, R17). */
function fyStartISO(fy: string): string {
  const year = parseInt(fy.slice(0, 4), 10);
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  return `${y}-04-01`;
}

/** As-of date for cumulative statements: the selected FY's 31 Mar, capped at today. */
function fyAsOfISO(fy: string): string {
  const fyEnd = `${parseInt(fy.slice(0, 4), 10) + 1}-03-31`;
  const today = toISODate(new Date());
  return fyEnd < today ? fyEnd : today;
}

function VerdictBanner({ balanced, drText, crText }: { balanced: boolean; drText: string; crText: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2",
        balanced
          ? "border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)]"
          : "border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)]"
      )}
    >
      <span className={cn("text-[13px] font-semibold", balanced ? "text-dmk-success" : "text-dmk-danger")}>
        {balanced ? "Σ Dr = Σ Cr — Books Balanced ✓" : "Books do not balance — investigate before filing"}
      </span>
      <span className="text-[12px] text-dmk-text-secondary font-money">
        {drText} · {crText}
      </span>
    </div>
  );
}

export default function StatementsView() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Financial Statements"
        subtitle="Trial balance, trading account and financial position — live from posted vouchers"
        icon={FileSpreadsheet}
      />
      <Tabs defaultValue="tb" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="tb" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Scale className="h-4 w-4" /> Trial Balance
          </TabsTrigger>
          <TabsTrigger value="pnl" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <BarChart3 className="h-4 w-4" /> Profit &amp; Loss
          </TabsTrigger>
          <TabsTrigger value="bs" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Scale className="h-4 w-4" /> Balance Sheet
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tb" className="mt-0"><TrialBalanceTab /></TabsContent>
        <TabsContent value="pnl" className="mt-0"><PnlTab /></TabsContent>
        <TabsContent value="bs" className="mt-0"><BalanceSheetTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRIAL BALANCE
// ═══════════════════════════════════════════════════════════════

function TrialBalanceTab() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const financialYear = useErpStore((s) => s.financialYear);
  const { toast } = useToast();
  // Cumulative books as of the SELECTED year's 31 Mar (today for the current year)
  const [asOf, setAsOf] = React.useState(() => fyAsOfISO(financialYear || "2026-27"));
  const [data, setData] = React.useState<TbResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<TbResponse>("/api/v1/ledger/trial-balance", { firmId: activeFirmId, asOf })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load trial balance");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, asOf]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      ["Trial Balance", `As of ${asOf}`],
      ["Code", "Account", "Class", "Debit", "Credit"],
    ];
    for (const r of data.rows) {
      out.push([r.accountCode, r.accountName, r.accountClass, r.debit, r.credit]);
    }
    out.push(["", "TOTAL", "", data.totalDebit, data.totalCredit]);
    downloadCSV(`trial-balance-${asOf}.csv`, out);
    toast({ title: "Exported", description: "Trial balance downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-card p-3 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">As of Date</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={cn(inputCls, "[color-scheme:dark]")} />
        </div>
        {data && (
          <div className="flex items-center gap-4 text-[12.5px] pb-0.5">
            <span className="text-dmk-text-secondary">
              Σ Dr <span className="font-money font-semibold text-dmk-yellow">{formatINR(data.totalDebit)}</span>
            </span>
            <span className="text-dmk-text-secondary">
              Σ Cr <span className="font-money font-semibold text-dmk-info">{formatINR(data.totalCredit)}</span>
            </span>
            <Badge tone={data.balanced ? "success" : "danger"}>{data.balanced ? "BALANCED" : "OUT OF BALANCE"}</Badge>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!data || data.rows.length === 0}
          className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover sm:ml-auto"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState icon={Scale} title="No balances as of this date" hint="Post vouchers or pick a later as-of date." />
      ) : (
        <>
          <div className="dmk-card overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-420px)] overflow-y-auto">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th className="w-24">Code</th>
                    <th>Account</th>
                    <th className="hidden sm:table-cell">Class</th>
                    <th className="num text-right">Debit (₹)</th>
                    <th className="num text-right">Credit (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.accountCode}>
                      <td className="font-money text-[12.5px] text-dmk-text-secondary">{r.accountCode}</td>
                      <td className="font-medium">{r.accountName}</td>
                      <td className="hidden sm:table-cell">
                        <Badge tone={CLASS_TONE[r.accountClass] ?? "neutral"}>{r.accountClass}</Badge>
                      </td>
                      <td className="num text-right text-dmk-yellow">{r.debit ? formatINR(r.debit) : "—"}</td>
                      <td className="num text-right text-dmk-info">{r.credit ? formatINR(r.credit) : "—"}</td>
                    </tr>
                  ))}
                  <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                    <td colSpan={3} className="font-bold text-dmk-text-primary">TOTAL</td>
                    <td className="num text-right font-money font-bold text-dmk-yellow">{formatINR(data.totalDebit)}</td>
                    <td className="num text-right font-money font-bold text-dmk-info">{formatINR(data.totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <VerdictBanner
            balanced={data.balanced}
            drText={`Σ Dr ${formatINR(data.totalDebit)}`}
            crText={`Σ Cr ${formatINR(data.totalCredit)}`}
          />
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PROFIT & LOSS — vertical flow
// ═══════════════════════════════════════════════════════════════

// P&L statement row — hoisted (static component, react-compiler safe)
function PnlRow({
  label,
  amount,
  indent = 0,
  tone = "default",
  bold = false,
  muted = false,
}: {
  label: string;
  amount: number;
  indent?: number;
  tone?: "default" | "orange" | "info" | "success" | "danger";
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2",
        indent > 0 && "pl-5",
        bold && "border-t border-dmk-border-subtle pt-2.5 mt-1"
      )}
    >
      <span
        className={cn(
          "text-[13px]",
          bold ? "font-semibold text-dmk-text-primary" : muted ? "text-dmk-text-muted" : "text-dmk-text-secondary"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-money tabular-nums text-[13px]",
          tone === "orange" && "text-dmk-yellow",
          tone === "info" && "text-dmk-info",
          tone === "success" && "text-dmk-success",
          tone === "danger" && "text-dmk-danger",
          (!tone || tone === "default") && (bold ? "text-dmk-text-primary font-semibold" : "text-dmk-text-primary"),
          bold && "font-semibold"
        )}
      >
        {formatINR(amount)}
      </span>
    </div>
  );
}

function PnlTab() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const financialYear = useErpStore((s) => s.financialYear);
  const { toast } = useToast();
  // The P&L window follows the FY selected in the header (falls back to the
  // firm's default when the store hasn't hydrated) and re-anchors when the
  // selection changes. Hand-edited dates still win until the next FY switch.
  const [dateFrom, setDateFrom] = React.useState(() => fyStartISO(financialYear || "2025-26"));
  const [dateTo, setDateTo] = React.useState(() => fyAsOfISO(financialYear || "2025-26"));
  const [data, setData] = React.useState<PnlResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (financialYear) {
      setDateFrom(fyStartISO(financialYear));
      setDateTo(fyAsOfISO(financialYear));
    }
  }, [financialYear]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<PnlResponse>("/api/v1/ledger/pnl", { firmId: activeFirmId, dateFrom, dateTo })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load P&L");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, dateFrom, dateTo]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      ["Profit & Loss", `${dateFrom} → ${dateTo}`],
      ["Particulars", "Amount"],
      ["Revenue", data.revenue],
      ["Less: Sales Returns", -data.salesReturns],
      ["Net Revenue", data.netRevenue],
      ["Less: Cost of Goods Sold", -data.cogs],
      ["Gross Profit", data.grossProfit],
    ];
    for (const e of data.expenses) out.push([`  ${e.name}`, -e.amount]);
    out.push(["Total Expenses", -data.totalExpenses]);
    out.push(["Net Profit", data.netProfit]);
    downloadCSV(`pnl-${dateFrom}-to-${dateTo}.csv`, out);
    toast({ title: "Exported", description: "P&L statement downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-card p-3 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">Period From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={cn(inputCls, "[color-scheme:dark]")} />
        </div>
        <div className="w-44">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">Period To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={cn(inputCls, "[color-scheme:dark]")} />
        </div>
        <p className="text-[11px] text-dmk-text-muted pb-1 hidden sm:block">
          Defaults to the active firm&apos;s financial year (Apr–Mar, R17)
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!data}
          className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover sm:ml-auto"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={BarChart3} title="P&L unavailable" hint="Adjust the period and try again." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 lg:items-stretch">
          {/* Vertical statement */}
          <div className="dmk-card p-5 space-y-0.5">
            <div className="flex items-center justify-between pb-3 border-b border-dmk-border-subtle">
              <h2 className="text-[15px] font-bold text-dmk-text-primary">Trading &amp; Profit &amp; Loss</h2>
              <span className="text-[11.5px] text-dmk-text-muted font-money">
                {dateFrom} → {dateTo}
              </span>
            </div>
            <PnlRow label="Revenue (Sales + Other Income)" amount={data.revenue} />
            <PnlRow label="Less: Sales Returns" amount={-data.salesReturns} indent={1} tone="orange" muted />
            <PnlRow label="Net Revenue" amount={data.netRevenue} bold />
            <PnlRow label="Less: Cost of Goods Sold" amount={-data.cogs} indent={1} tone="orange" muted />

            {/* Gross profit highlight */}
            <div className="dmk-well border-[rgba(37,99,235,0.4)] px-3 py-2.5 my-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-dmk-text-primary">Gross Profit</span>
              <span className={cn("font-money text-[15px] font-bold", data.grossProfit >= 0 ? "text-dmk-info" : "text-dmk-danger")}>
                {formatINR(data.grossProfit)}
              </span>
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted pt-2">Indirect Expenses</p>
            {data.expenses.length === 0 ? (
              <p className="text-[12px] text-dmk-text-muted py-1.5">No indirect expenses booked this period.</p>
            ) : (
              data.expenses.map((e) => <PnlRow key={e.code} label={e.name} amount={-e.amount} indent={1} tone="orange" muted />)
            )}
            <PnlRow label="Total Expenses" amount={-data.totalExpenses} bold tone="orange" />
          </div>

          {/* Net profit card */}
          <div className="dmk-elevated p-6 flex flex-col items-center justify-center gap-3">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Net Profit</span>
            <span
              className={cn(
                "font-money text-[30px] font-bold leading-none tabular-nums",
                data.netProfit > 0.005 ? "text-dmk-success" : data.netProfit < -0.005 ? "text-dmk-danger" : "text-dmk-text-primary"
              )}
            >
              {formatINR(data.netProfit)}
            </span>
            <Badge tone={data.netProfit > 0.005 ? "success" : data.netProfit < -0.005 ? "danger" : "neutral"}>
              {data.netProfit > 0.005 ? "PROFITABLE PERIOD" : data.netProfit < -0.005 ? "LOSS-MAKING PERIOD" : "BREAK-EVEN"}
            </Badge>
            <div className="w-full space-y-1.5 mt-2 text-[11.5px]">
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Gross margin</span>
                <span className="font-money text-dmk-text-secondary">
                  {data.netRevenue !== 0 ? `${((data.grossProfit / data.netRevenue) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Net margin</span>
                <span className="font-money text-dmk-text-secondary">
                  {data.netRevenue !== 0 ? `${((data.netProfit / data.netRevenue) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BALANCE SHEET — Assets | Liabilities + Equity
// ═══════════════════════════════════════════════════════════════

// Balance-sheet section card — hoisted (static component, react-compiler safe)
function BsSection({ title, rows, total, tone, className }: { title: string; rows: BsRow[]; total: number; tone: string; className?: string }) {
  return (
    <div className={cn("dmk-card p-4", className)}>
      <h3 className="text-[13px] font-bold uppercase tracking-wider text-dmk-text-secondary pb-2.5 border-b border-dmk-border-subtle">
        {title}
      </h3>
      <div className="divide-y divide-dmk-border-subtle/60">
        {rows.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted py-3">No balances.</p>
        ) : (
          rows.map((r) => (
            <div key={r.accountCode} className="flex items-center justify-between gap-3 py-2">
              <span className="text-[13px] text-dmk-text-secondary truncate">
                {r.accountName}
                <span className="text-[10.5px] text-dmk-text-muted ml-2 hidden sm:inline">{r.accountGroup}</span>
              </span>
              <span className="font-money text-[13px] text-dmk-text-primary tabular-nums shrink-0">
                {formatINR(r.amount)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between gap-3 pt-2.5 mt-1 border-t border-dmk-border-medium">
        <span className="text-[13px] font-semibold text-dmk-text-primary">Total {title}</span>
        <span className={cn("font-money text-[14px] font-bold tabular-nums", tone)}>{formatINR(total)}</span>
      </div>
    </div>
  );
}

function BalanceSheetTab() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const financialYearBS = useErpStore((s) => s.financialYear);
  const { toast } = useToast();
  const [asOf, setAsOf] = React.useState(() => fyAsOfISO(financialYearBS || "2026-27"));
  const [data, setData] = React.useState<BsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<BsResponse>("/api/v1/ledger/balance-sheet", { firmId: activeFirmId, asOf })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load balance sheet");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, asOf, refreshKey]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      ["Balance Sheet", `As of ${asOf}`],
      [],
      ["ASSETS", "Amount"],
    ];
    for (const r of data.assets) out.push([r.accountName, r.amount]);
    out.push(["Total Assets", data.totals.assets], []);
    out.push(["LIABILITIES", "Amount"]);
    for (const r of data.liabilities) out.push([r.accountName, r.amount]);
    out.push(["Total Liabilities", data.totals.liabilities], []);
    out.push(["EQUITY", "Amount"]);
    for (const r of data.equity) out.push([r.accountName, r.amount]);
    out.push(["Total Equity", data.totals.equity]);
    out.push(["Liabilities + Equity", data.totals.equityPlusProfit]);
    downloadCSV(`balance-sheet-${asOf}.csv`, out);
    toast({ title: "Exported", description: "Balance sheet downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-card p-3 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">As of Date</label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={cn(inputCls, "[color-scheme:dark]")} />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!data}
          className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover sm:ml-auto"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={Scale} title="Balance sheet unavailable" hint="Adjust the as-of date and try again." />
      ) : (
        <>
          {/* Two-column responsive: stacks on mobile · stretches level on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-stretch">
            <BsSection title="Assets" rows={data.assets} total={data.totals.assets} tone="text-dmk-yellow" />
            <div className="flex flex-col gap-4">
              <BsSection title="Liabilities" rows={data.liabilities} total={data.totals.liabilities} tone="text-dmk-info" />
              <BsSection title="Equity" rows={data.equity} total={data.totals.equity} tone="text-dmk-success" className="lg:flex-1" />
            </div>
          </div>

          <div className="dmk-well p-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className="text-dmk-text-secondary">
              Assets <span className="font-money font-semibold text-dmk-yellow">{formatINR(data.totals.assets)}</span>
              <span className="mx-2 text-dmk-text-muted">=</span>
              Liabilities + Equity{" "}
              <span className="font-money font-semibold text-dmk-info">{formatINR(data.totals.equityPlusProfit)}</span>
            </span>
            <span className="text-dmk-text-muted">
              (incl. Current Period Profit {formatINR(data.totals.equity)})
            </span>
          </div>

          <VerdictBanner
            balanced={data.totals.balanced}
            drText={`Assets ${formatINR(data.totals.assets)}`}
            crText={`L + E ${formatINR(data.totals.equityPlusProfit)}`}
          />
        </>
      )}
    </div>
  );
}
