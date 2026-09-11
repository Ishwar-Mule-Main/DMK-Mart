"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — RECURRING BILLING (standing-order templates)
// Templates auto-post tax invoices through the shared invoice
// engine: tier pricing + bulk discounts + GST + credit control +
// stock + ledger + journals. Gold action = generate all due now.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  ChevronDown,
  History,
  IndianRupee,
  Loader2,
  Pause,
  Pencil,
  Play,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  SkipForward,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import { calculateBulkPricing, TIERS } from "@/lib/pricing";
import type {
  Customer,
  Product,
  RecurringTemplate,
  RecurringGenerateResponse,
  RecurringRunsResponse,
} from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  Money,
} from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { useT, type TFn } from "@/lib/i18n";
import { filterByQuery } from "@/lib/search-rank";
import { cn } from "@/lib/utils";

// ── local helpers (mirror server math exactly) ───────────────────
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeProducts(res: unknown): Product[] {
  if (Array.isArray(res)) return res as Product[];
  const obj = res as { products?: Product[] } | null;
  return obj?.products ?? [];
}

const FREQUENCIES = ["WEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY"] as const;

const PAYMENT_MODES = ["CREDIT", "CASH", "UPI", "CARD", "NEFT"] as const;

function paymentBadge(mode: string) {
  switch (mode) {
    case "CREDIT":
      return <Badge tone="warning">CREDIT</Badge>;
    case "CASH":
      return <Badge tone="success">CASH</Badge>;
    case "UPI":
      return <Badge tone="info">UPI</Badge>;
    case "NEFT":
      return <Badge tone="info">NEFT</Badge>;
    default:
      return <Badge tone="neutral">{mode}</Badge>;
  }
}

/** Translated frequency label — falls back to the raw enum. */
function frequencyLabel(t: TFn, f: string): string {
  switch (f) {
    case "WEEKLY": return t("rec.freqWeekly");
    case "MONTHLY": return t("rec.freqMonthly");
    case "BIMONTHLY": return t("rec.freqBimonthly");
    case "QUARTERLY": return t("rec.freqQuarterly");
    default: return f;
  }
}

/** Translated payment-mode label — enum codes (UPI etc.) stay as-is. */
function payModeLabel(t: TFn, m: string): string {
  switch (m) {
    case "CREDIT": return t("rec.payCredit");
    case "CASH": return t("rec.payCash");
    case "CARD": return t("rec.payCard");
    case "NEFT": return t("rec.payNeft");
    default: return m;
  }
}

/** Client replica of the server estimate (tier → bulk → GST). */
function estimateLine(
  product: Product,
  qty: number,
  manualPct: number | null,
  tierKey: string,
  intra: boolean
) {
  const tierPrice = (product[tierKey as keyof Product] as number) || 0;
  const base = tierPrice > 0 ? tierPrice : product.tier4Retailer;
  const bulk = calculateBulkPricing(base, qty, manualPct ?? 0);
  const rate = product.gstRate;
  const tax = intra
    ? round2(bulk.taxable * (rate / 200)) * 2
    : round2(bulk.taxable * (rate / 100));
  return { bulk, tax: round2(tax), total: round2(bulk.taxable + tax) };
}

// ── form line shape ──────────────────────────────────────────────
interface Line {
  productId: string;
  qty: string;
  disc: string; // "" = auto
}

const emptyLine: Line = { productId: "", qty: "", disc: "" };

export default function RecurringView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const activeFirm = useActiveFirm();

  const [rows, setRows] = React.useState<RecurringTemplate[] | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("ALL");

  // customers + products directory for the dialog
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);

  // dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editOf, setEditOf] = React.useState<RecurringTemplate | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [frequency, setFrequency] = React.useState("MONTHLY");
  const [paymentMode, setPaymentMode] = React.useState("CREDIT");
  const [startDate, setStartDate] = React.useState(() => toISODate(new Date()));
  const [endDate, setEndDate] = React.useState("");
  const [skipUntil, setSkipUntil] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [autoPost, setAutoPost] = React.useState(true);
  const [lines, setLines] = React.useState<Line[]>([{ ...emptyLine }]);

  // row actions
  const [deleteOf, setDeleteOf] = React.useState<RecurringTemplate | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  // Expandable product list per template row
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [genResult, setGenResult] = React.useState<RecurringGenerateResponse | null>(null);

  // run-history (subscription ledger) dialog
  const [runsOf, setRunsOf] = React.useState<RecurringTemplate | null>(null);
  const [runsData, setRunsData] = React.useState<RecurringRunsResponse | null>(null);
  const [runsLoading, setRunsLoading] = React.useState(false);
  const [runsError, setRunsError] = React.useState<string | null>(null);
  const [autoAlive, setAutoAlive] = React.useState<boolean | null>(null);

  // ── load templates ────────────────────────────────────────────
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiGet<RecurringTemplate[]>("/api/v1/recurring", { firmId: activeFirmId });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: t("rec.errLoad"), description: e.message });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, refresh, toast, t]);

  // ── load directory once per firm ──────────────────────────────
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    (async () => {
      const [c, p] = await Promise.allSettled([
        apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId }),
        apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" }),
      ]);
      if (!alive) return;
      if (c.status === "fulfilled") setCustomers(c.value);
      if (p.status === "fulfilled") setProducts(normalizeProducts(p.value));
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  // ── dialog helpers ────────────────────────────────────────────
  // Scheduler liveness — one light probe so the header can show the
  // "auto-poster live" pill (Settings holds the full heartbeat card).
  React.useEffect(() => {
    let alive = true;
    apiGet<{ status: { alive: boolean } }>("/api/v1/recurring/scheduler")
      .then((r) => {
        if (alive) setAutoAlive(!!r.status?.alive);
      })
      .catch(() => {
        if (alive) setAutoAlive(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  function openNew() {
    setEditOf(null);
    setName("");
    setCustomerId("");
    setFrequency("MONTHLY");
    setPaymentMode("CREDIT");
    setStartDate(toISODate(new Date()));
    setEndDate("");
    setSkipUntil("");
    setNotes("");
    setAutoPost(true);
    setLines([{ ...emptyLine }]);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(tpl: RecurringTemplate) {
    setEditOf(tpl);
    setName(tpl.name);
    setCustomerId(tpl.customerId);
    setFrequency(tpl.frequency);
    setPaymentMode(tpl.paymentMode);
    setStartDate(toISODate(new Date(tpl.startDate)));
    setEndDate(tpl.endDate ? toISODate(new Date(tpl.endDate)) : "");
    setSkipUntil(tpl.skipUntil ? toISODate(new Date(tpl.skipUntil)) : "");
    setNotes(tpl.notes);
    setAutoPost(tpl.autoPost !== false);
    setLines(
      tpl.items.map((i) => ({
        productId: i.productId,
        qty: String(i.quantity),
        disc: i.manualDiscountPct === null || i.manualDiscountPct === undefined ? "" : String(i.manualDiscountPct),
      }))
    );
    setFormError(null);
    setFormOpen(true);
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const intra =
    !selectedCustomer || !activeFirm ? true : selectedCustomer.stateCode === activeFirm.stateCode;
  const tierKey =
    selectedCustomer && TIERS.some((t) => t.key === selectedCustomer.assignedTier)
      ? selectedCustomer.assignedTier
      : "tier4Retailer";

  // live preview (same math as the server estimate)
  const preview = React.useMemo(() => {
    let taxable = 0;
    let tax = 0;
    let valid = true;
    for (const l of lines) {
      const p = products.find((x) => x.id === l.productId);
      const qty = Number(l.qty);
      if (!p || !(qty > 0)) {
        valid = false;
        continue;
      }
      const est = estimateLine(p, qty, l.disc === "" ? null : Number(l.disc), tierKey, intra);
      taxable = round2(taxable + est.bulk.taxable);
      tax = round2(tax + est.tax);
    }
    return { taxable, tax, total: round2(taxable + tax), valid };
  }, [lines, products, tierKey, intra]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function validateForm(): string | null {
    if (!name.trim()) return t("rec.errName");
    if (!customerId) return t("rec.errCustomer");
    const clean = lines.filter((l) => l.productId);
    if (clean.length === 0) return t("rec.errLines");
    for (const l of clean) {
      if (!(Number(l.qty) > 0)) return t("rec.errQty");
      if (l.disc !== "" && (Number(l.disc) < 0 || Number(l.disc) > 100))
        return t("rec.errDisc");
    }
    if (endDate && startDate && endDate < startDate) return t("rec.errEnd");
    if (skipUntil && startDate && skipUntil < startDate) return t("rec.errSkip");
    return null;
  }

  async function submitTemplate() {
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      firmId: activeFirmId,
      name: name.trim(),
      customerId,
      frequency,
      paymentMode,
      startDate,
      endDate: endDate || null,
      skipUntil: skipUntil || null,
      notes: notes.trim(),
      autoPost,
      lines: lines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId,
          quantity: Number(l.qty),
          manualDiscountPct: l.disc === "" ? null : Number(l.disc),
        })),
    };
    try {
      if (editOf) {
        await apiPatch<RecurringTemplate>("/api/v1/recurring", { id: editOf.id, ...payload });
        toast({ title: t("rec.toastUpdated"), description: t("rec.toastUpdatedDesc", { name: payload.name }) });
      } else {
        await apiPost<RecurringTemplate>("/api/v1/recurring", payload);
        toast({ title: t("rec.toastCreated"), description: t("rec.toastCreatedDesc", { name: payload.name }) });
      }
      setFormOpen(false);
      setRefresh((r) => r + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t("rec.errSave"));
    } finally {
      setSaving(false);
    }
  }

  // ── row actions ───────────────────────────────────────────────
  function openRuns(tpl: RecurringTemplate) {
    if (!activeFirmId) return;
    setRunsOf(tpl);
    setRunsData(null);
    setRunsError(null);
    setRunsLoading(true);
    apiGet<RecurringRunsResponse>("/api/v1/recurring/runs", { firmId: activeFirmId, templateId: tpl.id })
      .then((res) => setRunsData(res))
      .catch((e) => setRunsError(e instanceof ApiError ? e.message : t("rec.errRuns")))
      .finally(() => setRunsLoading(false));
  }

  async function toggleActive(tpl: RecurringTemplate) {
    try {
      await apiPatch<RecurringTemplate>("/api/v1/recurring", {
        firmId: activeFirmId,
        id: tpl.id,
        isActive: !tpl.isActive,
      });
      toast({
        title: tpl.isActive ? t("rec.toastPaused") : t("rec.toastResumed"),
        description: tpl.isActive
          ? t("rec.toastPausedDesc", { name: tpl.name })
          : t("rec.toastResumedDesc", { name: tpl.name }),
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("rec.errUpdate"),
        description: e instanceof ApiError ? e.message : t("rec.errUpdateDesc"),
      });
    }
  }

  async function confirmDelete() {
    if (!deleteOf) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/recurring?firmId=${activeFirmId}&id=${deleteOf.id}`);
      toast({ title: t("rec.toastMoved"), description: t("rec.toastMovedDesc", { name: deleteOf.name }) });
      setDeleteOf(null);
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("rec.errDelete"),
        description: e instanceof ApiError ? e.message : t("rec.errDeleteDesc"),
      });
    } finally {
      setDeleting(false);
    }
  }

  async function runGenerate(templateId?: string) {
    if (!activeFirmId) return;
    if (templateId) setRunningId(templateId);
    else setGenerating(true);
    try {
      const res = await apiPost<RecurringGenerateResponse>("/api/v1/recurring/generate", {
        firmId: activeFirmId,
        ...(templateId ? { templateId } : {}),
      });
      if (templateId) {
        const run = res.runs[0];
        if (run?.ok && run.skipped) {
          toast({
            title: t("rec.toastSkipped", { n: run.skippedCycles ?? 1 }),
            description: t("rec.toastSkippedDesc", { name: run.templateName, date: run.holdUntil ? formatDate(run.holdUntil) : t("rec.phHoldDate") }),
          });
        } else if (run?.ok) {
          toast({
            title: t("rec.toastGenerated", { no: run.invoiceNumber ?? "" }),
            description: `${t("rec.toastGeneratedDesc", { name: run.templateName ?? "", amt: formatINR(run.grandTotal ?? 0) })}${(run.invoices ?? 1) > 1 ? ` ${t("rec.cyclesCaught", { n: run.invoices ?? 1 })}` : ""}`,
          });
        } else {
          toast({
            variant: "destructive",
            title: t("rec.toastGenFailed"),
            description: run?.error ?? t("rec.errNoInvoice"),
          });
        }
        setRefresh((r) => r + 1);
      } else {
        setGenResult(res);
        setRefresh((r) => r + 1);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("rec.toastGenFailed"),
        description: e instanceof ApiError ? e.message : t("rec.errGenRun"),
      });
    } finally {
      if (templateId) setRunningId(null);
      else setGenerating(false);
    }
  }

  // ── derived KPIs ──────────────────────────────────────────────
  const list = rows ?? [];
  // Word-wise search (template / customer / SKU) × status filter — order preserved.
  const filtered = filterByQuery(list, query, (t) => [
    t.name,
    t.customer?.partyName ?? "",
    (t.items ?? []).map((i) => `${i.sku} ${i.productName}`).join(" "),
  ]).filter((t) =>
    statusFilter === "ALL"
      ? true
      : statusFilter === "DUE"
        ? !!t.dueToday && t.isActive
        : statusFilter === "HOLD"
          ? !!t.onHold
          : statusFilter === "AUTO"
            ? t.autoPost !== false && t.isActive
            : statusFilter === "ACTIVE"
            ? t.isActive
            : !t.isActive
  );
  const activeCount = list.filter((t) => t.isActive).length;
  const dueRows = list.filter((t) => t.dueToday && t.isActive);
  const dueValue = dueRows.reduce((s, t) => s + (t.estValue?.estTotal ?? 0), 0);
  const overdueCount = dueRows.filter((t) => (t.overdueBy ?? 0) > 0).length;
  const holdCount = list.filter((t) => t.onHold).length;
  const autoCount = list.filter((t) => t.autoPost !== false && t.isActive).length;
  // Subscription invoices posted this month (from templateId-stamped rows)
  const monthRuns = list.reduce((s, t) => s + (t.runsThisMonth ?? 0), 0);
  const monthRunsValue = list.reduce(
    (s, t) => s + (t.runsThisMonth ?? 0) * (t.estValue?.estTotal ?? 0),
    0
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.recurring")}
        subtitle={t("rec.subtitle")}
        icon={CalendarClock}
        actions={
          <>
            {autoAlive && (
              <span
                title={t("rec.autoLiveTip")}
                className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-lg border border-dmk-success/30 bg-[rgba(34,197,94,0.07)] px-3 text-[11px] font-semibold text-dmk-success"
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-dmk-success" />
                {t("rec.autoLive")}
              </span>
            )}
            <Button
              size="sm"
              className="h-9 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 disabled:opacity-40"
              disabled={generating || dueRows.length === 0}
              onClick={() => runGenerate()}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {t("rec.generateDue")}
              <span className="ml-1 rounded-full bg-[#0A0F1D]/15 px-1.5 text-[10.5px] font-bold">{dueRows.length}</span>
            </Button>
            <Button size="sm" className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={openNew}>
              <Plus className="h-4 w-4" /> {t("rec.newTemplate")}
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("rec.kpiActive")}</span>
            <CalendarClock className="h-3.5 w-3.5 text-dmk-blue/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-text-primary">{activeCount}</span>
          <span className="text-[11px] text-dmk-text-muted">{t("rec.kpiTotal", { n: list.length, p: list.length - activeCount })}</span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("rec.kpiDue")}</span>
            <Zap className="h-3.5 w-3.5 text-dmk-gold/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-gold">{dueRows.length}</span>
          <span className={cn("text-[11px]", overdueCount > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
            {overdueCount > 0 ? t("rec.kpiOverdue", { n: overdueCount }) : holdCount > 0 ? t("rec.kpiHold", { n: holdCount }) : t("rec.kpiSchedule")}
          </span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("rec.kpiDueValue")}</span>
            <IndianRupee className="h-3.5 w-3.5 text-dmk-yellow/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-yellow">{formatINR(dueValue)}</span>
          <span className="text-[11px] text-dmk-text-muted">{t("rec.kpiEstTotal")}</span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{t("rec.kpiBilled")}</span>
            <History className="h-3.5 w-3.5 text-dmk-success/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-text-primary">{monthRuns}</span>
          <span className="text-[11px] text-dmk-text-muted">{t("rec.kpiInvoices", { amt: formatINR(monthRunsValue) })}</span>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder={t("rec.searchPh")} className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[170px]")}>
            <SelectValue placeholder={t("rec.phAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("rec.fAll")}</SelectItem>
            <SelectItem value="DUE">{t("rec.fDue")}</SelectItem>
            <SelectItem value="HOLD" disabled={holdCount === 0}>
              {holdCount > 0 ? t("rec.fHoldN", { n: holdCount }) : t("rec.fHold")}
            </SelectItem>
            <SelectItem value="AUTO" disabled={autoCount === 0}>
              {autoCount > 0 ? t("rec.fAutoN", { n: autoCount }) : t("rec.fAuto")}
            </SelectItem>
            <SelectItem value="ACTIVE">{t("cmn.activeOnly")}</SelectItem>
            <SelectItem value="PAUSED">{t("rec.fPaused")}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary" onClick={() => setRefresh((r) => r + 1)}>
          <RefreshCw className="h-4 w-4" /> {t("cmn.refresh")}
        </Button>
      </div>

      {/* template list */}
      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={list.length === 0 ? t("rec.emptyNone") : t("rec.emptyFiltered")}
              hint={
                list.length === 0
                  ? t("rec.emptyHint")
                  : t("rec.emptyFilteredHint")
              }
              action={
                list.length === 0 ? (
                  <Button size="sm" className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={openNew}>
                    <Plus className="h-4 w-4" /> {t("rec.newTemplate")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="dmk-table min-w-[1120px]">
              <thead>
                <tr>
                  <th>{t("rec.colTemplate")}</th>
                  <th>{t("cmn.customer")}</th>
                  <th>{t("rec.colFrequency")}</th>
                  <th>{t("rec.colPayment")}</th>
                  <th>{t("rec.colItems")}</th>
                  <th className="text-right">{t("rec.colEstValue")}</th>
                  <th>{t("rec.colNextRun")}</th>
                  <th>{t("cmn.status")}</th>
                  <th className="text-right">{t("cmn.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tpl) => {
                  const overdue = !tpl.onHold && (tpl.overdueBy ?? 0) > 0;
                  const dueToday = !!tpl.dueToday && !overdue && !tpl.onHold;
                  return (
                    <React.Fragment key={tpl.id}>
                    <tr className={cn("group/row", tpl.onHold && "opacity-80")}>
                      <td className="max-w-[220px]">
                        <span className="block truncate text-[13px] font-semibold text-dmk-text-primary">{tpl.name}</span>
                        {tpl.notes && (
                          <span className="block truncate text-[10.5px] text-dmk-text-muted" title={tpl.notes}>
                            {tpl.notes}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[190px]">
                        <span className="block truncate text-[12.5px] font-medium text-dmk-text-primary">
                          {tpl.customer?.partyName ?? "—"}
                        </span>
                        <span className="block truncate text-[10.5px] text-dmk-text-muted">
                          {tpl.customer?.city || tpl.customer?.stateCode || ""}
                        </span>
                      </td>
                      <td>
                        <Badge tone="gold">{frequencyLabel(t, tpl.frequency)}</Badge>
                      </td>
                      <td>{paymentBadge(tpl.paymentMode)}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">
                        <button
                          onClick={() => setExpandedId((id) => (id === tpl.id ? null : tpl.id))}
                          title={t("rec.expandTip")}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1 hover:bg-dmk-hover transition-colors"
                        >
                          <ChevronDown className={cn("h-3.5 w-3.5 text-dmk-text-muted transition-transform", expandedId === tpl.id && "rotate-180 text-dmk-yellow")} />
                          {tpl.itemSummary}
                        </button>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Money value={tpl.estValue?.estTotal ?? 0} className="text-[13px] font-semibold text-dmk-text-primary" />
                        <span className="block text-[10px] text-dmk-text-muted">
                          {t("rec.taxSub", { amt: formatINR(tpl.estValue?.estTax ?? 0) })}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        {tpl.onHold ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(245,158,11,0.12)] px-2 py-1 text-[11px] font-semibold text-dmk-warning">
                            <CalendarOff className="h-3 w-3" /> {t("rec.holdBadge", { date: tpl.holdUntilLabel ?? "" })}
                          </span>
                        ) : overdue ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(239,68,68,0.12)] px-2 py-1 text-[11px] font-semibold text-dmk-danger">
                            {t("rec.overdueBadge", { n: tpl.overdueBy ?? 0 })}
                          </span>
                        ) : dueToday ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-dmk-gold/15 px-2 py-1 text-[11px] font-semibold text-dmk-gold">
                            {t("rec.dueTodayBadge")}
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-dmk-text-secondary">{tpl.nextRunLabel ?? formatDate(tpl.nextRunDate)}</span>
                        )}
                        {tpl.lastRunDate && (
                          <span className="block text-[10px] text-dmk-text-muted">{t("rec.lastRun", { date: formatDate(tpl.lastRunDate) })}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          {tpl.isActive ? <Badge tone="success">ACTIVE</Badge> : <Badge tone="neutral">PAUSED</Badge>}
                          {tpl.autoPost !== false && tpl.isActive && (
                            <span
                              title={t("rec.autoTip")}
                              className="inline-flex items-center gap-1 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-dmk-success"
                            >
                              <Zap className="h-2.5 w-2.5" /> AUTO
                            </span>
                          )}
                          {(tpl.runsCount ?? 0) > 0 && (
                            <button
                              onClick={() => openRuns(tpl)}
                              title={t("rec.tipHistory")}
                              className="inline-flex items-center gap-1 rounded-md bg-dmk-blue/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-dmk-info transition-colors hover:bg-dmk-blue/20"
                            >
                              <History className="h-2.5 w-2.5" /> {(tpl.runsCount ?? 0) === 1 ? t("rec.runsOne", { n: tpl.runsCount ?? 0 }) : t("rec.runsMany", { n: tpl.runsCount ?? 0 })}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          <button
                            onClick={() => runGenerate(tpl.id)}
                            disabled={runningId === tpl.id}
                            title={tpl.onHold ? t("rec.tipRunHold") : t("rec.tipRunNow")}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-success hover:bg-dmk-hover disabled:opacity-40"
                          >
                            {runningId === tpl.id ? <Loader2 className="h-4 w-4 animate-spin" /> : tpl.onHold ? <SkipForward className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => openRuns(tpl)}
                            title={t("rec.tipHistory")}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-info hover:bg-dmk-hover"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(tpl)}
                            title={t("rec.tipEdit")}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleActive(tpl)}
                            title={tpl.isActive ? t("rec.tipPause") : t("rec.tipResume")}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-warning hover:bg-dmk-hover"
                          >
                            {tpl.isActive ? <Pause className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => setDeleteOf(tpl)}
                            title={t("rec.tipDelete")}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-danger hover:bg-dmk-hover"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === tpl.id && (
                      <tr key={`${tpl.id}-items`} className="bg-dmk-input-well/40">
                        <td colSpan={9} className="px-4 py-3">
                          <p className="text-[10px] uppercase tracking-widest font-semibold text-dmk-text-muted mb-2">
                            {t("rec.productsIn")}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {tpl.items.map((i) => (
                              <span
                                key={`${tpl.id}-${i.sku}-${i.productId}`}
                                className="inline-flex items-center gap-1.5 rounded-md border border-dmk-border-subtle bg-dmk-bg-primary px-2 py-1 text-[11px] text-dmk-text-secondary whitespace-nowrap"
                              >
                                <span className="font-money text-dmk-text-muted">{i.sku}</span>
                                <span className="text-dmk-text-primary max-w-[260px] truncate">{i.productName}</span>
                                <span className="font-money text-dmk-yellow">× {i.quantity}</span>
                                {i.manualDiscountPct != null && i.manualDiscountPct > 0 && (
                                  <span className="text-dmk-gold">−{i.manualDiscountPct}%</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* New / Edit template dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[88vh] overflow-y-auto sm:w-[760px]">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-dmk-text-primary">
              {editOf ? t("rec.dlgEdit") : t("rec.dlgNew")}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              {t("rec.dlgDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("rec.fName")}>
                <Input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("rec.phName")}
                />
              </Field>
              <Field label={t("cmn.customer")}>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder={t("rec.phSelectCust")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.partyName}
                        {c.customerType === "B2C_COUNTER" ? ` ${t("rec.counterTag")}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t("rec.colFrequency")}>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f} value={f}>
                        {frequencyLabel(t, f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("rec.colPayment")}>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {payModeLabel(t, m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("rec.fStart")}>
                <Input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label={t("rec.fEnd")}>
                <Input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("rec.fSkip")}
                hint={t("rec.fSkipHint")}
              >
                <Input
                  type="date"
                  className={cn(inputCls, skipUntil && "border-dmk-warning/50")}
                  value={skipUntil}
                  min={startDate}
                  onChange={(e) => setSkipUntil(e.target.value)}
                />
              </Field>
              {skipUntil ? (
                <div className="flex items-end pb-1">
                  <p className="flex items-center gap-1.5 rounded-md bg-[rgba(245,158,11,0.1)] px-2.5 py-2 text-[11px] font-semibold text-dmk-warning">
                    <CalendarOff className="h-3.5 w-3.5 shrink-0" />
                    {t("rec.onHoldUntil", { date: new Date(`${skipUntil}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) })}
                  </p>
                </div>
              ) : (
                <div className="flex items-end pb-1">
                  <p className="text-[11px] text-dmk-text-muted">{t("rec.noHold")}</p>
                </div>
              )}
            </div>

            {/* line items editor */}
            <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">{t("rec.lineItems")}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-dmk-border-medium bg-transparent px-2 text-[11.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                  onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}
                >
                  <Plus className="h-3.5 w-3.5" /> {t("rec.addLine")}
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const p = products.find((x) => x.id === l.productId);
                  const qty = Number(l.qty);
                  const est = p && qty > 0 ? estimateLine(p, qty, l.disc === "" ? null : Number(l.disc), tierKey, intra) : null;
                  return (
                    <div key={i} className="grid grid-cols-[1fr_76px_86px_28px] items-start gap-2">
                      <div className="min-w-0">
                        <Select value={l.productId} onValueChange={(v) => setLine(i, { productId: v })}>
                          <SelectTrigger className={cn(inputCls, "w-full")}>
                            <SelectValue placeholder={t("rec.phProduct")} />
                          </SelectTrigger>
                          <SelectContent className="max-h-64">
                            {products.map((p2) => (
                              <SelectItem key={p2.id} value={p2.id}>
                                <span className="font-mono text-[10.5px] text-dmk-text-muted">{p2.sku}</span> · {p2.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {est && p && (
                          <span className="mt-0.5 block truncate text-[10px] text-dmk-text-muted">
                            {t("rec.perUnit", { price: est.bulk.unitPrice.toFixed(2) })}
                            {est.bulk.discountPct > 0 ? ` · ${t("rec.bulkPart", { n: est.bulk.discountPct })}` : ""}
                            {l.disc !== "" ? ` · ${t("rec.manualPart", { n: l.disc })}` : ""} · {t("rec.gstPart", { n: p.gstRate })}
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className={inputCls}
                        placeholder={t("rec.phQty")}
                        value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        className={inputCls}
                        placeholder={t("rec.phDisc")}
                        title={t("rec.tipManualDisc")}
                        value={l.disc}
                        onChange={(e) => setLine(i, { disc: e.target.value })}
                      />
                      <button
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                        title={t("rec.tipRemoveLine")}
                        className="flex h-9 w-7 items-center justify-center rounded-md text-dmk-text-muted hover:bg-dmk-hover hover:text-dmk-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* live estimate strip */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dmk-border-subtle bg-dmk-bg-primary/60 px-3 py-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                  {t("rec.quickEstimate")} {intra ? t("rec.estIntra") : t("rec.estInter")}
                </span>
                <span className="flex items-center gap-3 font-money text-[12.5px]">
                  <span className="text-dmk-text-secondary">{t("rec.sumTaxable", { amt: formatINR(preview.taxable) })}</span>
                  <span className="text-dmk-info">{t("rec.sumGst", { amt: formatINR(preview.tax) })}</span>
                  <span className="font-semibold text-dmk-gold">{t("rec.sumTotal", { amt: formatINR(preview.total) })}</span>
                </span>
              </div>
            </div>

            <Field label={t("rec.fNotes")}>
              <Textarea
                className={cn(inputCls, "min-h-[56px] resize-none")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("rec.phNotes")}
              />
            </Field>

            {/* auto-post toggle — scheduler picks due cycles up every 5 min */}
            <Label
              htmlFor="tpl-autopost"
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3.5 py-3 transition-colors",
                autoPost ? "border-dmk-success/40 bg-[rgba(34,197,94,0.06)]" : "border-dmk-border-subtle bg-dmk-input-well/60"
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-dmk-text-primary">
                  <Zap className={cn("h-3.5 w-3.5", autoPost ? "text-dmk-success" : "text-dmk-text-muted")} />
                  {t("rec.autoPostTitle")}
                </span>
                <span className="text-[11px] leading-snug text-dmk-text-muted">
                  {t("rec.autoPostDesc", { mode: autoPost ? t("rec.modeCycle") : t("rec.modeManual") })}
                </span>
              </span>
              <Switch id="tpl-autopost" checked={autoPost} onCheckedChange={setAutoPost} />
            </Label>

            {formError && (
              <p className="rounded-md border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-dmk-danger">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary" onClick={() => setFormOpen(false)} disabled={saving}>
              {t("cmn.cancel")}
            </Button>
            <Button className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={submitTemplate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editOf ? t("cmn.saveChanges") : t("rec.btnCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* generate result dialog */}
      <Dialog open={!!genResult} onOpenChange={(o) => !o && setGenResult(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-dmk-text-primary">{t("rec.reportTitle")}</DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              {t("rec.reportBilled", { n: genResult?.generated ?? 0 })}{" · "}
              {(genResult?.skipped ?? 0) > 0 ? `${t("rec.reportSkipped", { n: genResult?.skipped ?? 0 })} · ` : ""}
              {t("rec.reportFailed", { n: genResult?.failed ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {(genResult?.runs ?? []).map((run, i) => (
              <div
                key={`${run.templateId}-${i}`}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  run.ok && !run.skipped
                    ? "border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.07)]"
                    : run.ok && run.skipped
                      ? "border-dmk-info/30 bg-dmk-info/[0.07]"
                      : "border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)]"
                )}
              >
                <div className="flex items-center gap-2">
                  {run.ok && !run.skipped ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-dmk-success" />
                  ) : run.ok && run.skipped ? (
                    <SkipForward className="h-4 w-4 shrink-0 text-dmk-info" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-dmk-danger" />
                  )}
                  <span className="truncate text-[13px] font-semibold text-dmk-text-primary">{run.templateName}</span>
                  {run.ok && !run.skipped && (
                    <span className="ml-auto whitespace-nowrap font-money text-[12.5px] font-semibold text-dmk-gold">
                      {formatINR(run.grandTotal ?? 0)}
                    </span>
                  )}
                  {run.ok && run.skipped && (
                    <Badge tone="info">SKIPPED</Badge>
                  )}
                </div>
                {run.ok && !run.skipped ? (
                  <p className="mt-1 pl-6 text-[11.5px] text-dmk-text-secondary">
                    {t("rec.runInvoice", { no: run.invoiceNumber ?? "" })}
                    {(run.invoices ?? 1) > 1 ? ` · ${t("rec.cyclesCaughtUp", { n: run.invoices ?? 1 })}` : ""}
                  </p>
                ) : run.ok && run.skipped ? (
                  <p className="mt-1 pl-6 text-[11.5px] text-dmk-text-secondary">
                    {t("rec.skippedDesc", { n: run.skippedCycles ?? 1, after: run.holdUntil ? t("rec.afterDate", { date: formatDate(run.holdUntil) }) : t("rec.advanced") })}
                  </p>
                ) : (
                  <p className="mt-1 pl-6 text-[11.5px] text-dmk-danger">{run.error}</p>
                )}
              </div>
            ))}
            {(genResult?.runs ?? []).length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-dmk-text-muted">{t("rec.noneDue")}</p>
            )}
          </div>
          <DialogFooter>
            <Button className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={() => setGenResult(null)}>
              {t("rec.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* run history (subscription ledger) dialog */}
      <Dialog open={!!runsOf} onOpenChange={(o) => !o && setRunsOf(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[16px] text-dmk-text-primary">
              <History className="h-4 w-4 text-dmk-info" />
              {t("rec.runsTitle", { name: runsOf?.name ?? "" })}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              {t("rec.runsDesc")}
            </DialogDescription>
          </DialogHeader>

          {runsLoading ? (
            <LoadingRows rows={4} />
          ) : runsError ? (
            <p className="rounded-md border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-dmk-danger">
              {runsError}
            </p>
          ) : runsData ? (
            <div className="space-y-3">
              {/* KPI wells */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">{t("rec.kpiTotalRuns")}</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-text-primary">{runsData.totals.runs}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">{t("rec.kpiTotalBilled")}</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-gold">{formatINR(runsData.totals.billed)}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">{t("rec.kpiAvgInvoice")}</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-text-primary">{formatINR(runsData.totals.avgInvoice)}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">{t("rec.kpiLastRun")}</p>
                  <p className="mt-0.5 truncate text-[12.5px] font-semibold text-dmk-text-secondary">
                    {runsData.totals.lastRunDate ? formatDate(runsData.totals.lastRunDate) : "—"}
                    {runsData.totals.lastInvoiceNo && (
                      <span className="block font-mono text-[10px] font-normal text-dmk-text-muted">{runsData.totals.lastInvoiceNo}</span>
                    )}
                  </p>
                </div>
              </div>

              {runsData.rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-dmk-border-medium px-4 py-8 text-center">
                  <History className="mx-auto h-6 w-6 text-dmk-text-muted" />
                  <p className="mt-2 text-[13px] font-semibold text-dmk-text-primary">{t("rec.noRuns")}</p>
                  <p className="mt-0.5 text-[11.5px] text-dmk-text-muted">
                    {t("rec.noRunsHint")}
                  </p>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto rounded-lg border border-dmk-border-subtle [&>*]:min-w-0">
                  <table className="dmk-table min-w-[560px]">
                    <thead>
                      <tr>
                        <th>{t("rec.colInvoiceNo")}</th>
                        <th>{t("cmn.date")}</th>
                        <th>{t("rcpt.colMode")}</th>
                        <th className="text-right">{t("rec.colGst")}</th>
                        <th className="text-right">{t("rec.colTotal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runsData.rows.map((r) => (
                        <tr key={r.id} className="group/row">
                          <td className="whitespace-nowrap font-mono text-[11.5px] font-semibold text-dmk-gold">{r.invoiceNumber}</td>
                          <td className="whitespace-nowrap text-[12px] text-dmk-text-secondary">{formatDate(r.invoiceDate)}</td>
                          <td>{paymentBadge(r.paymentMode)}</td>
                          <td className="text-right font-money text-[12px] text-dmk-info">{r.tax.toFixed(2)}</td>
                          <td className="text-right font-money text-[12.5px] font-semibold text-dmk-text-primary">
                            {r.grandTotal.toFixed(2)}
                            {r.status !== "POSTED" && <Badge tone="warning">{r.status}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="border-t border-dmk-border-subtle pt-2 text-[10.5px] text-dmk-text-muted">
                {t("rec.reconcileNote")}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
              onClick={() => setRunsOf(null)}
            >
              {t("cmn.close")}
            </Button>
            <Button
              className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90"
              onClick={() => {
                setRunsOf(null);
                setView("sales/invoices");
              }}
            >
              {t("rec.openRegister")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteOf} onOpenChange={(o) => !o && setDeleteOf(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rec.delTitle", { name: deleteOf?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rec.delDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              {t("cmn.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />} {t("cmn.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
