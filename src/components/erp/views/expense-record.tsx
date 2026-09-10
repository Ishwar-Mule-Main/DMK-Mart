"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — RECORD EXPENSE — daily operational expense voucher entry
// Coded against:
//   POST /api/v1/expenses                      → voucher + auto journal
//   GET  /api/v1/expenses?firmId=&limit=50     → recent register
//   GET  /api/v1/expenses?firmId=&from=…       → month KPIs
//   GET  /api/v1/expenses/categories?firmId=   → trilingual categories
//   DELETE /api/v1/expenses/{id}?firmId=       → reversal + delete
// The server auto-posts a balanced PAYMENT journal (DEBIT category ·
// CREDIT drawer/bank/CC), so the drawer, Day Book and P&L update the
// instant the voucher is saved.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Banknote,
  CalendarDays,
  Camera,
  CheckCircle2,
  CreditCard,
  FileStack,
  History,
  Landmark,
  Loader2,
  Paperclip,
  Save,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorText,
  Field,
  KpiCard,
  LoadingRows,
  PageHeader,
  inputCls,
} from "../shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types (mirror of the API contract) ──────────────────────────

type PaymentSource = "CASH_DRAWER" | "BANK_CURRENT" | "BANK_CC";
type Lang = "en" | "hi" | "mr";

interface ExpenseCategory {
  id: string;
  code: string;
  nameEnglish: string;
  nameHindi: string;
  nameMarathi: string;
  description?: string | null;
  accountCode: string;
  isActive?: boolean;
  _count?: { expenses: number };
}

interface CategoryNames {
  nameEnglish: string;
  nameHindi: string;
  nameMarathi: string;
}

interface ExpenseRow {
  id: string;
  voucherNumber: string;
  expenseDate: string;
  amount: number;
  paymentSource: PaymentSource;
  paidTo: string | null;
  vehicleNumber: string | null;
  tripId: string | null;
  narration: string | null;
  receiptFileUrl: string | null;
  createdBy?: string | null;
  createdAt?: string;
  category: ExpenseCategory;
  journalEntry?: { id: string; voucherNumber: string } | null;
}

interface ExpensesResponse {
  expenses: ExpenseRow[];
  count: number;
  summary: {
    total: number;
    count: number;
    byCategory: Array<{
      code: string;
      nameEnglish: string;
      nameHindi: string;
      nameMarathi: string;
      total: number;
      count: number;
      percent: number;
    }>;
    bySource: Record<PaymentSource, number>;
  };
}

interface TripLite {
  id: string;
  tripNumber: string;
  vehicleNumber: string;
}

interface JournalLine {
  accountName: string;
  entrySide: "DEBIT" | "CREDIT";
  amount: number;
}

interface SaveResponse {
  voucher: ExpenseRow;
  journal: { id: string; voucherNumber: string; lines: JournalLine[] };
}

const SOURCE_TONE: Record<PaymentSource, "warning" | "info" | "danger"> = {
  CASH_DRAWER: "warning",
  BANK_CURRENT: "info",
  BANK_CC: "danger",
};

const SOURCE_OPTIONS: Array<{
  value: PaymentSource;
  labelKey: string;
  icon: LucideIcon;
  selectedCls: string;
  iconCls: string;
}> = [
  {
    value: "CASH_DRAWER",
    labelKey: "exp.cashDrawer",
    icon: Wallet,
    selectedCls: "border-dmk-warning/70 bg-dmk-warning/10",
    iconCls: "text-dmk-warning",
  },
  {
    value: "BANK_CURRENT",
    labelKey: "exp.bankUpi",
    icon: Landmark,
    selectedCls: "border-dmk-success/70 bg-dmk-success/10",
    iconCls: "text-dmk-success",
  },
  {
    value: "BANK_CC",
    labelKey: "exp.bankCc",
    icon: CreditCard,
    selectedCls: "border-dmk-danger/70 bg-dmk-danger/10",
    iconCls: "text-dmk-danger",
  },
];

const RECEIPT_MAX_BYTES = 3 * 1024 * 1024;

/** Category name in the current UI language (falls back to English). */
function catMain(c: CategoryNames, lang: Lang): string {
  if (lang === "hi") return c.nameHindi || c.nameEnglish;
  if (lang === "mr") return c.nameMarathi || c.nameEnglish;
  return c.nameEnglish || c.nameHindi;
}

/** One other-language name shown as the subtle second line (all words visible). */
function catAlt(c: CategoryNames, lang: Lang): string {
  const other = lang === "en" ? c.nameHindi || c.nameMarathi : c.nameEnglish || c.nameHindi;
  return other && other !== catMain(c, lang) ? other : "";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ExpenseRecordView() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  // ── Reference data ──
  const [categories, setCategories] = React.useState<ExpenseCategory[]>([]);
  const [trips, setTrips] = React.useState<TripLite[]>([]);
  const [booting, setBooting] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  // ── Form state ──
  const [date, setDate] = React.useState(() => toISODate(new Date()));
  const [categoryId, setCategoryId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [source, setSource] = React.useState<PaymentSource>("CASH_DRAWER");
  const [paidTo, setPaidTo] = React.useState("");
  const [vehicle, setVehicle] = React.useState("");
  const [tripSel, setTripSel] = React.useState("NONE");
  const [narration, setNarration] = React.useState("");
  const [receipt, setReceipt] = React.useState<{ dataUrl: string; name: string; size: number } | null>(null);
  const [amountErr, setAmountErr] = React.useState(false);
  const [categoryErr, setCategoryErr] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // ── Success state (replaces the form card after save) ──
  const [saved, setSaved] = React.useState<SaveResponse | null>(null);

  // ── Recent list + month KPIs ──
  const [recent, setRecent] = React.useState<ExpensesResponse | null>(null);
  const [monthData, setMonthData] = React.useState<ExpensesResponse | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setBooting(true);
    setLoadError(null);
    const monthFrom = `${toISODate(new Date()).slice(0, 7)}-01`;
    Promise.allSettled([
      apiGet<ExpenseCategory[]>("/api/v1/expenses/categories", { firmId: activeFirmId }),
      apiGet<{ trips: TripLite[] }>("/api/v1/logistics/trips", { firmId: activeFirmId }),
      apiGet<ExpensesResponse>("/api/v1/expenses", { firmId: activeFirmId, limit: 50 }),
      apiGet<ExpensesResponse>("/api/v1/expenses", { firmId: activeFirmId, from: monthFrom, limit: 500 }),
    ]).then(([cats, trps, rec, mon]) => {
      if (!alive) return;
      const failed = [cats, trps, rec, mon].every((r) => r.status === "rejected");
      if (failed) setLoadError("Failed to load expense data");
      if (cats.status === "fulfilled") setCategories(cats.value ?? []);
      if (trps.status === "fulfilled") setTrips((trps.value?.trips ?? []).slice(0, 20));
      if (rec.status === "fulfilled") setRecent(rec.value);
      if (mon.status === "fulfilled") setMonthData(mon.value);
      setBooting(false);
    });
    return () => {
      alive = false;
    };
  }, [activeFirmId, refreshTick]);

  // ── Vehicle suggestions: trips + previously used expense vehicles ──
  const vehicleSuggestions = React.useMemo(() => {
    const set = new Set<string>();
    for (const tr of trips) {
      const v = tr.vehicleNumber?.trim();
      if (v) set.add(v);
    }
    for (const ex of recent?.expenses ?? []) {
      const v = ex.vehicleNumber?.trim();
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [trips, recent]);

  // ── Month KPI numbers (server month fetch, exact) ──
  const todayIso = toISODate(new Date());
  const monthTotal = monthData?.summary.total ?? 0;
  const monthCount = monthData?.summary.count ?? 0;
  const todayTotal = React.useMemo(
    () =>
      (monthData?.expenses ?? [])
        .filter((e) => toISODate(e.expenseDate) === todayIso)
        .reduce((s, e) => s + e.amount, 0),
    [monthData, todayIso]
  );

  const selectedCat = categories.find((c) => c.id === categoryId) ?? null;

  // ── Receipt picking (FileReader → dataURL, ≤ 3 MB) ──
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (file.size > RECEIPT_MAX_BYTES) {
      toast({ title: t("exp.errReceiptSize"), variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReceipt({ dataUrl: String(reader.result ?? ""), name: file.name, size: file.size });
    };
    reader.onerror = () => {
      toast({ title: t("exp.errReceiptSize"), variant: "destructive" });
    };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setDate(toISODate(new Date()));
    setCategoryId("");
    setAmount("");
    setSource("CASH_DRAWER");
    setPaidTo("");
    setVehicle("");
    setTripSel("NONE");
    setNarration("");
    setReceipt(null);
    setAmountErr(false);
    setCategoryErr(false);
  }

  async function onSave() {
    const amt = Number(amount);
    let ok = true;
    if (!Number.isFinite(amt) || amt <= 0) {
      setAmountErr(true);
      ok = false;
    } else setAmountErr(false);
    if (!categoryId) {
      setCategoryErr(true);
      ok = false;
    } else setCategoryErr(false);
    if (!ok) {
      toast({ title: !categoryId ? t("exp.errCategory") : t("exp.errAmount"), variant: "destructive" });
      return;
    }
    if (!activeFirmId) return;
    setSaving(true);
    try {
      const res = await apiPost<SaveResponse>("/api/v1/expenses", {
        firmId: activeFirmId,
        categoryId,
        amount: amt,
        paymentSource: source,
        expenseDate: date,
        paidTo: paidTo.trim() || undefined,
        vehicleNumber: vehicle.trim() || undefined,
        ...(tripSel !== "NONE" ? { tripId: tripSel } : {}),
        narration: narration.trim() || undefined,
        ...(receipt ? { receiptFileUrl: receipt.dataUrl } : {}),
      });
      setSaved(res);
      resetForm();
      // Push the new voucher to the top of the recent register immediately.
      setRecent((prev) =>
        prev ? { ...prev, expenses: [res.voucher, ...prev.expenses].slice(0, 50), count: prev.count + 1 } : prev
      );
      setRefreshTick((n) => n + 1); // exact month KPIs
      toast({ title: t("exp.saved"), description: res.voucher.voucherNumber });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to save expense",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || !activeFirmId) return;
    setDeleting(true);
    try {
      const res = await apiDelete<{ deleted: boolean; reversalJournalNumber: string }>(
        `/api/v1/expenses/${pendingDelete.id}?firmId=${activeFirmId}`
      );
      toast({ title: t("exp.deleted"), description: res?.reversalJournalNumber });
      setPendingDelete(null);
      setRefreshTick((n) => n + 1);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to delete expense",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4 dmk-enter-stagger">
      <PageHeader title={t("exp.title")} subtitle={t("exp.subtitle")} icon={Wallet} />

      {/* KPI strip — this month / today / voucher count */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label={t("exp.thisMonth")}
          value={formatINR(monthTotal)}
          sub={`${monthCount} ${t("exp.vouchers")}`}
          icon={CalendarDays}
          tone="gold"
        />
        <KpiCard label={t("exp.today")} value={formatINR(todayTotal)} icon={Banknote} tone="default" />
        <KpiCard
          label={t("exp.vouchers")}
          value={String(monthCount)}
          sub={t("exp.thisMonth")}
          icon={FileStack}
          tone="default"
        />
      </div>

      {/* MAIN FORM / SUCCESS */}
      {saved ? (
        <div className="dmk-card p-6 sm:p-8 dmk-enter" role="status">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dmk-success/40 bg-dmk-success/15">
              <CheckCircle2 className="h-9 w-9 text-dmk-success" strokeWidth={1.75} />
            </div>
            <p className="text-[17px] font-bold text-dmk-text-primary">{t("exp.saved")}</p>
            <p className="font-money text-[15px] font-semibold text-dmk-gold">{saved.voucher.voucherNumber}</p>
            <p className="text-[12px] text-dmk-text-muted">
              {t("exp.journalNo")}:{" "}
              <span className="font-money text-dmk-text-secondary">{saved.journal.voucherNumber}</span>
            </p>
          </div>

          {/* Mini double-entry table */}
          <div className="dmk-well mt-5 overflow-hidden">
            <table className="dmk-table">
              <tbody>
                {saved.journal.lines.map((l, i) => (
                  <tr key={`${l.accountName}-${i}`}>
                    <td className="w-24">
                      <Badge tone={l.entrySide === "DEBIT" ? "dr" : "cr"}>
                        {l.entrySide === "DEBIT" ? t("exp.debit") : t("exp.credit")}
                      </Badge>
                    </td>
                    <td className="text-[12.5px] text-dmk-text-secondary">{l.accountName}</td>
                    <td className="num text-right font-money text-[13px]">{formatINR(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-relaxed text-dmk-text-muted">
            <Save className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("exp.journalPosted")}
          </p>
          {saved.voucher.paymentSource === "CASH_DRAWER" && (
            <div className="dmk-well mt-3 flex items-start gap-2 px-3 py-2.5 text-[11.5px] leading-relaxed text-dmk-text-secondary">
              <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0 text-dmk-warning" aria-hidden="true" />
              {t("exp.drawerImpact")}
            </div>
          )}

          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => setSaved(null)}
              className="h-11 gap-2 bg-dmk-yellow px-5 text-[13px] font-semibold text-dmk-bg-primary hover:brightness-110"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              {t("exp.recordAnother")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="dmk-card p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label={t("exp.date")}>
              <Input
                type="date"
                value={date}
                max={toISODate(new Date())}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className={cn(inputCls, "[color-scheme:dark]")}
                aria-label={t("exp.date")}
              />
            </Field>

            <Field label={t("exp.category")}>
              <Select
                value={categoryId || undefined}
                onValueChange={(v) => {
                  setCategoryId(v);
                  setCategoryErr(false);
                }}
              >
                <SelectTrigger
                  className={cn(
                    "h-9 w-full border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary",
                    categoryErr && "border-dmk-danger"
                  )}
                  aria-label={t("exp.category")}
                >
                  <SelectValue placeholder={t("exp.choose")}>
                    {selectedCat ? `${selectedCat.code} · ${catMain(selectedCat, lang)}` : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                  {categories.map((c) => {
                    const main = catMain(c, lang);
                    const alt = catAlt(c, lang);
                    return (
                      <SelectItem key={c.id} value={c.id} className="py-2">
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[13px] leading-tight">
                            {c.code} · {main}
                          </span>
                          {alt && (
                            <span className="text-[10.5px] leading-tight text-dmk-text-muted">{alt}</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {categoryErr && (
                <p className="text-[11.5px] text-dmk-danger" role="alert">
                  {t("exp.errCategory")}
                </p>
              )}
            </Field>

            <Field label={t("exp.amount")}>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-dmk-text-muted"
                  aria-hidden="true"
                >
                  ₹
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountErr(false);
                  }}
                  placeholder="0.00"
                  className={cn(inputCls, "pl-7 font-money text-[14px]", amountErr && "border-dmk-danger")}
                  aria-label={t("exp.amount")}
                />
              </div>
              {amountErr && (
                <p className="text-[11.5px] text-dmk-danger" role="alert">
                  {t("exp.errAmount")}
                </p>
              )}
            </Field>
          </div>

          {/* Paid Through — 3 radio cards */}
          <div className="mt-4">
            <Field label={t("exp.paidThrough")}>
              <div role="radiogroup" aria-label={t("exp.paidThrough")} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SOURCE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = source === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={t(opt.labelKey)}
                      onClick={() => setSource(opt.value)}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors",
                        active
                          ? `${opt.selectedCls} text-dmk-text-primary`
                          : "border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                      )}
                    >
                      <Icon
                        className={cn("h-[18px] w-[18px] shrink-0", active ? opt.iconCls : "text-dmk-text-muted")}
                        strokeWidth={1.75}
                      />
                      <span className="truncate">{t(opt.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label={t("exp.paidTo")}>
              <Input
                value={paidTo}
                onChange={(e) => setPaidTo(e.target.value)}
                placeholder={t("exp.paidToPlaceholder")}
                className={inputCls}
                aria-label={t("exp.paidTo")}
              />
            </Field>

            <Field label={t("exp.vehicle")}>
              <Input
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                placeholder={t("exp.vehiclePlaceholder")}
                list="dmk-expense-vehicles"
                className={inputCls}
                aria-label={t("exp.vehicle")}
              />
              <datalist id="dmk-expense-vehicles">
                {vehicleSuggestions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </Field>

            <Field label={t("exp.trip")}>
              <Select value={tripSel} onValueChange={setTripSel}>
                <SelectTrigger
                  className="h-9 w-full border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary"
                  aria-label={t("exp.trip")}
                >
                  <SelectValue placeholder={t("exp.choose")} />
                </SelectTrigger>
                <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                  <SelectItem value="NONE">{t("exp.tripNone")}</SelectItem>
                  {trips.map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>
                      <span className="text-[13px]">
                        {tr.tripNumber} · {tr.vehicleNumber}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="mt-4">
            <Field label={t("exp.narration")}>
              <Textarea
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder={t("exp.narrationPlaceholder")}
                rows={2}
                className="min-h-[64px] resize-none border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input placeholder:text-dmk-text-disabled"
                aria-label={t("exp.narration")}
              />
            </Field>
          </div>

          {/* Receipt photo — dashed attach row / preview */}
          <div className="mt-4">
            <Field label={t("exp.receipt")}>
              <input
                id="dmk-expense-receipt"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPickFile}
                aria-label={t("exp.attachReceipt")}
              />
              {receipt ? (
                <div className="flex items-center gap-3 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5">
                  <img
                    src={receipt.dataUrl}
                    alt={t("exp.receiptAttached")}
                    className="h-12 w-12 shrink-0 rounded-md border border-dmk-border-subtle object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-dmk-text-primary">{receipt.name}</p>
                    <p className="text-[10.5px] text-dmk-text-muted">{formatBytes(receipt.size)}</p>
                  </div>
                  <Badge tone="success">{t("exp.receiptAttached")}</Badge>
                  <button
                    type="button"
                    onClick={() => setReceipt(null)}
                    aria-label={t("exp.removeReceipt")}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-dmk-text-muted transition-colors hover:bg-dmk-hover hover:text-dmk-danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="dmk-expense-receipt"
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-dmk-border-medium bg-dmk-input-well px-3.5 py-2.5 text-[13px] text-dmk-text-secondary transition-colors hover:bg-dmk-hover hover:text-dmk-text-primary"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-dmk-bg-tertiary border border-dmk-border-subtle">
                    <Camera className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />
                  </span>
                  <span className="truncate">{t("exp.attachReceipt")}</span>
                  <Paperclip className="ml-auto h-3.5 w-3.5 shrink-0 text-dmk-text-muted" aria-hidden="true" />
                </label>
              )}
            </Field>
          </div>

          {loadError && <div className="mt-4"><ErrorText>{loadError}</ErrorText></div>}

          {/* Footer actions */}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={resetForm}
              disabled={saving}
              className="h-11 border-dmk-border-subtle bg-transparent px-5 text-[13px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
            >
              {t("exp.cancel")}
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={saving}
              className="h-11 gap-2 bg-dmk-yellow px-5 text-[13px] font-semibold text-dmk-bg-primary hover:brightness-110"
              aria-label={t("exp.save")}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("exp.saving")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {t("exp.save")}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* RECENT EXPENSES */}
      <div className="dmk-card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-dmk-border-subtle">
          <div className="flex items-center gap-2 min-w-0">
            <History className="h-4 w-4 shrink-0 text-dmk-yellow" strokeWidth={1.75} aria-hidden="true" />
            <h2 className="text-[13px] font-bold text-dmk-text-primary truncate">{t("exp.recentTitle")}</h2>
          </div>
          {recent && (
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary shrink-0">
              {recent.count} {t("exp.vouchers")}
            </span>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-dmk-border-subtle">
          {booting && !recent ? (
            <LoadingRows rows={5} />
          ) : !recent || recent.expenses.length === 0 ? (
            <EmptyState icon={Wallet} title={t("exp.empty")} />
          ) : (
            recent.expenses.map((v) => (
              <div
                key={v.id}
                className="group/row flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-dmk-hover"
              >
                <span className="w-[86px] shrink-0 text-[12px] text-dmk-text-muted whitespace-nowrap">
                  {formatDate(v.expenseDate)}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-[13px] font-medium text-dmk-text-primary">
                      {catMain(v.category, lang)}
                    </span>
                    <span className="dmk-badge bg-dmk-input-well font-mono text-[9.5px] text-dmk-text-muted shrink-0">
                      {v.category.code}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-dmk-text-muted min-w-0">
                    <span className="font-money whitespace-nowrap">{v.voucherNumber}</span>
                    {v.paidTo && <span className="truncate">· {v.paidTo}</span>}
                  </span>
                </span>
                {v.vehicleNumber && (
                  <span className="dmk-badge max-w-[150px] truncate bg-dmk-input-well text-[9.5px] text-dmk-text-secondary">
                    {v.vehicleNumber}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2.5">
                  {v.receiptFileUrl && (
                    <img
                      src={v.receiptFileUrl}
                      alt={t("exp.receiptAttached")}
                      className="h-12 w-12 rounded-md border border-dmk-border-subtle object-cover"
                    />
                  )}
                  <Badge tone={SOURCE_TONE[v.paymentSource] ?? "neutral"}>{v.paymentSource}</Badge>
                  <span className="font-money w-24 text-right text-[13px] font-semibold text-dmk-text-primary">
                    {formatINR(v.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(v)}
                    aria-label={`${t("exp.delete")} ${v.voucherNumber}`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-dmk-text-muted transition-colors hover:bg-dmk-hover hover:text-dmk-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation — server posts a reversal, original journal immutable */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="border-dmk-border-medium bg-dmk-bg-secondary">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">{t("exp.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-secondary">
              {t("exp.deleteConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="h-10 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
              disabled={deleting}
            >
              {t("exp.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-10 bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the API answers
                void confirmDelete();
              }}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : t("exp.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
