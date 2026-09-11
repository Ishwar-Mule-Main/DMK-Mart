"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — RECEIVABLES / PAYABLES AGING (R13 credit control)
// Oldest-first bucket allocation from /ledger/aging (AR | AP).
// Buckets: 0-30 (blue) · 31-60 (warning) · 61-90 (gold) · 90+ (danger)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { ArrowUpRight, Download, Hourglass, Package, ReceiptText, RefreshCw, Scale, ShieldAlert } from "lucide-react";

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
import { useT, type TFn } from "@/lib/i18n";
import { useErpStore } from "@/store/erp-store";
import { consumePendingAgingTab, requestLedgerParty } from "@/lib/settle-bus";
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

/** Aging buckets — display labels come from the dict (keys are API field names). */
function buckets(t: TFn): Array<{ key: keyof AgingBuckets; label: string; cls: string }> {
  return [
    { key: "d0_30", label: t("aging.b0_30"), cls: "text-dmk-blue" },
    { key: "d31_60", label: t("aging.b31_60"), cls: "text-dmk-warning" },
    { key: "d61_90", label: t("aging.b61_90"), cls: "text-dmk-gold" },
    { key: "d90plus", label: t("aging.b90plus"), cls: "text-dmk-danger" },
  ];
}

/** Party name → deep link into the preselected party ledger statement. */
function PartyLink({
  partyType,
  partyId,
  name,
  className,
}: {
  partyType: "CUSTOMER" | "VENDOR";
  partyId: string | null;
  name: string;
  className?: string;
}) {
  const setView = useErpStore((s) => s.setView);
  const { t } = useT();
  if (!partyId) return <span className={className}>{name}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        requestLedgerParty(partyType, partyId);
        setView("finance/ledgers");
      }}
      title={t("aging.openLedger", { party: name })}
      className={cn(
        "group/party inline-flex items-center gap-0.5 rounded text-left transition-colors",
        "hover:text-dmk-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60",
        className
      )}
    >
      <span className="truncate">{name}</span>
      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover/party:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

const AGING_TABS = ["ar", "inv", "ap", "po"] as const;

type AgingTabId = (typeof AGING_TABS)[number];

export default function AgingView() {
  const { t } = useT();
  // Controlled tabs so other views (dashboard pulses, ⌘K) can preset the tab.
  const [tab, setTab] = React.useState<AgingTabId>("ar");

  React.useEffect(() => {
    const pending = consumePendingAgingTab();
    if (pending && (AGING_TABS as readonly string[]).includes(pending)) {
      setTab(pending as AgingTabId);
    }
    const onPreset = (e: Event) => {
      const tabId = (e as CustomEvent<{ tab: string }>).detail?.tab;
      if (tabId && (AGING_TABS as readonly string[]).includes(tabId)) setTab(tabId as AgingTabId);
    };
    window.addEventListener("dmk:aging-tab", onPreset);
    return () => window.removeEventListener("dmk:aging-tab", onPreset);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("aging.title")}
        subtitle={t("aging.subtitle")}
        icon={Hourglass}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as AgingTabId)} className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="ar" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            {t("aging.tabAr")}
          </TabsTrigger>
          <TabsTrigger value="inv" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <ReceiptText className="h-3.5 w-3.5 mr-1.5" />
            {t("aging.tabInv")}
          </TabsTrigger>
          <TabsTrigger value="ap" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            {t("aging.tabAp")}
          </TabsTrigger>
          <TabsTrigger value="po" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Package className="h-3.5 w-3.5 mr-1.5" />
            {t("aging.tabPo")}
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
  const { t } = useT();
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
          setError(e instanceof Error ? e.message : t(type === "AR" ? "aging.errAr" : "aging.errAp"));
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
      [t(type === "AR" ? "aging.csvArTitle" : "aging.csvApTitle"), t("aging.asOf", { date: new Date().toISOString().slice(0, 10) })],
      [t("aging.colParty"), t("aging.csvState"), "0-30", "31-60", "61-90", "90+", t("cmn.total"), t("aging.csvOldestDoc"), t("aging.csvOldestDocDate")],
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
      t("aging.totalRow"),
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
    toast({ title: t("jrnl.toastExported"), description: t(type === "AR" ? "aging.toastCsvAr" : "aging.toastCsvAp") });
  }

  const isAR = type === "AR";

  return (
    <div className="space-y-4">
      {/* Credit-control note (R13) */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-dmk-warning mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">{t("aging.creditControl")}</span>{" "}
          {t("aging.creditControlBody")} {isAR ? t("aging.agedInvoices") : t("aging.agedPos")}
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={Hourglass} title={t("aging.unavailable")} hint={t("aging.refreshHint")} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={Hourglass}
          title={isAR ? t("aging.noAr") : t("aging.noAp")}
          hint={isAR ? t("aging.noArHint") : t("aging.noApHint")}
        />
      ) : (
        <>
          {/* Bucket summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {buckets(t).map((b) => (
              <div key={b.key} className="dmk-kpi p-4">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{b.label}</span>
                <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", b.cls)}>
                  {formatINR(data.totals[b.key])}
                </span>
                <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                  {data.totals.total > 0 ? t("aging.pctOfTotal", { pct: ((data.totals[b.key] / data.totals.total) * 100).toFixed(0) }) : "—"}
                </span>
              </div>
            ))}
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">
                {isAR ? t("aging.totalAr") : t("aging.totalAp")}
              </span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {formatINR(data.totals.total)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {t("aging.partyCount", { n: data.rows.length })}
              </span>
            </div>
          </div>

          {/* Aging table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
              <span className="text-[12px] text-dmk-text-muted">
                {t("aging.redRows")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
              >
                <Download className="h-3.5 w-3.5" /> {t("jrnl.exportCsv")}
              </Button>
            </div>
            <div className="overflow-x-auto max-h-[calc(100vh-520px)] overflow-y-auto">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th>{t("aging.colParty")}</th>
                    <th className="num text-right">{t("aging.col0_30")}</th>
                    <th className="num text-right">{t("aging.col31_60")}</th>
                    <th className="num text-right">{t("aging.col61_90")}</th>
                    <th className="num text-right">{t("aging.col90plus")}</th>
                    <th className="num text-right">{t("aging.colTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const severe = r.buckets.d90plus > 0.005;
                    return (
                      <tr key={r.partyId} className={cn(severe && "bg-[rgba(239,68,68,0.05)]")}>
                        <td className="min-w-[220px]">
                          <div className="flex items-center gap-2">
                            {severe && <span className="h-1.5 w-1.5 rounded-full bg-dmk-danger shrink-0" aria-label={t("aging.aria90")} />}
                            <div className="min-w-0">
                              <PartyLink
                                partyType={isAR ? "CUSTOMER" : "VENDOR"}
                                partyId={r.partyId}
                                name={r.partyName}
                                className={cn("text-[13px] font-medium max-w-[220px]", severe ? "text-dmk-danger hover:text-dmk-blue" : "text-dmk-text-primary")}
                              />
                              <p className="text-[10.5px] text-dmk-text-muted truncate">
                                {t("aging.stateLabel", { code: r.stateCode || "—" })}
                                {r.oldestDocNo && t("aging.oldestPart", { doc: r.oldestDocNo })}
                                {r.oldestDocDate && t("aging.datePart", { date: formatDate(r.oldestDocDate) })}
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
                    <td className="font-bold text-dmk-text-primary">{t("aging.totalRow")}</td>
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
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {t("aging.recalc")}
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
  const { t } = useT();
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
          setError(e instanceof Error ? e.message : t("aging.errInv"));
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
      [t("aging.csvInvTitle"), t("aging.asOf", { date: data.asOf.slice(0, 10) })],
      [t("aging.csvInvoiceNo"), t("aging.colParty"), t("aging.csvInvoiceDate"), t("aging.csvAge"), t("aging.csvBucket"), t("aging.csvDueDate"), t("aging.csvOverdue"), t("aging.csvGrandTotal"), t("aging.csvSettled"), t("aging.csvCreditNotes"), t("aging.csvOutstanding")],
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
      t("aging.totalRow"),
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
    toast({ title: t("jrnl.toastExported"), description: t("aging.toastCsvInv") });
  }

  return (
    <div className="space-y-4">
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ReceiptText className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">{t("aging.preciseMode")}</span>{" "}
          {t("aging.preciseInvA")} <span className="italic">{t("aging.invDate")}</span>{t("aging.preciseInvB")}
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={ReceiptText} title={t("aging.invUnavailable")} hint={t("aging.refreshHint")} />
      ) : (
        <>
          {/* KPI cards */}
          <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{t("aging.openInvoices")}</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {data.totals.openInvoices}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {t("aging.outstandingAmt", { amt: formatINR(data.totals.outstanding) })}
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{t("aging.overdue")}</span>
              <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", data.totals.overdue > 0.009 ? "text-dmk-danger" : "text-dmk-success")}>
                {formatINR(data.totals.overdue)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {t("aging.overdueInvCount", { n: data.totals.overdueInvoices })}
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{t("aging.current30")}</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-blue">
                {formatINR(data.totals.buckets.d0_30)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {t("aging.healthyBook")}
              </span>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{t("aging.days90")}</span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-danger">
                {formatINR(data.totals.buckets.d90plus)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {t("aging.collectionTail")}
              </span>
            </div>
          </div>

          {/* AR subledger reconciliation strip */}
          {data.reconciliation && (
            <div className="dmk-card px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
              <div className="flex items-center gap-2 shrink-0">
                <Scale className="h-4 w-4 text-dmk-gold" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("aging.subledgerRec")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-dmk-text-secondary font-money">
                <span>{t("aging.recOpenInvoices", { amt: formatINR(data.reconciliation.openInvoices) }).split("{" + "amt}" + "")[0]}
                  <b className="text-dmk-text-primary">{formatINR(data.reconciliation.openInvoices)}</b>
                </span>
                <span className="text-dmk-text-muted">−</span>
                <span>{t("aging.recUnappliedReceipts", { amt: formatINR(data.reconciliation.unappliedReceipts) }).split("{" + "amt}" + "")[0]}
                  <b className="text-dmk-info">{formatINR(data.reconciliation.unappliedReceipts)}</b>
                </span>
                <span className="text-dmk-text-muted">+</span>
                <span>{t("aging.recPartyOpenings", { amt: formatINR(data.reconciliation.openingBalances) }).split("{" + "amt}" + "")[0]}
                  <b className="text-dmk-text-secondary">{formatINR(data.reconciliation.openingBalances)}</b>
                </span>
                <span className="text-dmk-text-muted">=</span>
                <span>{t("aging.recGlReceivables", { amt: formatINR(data.reconciliation.glReceivables) }).split("{" + "amt}" + "")[0]}
                  <b className="text-dmk-yellow">{formatINR(data.reconciliation.glReceivables)}</b>
                </span>
                {Math.abs(data.reconciliation.difference) <= 0.01 ? (
                  <Badge tone="success">{t("aging.reconciled")}</Badge>
                ) : (
                  <Badge tone="warning">Δ {formatINR(data.reconciliation.difference)}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Party rollup strip */}
          {data.parties.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted mr-1">{t("aging.byParty")}</span>
              {data.parties.slice(0, 6).map((p) => {
                const isFiltered = partyFilter === p.customerId;
                const chip = (
                  <>
                    <span className="text-dmk-text-secondary max-w-[150px] truncate">{p.partyName}</span>
                    <span className="font-money font-semibold text-dmk-yellow">{formatINR(p.outstanding)}</span>
                    {!!p.unapplied && p.unapplied > 0.009 && (
                      <span className="font-money text-[10px] text-dmk-info" title={t("aging.unappliedReceiptsTitle")}>{t("aging.unappliedChip", { amt: formatINR(p.unapplied) })}</span>
                    )}
                  </>
                );
                if (!p.customerId) {
                  return (
                    <span
                      key={p.partyName}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 text-[11px]"
                      title={t("aging.chipInvTitle", { n: p.invoiceCount, doc: p.oldestInvoiceNo || "—" })}
                    >
                      {chip}
                    </span>
                  );
                }
                return (
                  <button
                    key={p.customerId}
                    type="button"
                    onClick={() => setPartyFilter(isFiltered ? "all" : p.customerId)}
                    title={isFiltered ? t("aging.chipInvActive", { n: p.invoiceCount }) : t("aging.chipInvFilter", { n: p.invoiceCount })}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                      "hover:border-dmk-blue/50 hover:bg-dmk-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60",
                      isFiltered ? "border-dmk-blue/60 bg-dmk-hover" : "border-dmk-border-subtle bg-dmk-input-well"
                    )}
                  >
                    {chip}
                  </button>
                );
              })}
              {data.parties.length > 6 && (
                <span className="text-[10.5px] text-dmk-text-muted">{t("aging.moreMore", { n: data.parties.length - 6 })}</span>
              )}
            </div>
          )}

          {/* Controls + table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
              <Select value={partyFilter} onValueChange={setPartyFilter}>
                <SelectTrigger className="h-8 w-full sm:w-72 bg-dmk-input-well border-dmk-border-subtle text-[12px] text-dmk-text-secondary">
                  <SelectValue placeholder={t("aging.allParties")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">{t("aging.allParties")}</SelectItem>
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
                            <PartyLink
                              partyType="CUSTOMER"
                              partyId={r.customerId}
                              name={r.partyName}
                              className="text-[13px] font-medium text-dmk-text-primary max-w-[200px]"
                            />
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
  const { t } = useT();
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
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{t("aging.openBills")}</span>
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
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("aging.recon")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-dmk-text-secondary font-money">
                <span>{t("aging.openBills")} <b className="text-dmk-text-primary">{formatINR(data.reconciliation.openPOs)}</b></span>
                <span className="text-dmk-text-muted">−</span>
                <span>{t("aging.unappliedPays")} <b className="text-dmk-info">{formatINR(data.reconciliation.unappliedPayments)}</b></span>
                <span className="text-dmk-text-muted">+</span>
                <span>{t("aging.vendorOpenings")} <b className="text-dmk-text-secondary">{formatINR(data.reconciliation.openingBalances)}</b></span>
                <span className="text-dmk-text-muted">−</span>
                <span>{t("aging.standaloneDN")} <b className="text-dmk-warning">{formatINR(data.reconciliation.standaloneDebitNotes)}</b></span>
                <span className="text-dmk-text-muted">=</span>
                <span>{t("aging.glPayables")} <b className="text-dmk-yellow">{formatINR(data.reconciliation.glPayables)}</b></span>
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
              {data.vendors.slice(0, 6).map((v) => {
                const isFiltered = vendorFilter === v.vendorId;
                const chip = (
                  <>
                    <span className="text-dmk-text-secondary max-w-[150px] truncate">{v.vendorName}</span>
                    <span className="font-money font-semibold text-dmk-yellow">{formatINR(v.outstanding)}</span>
                    {!!v.unapplied && v.unapplied > 0.009 && (
                      <span className="font-money text-[10px] text-dmk-info" title="Unapplied on-account payments">−{formatINR(v.unapplied)} unapplied</span>
                    )}
                  </>
                );
                if (!v.vendorId) {
                  return (
                    <span key={v.vendorName} className="inline-flex items-center gap-1.5 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 text-[11px]"
                      title={`${v.poCount} open bill(s) · oldest ${v.oldestPoNo || "—"}`}>
                      {chip}
                    </span>
                  );
                }
                return (
                  <button
                    key={v.vendorId}
                    type="button"
                    onClick={() => setVendorFilter(isFiltered ? "all" : v.vendorId)}
                    title={`${v.poCount} open bill(s) · click to filter${isFiltered ? " (click again to clear)" : ""}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                      "hover:border-dmk-blue/50 hover:bg-dmk-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60",
                      isFiltered ? "border-dmk-blue/60 bg-dmk-hover" : "border-dmk-border-subtle bg-dmk-input-well"
                    )}
                  >
                    {chip}
                  </button>
                );
              })}
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
                  <SelectValue placeholder={t("aging.allVendors")} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">{t("aging.allVendors")}</SelectItem>
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
                                <p className="font-money text-[12px] font-semibold text-dmk-text-primary">
                                  {r.poNumber}
                                  {r.vendorBillNo && (
                                    <span className="ml-2 font-normal text-[10px] text-dmk-text-muted" title="Vendor bill no.">Bill {r.vendorBillNo}</span>
                                  )}
                                </p>
                                <p className="text-[10.5px] text-dmk-text-muted">
                                  {formatDate(r.poDate)} · {formatINR(r.grandTotal)} billed
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-[220px]">
                            <PartyLink
                              partyType="VENDOR"
                              partyId={r.vendorId}
                              name={r.vendorName}
                              className="text-[13px] font-medium text-dmk-text-primary max-w-[200px]"
                            />
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
