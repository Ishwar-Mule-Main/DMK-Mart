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
  CheckCircle2,
  Download,
  FileWarning,
  GitCompareArrows,
  HelpCircle,
  Loader2,
  Scale,
  Upload,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
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

function statusBadge(s: Gstr2bRecordRow["status"]) {
  if (s === "MATCHED") return <Badge tone="success">MATCHED</Badge>;
  if (s === "AMOUNT_MISMATCH") return <Badge tone="warning">AMOUNT MISMATCH</Badge>;
  return <Badge tone="danger">MISSING IN BOOKS</Badge>;
}

/** How the row was matched — bill number (exact) vs GSTIN + amount (best-fit). */
function basisBadge(basis: Gstr2bRecordRow["matchBasis"]) {
  if (basis === "BILL_NO")
    return (
      <span
        className="dmk-badge bg-dmk-gold/15 text-dmk-gold"
        title="Matched by the vendor bill number captured on the PO — exact identity"
      >
        BILL NO
      </span>
    );
  if (basis === "AMOUNT")
    return (
      <span
        className="dmk-badge bg-dmk-info/15 text-dmk-info"
        title="Matched by supplier GSTIN + amount proximity — verify manually if unsure"
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
          setError(e instanceof Error ? e.message : "Failed to load reconciliation");
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
      [`GSTR-2B Reconciliation · ${data.period}`, `Firm ${data.firmName} (${data.firmGstin})`],
      ["Source", "GSTIN", "Trade Name", "Invoice #", "Date", "Taxable", "IGST", "CGST", "SGST", "Grand", "ITC", "Status", "Match Basis", "Matched PO"],
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
    toast({ title: "Exported", description: `Reconciliation for ${data.period} written to CSV.` });
  }

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title="GSTR-2B Reconciliation"
        subtitle="Import supplier-reported ITC and match it against confirmed purchases — catch missing bills before filing"
        icon={GitCompareArrows}
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value || currentPeriod())}
              className={cn(inputCls, "w-[150px] font-money")}
              aria-label="Return period"
            />
            <Button
              size="sm"
              className="h-9 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-4 w-4" /> Import 2B CSV
            </Button>
          </div>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={GitCompareArrows} title="Reconciliation unavailable" hint="Refresh once the firm data is loaded." />
      ) : (
        <>
          {/* KPI row */}
          <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="2B Records" value={String(s!.records2b)} tone="blue" icon={GitCompareArrows} sub={`${s!.matched} matched · ${s!.billMatched} by bill no.`} />
            <KpiCard label="ITC as per 2B" value={formatINR(s!.itc2b)} tone="info" icon={Download} sub="Supplier-reported tax credits" />
            <KpiCard label="ITC as per Books" value={formatINR(s!.itcBooks)} tone="default" icon={Scale} sub={`${data.booksTotal} confirmed bill(s) in period`} />
            <KpiCard label="Matched ITC" value={formatINR(s!.matchedItc)} tone="success" icon={CheckCircle2} sub="Safe to claim in GST return" />
            <KpiCard label="ITC at Risk" value={formatINR(s!.missingItc)} tone="orange" icon={AlertTriangle} sub={`${s!.missingInBooks + s!.mismatches} 2B row(s) unresolved`} />
            <KpiCard label="Net ITC Risk" value={formatINR(s!.netItcRisk)} tone={s!.netItcRisk > 0.009 ? "danger" : "success"} icon={FileWarning} sub="2B risk − books-only tax" />
          </div>

          {/* Guidance strip */}
          <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
            <HelpCircle className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
            <p className="text-[12px] text-dmk-text-secondary">
              <span className="font-semibold text-dmk-text-primary">How matching works:</span> when a PO carries the supplier's
              bill number it is matched <Badge tone="success">BILL NO</Badge> first — exact identity, immune to amount tweaks.
              Remaining rows match by <Badge tone="info">AMOUNT</Badge> — supplier GSTIN plus ±₹1/±0.5% proximity on grand or
              taxable value. A GSTIN match with no amount fit flags an <Badge tone="warning">AMOUNT MISMATCH</Badge> (period
              cuts — bill in Aug, GRN in Sep — are the usual culprit). Rows with a GSTIN absent from books flag{" "}
              <Badge tone="danger">MISSING IN BOOKS</Badge>. Books-only bills appear under <Badge tone="info">MISSING IN 2B</Badge>.
            </p>
          </div>

          {records.length === 0 && data.booksTotal === 0 ? (
            <div className="dmk-card">
              <EmptyState
                icon={GitCompareArrows}
                title={`No 2B data imported for ${period}`}
                hint="Import the GSTR-2B CSV downloaded from the GST portal to reconcile ITC."
                action={
                  <Button size="sm" className="bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold" onClick={() => setImportOpen(true)}>
                    <Upload className="h-4 w-4" /> Import 2B CSV
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
                    Supplier rows (GSTR-2B) — {period}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportCsv}
                    disabled={records.length === 0 && data.books.length === 0}
                    className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
                  >
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
                <div className="overflow-x-auto min-h-[200px] max-h-[calc(100vh-560px)] overflow-y-auto">
                  {records.length === 0 ? (
                    <EmptyState
                      icon={GitCompareArrows}
                      title="No 2B rows for this period"
                      hint="Import the portal CSV or pick another period."
                    />
                  ) : (
                    <table className="dmk-table min-w-[1080px]">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Supplier</th>
                          <th>Invoice</th>
                          <th className="num text-right">Taxable (₹)</th>
                          <th className="num text-right">IGST (₹)</th>
                          <th className="num text-right">CGST+SGST (₹)</th>
                          <th className="num text-right">Total (₹)</th>
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
                                {statusBadge(r.status)}
                                {basisBadge(r.matchBasis)}
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
                                <Badge tone="neutral">RESTRICTED</Badge>
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
                    In books, missing in 2B — {data.books.length} of {data.booksTotal} bill{data.booksTotal !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  {data.books.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <CheckCircle2 className="h-8 w-8 text-dmk-success mx-auto" />
                      <p className="text-[12.5px] text-dmk-text-secondary mt-2">
                        Every confirmed bill in {period} is reported by suppliers in 2B — clean period.
                      </p>
                    </div>
                  ) : (
                    <table className="dmk-table min-w-[860px]">
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>Vendor</th>
                          <th>GSTIN</th>
                          <th>Vendor Bill</th>
                          <th className="num text-right">Taxable (₹)</th>
                          <th className="num text-right">Tax (₹)</th>
                          <th className="num text-right">Grand (₹)</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.books.map((b) => (
                          <tr key={b.poId}>
                            <td className="font-money text-[12px] font-semibold text-dmk-text-primary">
                              {b.poNumber}
                              {b.vendorBillNo && (
                                <span className="block text-[10px] font-normal text-dmk-text-muted">Bill {b.vendorBillNo}</span>
                              )}
                            </td>
                            <td className="text-[13px] max-w-[220px] truncate">{b.vendorName}</td>
                            <td className="font-money text-[11px] text-dmk-text-muted">{b.gstin || "—"}</td>
                            <td className="font-money text-[11.5px] text-dmk-text-secondary">{b.vendorBillNo || "—"}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">{formatINR(b.taxable)}</td>
                            <td className="num text-right font-money text-dmk-text-secondary">{formatINR(b.igst + b.cgst + b.sgst)}</td>
                            <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(b.grand)}</td>
                            <td><Badge tone="info">MISSING IN 2B</Badge></td>
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
    toast({ title: "File loaded", description: `${f.name} — review the preview below and import.` });
  }

  async function submit() {
    if (!activeFirmId) return;
    if (!csv.trim()) {
      toast({ variant: "destructive", title: "Nothing to import", description: "Paste CSV text, upload a file, or load the sample." });
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
        title: "GSTR-2B imported",
        description: `${res.imported} supplier row(s) recorded for ${res.period} — existing rows for the period were replaced.`,
      });
      onImported();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: e instanceof ApiError ? e.message : "Could not import the CSV.",
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
      <DialogContent className="sm:max-w-xl dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Import GSTR-2B CSV</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Download B2B invoices from the GST portal, then paste or upload them here. Importing a period replaces its rows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Return period *" hint="Month the supplier invoices were reported in">
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
              <Upload className="h-3.5 w-3.5" /> Upload .csv
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} aria-label="Upload GSTR-2B CSV file" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-dmk-border-medium text-dmk-info hover:bg-dmk-hover"
              onClick={() => setCsv(SAMPLE_CSV)}
            >
              <Loader2 className="hidden" /> Load sample rows
            </Button>
          </div>

          <Field label="CSV text *" hint="Columns: GSTIN, TradeName, InvoiceNo, InvoiceDate (dd/mm/yyyy), TaxableValue, IGST, CGST, SGST, ITC (YES/NO), PlaceOfSupply">
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
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted mb-1">Preview (first rows)</p>
              {previewRows.map((line, i) => (
                <p key={i} className="font-money text-[10.5px] text-dmk-text-secondary whitespace-nowrap">
                  {line}
                </p>
              ))}
            </div>
          )}

          <div className="dmk-well px-3 py-2.5 text-[11.5px] text-dmk-text-muted">
            Matching is read-only — importing never changes books. Unmatched rows simply surface as exceptions for follow-up
            (e.g. vendor not booked, amount drift, or period cut).
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !csv.trim()} className="bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-semibold">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
