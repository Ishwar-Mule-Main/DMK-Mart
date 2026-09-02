"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — RECEIVABLES / PAYABLES AGING (R13 credit control)
// Oldest-first bucket allocation from /ledger/aging (AR | AP).
// Buckets: 0-30 (blue) · 31-60 (warning) · 61-90 (gold) · 90+ (danger)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Download, Hourglass, Package, ReceiptText, RefreshCw, Scale, ShieldAlert } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { InvoiceAgingResponse, OpenInvoiceRow, PoAgingResponse, OpenPurchaseOrderRow } from "@/types/erp";

interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface AgingRowShape {
  partyId: string;
  partyName: string;
  stateCode: string;
  balance: number;
  buckets: AgingBuckets;
  oldestDocDate: string | null;
  oldestDocNo: string;
}

interface AgingResponse {
  type: "AR" | "AP";
  rows: AgingRowShape[];
  totals: AgingBuckets & { total: number };
}

const BUCKETS: Array<{ key: keyof AgingBuckets; label: string; cls: string }> = [
  { key: "d0_30", label: "0–30 days", cls: "text-dmk-blue" },
  { key: "d31_60", label: "31–60 days", cls: "text-dmk-warning" },
  { key: "d61_90", label: "61–90 days", cls: "text-dmk-gold" },
  { key: "d90plus", label: "90+ days", cls: "text-dmk-danger" },
];

export default function AgingView() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Receivables & Payables Aging"
        subtitle="Outstanding balances bucketed by document age — party summary, precise invoice-wise AR and PO-wise AP"
        icon={Hourglass}
      />
      <Tabs defaultValue="ar" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="ar" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            Receivables (AR)
          </TabsTrigger>
          <TabsTrigger value="inv" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <ReceiptText className="h-3.5 w-3.5 mr-1.5" />
            Invoice-wise (precise)
          </TabsTrigger>
          <TabsTrigger value="ap" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            Payables (AP)
          </TabsTrigger>
          <TabsTrigger value="po" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            PO-wise (precise)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ar" className="mt-0"><AgingTab type="AR" /></TabsContent>
        <TabsContent value="inv" className="mt-0"><InvoiceAgingTab /></TabsContent>
        <TabsContent value="ap" className="mt-0"><AgingTab type="AP" /></TabsContent>
        <TabsContent value="po" className="mt-0"><PoAgingTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function AgingTab({ type }: { type: "AR" | "AP" }) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [data, setData] = React.useState<AgingResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<AgingResponse>("/api/v1/ledger/aging", { firmId: activeFirmId, type, asOf: new Date().toISOString().slice(0, 10) })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : `Failed to load ${type} aging`);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, type, refreshKey]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      [`${type === "AR" ? "Receivables" : "Payables"} Aging`, `As of ${new Date().toISOString().slice(0, 10)}`],
      ["Party", "State", "0-30", "31-60", "61-90", "90+", "Total", "Oldest Doc", "Oldest Doc Date"],
    ];
    for (const r of data.rows) {
      out.push([
        r.partyName,
        r.stateCode,
        r.buckets.d0_30,
        r.buckets.d31_60,
        r.buckets.d61_90,
        r.buckets.d90plus,
        r.balance,
        r.oldestDocNo,
        r.oldestDocDate ? r.oldestDocDate.slice(0, 10) : "",
      ]);
    }
    out.push([
      "TOTAL",
      "",
      data.totals.d0_30,
      data.totals.d31_60,
      data.totals.d61_90,
      data.totals.d90plus,
      data.totals.total,
      "",
      "",
    ]);
    downloadCSV(`aging-${type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: "Exported", description: `${type} aging downloaded as CSV.` });
  }

  const isAR = type === "AR";

  return (
    <div className="space-y-4">
      {/* Credit-control note (R13) */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-dmk-warning mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Credit control:</span>{" "}
          blocks B2B sales when overdue + limit exceeded — parties sitting in the 90+ bucket are
          auto-locked at billing. {isAR ? "Aged against posted credit invoices." : "Aged against confirmed purchase orders."}
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={Hourglass} title="Aging unavailable" hint="Refresh once the firm data is loaded." />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={Hourglass}
          title={isAR ? "No receivables outstanding" : "No payables outstanding"}
          hint={isAR ? "Every customer is fully settled — nice." : "All vendor dues are cleared."}
        />
      ) : (
        <>
          {/* Bucket summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {BUCKETS.map((b) => (
              <div key={b.key} className="dmk-kpi p-4">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{b.label}</span>
                <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", b.cls)}>
                  {formatINR(data.totals[b.key])}
                </span>
                <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                  {data.totals.total > 0 ? `${((data.totals[b.key] / data.totals.total) * 100).toFixed(0)}% of total` : "—"}
                </span>
              </div>
            ))}
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">
                {isAR ? "Total Receivable" : "Total Payable"}
              </span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {formatINR(data.totals.total)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {data.rows.length} part{data.rows.length !== 1 ? "ies" : "y"}
              </span>
            </div>
          </div>

          {/* Aging table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
              <span className="text-[12px] text-dmk-text-muted">
                Rows highlighted in red carry 90+ day balances
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
            <div className="overflow-x-auto max-h-[calc(100vh-520px)] overflow-y-auto">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="num text-right">0–30 (₹)</th>
                    <th className="num text-right">31–60 (₹)</th>
                    <th className="num text-right">61–90 (₹)</th>
                    <th className="num text-right">90+ (₹)</th>
                    <th className="num text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const severe = r.buckets.d90plus > 0.005;
                    return (
                      <tr key={r.partyId} className={cn(severe && "bg-[rgba(239,68,68,0.05)]")}>
                        <td className="min-w-[220px]">
                          <div className="flex items-center gap-2">
                            {severe && <span className="h-1.5 w-1.5 rounded-full bg-dmk-danger shrink-0" aria-label="90+ overdue" />}
                            <div className="min-w-0">
                              <p className={cn("text-[13px] font-medium truncate", severe ? "text-dmk-danger" : "text-dmk-text-primary")}>
                                {r.partyName}
                              </p>
                              <p className="text-[10.5px] text-dmk-text-muted truncate">
                                State {r.stateCode || "—"}
                                {r.oldestDocNo && ` · oldest ${r.oldestDocNo}`}
                                {r.oldestDocDate && ` (${formatDate(r.oldestDocDate)})`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="num text-right text-dmk-blue">{r.buckets.d0_30 ? formatINR(r.buckets.d0_30) : "—"}</td>
                        <td className="num text-right text-dmk-warning">{r.buckets.d31_60 ? formatINR(r.buckets.d31_60) : "—"}</td>
                        <td className="num text-right text-dmk-gold">{r.buckets.d61_90 ? formatINR(r.buckets.d61_90) : "—"}</td>
                        <td className={cn("num text-right", severe ? "font-bold" : "")}>
                          <span className={severe ? "text-dmk-danger" : "text-dmk-text-muted"}>
                            {r.buckets.d90plus ? formatINR(r.buckets.d90plus) : "—"}
                          </span>
                        </td>
                        <td className="num text-right font-money font-semibold text-dmk-text-primary">
                          {formatINR(r.balance)}
                          {severe && (
                            <span className="ml-2">
                              <Badge tone="danger">90+</Badge>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                    <td className="font-bold text-dmk-text-primary">TOTAL</td>
                    <td className="num text-right font-money font-bold text-dmk-blue">{formatINR(data.totals.d0_30)}</td>
                    <td className="num text-right font-money font-bold text-dmk-warning">{formatINR(data.totals.d31_60)}</td>
                    <td className="num text-right font-money font-bold text-dmk-gold">{formatINR(data.totals.d61_90)}</td>
                    <td className="num text-right font-money font-bold text-dmk-danger">{formatINR(data.totals.d90plus)}</td>
                    <td className="num text-right font-money font-bold text-dmk-text-primary">{formatINR(data.totals.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-8 gap-1.5 text-[12px] text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Recalculate as of today
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Invoice-wise AR aging — precise outstanding per credit invoice
// (receipt allocations + credit notes, not balance approximation)
// ═══════════════════════════════════════════════════════════════

function invoiceBucketTone(bucket: OpenInvoiceRow["bucket"]): "info" | "warning" | "gold" | "danger" {
  if (bucket === "0-30") return "info";
  if (bucket === "31-60") return "warning";
  if (bucket === "61-90") return "gold";
  return "danger";
}

function InvoiceAgingTab() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [data, setData] = React.useState<InvoiceAgingResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [partyFilter, setPartyFilter] = React.useState("all");
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<InvoiceAgingResponse>("/api/v1/ledger/aging-invoices", {
      firmId: activeFirmId,
      customerId: partyFilter === "all" ? undefined : partyFilter,
      asOf: new Date().toISOString().slice(0, 10),
    })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load invoice aging");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, partyFilter, refreshKey]);

  const visibleRows = React.useMemo(() => {
    if (!data) return [];
    // When a party filter is applied the API already narrows rows.
    return data.rows;
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      ["Invoice-wise Receivables Aging (precise)", `As of ${data.asOf.slice(0, 10)}`],
      ["Invoice #", "Party", "Invoice Date", "Age (days)", "Bucket", "Due Date", "Overdue (days)", "Grand Total", "Settled", "Credit Notes", "Outstanding"],
    ];
    for (const r of visibleRows) {
      out.push([
        r.invoiceNumber,
        r.partyName,
        r.invoiceDate.slice(0, 10),
        r.ageDays,
        r.bucket,
        r.dueDate.slice(0, 10),
        r.overdueDays,
        r.grandTotal,
        r.settled,
        r.credited,
        r.outstanding,
      ]);
    }
    out.push([
      "TOTAL",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      data.totals.outstanding,
    ]);
    downloadCSV(`aging-invoices-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: "Exported", description: "Invoice-wise aging downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ReceiptText className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Precise mode:</span> each credit invoice&apos;s outstanding =
          grand total − receipt allocations − credit notes. Receipts settled against invoices (from the Receipts module) age
          by <span className="italic">invoice date</span>, not as a party-balance approximation. Overdue flags use each
          customer&apos;s credit days (R13).
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={ReceiptText} title="Invoice aging unavailable" hint="Refresh once the firm data is loaded." />
      ) : (
        <>
          {/* KPI cards */}
          <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Open Invoices</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {data.totals.openInvoices}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                outstanding {formatINR(data.totals.outstanding)}
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Overdue</span>
              <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", data.totals.overdue > 0.009 ? "text-dmk-danger" : "text-dmk-success")}>
                {formatINR(data.totals.overdue)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {data.totals.overdueInvoices} invoice{data.totals.overdueInvoices !== 1 ? "s" : ""} past credit days
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Current (0–30d)</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-blue">
                {formatINR(data.totals.buckets.d0_30)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                healthy portion of the book
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">90+ Days</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-danger">
                {formatINR(data.totals.buckets.d90plus)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                collection-risk tail
              </span>
            </div>
          </div>

          {/* AR subledger reconciliation strip */}
          {data.reconciliation && (
            <div className="dmk-card px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex items-center gap-2 shrink-0">
                <Scale className="h-4 w-4 text-dmk-gold" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Subledger reconciliation</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-dmk-text-secondary font-money">
                <span>Open invoices <b className="text-dmk-text-primary">{formatINR(data.reconciliation.openInvoices)}</b></span>
                <span className="text-dmk-text-muted">−</span>
                <span>unapplied receipts <b className="text-dmk-info">{formatINR(data.reconciliation.unappliedReceipts)}</b></span>
                <span className="text-dmk-text-muted">+</span>
                <span>party openings <b className="text-dmk-text-secondary">{formatINR(data.reconciliation.openingBalances)}</b></span>
                <span className="text-dmk-text-muted">=</span>
                <span>GL receivables <b className="text-dmk-orange">{formatINR(data.reconciliation.glReceivables)}</b></span>
                {Math.abs(data.reconciliation.difference) <= 0.01 ? (
                  <Badge tone="success">RECONCILED ✓</Badge>
                ) : (
                  <Badge tone="warning">Δ {formatINR(data.reconciliation.difference)}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Party rollup strip */}
          {data.parties.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted mr-1">By party:</span>
              {data.parties.slice(0, 6).map((p) => (
                <span
                  key={p.customerId || p.partyName}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 text-[11px]"
                  title={`${p.invoiceCount} open invoice(s) · oldest ${p.oldestInvoiceNo || "—"}`}
                >
                  <span className="text-dmk-text-secondary max-w-[180px] truncate">{p.partyName}</span>
                  <span className="font-money font-semibold text-dmk-orange">{formatINR(p.outstanding)}</span>
                  {!!p.unapplied && p.unapplied > 0.009 && (
                    <span className="font-money text-[10px] text-dmk-info" title="Unapplied on-account receipts">−{formatINR(p.unapplied)} unapplied</span>
                  )}
                </span>
              ))}
              {data.parties.length > 6 && (
                <span className="text-[10.5px] text-dmk-text-muted">+{data.parties.length - 6} more</span>
              )}
            </div>
          )}

          {/* Controls + table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
              <Select value={partyFilter} onValueChange={setPartyFilter}>
                <SelectTrigger className="h-8 w-full sm:w-72 bg-dmk-input-well border-dmk-border-subtle text-[12px] text-dmk-text-secondary">
                  <SelectValue placeholder="All parties" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All parties</SelectItem>
                  {data.parties.map((p) => (
                    <SelectItem key={p.customerId || p.partyName} value={p.customerId || p.partyName}>
                      {p.partyName} — {formatINR(p.outstanding)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-dmk-text-muted hidden md:inline">
                  Sorted oldest first · overdue highlighted
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  disabled={visibleRows.length === 0}
                  className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto min-h-[240px] max-h-[calc(100vh-420px)] overflow-y-auto">
              {visibleRows.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title={partyFilter === "all" ? "No open credit invoices" : "No open invoices for this party"}
                  hint="Every credit invoice is fully settled via receipts or credit notes."
                />
              ) : (
                <table className="dmk-table min-w-[860px]">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Party</th>
                      <th>Age</th>
                      <th>Due</th>
                      <th className="num text-right">Outstanding (₹)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => {
                      const severe = r.bucket === "90+";
                      const partial = r.settled > 0.009 || r.credited > 0.009;
                      return (
                        <tr key={r.invoiceId} className={cn(r.isOverdue && "bg-[rgba(239,68,68,0.04)]")}>
                          <td>
                            <div className="flex items-center gap-2">
                              {severe && <span className="h-1.5 w-1.5 rounded-full bg-dmk-danger shrink-0" aria-label="90+ days old" />}
                              <div className="min-w-0">
                                <p className="font-money text-[12px] font-semibold text-dmk-text-primary">{r.invoiceNumber}</p>
                                <p className="text-[10.5px] text-dmk-text-muted">
                                  {formatDate(r.invoiceDate)} · {formatINR(r.grandTotal)} billed
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-[220px]">
                            <p className="text-[13px] font-medium text-dmk-text-primary truncate">{r.partyName}</p>
                            {partial && (
                              <p className="text-[10.5px] text-dmk-text-muted">
                                {r.settled > 0.009 && <>receipts {formatINR(r.settled)} </>}
                                {r.credited > 0.009 && <>· credit note {formatINR(r.credited)}</>}
                              </p>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Badge tone={invoiceBucketTone(r.bucket)}>{r.bucket}</Badge>
                              <span className="text-[11px] text-dmk-text-muted font-money tabular-nums">{r.ageDays}d</span>
                            </div>
                          </td>
                          <td className="text-[11.5px] text-dmk-text-secondary whitespace-nowrap">
                            {formatDate(r.dueDate)}
                            <span className="text-[10.5px] text-dmk-text-muted ml-1.5">({r.creditDays}d terms)</span>
                          </td>
                          <td className="num text-right font-money font-semibold text-dmk-text-primary">
                            {formatINR(r.outstanding)}
                          </td>
                          <td>
                            {r.isOverdue ? (
                              <Badge tone="danger">OVERDUE {r.overdueDays}d</Badge>
                            ) : (
                              <Badge tone="success">WITHIN TERMS</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                      <td className="font-bold text-dmk-text-primary" colSpan={4}>
                        TOTAL — {visibleRows.length} open invoice{visibleRows.length !== 1 ? "s" : ""}
                      </td>
                      <td className="num text-right font-money font-bold text-dmk-text-primary">
                        {formatINR(visibleRows.reduce((s, r) => s + r.outstanding, 0))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-8 gap-1.5 text-[12px] text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Recalculate as of today
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PO-wise AP aging — precise outstanding per CONFIRMED purchase
// order (payment allocations + debit notes, not approximation).
// ═══════════════════════════════════════════════════════════════

function poBucketTone(bucket: OpenPurchaseOrderRow["bucket"]): "info" | "warning" | "gold" | "danger" {
  if (bucket === "0-30") return "info";
  if (bucket === "31-60") return "warning";
  if (bucket === "61-90") return "gold";
  return "danger";
}

function PoAgingTab() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [data, setData] = React.useState<PoAgingResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = React.useState("all");
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<PoAgingResponse>("/api/v1/ledger/aging-pos", {
      firmId: activeFirmId,
      vendorId: vendorFilter === "all" ? undefined : vendorFilter,
      asOf: new Date().toISOString().slice(0, 10),
    })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load PO aging");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, vendorFilter, refreshKey]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      ["PO-wise Payables Aging (precise)", `As of ${data.asOf.slice(0, 10)}`],
      ["PO #", "Vendor", "PO Date", "Age (days)", "Bucket", "Due Date", "Overdue (days)", "Grand Total", "Payments", "Debit Notes", "Outstanding"],
    ];
    for (const r of data.rows) {
      out.push([
        r.poNumber,
        r.vendorName,
        r.poDate.slice(0, 10),
        r.ageDays,
        r.bucket,
        r.dueDate.slice(0, 10),
        r.overdueDays,
        r.grandTotal,
        r.settled,
        r.credited,
        r.outstanding,
      ]);
    }
    out.push(["TOTAL", "", "", "", "", "", "", "", "", "", data.totals.outstanding]);
    downloadCSV(`aging-pos-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: "Exported", description: "PO-wise aging downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <Package className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Precise mode:</span> each CONFIRMED purchase order&apos;s
          outstanding = grand total − payment allocations − debit notes. Payments settled against bills (from the Vendor
          Payments module) age by <span className="italic">PO date</span>, not as a party-balance approximation. Overdue
          flags use each vendor&apos;s payment terms.
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={Package} title="PO aging unavailable" hint="Refresh once the firm data is loaded." />
      ) : (
        <>
          {/* KPI cards */}
          <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Open Bills</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {data.totals.openPOs}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                outstanding {formatINR(data.totals.outstanding)}
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Overdue</span>
              <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", data.totals.overdue > 0.009 ? "text-dmk-danger" : "text-dmk-success")}>
                {formatINR(data.totals.overdue)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {data.totals.overduePOs} bill{data.totals.overduePOs !== 1 ? "s" : ""} past payment terms
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">Current (0–30d)</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-blue">
                {formatINR(data.totals.buckets.d0_30)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                healthy portion of payables
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">90+ Days</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-danger">
                {formatINR(data.totals.buckets.d90plus)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                relationship-risk tail
              </span>
            </div>
          </div>

          {/* AP subledger reconciliation strip */}
          {data.reconciliation && (
            <div className="dmk-card px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex items-center gap-2 shrink-0">
                <Scale className="h-4 w-4 text-dmk-gold" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Subledger reconciliation</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-dmk-text-secondary font-money">
                <span>Open bills <b className="text-dmk-text-primary">{formatINR(data.reconciliation.openPOs)}</b></span>
                <span className="text-dmk-text-muted">−</span>
                <span>unapplied payments <b className="text-dmk-info">{formatINR(data.reconciliation.unappliedPayments)}</b></span>
                <span className="text-dmk-text-muted">+</span>
                <span>vendor openings <b className="text-dmk-text-secondary">{formatINR(data.reconciliation.openingBalances)}</b></span>
                <span className="text-dmk-text-muted">−</span>
                <span>standalone debit notes <b className="text-dmk-warning">{formatINR(data.reconciliation.standaloneDebitNotes)}</b></span>
                <span className="text-dmk-text-muted">=</span>
                <span>GL payables <b className="text-dmk-orange">{formatINR(data.reconciliation.glPayables)}</b></span>
                {Math.abs(data.reconciliation.difference) <= 0.01 ? (
                  <Badge tone="success">RECONCILED ✓</Badge>
                ) : (
                  <Badge tone="warning">Δ {formatINR(data.reconciliation.difference)}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Vendor rollup strip */}
          {data.vendors.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted mr-1">By vendor:</span>
              {data.vendors.slice(0, 6).map((v) => (
                <span
                  key={v.vendorId}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 text-[11px]"
                  title={`${v.poCount} open bill(s) · oldest ${v.oldestPoNo || "—"}`}
                >
                  <span className="text-dmk-text-secondary max-w-[180px] truncate">{v.vendorName}</span>
                  <span className="font-money font-semibold text-dmk-orange">{formatINR(v.outstanding)}</span>
                  {!!v.unapplied && v.unapplied > 0.009 && (
                    <span className="font-money text-[10px] text-dmk-info" title="Unapplied on-account payments">−{formatINR(v.unapplied)} unapplied</span>
                  )}
                </span>
              ))}
              {data.vendors.length > 6 && (
                <span className="text-[10.5px] text-dmk-text-muted">+{data.vendors.length - 6} more</span>
              )}
            </div>
          )}

          {/* Controls + table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger className="h-8 w-full sm:w-72 bg-dmk-input-well border-dmk-border-subtle text-[12px] text-dmk-text-secondary">
                  <SelectValue placeholder="All vendors" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">All vendors</SelectItem>
                  {data.vendors.map((v) => (
                    <SelectItem key={v.vendorId} value={v.vendorId}>
                      {v.vendorName} — {formatINR(v.outstanding)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-dmk-text-muted hidden md:inline">
                  Sorted oldest first · overdue highlighted
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCsv}
                  disabled={data.rows.length === 0}
                  className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto min-h-[240px] max-h-[calc(100vh-420px)] overflow-y-auto">
              {data.rows.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={vendorFilter === "all" ? "No open purchase orders" : "No open bills for this vendor"}
                  hint="Every CONFIRMED bill is fully settled via payments or debit notes."
                />
              ) : (
                <table className="dmk-table min-w-[860px]">
                  <thead>
                    <tr>
                      <th>Bill / PO</th>
                      <th>Vendor</th>
                      <th>Age</th>
                      <th>Due</th>
                      <th className="num text-right">Outstanding (₹)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const severe = r.bucket === "90+";
                      const partial = r.settled > 0.009 || r.credited > 0.009;
                      return (
                        <tr key={r.poId} className={cn(r.isOverdue && "bg-[rgba(239,68,68,0.04)]")}>
                          <td>
                            <div className="flex items-center gap-2">
                              {severe && <span className="h-1.5 w-1.5 rounded-full bg-dmk-danger shrink-0" aria-label="90+ days old" />}
                              <div className="min-w-0">
                                <p className="font-money text-[12px] font-semibold text-dmk-text-primary">{r.poNumber}</p>
                                <p className="text-[10.5px] text-dmk-text-muted">
                                  {formatDate(r.poDate)} · {formatINR(r.grandTotal)} billed
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-[220px]">
                            <p className="text-[13px] font-medium text-dmk-text-primary truncate">{r.vendorName}</p>
                            {partial && (
                              <p className="text-[10.5px] text-dmk-text-muted">
                                {r.settled > 0.009 && <>payments {formatINR(r.settled)} </>}
                                {r.credited > 0.009 && <>· debit note {formatINR(r.credited)}</>}
                              </p>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Badge tone={poBucketTone(r.bucket)}>{r.bucket}</Badge>
                              <span className="text-[11px] text-dmk-text-muted font-money tabular-nums">{r.ageDays}d</span>
                            </div>
                          </td>
                          <td className="text-[11.5px] text-dmk-text-secondary whitespace-nowrap">
                            {formatDate(r.dueDate)}
                            <span className="text-[10.5px] text-dmk-text-muted ml-1.5">({r.paymentDays}d terms)</span>
                          </td>
                          <td className="num text-right font-money font-semibold text-dmk-text-primary">
                            {formatINR(r.outstanding)}
                          </td>
                          <td>
                            {r.isOverdue ? (
                              <Badge tone="danger">OVERDUE {r.overdueDays}d</Badge>
                            ) : (
                              <Badge tone="success">WITHIN TERMS</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                      <td className="font-bold text-dmk-text-primary" colSpan={4}>
                        TOTAL — {data.rows.length} open bill{data.rows.length !== 1 ? "s" : ""}
                      </td>
                      <td className="num text-right font-money font-bold text-dmk-text-primary">
                        {formatINR(data.rows.reduce((s, r) => s + r.outstanding, 0))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-8 gap-1.5 text-[12px] text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Recalculate as of today
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
