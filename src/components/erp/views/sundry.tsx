"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE & ACCOUNTING — SUNDRY DEBTORS & CREDITORS
// "Sundry" = the trade parties dealt with on credit (Tally groups).
//   · Sundry Debtors  (A/c 1100): customers who owe us — AR
//   · Sundry Creditors (A/c 2000): vendors we owe — AP
// Party-wise ledger balances + credit-limit utilization, invoice /
// PO aging buckets, last payment & activity, and a GL ↔ subledger
// reconciliation strip (Δ must be ₹0.00).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Banknote,
  BookUser,
  Landmark,
  ReceiptText,
  RefreshCw,
  Scale,
  ShieldAlert,
  Timer,
} from "lucide-react";

import { Badge, EmptyState, ErrorText, KpiCard, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useErpStore } from "@/store/erp-store";
import { requestLedgerParty } from "@/lib/settle-bus";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface BucketSet {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface SundryDebtor {
  id: string;
  name: string;
  city: string;
  phone: string;
  customerType: string;
  ledgerBalance: number;
  creditLimit: number;
  creditDays: number;
  available: number | null;
  utilizationPct: number;
  overLimit: boolean;
  openInvoiceCount: number;
  openOutstanding: number;
  unapplied: number;
  overdueOutstanding: number;
  overdueCount: number;
  oldestInvoice: { no: string; date: string; ageDays: number } | null;
  buckets: BucketSet;
  lastActivity: string | null;
}

interface SundryCreditor {
  id: string;
  name: string;
  vendorType: string;
  brand: string;
  ledgerBalance: number;
  paymentTerms: string;
  openPOCount: number;
  openPOValue: number;
  buckets: BucketSet;
  oldestDocDate: string | null;
  oldestDocNo: string;
  lastPayment: { date: string; amount: number; mode: string } | null;
  lastActivity: string | null;
}

interface SundryResponse {
  type: "DEBTORS" | "CREDITORS";
  glCode: string;
  glName: string;
  asOf: string;
  parties: SundryDebtor[] | SundryCreditor[];
  totals: {
    debit: number;
    credit: number;
    net: number;
    openOutstanding?: number;
    unapplied?: number;
    overdue?: number;
    overLimitCount?: number;
    openPOValue?: number;
    openPOCount?: number;
    partyCount: number;
  };
  reconciliation: { glBalance: number; partySum: number; difference: number; claimsBalance?: number };
}

const BUCKET_CHIPS: Array<{ key: keyof BucketSet; label: string; cls: string }> = [
  { key: "d0_30", label: "0–30", cls: "text-dmk-blue" },
  { key: "d31_60", label: "31–60", cls: "text-dmk-warning" },
  { key: "d61_90", label: "61–90", cls: "text-dmk-gold" },
  { key: "d90plus", label: "90+", cls: "text-dmk-danger" },
];

function BucketChips({ buckets }: { buckets: BucketSet }) {
  const { t } = useT();
  const total = buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90plus;
  if (total <= 0.009) return <span className="text-[11px] text-dmk-text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {BUCKET_CHIPS.filter((b) => buckets[b.key] > 0.009).map((b) => (
        <span
          key={b.key}
          title={t("sund.bucketTitle", { label: b.label, amt: formatINR(buckets[b.key]) })}
          className={cn("dmk-badge text-[9.5px] px-1.5 py-0.5 font-money bg-dmk-input-well", b.cls)}
        >
          {b.label} · {formatINR(buckets[b.key])}
        </span>
      ))}
    </div>
  );
}

function UtilBar({ pct, overLimit }: { pct: number; overLimit: boolean }) {
  const cls = overLimit ? "bg-dmk-danger" : pct >= 85 ? "bg-dmk-warning" : "bg-dmk-success";
  return (
    <div className="h-1.5 w-full rounded-full bg-dmk-input-well overflow-hidden" role="presentation">
      <div className={cn("h-full rounded-full transition-all", cls)} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
    </div>
  );
}

/** Party name → deep link into the preselected party ledger statement. */
function PartyLink({
  partyType,
  partyId,
  name,
}: {
  partyType: "CUSTOMER" | "VENDOR";
  partyId: string;
  name: string;
}) {
  const { t } = useT();
  const setView = useErpStore((s) => s.setView);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        requestLedgerParty(partyType, partyId);
        setView("finance/ledgers");
      }}
      title={t("aging.openLedger", { party: name })}
      className="group/party inline-flex items-center gap-0.5 rounded text-left text-[13px] font-semibold text-dmk-text-primary hover:text-dmk-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60"
    >
      <span className="truncate max-w-[220px]">{name}</span>
      <ArrowUpRight className="h-3 w-3 opacity-0 group-hover/party:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

function ReconStrip({ recon, glName, glCode }: { recon: SundryResponse["reconciliation"]; glName: string; glCode: string }) {
  const { t } = useT();
  const ok = Math.abs(recon.difference) <= 0.05;
  return (
    <div
      className={cn(
        "dmk-well px-3 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5",
        !ok && "border border-dmk-danger/40"
      )}
      role="status"
    >
      <span className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
        <Scale className="h-3.5 w-3.5 text-dmk-gold" /> {t("sund.glSubledger")}
      </span>
      <span className="text-[12px] text-dmk-text-secondary">
        GL <span className="font-semibold text-dmk-text-primary">{t("sund.glAcct", { code: glCode })}</span> · {glName}
      </span>
      <span className="text-[12px] text-dmk-text-secondary font-money">
        {t("sund.glBalance")} <span className="text-dmk-text-primary font-semibold">{formatINR(recon.glBalance)}</span>
      </span>
      <span className="text-[12px] text-dmk-text-secondary font-money">
        {t("sund.partySum")} <span className="text-dmk-text-primary font-semibold">{formatINR(recon.partySum)}</span>
      </span>
      {typeof recon.claimsBalance === "number" && recon.claimsBalance > 0.009 && (
        <span
          className="text-[12px] text-dmk-text-secondary font-money"
          title={t("sund.claimsTitle")}
        >
          {t("sund.claims")} <span className="text-dmk-gold font-semibold">{formatINR(recon.claimsBalance)}</span>
        </span>
      )}
      <span
        className={cn(
          "dmk-badge text-[10px] px-2 py-0.5 font-money",
          ok ? "bg-dmk-success/15 text-dmk-success" : "bg-dmk-danger/15 text-dmk-danger"
        )}
      >
        Δ {formatINR(recon.difference)} {ok ? t("sund.reconOk") : t("sund.reconBad")}
      </span>
    </div>
  );
}

function DebtorsTab({ refreshKey }: { refreshKey: number }) {
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [data, setData] = React.useState<SundryResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<SundryResponse>("/api/v1/finance/sundry", { firmId: activeFirmId, type: "DEBTORS" })
      .then((res) => alive && setData(res))
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : t("sund.errDebtors"));
          setData(null);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [activeFirmId, refreshKey]);

  const parties = (data?.parties ?? []) as SundryDebtor[];

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      [t("sund.csvDebtorsTitle"), t("aging.asOf", { date: data.asOf.slice(0, 10) })],
      [t("aging.colParty"), t("cmn.city"), t("cmn.type"), t("sund.colLedgerBalance"), t("sund.colCreditLimit"), t("sund.colUtilisation"), t("sund.colOpenInvoices"), t("sund.colOpenOutstanding"), t("sund.colUnappliedReceipts"), t("sund.colOverdue"), "0-30", "31-60", "61-90", "90+", t("sund.colOldestInvoice"), t("aging.csvAge"), t("sund.colLastActivity")],
    ];
    for (const p of parties) {
      out.push([
        p.name,
        p.city,
        p.customerType,
        p.ledgerBalance,
        p.creditLimit,
        p.utilizationPct,
        p.openInvoiceCount,
        p.openOutstanding,
        p.unapplied,
        p.overdueOutstanding,
        p.buckets.d0_30,
        p.buckets.d31_60,
        p.buckets.d61_90,
        p.buckets.d90plus,
        p.oldestInvoice?.no ?? "",
        p.oldestInvoice?.ageDays ?? "",
        p.lastActivity ? p.lastActivity.slice(0, 10) : "",
      ]);
    }
    out.push(["TOTAL", "", "", data.totals.net, "", "", "", data.totals.openOutstanding ?? 0, data.totals.unapplied ?? 0, data.totals.overdue ?? 0, "", "", "", "", "", "", ""]);
    downloadCSV(`sundry-debtors-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: t("jrnl.toastExported"), description: t("sund.toastDebtorsCsv") });
  }

  return (
    <div className="space-y-4">
      {error && <ErrorText>{error}</ErrorText>}
      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <EmptyState icon={BookUser} title={t("sund.unavailableDebtors")} hint={t("g2b.refreshHint")} />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label={t("sund.kpiTotalDr")} value={formatINR(data.totals.net)} icon={BookUser} tone="yellow" sub={t("sund.kpiTotalDrSub", { n: data.totals.partyCount })} />
            <KpiCard label={t("sund.kpiOverdue")} value={formatINR(data.totals.overdue ?? 0)} icon={Timer} tone="danger" sub={t("sund.pastCreditTerms")} />
            <KpiCard label={t("sund.kpiOpenInv")} value={formatINR(data.totals.openOutstanding ?? 0)} icon={ReceiptText} tone="info" sub={t("sund.unappliedAmt", { amt: formatINR(data.totals.unapplied ?? 0) })} />
            <KpiCard label={t("sund.kpiAdvancesCr")} value={formatINR(data.totals.credit)} icon={ArrowDownToLine} tone="success" sub={t("sund.overLimitCount", { n: data.totals.overLimitCount ?? 0 })} />
          </div>

          <ReconStrip recon={data.reconciliation} glName={data.glName} glCode={data.glCode} />

          {parties.length === 0 ? (
            <EmptyState icon={BookUser} title={t("sund.emptyDebtors")} hint={t("sund.emptyDebtorsHint")} />
          ) : (
            <div className="dmk-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                  {t("sund.registerDebtors", { n: parties.length, date: formatDate(data.asOf) })}
                </p>
                <Button size="sm" variant="outline" className="h-7 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={exportCsv}>
                  <ArrowDownToLine className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-dmk-bg-tertiary z-10">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-dmk-text-muted border-b border-dmk-border-subtle">
                      <th className="px-4 py-2 font-semibold">{t("aging.colParty")}</th>
                      <th className="px-3 py-2 font-semibold text-right">{t("sund.colLedgerBalance")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colCreditLimit")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colAging")}</th>
                      <th className="px-3 py-2 font-semibold text-right">{t("sund.colOpenInvoices")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colOldestOpen")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colLastActivity")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parties.map((p) => {
                      const hasDue = p.ledgerBalance > 0.009;
                      return (
                        <tr key={p.id} className="border-b border-dmk-border-subtle last:border-b-0 hover:bg-dmk-hover/40 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <PartyLink partyType="CUSTOMER" partyId={p.id} name={p.name} />
                              {p.overLimit && <Badge tone="danger">{t("sund.overLimit")}</Badge>}
                              {p.overdueCount > 0 && <Badge tone="warning">{t("sund.overdueCount", { n: p.overdueCount })}</Badge>}
                            </div>
                            <p className="text-[10.5px] text-dmk-text-muted mt-0.5">
                              {p.customerType === "B2B" ? "B2B" : "B2C"} {p.city ? `· ${p.city}` : ""} {p.phone ? `· ${p.phone}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={cn("font-money font-semibold", hasDue ? "text-dmk-yellow" : p.ledgerBalance < -0.009 ? "text-dmk-success" : "text-dmk-text-muted")}>
                              {hasDue ? `Dr ${formatINR(p.ledgerBalance)}` : p.ledgerBalance < -0.009 ? `Cr ${formatINR(-p.ledgerBalance)}` : t("pled.clear")}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 min-w-[130px]">
                            {p.creditLimit > 0 ? (
                              <>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-money text-[11.5px] text-dmk-text-secondary">{formatINR(p.creditLimit)}</span>
                                  <span className={cn("text-[10.5px] font-semibold", p.overLimit ? "text-dmk-danger" : "text-dmk-text-muted")}>{p.utilizationPct.toFixed(0)}%</span>
                                </div>
                                <UtilBar pct={p.utilizationPct} overLimit={p.overLimit} />
                                <p className="text-[10px] text-dmk-text-muted mt-0.5">{t("sund.availDays", { amt: formatINR(Math.max(p.available ?? 0, 0)), n: p.creditDays })}</p>
                              </>
                            ) : (
                              <span className="text-[11px] text-dmk-text-muted">{t("sund.noLimit")}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5"><BucketChips buckets={p.buckets} /></td>
                          <td className="px-3 py-2.5 text-right">
                            {p.openInvoiceCount > 0 ? (
                              <>
                                <span className="font-money text-dmk-text-primary font-semibold">{formatINR(p.openOutstanding)}</span>
                                <p className="text-[10.5px] text-dmk-text-muted">{t("sund.invoiceCount", { n: p.openInvoiceCount })}</p>
                              </>
                            ) : (
                              <span className="text-[11px] text-dmk-text-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.oldestInvoice ? (
                              <>
                                <p className="text-[11.5px] text-dmk-text-secondary font-mono">{p.oldestInvoice.no}</p>
                                <p className={cn("text-[10.5px]", p.oldestInvoice.ageDays > 60 ? "text-dmk-danger" : "text-dmk-text-muted")}>{t("sund.daysOld", { n: p.oldestInvoice.ageDays })}</p>
                              </>
                            ) : (
                              <span className="text-[11px] text-dmk-text-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.lastActivity ? <span className="text-[11.5px] text-dmk-text-secondary">{formatDate(p.lastActivity)}</span> : <span className="text-[11px] text-dmk-text-muted">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CreditorsTab({ refreshKey }: { refreshKey: number }) {
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const { toast } = useToast();
  const [data, setData] = React.useState<SundryResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<SundryResponse>("/api/v1/finance/sundry", { firmId: activeFirmId, type: "CREDITORS" })
      .then((res) => alive && setData(res))
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : t("sund.errCreditors"));
          setData(null);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [activeFirmId, refreshKey]);

  const parties = (data?.parties ?? []) as SundryCreditor[];

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      [t("sund.csvCreditorsTitle"), t("aging.asOf", { date: data.asOf.slice(0, 10) })],
      [t("cmn.vendor"), t("cmn.type"), t("cmn.brand"), t("sund.colLedgerCr"), t("sund.colTerms"), t("sund.colOpenPos"), t("sund.colOpenPoValue"), "0-30", "31-60", "61-90", "90+", t("sund.colLastPayment"), t("sund.colLastActivity")],
    ];
    for (const p of parties) {
      out.push([
        p.name,
        p.vendorType,
        p.brand,
        p.ledgerBalance,
        p.paymentTerms,
        p.openPOCount,
        p.openPOValue,
        p.buckets.d0_30,
        p.buckets.d31_60,
        p.buckets.d61_90,
        p.buckets.d90plus,
        p.lastPayment ? `${p.lastPayment.date.slice(0, 10)} · ${p.lastPayment.amount} · ${p.lastPayment.mode}` : "",
        p.lastActivity ? p.lastActivity.slice(0, 10) : "",
      ]);
    }
    out.push(["TOTAL", "", "", data.totals.net, "", data.totals.openPOCount ?? 0, data.totals.openPOValue ?? 0, "", "", "", "", "", ""]);
    downloadCSV(`sundry-creditors-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: t("jrnl.toastExported"), description: t("sund.toastCreditorsCsv") });
  }

  return (
    <div className="space-y-4">
      {error && <ErrorText>{error}</ErrorText>}
      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <EmptyState icon={BookUser} title={t("sund.unavailableCreditors")} hint={t("g2b.refreshHint")} />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label={t("sund.kpiTotalCr")} value={formatINR(data.totals.net)} icon={BookUser} tone="yellow" sub={t("sund.kpiTotalCrSub", { n: data.totals.partyCount })} />
            <KpiCard label={t("sund.kpiOpenPo")} value={formatINR(data.totals.openPOValue ?? 0)} icon={ReceiptText} tone="info" sub={t("sund.kpiOpenPoSub", { n: data.totals.openPOCount ?? 0 })} />
            <KpiCard label={t("sund.kpiAdvancesDr")} value={formatINR(data.totals.debit)} icon={ArrowDownToLine} tone="success" sub={t("sund.paidAhead")} />
            <KpiCard label={t("sund.kpiWorst")} value={formatINR(Math.max(...parties.map((p) => p.buckets.d90plus), 0))} icon={Timer} tone="danger" sub={t("sund.payables90")} />
          </div>

          <ReconStrip recon={data.reconciliation} glName={data.glName} glCode={data.glCode} />

          {parties.length === 0 ? (
            <EmptyState icon={BookUser} title={t("sund.emptyCreditors")} hint={t("sund.emptyCreditorsHint")} />
          ) : (
            <div className="dmk-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                  {t("sund.registerCreditors", { n: parties.length, date: formatDate(data.asOf) })}
                </p>
                <Button size="sm" variant="outline" className="h-7 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={exportCsv}>
                  <ArrowDownToLine className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-dmk-bg-tertiary z-10">
                    <tr className="text-left text-[10px] uppercase tracking-wider text-dmk-text-muted border-b border-dmk-border-subtle">
                      <th className="px-4 py-2 font-semibold">{t("cmn.vendor")}</th>
                      <th className="px-3 py-2 font-semibold text-right">{t("sund.colLedgerBalance")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colTerms")}</th>
                      <th className="px-3 py-2 font-semibold text-right">{t("sund.colOpenPos")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colAging")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colLastPayment")}</th>
                      <th className="px-3 py-2 font-semibold">{t("sund.colLastActivity")}</th>
                      <th className="px-3 py-2 font-semibold text-right">{t("cmn.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parties.map((p) => {
                      const owed = p.ledgerBalance > 0.009;
                      return (
                        <tr key={p.id} className="border-b border-dmk-border-subtle last:border-b-0 hover:bg-dmk-hover/40 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <PartyLink partyType="VENDOR" partyId={p.id} name={p.name} />
                              <Badge tone={p.vendorType === "MANUFACTURER" ? "dr" : "info"}>{p.vendorType}</Badge>
                            </div>
                            {p.brand && <p className="text-[10.5px] text-dmk-text-muted mt-0.5">{t("sund.brandDot", { brand: p.brand })}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={cn("font-money font-semibold", owed ? "text-dmk-yellow" : p.ledgerBalance < -0.009 ? "text-dmk-success" : "text-dmk-text-muted")}>
                              {owed ? `Cr ${formatINR(p.ledgerBalance)}` : p.ledgerBalance < -0.009 ? `Dr ${formatINR(-p.ledgerBalance)}` : t("pled.clear")}
                            </span>
                          </td>
                          <td className="px-3 py-2.5"><span className="text-[11.5px] text-dmk-text-secondary">{p.paymentTerms.replace("_", "-")}</span></td>
                          <td className="px-3 py-2.5 text-right">
                            {p.openPOCount > 0 ? (
                              <>
                                <span className="font-money text-dmk-text-primary font-semibold">{formatINR(p.openPOValue)}</span>
                                <p className="text-[10.5px] text-dmk-text-muted">{t("sund.poCount", { n: p.openPOCount })}</p>
                              </>
                            ) : (
                              <span className="text-[11px] text-dmk-text-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5"><BucketChips buckets={p.buckets} /></td>
                          <td className="px-3 py-2.5">
                            {p.lastPayment ? (
                              <>
                                <p className="font-money text-[11.5px] text-dmk-text-primary">{formatINR(p.lastPayment.amount)}</p>
                                <p className="text-[10.5px] text-dmk-text-muted">{formatDate(p.lastPayment.date)} · {p.lastPayment.mode}</p>
                              </>
                            ) : (
                              <span className="text-[11px] text-dmk-text-muted">{t("sund.noPaymentsYet")}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.lastActivity ? <span className="text-[11.5px] text-dmk-text-secondary">{formatDate(p.lastActivity)}</span> : <span className="text-[11px] text-dmk-text-muted">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                                    onClick={() => setView("purchase/payments")}
                                  >
                                    <Banknote className="h-3.5 w-3.5" /> {t("pled.pay")}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t("sund.payTooltip")}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SundryView() {
  const { t } = useT();
  const [tab, setTab] = React.useState<"debtors" | "creditors">("debtors");
  const [refreshKey, setRefreshKey] = React.useState(0);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("sund.title")}
        subtitle={t("sund.subtitle")}
        icon={BookUser}
        actions={
          <Button variant="outline" size="sm" className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setRefreshKey((k) => k + 1)} aria-label={t("sund.refreshAria")}>
            <RefreshCw className="h-4 w-4" /> {t("cmn.refresh")}
          </Button>
        }
      />

      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-dmk-gold mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">{t("sund.whatQ")}</span> {t("sund.whatSegA")}{" "}
          <span className="font-semibold">{t("sund.debtors")}</span> {t("sund.whatSegB")}{" "}
          <span className="font-semibold">{t("sund.creditors")}</span> {t("sund.whatSegC")}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "debtors" | "creditors")} className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="debtors" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <BookUser className="h-3.5 w-3.5 mr-1.5" /> {t("sund.tabDebtors")}
          </TabsTrigger>
          <TabsTrigger value="creditors" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Landmark className="h-3.5 w-3.5 mr-1.5" /> {t("sund.tabCreditors")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="debtors" className="mt-0"><DebtorsTab refreshKey={refreshKey} /></TabsContent>
        <TabsContent value="creditors" className="mt-0"><CreditorsTab refreshKey={refreshKey} /></TabsContent>
      </Tabs>
    </div>
  );
}
