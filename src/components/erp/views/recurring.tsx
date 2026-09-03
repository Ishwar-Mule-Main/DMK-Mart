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

const FREQUENCIES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "BIMONTHLY", label: "Every 2 months" },
  { value: "QUARTERLY", label: "Quarterly" },
];

const PAYMENT_MODES = [
  { value: "CREDIT", label: "Credit" },
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "NEFT", label: "NEFT / Bank" },
];

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

function frequencyLabel(f: string): string {
  return FREQUENCIES.find((x) => x.value === f)?.label ?? f;
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
            toast({ variant: "destructive", title: "Could not load templates", description: e.message });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, refresh, toast]);

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

  function openEdit(t: RecurringTemplate) {
    setEditOf(t);
    setName(t.name);
    setCustomerId(t.customerId);
    setFrequency(t.frequency);
    setPaymentMode(t.paymentMode);
    setStartDate(toISODate(new Date(t.startDate)));
    setEndDate(t.endDate ? toISODate(new Date(t.endDate)) : "");
    setSkipUntil(t.skipUntil ? toISODate(new Date(t.skipUntil)) : "");
    setNotes(t.notes);
    setAutoPost(t.autoPost !== false);
    setLines(
      t.items.map((i) => ({
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
    if (!name.trim()) return "Template name is required.";
    if (!customerId) return "Select a customer for this standing order.";
    if (selectedCustomer?.customerType === "B2C_COUNTER" && paymentMode === "CREDIT")
      return "Counter customers are cash-and-carry — pick CASH, UPI or CARD.";
    const clean = lines.filter((l) => l.productId);
    if (clean.length === 0) return "Add at least one product line.";
    for (const l of clean) {
      if (!(Number(l.qty) > 0)) return "Every line needs a quantity greater than 0.";
      if (l.disc !== "" && (Number(l.disc) < 0 || Number(l.disc) > 100))
        return "Manual discount must be between 0 and 100.";
    }
    if (endDate && startDate && endDate < startDate) return "End date cannot be before the start date.";
    if (skipUntil && startDate && skipUntil < startDate) return "Skip-until date cannot be before the start date.";
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
        toast({ title: "Template updated", description: `“${payload.name}” saved.` });
      } else {
        await apiPost<RecurringTemplate>("/api/v1/recurring", payload);
        toast({ title: "Template created", description: `“${payload.name}” will auto-post invoices on schedule.` });
      }
      setFormOpen(false);
      setRefresh((r) => r + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not save the template.");
    } finally {
      setSaving(false);
    }
  }

  // ── row actions ───────────────────────────────────────────────
  function openRuns(t: RecurringTemplate) {
    if (!activeFirmId) return;
    setRunsOf(t);
    setRunsData(null);
    setRunsError(null);
    setRunsLoading(true);
    apiGet<RecurringRunsResponse>("/api/v1/recurring/runs", { firmId: activeFirmId, templateId: t.id })
      .then((res) => setRunsData(res))
      .catch((e) => setRunsError(e instanceof ApiError ? e.message : "Could not load run history."))
      .finally(() => setRunsLoading(false));
  }

  async function toggleActive(t: RecurringTemplate) {
    try {
      await apiPatch<RecurringTemplate>("/api/v1/recurring", {
        firmId: activeFirmId,
        id: t.id,
        isActive: !t.isActive,
      });
      toast({
        title: t.isActive ? "Template paused" : "Template resumed",
        description: t.isActive
          ? `“${t.name}” is excluded from generation while paused.`
          : `“${t.name}” is back on schedule.`,
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof ApiError ? e.message : "Could not change template state.",
      });
    }
  }

  async function confirmDelete() {
    if (!deleteOf) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/recurring?firmId=${activeFirmId}&id=${deleteOf.id}`);
      toast({ title: "Template deleted", description: `“${deleteOf.name}” removed. Posted invoices are untouched.` });
      setDeleteOf(null);
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof ApiError ? e.message : "Could not delete this template.",
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
            title: `Skipped ${run.skippedCycles ?? 1} cycle${(run.skippedCycles ?? 1) === 1 ? "" : "s"}`,
            description: `${run.templateName} is on hold until ${run.holdUntil ? formatDate(run.holdUntil) : "the hold date"} — schedule advanced without billing.`,
          });
        } else if (run?.ok) {
          toast({
            title: `Invoice ${run.invoiceNumber} generated`,
            description: `${run.templateName} · ${formatINR(run.grandTotal ?? 0)}${(run.invoices ?? 1) > 1 ? ` · ${(run.invoices ?? 1)} cycles caught up` : ""}`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Generation failed",
            description: run?.error ?? "No invoice was generated for this template.",
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
        title: "Generation failed",
        description: e instanceof ApiError ? e.message : "Could not run recurring generation.",
      });
    } finally {
      if (templateId) setRunningId(null);
      else setGenerating(false);
    }
  }

  // ── derived KPIs ──────────────────────────────────────────────
  const list = rows ?? [];
  const filtered = list.filter((t) => {
    const q = query.trim().toLowerCase();
    const matchQ =
      !q ||
      t.name.toLowerCase().includes(q) ||
      t.customer?.partyName?.toLowerCase().includes(q) ||
      (t.items ?? []).some((i) => i.sku.toLowerCase().includes(q) || i.productName.toLowerCase().includes(q));
    const matchS =
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
              : !t.isActive;
    return matchQ && matchS;
  });
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
        title="Recurring Billing"
        subtitle="Standing-order templates → auto-posted tax invoices"
        icon={CalendarClock}
        actions={
          <>
            {autoAlive && (
              <span
                title="The platform scheduler is live — due AUTO templates post themselves every 5 min. Full heartbeat in Settings."
                className="hidden sm:inline-flex h-9 items-center gap-1.5 rounded-lg border border-dmk-success/30 bg-[rgba(34,197,94,0.07)] px-3 text-[11px] font-semibold text-dmk-success"
              >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-dmk-success" />
                AUTO-POSTER LIVE
              </span>
            )}
            <Button
              size="sm"
              className="h-9 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 disabled:opacity-40"
              disabled={generating || dueRows.length === 0}
              onClick={() => runGenerate()}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Generate due now
              <span className="ml-1 rounded-full bg-[#0A0F1D]/15 px-1.5 text-[10.5px] font-bold">{dueRows.length}</span>
            </Button>
            <Button size="sm" className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={openNew}>
              <Plus className="h-4 w-4" /> New Template
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Active Templates</span>
            <CalendarClock className="h-3.5 w-3.5 text-dmk-blue/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-text-primary">{activeCount}</span>
          <span className="text-[11px] text-dmk-text-muted">{list.length} total · {(list.length - activeCount)} paused</span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Due Today</span>
            <Zap className="h-3.5 w-3.5 text-dmk-gold/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-gold">{dueRows.length}</span>
          <span className={cn("text-[11px]", overdueCount > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
            {overdueCount > 0 ? `${overdueCount} overdue — run generation` : list.some((t) => t.onHold) ? `${list.filter((t) => t.onHold).length} on hold` : "on schedule"}
          </span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Due Value</span>
            <IndianRupee className="h-3.5 w-3.5 text-dmk-yellow/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-yellow">{formatINR(dueValue)}</span>
          <span className="text-[11px] text-dmk-text-muted">est. grand total incl. GST</span>
        </div>
        <div className="dmk-kpi p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Billed This Month</span>
            <History className="h-3.5 w-3.5 text-dmk-success/70" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-text-primary">{monthRuns}</span>
          <span className="text-[11px] text-dmk-text-muted">invoices · ≈ {formatINR(monthRunsValue)} est.</span>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search template, customer or SKU…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[170px]")}>
            <SelectValue placeholder="All templates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All templates</SelectItem>
            <SelectItem value="DUE">Due today</SelectItem>
            <SelectItem value="HOLD" disabled={holdCount === 0}>
              On hold{holdCount > 0 ? ` (${holdCount})` : ""}
            </SelectItem>
            <SelectItem value="AUTO" disabled={autoCount === 0}>
              Auto-posting{autoCount > 0 ? ` (${autoCount})` : ""}
            </SelectItem>
            <SelectItem value="ACTIVE">Active only</SelectItem>
            <SelectItem value="PAUSED">Paused only</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary" onClick={() => setRefresh((r) => r + 1)}>
          <RefreshCw className="h-4 w-4" /> Refresh
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
              title={list.length === 0 ? "No recurring templates" : "No templates match your filters"}
              hint={
                list.length === 0
                  ? "Create a standing order — e.g. “20 buckets every month to Latur trader” — and DMK Mart will auto-post the tax invoice on schedule."
                  : "Try a different search or switch the status filter."
              }
              action={
                list.length === 0 ? (
                  <Button size="sm" className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={openNew}>
                    <Plus className="h-4 w-4" /> New Template
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <table className="dmk-table min-w-[1120px]">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Customer</th>
                  <th>Frequency</th>
                  <th>Payment</th>
                  <th>Items</th>
                  <th className="text-right">Est. Value</th>
                  <th>Next Run</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const overdue = !t.onHold && (t.overdueBy ?? 0) > 0;
                  const dueToday = !!t.dueToday && !overdue && !t.onHold;
                  return (
                    <tr key={t.id} className={cn("group/row", t.onHold && "opacity-80")}>
                      <td className="max-w-[220px]">
                        <span className="block truncate text-[13px] font-semibold text-dmk-text-primary">{t.name}</span>
                        {t.notes && (
                          <span className="block truncate text-[10.5px] text-dmk-text-muted" title={t.notes}>
                            {t.notes}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[190px]">
                        <span className="block truncate text-[12.5px] font-medium text-dmk-text-primary">
                          {t.customer?.partyName ?? "—"}
                        </span>
                        <span className="block truncate text-[10.5px] text-dmk-text-muted">
                          {t.customer?.city || t.customer?.stateCode || ""}
                        </span>
                      </td>
                      <td>
                        <Badge tone="gold">{frequencyLabel(t.frequency)}</Badge>
                      </td>
                      <td>{paymentBadge(t.paymentMode)}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{t.itemSummary}</td>
                      <td className="text-right whitespace-nowrap">
                        <Money value={t.estValue?.estTotal ?? 0} className="text-[13px] font-semibold text-dmk-text-primary" />
                        <span className="block text-[10px] text-dmk-text-muted">
                          tax {formatINR(t.estValue?.estTax ?? 0)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        {t.onHold ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(245,158,11,0.12)] px-2 py-1 text-[11px] font-semibold text-dmk-warning">
                            <CalendarOff className="h-3 w-3" /> HOLD · till {t.holdUntilLabel}
                          </span>
                        ) : overdue ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(239,68,68,0.12)] px-2 py-1 text-[11px] font-semibold text-dmk-danger">
                            OVERDUE by {t.overdueBy}d
                          </span>
                        ) : dueToday ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-dmk-gold/15 px-2 py-1 text-[11px] font-semibold text-dmk-gold">
                            DUE TODAY
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-dmk-text-secondary">{t.nextRunLabel ?? formatDate(t.nextRunDate)}</span>
                        )}
                        {t.lastRunDate && (
                          <span className="block text-[10px] text-dmk-text-muted">last {formatDate(t.lastRunDate)}</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-col items-start gap-1">
                          {t.isActive ? <Badge tone="success">ACTIVE</Badge> : <Badge tone="neutral">PAUSED</Badge>}
                          {t.autoPost !== false && t.isActive && (
                            <span
                              title="Auto-posted by the platform scheduler when due — no manual run needed"
                              className="inline-flex items-center gap-1 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-dmk-success"
                            >
                              <Zap className="h-2.5 w-2.5" /> AUTO
                            </span>
                          )}
                          {(t.runsCount ?? 0) > 0 && (
                            <button
                              onClick={() => openRuns(t)}
                              title="Open run history — subscription ledger"
                              className="inline-flex items-center gap-1 rounded-md bg-dmk-blue/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-dmk-info transition-colors hover:bg-dmk-blue/20"
                            >
                              <History className="h-2.5 w-2.5" /> {t.runsCount} RUN{(t.runsCount ?? 0) === 1 ? "" : "S"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          <button
                            onClick={() => runGenerate(t.id)}
                            disabled={runningId === t.id}
                            title={t.onHold ? "On hold — run now skips the due cycles" : "Run now — bill the next cycle immediately"}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-success hover:bg-dmk-hover disabled:opacity-40"
                          >
                            {runningId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t.onHold ? <SkipForward className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => openRuns(t)}
                            title="Run history — subscription ledger"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-info hover:bg-dmk-hover"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(t)}
                            title="Edit template"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toggleActive(t)}
                            title={t.isActive ? "Pause — stop auto generation" : "Resume schedule"}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-warning hover:bg-dmk-hover"
                          >
                            {t.isActive ? <Pause className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => setDeleteOf(t)}
                            title="Delete template"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-dmk-danger hover:bg-dmk-hover"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
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
              {editOf ? "Edit Recurring Template" : "New Recurring Template"}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              Every cycle posts a real tax invoice through the billing engine — tier pricing, GST, credit control and stock all apply.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Template Name">
                <Input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Latur monthly buckets"
                />
              </Field>
              <Field label="Customer">
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.partyName}
                        {c.customerType === "B2C_COUNTER" ? " · Counter" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Frequency">
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment">
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className={inputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value} disabled={selectedCustomer?.customerType === "B2C_COUNTER" && m.value === "CREDIT"}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Start Date">
                <Input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label="End Date (optional)">
                <Input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Skip cycles until (optional)"
                hint="Vacation / stock-out hold — cycles due inside the window are skipped, not back-billed. Clear the date to lift the hold."
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
                    On hold until {new Date(`${skipUntil}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </p>
                </div>
              ) : (
                <div className="flex items-end pb-1">
                  <p className="text-[11px] text-dmk-text-muted">No hold — the template bills every cycle on schedule.</p>
                </div>
              )}
            </div>

            {/* line items editor */}
            <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Line Items</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-dmk-border-medium bg-transparent px-2 text-[11.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                  onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
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
                            <SelectValue placeholder="Search product…" />
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
                            ₹{est.bulk.unitPrice.toFixed(2)}/unit
                            {est.bulk.discountPct > 0 ? ` · bulk −${est.bulk.discountPct}%` : ""}
                            {l.disc !== "" ? ` · manual −${l.disc}%` : ""} · GST {p.gstRate}%
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className={inputCls}
                        placeholder="Qty"
                        value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                      />
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        className={inputCls}
                        placeholder="Disc %"
                        title="Manual discount % — leave empty for automatic bulk discounts"
                        value={l.disc}
                        onChange={(e) => setLine(i, { disc: e.target.value })}
                      />
                      <button
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))}
                        title="Remove line"
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
                  Quick estimate {intra ? "· CGST + SGST" : "· IGST"}
                </span>
                <span className="flex items-center gap-3 font-money text-[12.5px]">
                  <span className="text-dmk-text-secondary">Taxable {formatINR(preview.taxable)}</span>
                  <span className="text-dmk-info">GST {formatINR(preview.tax)}</span>
                  <span className="font-semibold text-dmk-gold">Total {formatINR(preview.total)}</span>
                </span>
              </div>
            </div>

            <Field label="Notes (optional)">
              <Textarea
                className={cn(inputCls, "min-h-[56px] resize-none")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Deliver via transporter, bill on 1st of every month"
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
                  Auto-post on schedule
                </span>
                <span className="text-[11px] leading-snug text-dmk-text-muted">
                  When due, the platform scheduler bills this template automatically every {""}
                  {autoPost ? "cycle" : "manual pass only"} — same engine, same credit &amp; stock guards.
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
              Cancel
            </Button>
            <Button className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={submitTemplate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editOf ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* generate result dialog */}
      <Dialog open={!!genResult} onOpenChange={(o) => !o && setGenResult(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="text-[16px] text-dmk-text-primary">Generation Report</DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              {genResult?.generated ?? 0} template{(genResult?.generated ?? 0) === 1 ? "" : "s"} billed ·{" "}
              {(genResult?.skipped ?? 0) > 0 ? `${genResult?.skipped} skipped · ` : ""}
              {genResult?.failed ?? 0} failed. Invoices and journals are posted.
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
                    Invoice <span className="font-mono">{run.invoiceNumber}</span>
                    {(run.invoices ?? 1) > 1 ? ` · ${run.invoices} cycles caught up` : ""}
                  </p>
                ) : run.ok && run.skipped ? (
                  <p className="mt-1 pl-6 text-[11.5px] text-dmk-text-secondary">
                    {run.skippedCycles ?? 1} cycle{(run.skippedCycles ?? 1) === 1 ? "" : "s"} inside the hold window skipped —
                    next run {run.holdUntil ? `after ${formatDate(run.holdUntil)}` : "advanced"} without billing.
                  </p>
                ) : (
                  <p className="mt-1 pl-6 text-[11.5px] text-dmk-danger">{run.error}</p>
                )}
              </div>
            ))}
            {(genResult?.runs ?? []).length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-dmk-text-muted">No templates were due.</p>
            )}
          </div>
          <DialogFooter>
            <Button className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90" onClick={() => setGenResult(null)}>
              Done
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
              Run History — {runsOf?.name}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-dmk-text-muted">
              Subscription ledger — every tax invoice auto-posted by this template, newest first.
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Total runs</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-text-primary">{runsData.totals.runs}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Total billed</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-gold">{formatINR(runsData.totals.billed)}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Avg invoice</p>
                  <p className="mt-0.5 font-money text-[15px] font-semibold text-dmk-text-primary">{formatINR(runsData.totals.avgInvoice)}</p>
                </div>
                <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Last run</p>
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
                  <p className="mt-2 text-[13px] font-semibold text-dmk-text-primary">No runs yet</p>
                  <p className="mt-0.5 text-[11.5px] text-dmk-text-muted">
                    Invoices appear here the first time the template bills — run it now or wait for the schedule.
                  </p>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto rounded-lg border border-dmk-border-subtle [&>*]:min-w-0">
                  <table className="dmk-table min-w-[560px]">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Mode</th>
                        <th className="text-right">GST (₹)</th>
                        <th className="text-right">Total (₹)</th>
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
                Totals reconcile with the invoice register — every run is a real A4 tax invoice with its own journal and stock draw.
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
              onClick={() => setRunsOf(null)}
            >
              Close
            </Button>
            <Button
              className="h-9 bg-dmk-blue text-white hover:bg-dmk-blue/90"
              onClick={() => {
                setRunsOf(null);
                setView("sales/invoices");
              }}
            >
              Open Invoice Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteOf} onOpenChange={(o) => !o && setDeleteOf(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteOf?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template and its lines will be removed from the schedule. Invoices already posted stay in your books.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
