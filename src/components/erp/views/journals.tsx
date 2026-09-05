"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — JOURNAL REGISTER + MANUAL JOURNAL ENTRY (R6)
// All vouchers post balanced journals; manual entries accept
// JOURNAL | CONTRA only and are validated ΣDr = ΣCr live client-side.
// Coded against GET/POST /api/v1/ledger/journals + /ledger/trial-balance.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";

import {
  Badge,
  DataTable,
  DateText,
  EmptyState,
  ErrorText,
  Field,
  LoadingRows,
  PageHeader,
  SearchInput,
  inputCls,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { downloadCSV, formatINR, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

// ─── API shapes (verified against route sources) ────────────────

interface JournalLineRow {
  id: string;
  accountId: string;
  accountName: string;
  entrySide: "DEBIT" | "CREDIT";
  debitAmount: number;
  creditAmount: number;
  narration: string;
}

interface JournalEntryRow {
  id: string;
  voucherNumber: string;
  voucherType: string;
  postingDate: string;
  narration: string;
  totalDebit: number;
  totalCredit: number;
  lines: JournalLineRow[];
}

interface TbAccount {
  accountCode: string;
  accountName: string;
  accountClass: string;
}

const VOUCHER_TYPES = [
  "ALL",
  "SALES",
  "PURCHASE",
  "RECEIPT",
  "PAYMENT",
  "JOURNAL",
  "CONTRA",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "OPENING",
] as const;

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface DraftLine {
  accountCode: string;
  entrySide: "DEBIT" | "CREDIT";
  amount: string;
}

export default function JournalsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();

  const [type, setType] = React.useState<string>("ALL");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [rows, setRows] = React.useState<JournalEntryRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Debounced filter reload (search is server-side)
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<JournalEntryRow[]>("/api/v1/ledger/journals", {
          firmId: activeFirmId,
          type: type === "ALL" ? undefined : type,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search.trim() || undefined,
        });
        if (alive) setRows(data);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load journals");
          setRows([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, search ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, type, dateFrom, dateTo, search, refreshKey]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const out: (string | number)[][] = [
      ["Date", "Voucher #", "Type", "Narration", "Total Debit", "Total Credit"],
    ];
    for (const j of rows ?? []) {
      out.push([
        toISODate(j.postingDate),
        j.voucherNumber,
        j.voucherType,
        j.narration,
        round2(j.totalDebit),
        round2(j.totalCredit),
      ]);
      for (const l of j.lines) {
        out.push([
          "",
          `  ↳ ${l.accountName}`,
          l.entrySide,
          l.narration ?? "",
          round2(l.debitAmount),
          round2(l.creditAmount),
        ]);
      }
    }
    downloadCSV(`journals-${toISODate(new Date())}.csv`, out);
    toast({ title: "Exported", description: "Journal register downloaded as CSV." });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journal Register"
        subtitle="Every monetary event posts a balanced double-entry voucher (R6)"
        icon={BookOpenCheck}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={!rows || rows.length === 0}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              disabled={!activeFirmId}
              className="h-9 gap-2 bg-dmk-yellow text-[12.5px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/85"
            >
              <Plus className="h-4 w-4" /> New Journal
            </Button>
          </>
        }
      />

      {/* ── Filters ─────────────────────────────────────── */}
      <div className="dmk-card p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Voucher Type">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className={cn(inputCls, "w-full")}>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium">
              {VOUCHER_TYPES.map((v) => (
                <SelectItem key={v} value={v} className="text-[13px]">
                  {v === "ALL" ? "All Types" : (TYPE_LABEL[v] ?? v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={cn(inputCls, "[color-scheme:dark]")}
          />
        </Field>
        <Field label="Date To">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={cn(inputCls, "[color-scheme:dark]")}
          />
        </Field>
        <Field label="Search">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Narration or voucher #…"
          />
        </Field>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {/* ── Table ───────────────────────────────────────── */}
      {!rows && loading ? (
        <LoadingRows rows={8} />
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No journal vouchers found"
          hint="Adjust filters, or post a manual JOURNAL / CONTRA entry."
          action={
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85"
            >
              <Plus className="h-4 w-4" /> New Journal
            </Button>
          }
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className="w-8" />
              <th>Voucher #</th>
              <th>Date</th>
              <th>Type</th>
              <th>Narration</th>
              <th className="num text-right">Debit (₹)</th>
              <th className="num text-right">Credit (₹)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => {
              const isOpen = expanded.has(j.id);
              return (
                <React.Fragment key={j.id}>
                  <tr
                    className={cn("cursor-pointer", isOpen && "bg-dmk-hover/60")}
                    onClick={() => toggleExpand(j.id)}
                  >
                    <td className="text-dmk-text-muted">
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>
                    <td className="font-money text-[12.5px] whitespace-nowrap">{j.voucherNumber}</td>
                    <td><DateText d={j.postingDate} /></td>
                    <td>
                      <Badge tone={TYPE_TONE[j.voucherType] ?? "neutral"}>
                        {TYPE_LABEL[j.voucherType] ?? j.voucherType}
                      </Badge>
                    </td>
                    <td className="max-w-[280px] lg:max-w-[420px]">
                      <span className="block truncate text-dmk-text-secondary" title={j.narration}>
                        {j.narration || "—"}
                      </span>
                    </td>
                    <td className="num text-right text-dmk-yellow font-semibold">
                      {formatINR(j.totalDebit)}
                    </td>
                    <td className="num text-right text-dmk-info font-semibold">
                      {formatINR(j.totalCredit)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={7} className="bg-dmk-input-well/60 px-0 py-0">
                        <div className="px-4 sm:px-10 py-3">
                          <div className="dmk-well overflow-hidden">
                            <table className="dmk-table">
                              <thead>
                                <tr>
                                  <th>Account</th>
                                  <th>Line Narration</th>
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
                                    <td className="text-dmk-text-muted text-[12px] max-w-[260px]">
                                      <span className="block truncate">{l.narration || "—"}</span>
                                    </td>
                                    <td className="num text-right text-dmk-yellow">
                                      {l.debitAmount ? formatINR(l.debitAmount) : "—"}
                                    </td>
                                    <td className="num text-right text-dmk-info">
                                      {l.creditAmount ? formatINR(l.creditAmount) : "—"}
                                    </td>
                                  </tr>
                                ))}
                                <tr>
                                  <td colSpan={2} className="text-right font-semibold text-dmk-text-secondary">
                                    Voucher Total
                                  </td>
                                  <td className="num text-right text-dmk-yellow font-bold">
                                    {formatINR(j.totalDebit)}
                                  </td>
                                  <td className="num text-right text-dmk-info font-bold">
                                    {formatINR(j.totalCredit)}
                                  </td>
                                </tr>
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
        </DataTable>
      )}

      <p className="text-[11px] text-dmk-text-muted">
        Showing {rows?.length ?? 0} voucher{((rows?.length ?? 0) !== 1) ? "s" : ""} · click a row to expand line detail
      </p>

      <NewJournalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MANUAL JOURNAL DIALOG — live ΣDr vs ΣCr difference chip
// ═══════════════════════════════════════════════════════════════

function NewJournalDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();

  const [accounts, setAccounts] = React.useState<TbAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = React.useState(false);
  const [voucherType, setVoucherType] = React.useState<"JOURNAL" | "CONTRA">("JOURNAL");
  const [postingDate, setPostingDate] = React.useState(() => toISODate(new Date()));
  const [narration, setNarration] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([
    { accountCode: "", entrySide: "DEBIT", amount: "" },
    { accountCode: "", entrySide: "CREDIT", amount: "" },
  ]);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Load COA account list from trial-balance once per dialog open / firm
  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    setAccountsLoading(true);
    apiGet<{ rows: TbAccount[] }>("/api/v1/ledger/trial-balance", { firmId: activeFirmId })
      .then((res) => {
        if (alive) setAccounts(res.rows ?? []);
      })
      .catch(() => {
        if (alive) setAccounts([]);
      })
      .finally(() => {
        if (alive) setAccountsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId]);

  function resetForm() {
    setVoucherType("JOURNAL");
    setPostingDate(toISODate(new Date()));
    setNarration("");
    setLines([
      { accountCode: "", entrySide: "DEBIT", amount: "" },
      { accountCode: "", entrySide: "CREDIT", amount: "" },
    ]);
    setFormError(null);
  }

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { accountCode: "", entrySide: "DEBIT", amount: "" }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)));
  }

  // Live totals — exact to the paisa
  const totalDebit = round2(
    lines.reduce((s, l) => s + (l.entrySide === "DEBIT" ? Number(l.amount) || 0 : 0), 0)
  );
  const totalCredit = round2(
    lines.reduce((s, l) => s + (l.entrySide === "CREDIT" ? Number(l.amount) || 0 : 0), 0)
  );
  const difference = round2(totalDebit - totalCredit);
  const nonZeroLines = lines.filter((l) => l.accountCode && Number(l.amount) > 0).length;
  const balanced = difference === 0 && nonZeroLines >= 2;

  async function save() {
    if (!activeFirmId || !balanced) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiPost("/api/v1/ledger/journals", {
        firmId: activeFirmId,
        voucherType,
        postingDate,
        narration: narration.trim() || undefined,
        lines: lines
          .filter((l) => l.accountCode && Number(l.amount) > 0)
          .map((l) => ({
            accountCode: l.accountCode,
            entrySide: l.entrySide,
            amount: round2(Number(l.amount)),
          })),
      });
      toast({
        title: "Journal posted",
        description: `${voucherType} voucher for ${formatINR(totalDebit)} posted to the books.`,
      });
      resetForm();
      onOpenChange(false);
      onSaved();
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Failed to post journal";
      setFormError(msg);
      toast({ variant: "destructive", title: "Could not post journal", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="bg-dmk-bg-secondary border-dmk-border-medium max-h-[90vh] overflow-y-auto sm:w-[680px]">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary flex items-center gap-2">
            <Scale className="h-4 w-4 text-dmk-yellow" /> New Manual Voucher
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            Manual entries accept JOURNAL (adjustments) and CONTRA (cash ⇄ bank) only.
            Auto vouchers post through documents. Σ Dr must equal Σ Cr (R6).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Voucher Type">
            <Select value={voucherType} onValueChange={(v) => setVoucherType(v as "JOURNAL" | "CONTRA")}>
              <SelectTrigger className={cn(inputCls, "w-full")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium">
                <SelectItem value="JOURNAL">JOURNAL</SelectItem>
                <SelectItem value="CONTRA">CONTRA</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Posting Date">
            <Input
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
              className={cn(inputCls, "[color-scheme:dark]")}
            />
          </Field>
          <Field label="Narration">
            <Input
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="e.g. Depreciation for the month"
              className={inputCls}
            />
          </Field>
        </div>

        {/* ── Lines ─────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
              Journal Lines
            </Label>
            {accountsLoading && (
              <span className="flex items-center gap-1.5 text-[11px] text-dmk-text-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> loading accounts…
              </span>
            )}
          </div>

          {lines.map((line, idx) => (
            <div key={idx} className="dmk-well p-2.5 grid grid-cols-1 sm:grid-cols-[1fr_120px_110px_36px] gap-2 items-center">
              <Select
                value={line.accountCode || undefined}
                onValueChange={(v) => updateLine(idx, { accountCode: v })}
              >
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-h-64">
                  {accounts.map((a) => (
                    <SelectItem key={a.accountCode} value={a.accountCode} className="text-[12.5px]">
                      {a.accountCode} — {a.accountName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RadioGroup
                value={line.entrySide}
                onValueChange={(v) => updateLine(idx, { entrySide: v as "DEBIT" | "CREDIT" })}
                className="flex items-center gap-3 h-9"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="DEBIT" id={`side-${idx}-dr`} className="border-dmk-border-medium" />
                  <Label htmlFor={`side-${idx}-dr`} className="text-[12px] text-dmk-yellow cursor-pointer font-medium">Dr</Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="CREDIT" id={`side-${idx}-cr`} className="border-dmk-border-medium" />
                  <Label htmlFor={`side-${idx}-cr`} className="text-[12px] text-dmk-info cursor-pointer font-medium">Cr</Label>
                </div>
              </RadioGroup>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={line.amount}
                onChange={(e) => updateLine(idx, { amount: e.target.value })}
                placeholder="0.00"
                className={cn(inputCls, "text-right font-money")}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeLine(idx)}
                disabled={lines.length <= 2}
                className="h-9 w-9 text-dmk-text-muted hover:text-dmk-danger hover:bg-transparent"
                aria-label={`Remove line ${idx + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={addLine}
            className="h-8 gap-1.5 border-dmk-border-subtle bg-transparent text-[12px] hover:bg-dmk-hover"
          >
            <Plus className="h-3.5 w-3.5" /> Add Line
          </Button>
        </div>

        {/* ── Live balance chip + totals ────────────────── */}
        <div className="dmk-well p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-[12.5px]">
            <span className="text-dmk-text-secondary">
              Σ Dr <span className="font-money font-semibold text-dmk-yellow">{formatINR(totalDebit)}</span>
            </span>
            <span className="text-dmk-text-secondary">
              Σ Cr <span className="font-money font-semibold text-dmk-info">{formatINR(totalCredit)}</span>
            </span>
          </div>
          {balanced ? (
            <span className="dmk-badge dmk-badge-success">Balanced ✓</span>
          ) : (
            <span className="dmk-badge dmk-badge-danger">
              Difference {formatINR(Math.abs(difference))} {difference > 0 ? "(Cr short)" : "(Dr short)"}
            </span>
          )}
        </div>

        {formError && <ErrorText>{formError}</ErrorText>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { resetForm(); onOpenChange(false); }}
            className="h-9 border-dmk-border-subtle bg-transparent hover:bg-dmk-hover"
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!balanced || saving}
            className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Post Voucher
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
