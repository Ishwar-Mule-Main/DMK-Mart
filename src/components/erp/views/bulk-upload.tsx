"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Bulk Upload — CSV import wizard (R2)
// Step 1 Source → Step 2 Validate (dry-run) → Step 3 Commit
// CSV parsed client-side (quotes + escaped quotes + CRLF aware)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Check, Download, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";

import { PageHeader, Badge, Money, ErrorText, EmptyState } from "../shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ─── API response types (per bulk-upload route) ─────────────────

interface ValidRow {
  rowNumber: number;
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  hsnCode: string;
  gstRate: number;
  purchaseCost: number;
  tier1Distributor: number;
  tier2Wholesale: number;
  tier3SemiWholesale: number;
  tier4Retailer: number;
  tier5Mrp: number;
  openingStock: number;
  openingDamagedStock: number;
  lowStockThreshold: number;
  weightGrams: number | null;
  barcode: string;
  status: "VALID";
}

interface InvalidRow {
  rowNumber: number;
  sku: string;
  errors: string[];
}

interface DryRunResponse {
  totalRows: number;
  validRows: ValidRow[];
  invalidRows: InvalidRow[];
}

interface CommitResponse {
  created: number;
  updated: number;
  failed: number;
  invalidRows: InvalidRow[];
  errors: string[];
}

// ─── Client-side CSV parsing (RFC-4180-ish, no deps) ────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0].trim() !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
  }
  return rows;
}

function csvToRecords(text: string): Record<string, string>[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const headers = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
}

// ─── Step indicator ─────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  const { t } = useT();
  const steps = [t("bul.step1"), t("bul.step2"), t("bul.step3")];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[11.5px] font-bold border transition-colors",
                step > i + 1
                  ? "bg-dmk-success/15 border-dmk-success/40 text-dmk-success"
                  : step === i + 1
                    ? "bg-dmk-blue/15 border-dmk-blue/50 text-dmk-blue"
                    : "bg-dmk-input-well border-dmk-border-subtle text-dmk-text-muted"
              )}
            >
              {step > i + 1 ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[12px]",
                step === i + 1 ? "text-dmk-text-primary font-semibold" : "text-dmk-text-muted"
              )}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn("h-px w-6 sm:w-10", step > i + 1 ? "bg-dmk-success/50" : "bg-dmk-border-subtle")}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function BulkUploadView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { t } = useT();

  const [step, setStep] = React.useState(1);
  const [csvText, setCsvText] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [records, setRecords] = React.useState<Record<string, string>[]>([]);
  const [dryRun, setDryRun] = React.useState<DryRunResponse | null>(null);
  const [commitRes, setCommitRes] = React.useState<CommitResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setStep(1);
    setCsvText("");
    setFileName(null);
    setRecords([]);
    setDryRun(null);
    setCommitRes(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setCsvText(text);
      setError(null);
    } catch {
      setError(t("bul.fileReadErr"));
    }
  };

  const validate = async () => {
    if (!activeFirmId) return;
    const recs = csvToRecords(csvText);
    if (recs.length === 0) {
      setError(t("bul.noRows"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<DryRunResponse>("/api/v1/products/bulk-upload", {
        firmId: activeFirmId,
        commit: false,
        rows: recs,
      });
      setRecords(recs);
      setDryRun(res);
      setStep(2);
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : t("bul.validationFailed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!activeFirmId || !records.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<CommitResponse>("/api/v1/products/bulk-upload", {
        firmId: activeFirmId,
        commit: true,
        rows: records,
      });
      setCommitRes(res);
      setStep(3);
      toast({
        title: t("bul.toastComplete"),
        description: t("bul.toastCompleteDesc", { c: res.created, u: res.updated, f: res.failed }),
        variant: res.failed > 0 ? "destructive" : "default",
      });
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : t("bul.importFailed");
      setError(msg);
      toast({ title: t("bul.importFailed"), description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const validPreview = (dryRun?.validRows ?? []).slice(0, 100);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("prod.bulkUpload")}
        subtitle={t("bul.subtitle")}
      />

      <div className="dmk-card p-4">
        <StepDots step={step} />
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {/* ── STEP 1: Source ─────────────────────────────── */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="dmk-card p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                <Download className="h-4 w-4 text-dmk-yellow" />
              </div>
              <div>
                <h2 className="text-[14px] font-semibold text-dmk-text-primary">{t("bul.step1Title")}</h2>
                <p className="text-[11.5px] text-dmk-text-muted">
                  {t("bul.templateHint")}
                </p>
              </div>
            </div>
            <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
              {t("bul.templateDesc")}
            </p>
            <a
              href="/api/v1/products/template"
              download
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-dmk-blue px-3.5 text-[12.5px] font-semibold text-white hover:brightness-110 transition-all"
            >
              <Download className="h-3.5 w-3.5" />
              {t("bul.downloadTemplate")}
            </a>
          </div>

          <div className="dmk-card p-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                <Upload className="h-4 w-4 text-dmk-gold" />
              </div>
              <div>
                <h2 className="text-[14px] font-semibold text-dmk-text-primary">{t("bul.step2Title")}</h2>
                <p className="text-[11.5px] text-dmk-text-muted">{t("bul.provideHint")}</p>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void onFilePicked(e.target.files?.[0])}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover text-[12.5px]"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {t("bul.chooseFile")}
              </Button>
              {fileName && <span className="text-[11.5px] text-dmk-text-secondary truncate">{fileName}</span>}
            </div>
            <Textarea
              rows={5}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setFileName(null);
              }}
              placeholder={"SKU,Product Name,Category,…,Price_Tier5_MRP,Opening Stock\nDMK-1001,Magnum Box 50L,Storage,…,399,120"}
              className="bg-dmk-input-well border-dmk-border-subtle text-[12px] font-money text-dmk-text-primary placeholder:text-dmk-text-disabled resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-dmk-text-muted">
                {csvText.trim() ? t("bul.rowsDetected", { n: csvToRecords(csvText).length }) : t("bul.waiting")}
              </span>
              <Button size="sm" onClick={() => void validate()} disabled={busy || !csvText.trim()} className="h-9">
                {busy ? t("bul.validating") : t("bul.validateBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Validate / preview ─────────────────── */}
      {step === 2 && dryRun && (
        <div className="space-y-4">
          <div className="dmk-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="neutral">{t("bul.totalN", { n: dryRun.totalRows })}</Badge>
              <Badge tone="success">{t("bul.validN", { n: dryRun.validRows.length })}</Badge>
              <Badge tone={dryRun.invalidRows.length > 0 ? "danger" : "neutral"}>
                {t("bul.invalidN", { n: dryRun.invalidRows.length })}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(1)}
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
              >
                {t("bul.back")}
              </Button>
              <Button
                size="sm"
                onClick={() => void commit()}
                disabled={busy || dryRun.validRows.length === 0}
                className="h-9"
              >
                {busy ? t("bul.importing") : t("bul.importBtn", { n: dryRun.validRows.length })}
              </Button>
            </div>
          </div>

          {dryRun.invalidRows.length > 0 && (
            <div className="dmk-card">
              <div className="px-4 py-3 border-b border-dmk-border-subtle">
                <h3 className="text-[13.5px] font-semibold text-dmk-danger">{t("bul.invalidRows")}</h3>
                <p className="text-[11px] text-dmk-text-muted">{t("bul.invalidRowsHint")}</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="dmk-table">
                  <thead>
                    <tr>
                      <th className="w-16">{t("bul.colRow")}</th>
                      <th className="w-36">{t("cmn.sku")}</th>
                      <th>{t("bul.colErrors")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRun.invalidRows.map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="font-money text-dmk-text-muted">{r.rowNumber}</td>
                        <td className="font-money text-[12px]">{r.sku || "—"}</td>
                        <td className="text-[12px] text-dmk-danger">{r.errors.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="dmk-card">
            <div className="px-4 py-3 border-b border-dmk-border-subtle">
              <h3 className="text-[13.5px] font-semibold text-dmk-text-primary">
                {t("bul.validRows")} {dryRun.validRows.length > 100 && <span className="text-dmk-text-muted font-normal">{t("bul.showingFirst", { n: 100 })}</span>}
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th className="w-16">{t("bul.colRow")}</th>
                    <th>{t("cmn.sku")}</th>
                    <th>{t("cmn.name")}</th>
                    <th>{t("cmn.category")}</th>
                    <th className="num">{t("prod.tblGst")}</th>
                    <th className="num">{t("prod.tblCost")}</th>
                    <th className="num">{t("prod.tblMrp")}</th>
                    <th className="num">{t("bul.colOpening")}</th>
                  </tr>
                </thead>
                <tbody>
                  {validPreview.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="font-money text-dmk-text-muted">{r.rowNumber}</td>
                      <td className="font-money text-[12.5px] text-dmk-text-secondary">{r.sku}</td>
                      <td className="font-medium max-w-[220px] truncate" title={r.name}>
                        {r.name}
                      </td>
                      <td className="text-dmk-text-secondary">{r.category}</td>
                      <td className="num text-dmk-text-secondary">{r.gstRate}%</td>
                      <td className="num">
                        <Money value={r.purchaseCost} className="text-dmk-text-secondary" />
                      </td>
                      <td className="num">
                        <Money value={r.tier5Mrp} />
                      </td>
                      <td className="num text-dmk-text-secondary">{r.openingStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: Result ─────────────────────────────── */}
      {step === 3 && commitRes && (
        <div className="space-y-4">
          <div className="dmk-card p-6 text-center space-y-1">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-dmk-success/15 border border-dmk-success/30">
              <Check className="h-6 w-6 text-dmk-success" />
            </div>
            <h2 className="text-[16px] font-bold text-dmk-text-primary mt-2">{t("bul.finishedTitle")}</h2>
            <p className="text-[12px] text-dmk-text-muted">{t("bul.finishedDesc")}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("bul.created")}</span>
              <p className="font-money text-[24px] font-semibold text-dmk-success mt-1">{commitRes.created}</p>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("bul.updated")}</span>
              <p className="font-money text-[24px] font-semibold text-dmk-info mt-1">{commitRes.updated}</p>
            </div>
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("bul.failed")}</span>
              <p className={cn("font-money text-[24px] font-semibold mt-1", commitRes.failed > 0 ? "text-dmk-danger" : "text-dmk-text-primary")}>
                {commitRes.failed}
              </p>
            </div>
          </div>

          {(commitRes.errors.length > 0 || commitRes.invalidRows.length > 0) && (
            <div className="dmk-card">
              <div className="px-4 py-3 border-b border-dmk-border-subtle">
                <h3 className="text-[13.5px] font-semibold text-dmk-danger">{t("bul.rowFailures")}</h3>
              </div>
              <ul className="max-h-64 overflow-y-auto px-4 py-2 space-y-1.5">
                {commitRes.errors.map((err, i) => (
                  <li key={`err-${i}`} className="text-[12px] text-dmk-danger">
                    {err}
                  </li>
                ))}
                {commitRes.invalidRows.map((r) => (
                  <li key={`inv-${r.rowNumber}`} className="text-[12px] text-dmk-danger">
                    {t("bul.rowFailure", { row: r.rowNumber, sku: r.sku || t("bul.noSku"), errors: r.errors.join(" · ") })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-center">
            <Button onClick={reset} className="h-9 gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              {t("bul.doneAnother")}
            </Button>
          </div>
        </div>
      )}

      {/* Safety net for unreachable states */}
      {step === 2 && !dryRun && (
        <div className="dmk-card">
          <EmptyState
            icon={FileSpreadsheet}
            title={t("bul.nothingToPreview")}
            hint={t("bul.nothingToPreviewHint")}
          />
        </div>
      )}
    </div>
  );
}
