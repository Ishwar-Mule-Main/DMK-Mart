"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — GSTR-2B RECONCILIATION (ITC matching)
// Import the supplier-reported GSTR-2B rows (CSV) for a return
// period and match them against CONFIRMED purchase orders (books):
// bill-number-first (vendorBillNo captured on POs), then GSTIN +
// amount proximity. Statuses: MATCHED, AMOUNT_MISMATCH,
// MISSING_IN_BOOKS, MISSING_IN_2B.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  GitCompareArrows,
  HelpCircle,
  Loader2,
  Scale,
  Upload,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { useT, type TFn } from "@/lib/i18n";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, downloadCSV } from "@/lib/format";
import type { Gstr2bResponse, Gstr2bRecordRow } from "@/types/erp";
import { PageHeader, Badge, EmptyState, ErrorText, LoadingRows, KpiCard, Field, inputCls } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Shift a YYYY-MM period by ±months (clamped day never needed). */
function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "Sep 2026" style label for a YYYY-MM period (locale-aware). */
function periodLabel(period: string, locale: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: "short", year: "numeric", timeZone: "UTC" });
}

function statusBadge(s: Gstr2bRecordRow["status"], t: TFn) {
  if (s === "MATCHED") return <Badge tone="success">{t("g2b.stMatched")}</Badge>;
  if (s === "AMOUNT_MISMATCH") return <Badge tone="warning">{t("g2b.stAmountMismatch")}</Badge>;
  return <Badge tone="danger">{t("g2b.stMissingBooks")}</Badge>;
}

/** How the row was matched — bill number (exact) vs GSTIN + amount (best-fit). */
function basisBadge(basis: Gstr2bRecordRow["matchBasis"], t: TFn) {
  if (basis === "BILL_NO")
    return (
      <span
        className="dmk-badge bg-dmk-gold/15 text-dmk-gold"
        title={t("g2b.basisBillTitle")}
      >
        BILL NO
      </span>
    );
  if (basis === "AMOUNT")
    return (
      <span
        className="dmk-badge bg-dmk-info/15 text-dmk-info"
        title={t("g2b.basisAmountTitle")}
      >
        AMOUNT
      </span>
    );
  return null;
}

const SAMPLE_CSV = `GSTIN,TradeName,InvoiceNo,InvoiceDate,TaxableValue,IGST,CGST,SGST,ITC,PlaceOfSupply
27AAECD1111H1ZP,DMK Polymers Pvt Ltd,SB-2026-1188,22/08/2026,25700.00,0.00,2313.00,2313.00,YES,27
29AAHCB4444L1Z7,Sri Balaji Plastic Traders,SB/26-27/4471,23/08/2026,29100.00,5238.00,0.00,0.00,YES,27
27AAFCS2222J1Z6,Supreme Polymers Industries,SP-77123,18/08/2026,9800.00,0.00,882.00,882.00,YES,27`;

export default function Gstr2bView() {
  const { t, speechTag } = useT();
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [period, setPeriod] = React.useState(currentPeriod());
  const [data, setData] = React.useState<Gstr2bResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<Gstr2bResponse>("/api/v1/gstr2b", { firmId: activeFirmId, period })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : t("g2b.errLoad"));
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, period, refreshKey]);

  const records = data?.records ?? [];
  const filtered = records; // placeholder for future filters

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      [t("g2b.csvTitle", { period: data.period }), t("g2b.csvFirm", { name: data.firmName, gstin: data.firmGstin })],
      [t("g2b.colSource"), "GSTIN", t("g2b.colTradeName"), t("g2b.colInvoiceNo"), t("cmn.date"), t("g2b.colTaxable"), "IGST", "CGST", "SGST", t("g2b.colGrand"), "ITC", t("cmn.status"), t("g2b.colMatchBasis"), t("g2b.colMatchedPo")],
      ...data.records.map((r) => [
        "2B",
        r.gstin,
        r.tradeName,
        r.invoiceNo,
        r.invoiceDate.slice(0, 10),
        r.taxableValue,
        r.igst,
        r.cgst,
        r.sgst,
        r.grand,
        r.itcAvailable ? "YES" : "NO",
        r.status,
        r.matchBasis ?? "",
        r.matchedPoNumber ?? "",
      ]),
      ...data.books.map((b) => [
        "BOOKS",
        b.gstin,
        b.vendorName,
        b.poNumber,
        "",
        b.taxable,
        b.igst,
        b.cgst,
        b.sgst,
        b.grand,
        "YES",
        b.status,
        "",
        "",
      ]),
    ];
    downloadCSV(`gstr2b-recon-${data.period}.csv`, out);
    toast({ title: t("jrnl.toastExported"), description: t("g2b.toastCsvDesc", { period: data.period }) });
  }

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("g2b.title")}
        subtitle={t("g2b.subtitle")}
        icon={GitCompareArrows}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-lg border border-dmk-border-subtle bg-dmk-input-well">
              <button
                type="button"
                onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
                title={t("g2b.prevPeriod")}
                aria-label={t("g2b.prevPeriod")}
                className="flex h-9 w-8 items-center justify-center text-dmk-text-secondary transition-colors hover:bg-dmk-hover hover:text-dmk-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span
                className="flex h-9 min-w-[96px] items-center justify-center gap-1.5 border-x border-dmk-border-subtle px-2 font-money text-[12.5px] font-semibold text-dmk-text-primary"
                title={t("g2b.periodTitle", { period })}
              >
                <CalendarDays className="h-3.5 w-3.5 text-dmk-blue" />
                {periodLabel(period, speechTag)}
              </span>
              <button
                type="button"
                onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
                title={t("g2b.nextPeriod")}
                aria-label={t("g2b.nextPeriod")}
                className="flex h-9 w-8 items-center justify-center text-dmk-text-secondary transition-colors hover:bg-dmk-hover hover:text-dmk-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dmk-blue/60"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
              className={cn(inputCls, "w-[150px] font-money")}
              aria-label={t("g2b.returnPeriod")}
            />
            {period !== currentPeriod() && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
                onClick={() => setPeriod(currentPeriod())}
                title={t("g2b.jumpCurrent")}
              >
                {t("g2b.current")}
              </Button>
            )}
            <Button
              size="sm"
              className="h-9 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" /> {t("g2b.importBtn")}
            </Button>
          </div>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={GitCompareArrows} title={t("g2b.unavailable")} hint={t("g2b.refreshHint")} />
      ) : (
        <>
          {/* KPI row */}
          <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label={t("g2b.kpiRecords")} value={String(s!.records2b)} tone="blue" icon={GitCompareArrows} sub={t("g2b.kpiRecordsSub", { matched: s!.matched, n: s!.billMatched })} />
            <KpiCard label={t("g2b.kpiItc2b")} value={formatINR(s!.itc2b)} tone="info" icon={Download} sub={t("g2b.kpiItc2bSub")} />
            <KpiCard label={t("g2b.kpiItcBooks")} value={formatINR(s!.itcBooks)} tone="default" icon={Scale} sub={t("g2b.kpiItcBooksSub", { n: data.booksTotal })} />
            <KpiCard label={t("g2b.kpiMatched")} value={formatINR(s!.matchedItc)} tone="success" icon={CheckCircle2} sub={t("g2b.kpiMatchedSub")} />
            <KpiCard label={t("g2b.kpiRisk")} value={formatINR(s!.missingItc)} tone="orange" icon={AlertTriangle} sub={t("g2b.kpiRiskSub", { n: s!.missingInBooks + s!.mismatches })} />
            <KpiCard label={t("g2b.kpiNetRisk")} value={formatINR(s!.netItcRisk)} tone={s!.netItcRisk > 0.009 ? "danger" : "success"} icon={FileWarning} sub={t("g2b.kpiNetRiskSub")} />
          </div>

          {/* Guidance strip */}
          <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
            <HelpCircle className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
            <p className="text-[12px] text-dmk-text-secondary">
              <span className="font-semibold text-dmk-text-primary">{t("g2b.howMatch")}</span> {t("g2b.matchSegA")}{" "}
              <Badge tone="success">BILL NO</Badge> {t("g2b.matchSegB")} <Badge tone="info">AMOUNT</Badge> {t("g2b.matchSegC")}{" "}
              <Badge tone="warning">{t("g2b.stAmountMismatch")}</Badge> {t("g2b.matchSegD")}{" "}
              <Badge tone="danger">{t("g2b.stMissingBooks")}</Badge> {t("g2b.matchSegE")} <Badge tone="info">{t("g2b.stMissing2b")}</Badge>.
            </p>
          </div>

          {records.length === 0 && data.booksTotal === 0 ? (
            <div className="dmk-card">
              <EmptyState
                icon={GitCompareArrows}
                title={t("g2b.noData", { period })}
                hint={t("g2b.noDataHint")}
                action={
                  <Button size="sm" className="bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold" onClick={() => setImportOpen(true)}>
                    <Upload className="h-4 w-4" /> {t("g2b.importBtn")}
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              {/* 2B records table */}
              <div className="dmk-card overflow-hidden">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
                  <span className="text-[12.5px] font-semibold text-dmk-text-primary">
                    {t("g2b.supplierRows", { period })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportCsv}
                    disabled={records.length === 0 && data.books.length === 0}
                    className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
                  >
                    <Download className="h-3.5 w-3.5" /> {t("jrnl.exportCsv")}
                  </Button>
                </div>
                <div className="overflow-x-auto min-h-[200px] max-h-[calc(100vh-560px)] overflow-y-auto">
                  {records.length === 0 ? (
                    <EmptyState
                      icon={GitCompareArrows}
                      title={t("g2b.noRows")}
                      hint={t("g2b.noRowsHint")}
                    />
                  ) : (
                    <table className="dmk-table min-w-[1080px]">
                      <thead>
                        <tr>
                          <th>{t("cmn.status")}</th>
                          <th>{t("g2b.colSupplier")}</th>
                          <th>{t("g2b.colInvoice")}</th>
                          <th className="num text-right">{t("g2b.colTaxableRs")}</th>
                          <th className="num text-right">{t("g2b.colIgstRs")}</th>
                          <th className="num text-right">{t("g2b.colCgstSgstRs")}</th>
                          <th className="num text-right">{t("g2b.colTotalRs")}</th>
                          <th>ITC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr
                            key={r.id}
                            className={cn(
                              r.status === "MISSING_IN_BOOKS" && "bg-[rgba(239,68,68,0.04)]",
                              r.status === "AMOUNT_MISMATCH" && "bg-[rgba(245,158,11,0.03)]"
                            )}
                          >
                            <td>
                              <div className="flex flex-col gap-1 items-start">
                                {statusBadge(r.status, t)}
                                {basisBadge(r.matchBasis, t)}
                                {r.matchedPoNumber && (
                                  <span className="font-money text-[10px] text-dmk-text-muted">{r.matchedPoNumber}</span>
                                )}
                              </div>
                            </td>
                            <td className="max-w-[240px]">
                              <p className="text-[13px] font-medium text-dmk-text-primary truncate">{r.tradeName || "—"}</p>
                              <p className="font-money text-[10.5px] text-dmk-text-muted">{r.gstin}</p>
                            </td>
                            <td>
                              <p className="font-money text-[12px] text-dmk-text-secondary">{r.invoiceNo}</p>
                              <p className="text-[10.5px] text-dmk-text-muted">{formatDate(r.invoiceDate)}</p>
                            </td>
                            <td className="num text-right font-money text-dmk-text-secondary">{formatINR(r.taxableValue)}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">{r.igst ? formatINR(r.igst) : "—"}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">
                              {r.cgst + r.sgst ? formatINR(r.cgst + r.sgst) : "—"}
                            </td>
                            <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(r.grand)}</td>
                            <td>
                              {r.itcAvailable ? (
                                <Badge tone="success">YES</Badge>
                              ) : (
                                <Badge tone="neutral">{t("g2b.restricted")}</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Books-only bills */}
              <div className="dmk-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-dmk-border-subtle">
                  <span className="text-[12.5px] font-semibold text-dmk-text-primary">
                    {t("g2b.booksMissing", { n: data.books.length, total: data.booksTotal })}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  {data.books.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <CheckCircle2 className="h-8 w-8 text-dmk-success mx-auto" />
                      <p className="text-[12.5px] text-dmk-text-secondary mt-2">
                        {t("g2b.cleanPeriod", { period })}
                      </p>
                    </div>
                  ) : (
                    <table className="dmk-table min-w-[860px]">
                      <thead>
                        <tr>
                          <th>{t("g2b.colPoNo")}</th>
                          <th>{t("cmn.vendor")}</th>
                          <th>GSTIN</th>
                          <th>{t("g2b.colVendorBill")}</th>
                          <th className="num text-right">{t("g2b.colTaxableRs")}</th>
                          <th className="num text-right">{t("g2b.colTaxRs")}</th>
                          <th className="num text-right">{t("g2b.colGrandRs")}</th>
                          <th>{t("cmn.status")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.books.map((b) => (
                          <tr key={b.poId}>
                            <td className="font-money text-[12px] font-semibold text-dmk-text-primary">
                              {b.poNumber}
                              {b.vendorBillNo && (
                                <span className="block text-[10px] font-normal text-dmk-text-muted">{t("g2b.billNo", { no: b.vendorBillNo })}</span>
                              )}
                            </td>
                            <td className="text-[13px] max-w-[220px] truncate">{b.vendorName}</td>
                            <td className="font-money text-[11px] text-dmk-text-muted">{b.gstin || "—"}</td>
                            <td className="font-money text-[11.5px] text-dmk-text-secondary">{b.vendorBillNo || "—"}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">{formatINR(b.taxable)}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">{formatINR(b.igst + b.cgst + b.sgst)}</td>
                            <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(b.grand)}</td>
                            <td><Badge tone="info">{t("g2b.stMissing2b")}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        period={period}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Import dialog — paste CSV, upload file, or load a sample
// ═══════════════════════════════════════════════════════════════
function ImportDialog({
  open,
  onOpenChange,
  period,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  period: string;
  onImported: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [csv, setCsv] = React.useState("");
  const [importPeriod, setImportPeriod] = React.useState(period);
  const [saving, setSaving] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setCsv("");
      setImportPeriod(period);
    }
  }, [open, period]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    if (fileRef.current) fileRef.current.value = "";
    toast({ title: t("g2b.toastFileLoaded"), description: t("g2b.toastFileLoadedDesc", { name: f.name }) });
  }

  async function submit() {
    if (!activeFirmId) return;
    if (!csv.trim()) {
      toast({ variant: "destructive", title: t("g2b.toastNothing"), description: t("g2b.toastNothingDesc") });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ imported: number; period: string }>("/api/v1/gstr2b", {
        firmId: activeFirmId,
        period: importPeriod,
        csv,
      });
      toast({
        title: t("g2b.toastImported"),
        description: t("g2b.toastImportedDesc", { n: res.imported, period: res.period }),
      });
      onImported();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("g2b.toastFailed"),
        description: e instanceof ApiError ? e.message : t("g2b.toastFailedDesc"),
      });
    } finally {
      setSaving(false);
    }
  }

  const previewRows = React.useMemo(() => {
    const lines = csv.trim() ? csv.trim().split(/\r?\n/) : [];
    return lines.slice(0, 4);
  }, [csv]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{t("g2b.importTitle")}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {t("g2b.importDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label={t("g2b.periodFieldLabel")} hint={t("g2b.periodFieldHint")}>
            <Input
              type="month"
              value={importPeriod}
              onChange={(e) => setImportPeriod(e.target.value)}
              className={cn(inputCls, "font-money")}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" /> {t("g2b.uploadCsv")}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} aria-label={t("g2b.uploadAria")} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-dmk-border-medium text-dmk-info hover:bg-dmk-hover"
              onClick={() => setCsv(SAMPLE_CSV)}
            >
              <Loader2 className="hidden" /> {t("g2b.loadSample")}
            </Button>
          </div>

          <Field label={t("g2b.csvFieldLabel")} hint={t("g2b.csvFieldHint")}>
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={7}
              className="bg-dmk-input-well border-dmk-border-subtle font-money text-[11.5px] text-dmk-text-primary dmk-input resize-y"
              placeholder={"GSTIN,TradeName,InvoiceNo,InvoiceDate,TaxableValue,IGST,CGST,SGST,ITC,PlaceOfSupply\n27AAECD1111H1ZP,DMK Polymers,SB-1188,22/08/2026,25700,0,2313,2313,YES,27"}
            />
          </Field>

          {previewRows.length > 0 && (
            <div className="rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary/60 px-3 py-2 overflow-x-auto">
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted mb-1">{t("g2b.preview")}</p>
              {previewRows.map((line, i) => (
                <p key={i} className="font-money text-[10.5px] text-dmk-text-secondary whitespace-nowrap">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="dmk-well px-3 py-2.5 text-[11.5px] text-dmk-text-muted">
            {t("g2b.readonlyNote")}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || !csv.trim()} className="bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t("g2b.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
