"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — VENDOR PAYMENTS + PER-PO SETTLEMENT (R7)
// Paydown of vendor payable (Cr-positive ↓) via NEFT/UPI/CHEQUE/CASH
// with UTR reference. Journal: Dr AP, Cr Bank/Cash (R6/R7).
// Optional settlement: allocate the payment against specific open
// CONFIRMED purchase orders (oldest-first auto or manual) → precise AP.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, Banknote, CalendarClock, Download, Landmark, Loader2, Package, Plus, ReceiptText, Search, Sparkles, Wallet } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate, downloadCSV } from "@/lib/format";
import type { Vendor, PoAgingResponse, OpenPurchaseOrderRow } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  KpiCard,
  SearchInput,
  Field,
  inputCls,
} from "@/components/erp/shared";
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
import { useToast } from "@/hooks/use-toast";
import { consumePendingVendor } from "@/lib/settle-bus";
import { cn } from "@/lib/utils";

interface PayAllocation {
  amount: number;
  purchaseOrder?: { poNumber: string } | null;
}

interface PayRow {
  id: string;
  vendorId: string;
  vendor?: { id: string; vendorName: string } | null;
  paymentDate: string;
  amount: number;
  mode: string;
  utrRef: string;
  notes: string;
  allocations?: PayAllocation[];
}

const MODES = ["NEFT", "UPI", "CHEQUE", "CASH"] as const;

function modeTone(mode: string): "info" | "success" | "warning" | "neutral" {
  switch (mode) {
    case "NEFT": return "info";
    case "UPI": return "success";
    case "CHEQUE": return "warning";
    default: return "neutral";
  }
}

function poBucketTone(bucket: OpenPurchaseOrderRow["bucket"]): "info" | "warning" | "gold" | "danger" {
  if (bucket === "0-30") return "info";
  if (bucket === "31-60") return "warning";
  if (bucket === "61-90") return "gold";
  return "danger";
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── "Settled against" cell (PO chips, mirrors receipts.tsx) ──────
function SettledAgainstCell({ row }: { row: PayRow }) {
  const allocs = row.allocations ?? [];
  if (allocs.length === 0) {
    return <span className="text-[11.5px] italic text-dmk-text-muted">On account</span>;
  }
  const shown = allocs.slice(0, 2);
  const rest = allocs.length - shown.length;
  const allocated = allocs.reduce((s, a) => s + Number(a.amount), 0);
  const remainder = Number(row.amount) - allocated;
  return (
    <div className="space-y-0.5 min-w-[140px]">
      {shown.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="dmk-badge-info font-money text-[10px] px-1.5 py-0.5 rounded border border-dmk-info/30 bg-dmk-info/10 text-dmk-info">
            {a.purchaseOrder?.poNumber ?? "PO"}
          </span>
          <span className="font-money text-[10.5px] text-dmk-text-secondary">{formatINR(Number(a.amount))}</span>
        </div>
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-dmk-text-muted block">
          +{rest} more · {formatINR(allocs.slice(2).reduce((s, a) => s + Number(a.amount), 0))}
        </span>
      )}
      {remainder > 0.009 && (
        <span className="text-[10.5px] text-dmk-text-muted font-money block">· on acct {formatINR(remainder)}</span>
      )}
    </div>
  );
}

export default function VendorPaymentsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [rows, setRows] = React.useState<PayRow[] | null>(null);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [vendorFilter, setVendorFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [payOpen, setPayOpen] = React.useState(false);
  const [presetVendor, setPresetVendor] = React.useState<string | null>(null);

  // Settle-from-context: party ledger "Pay" deep-links here (cycle 15).
  // Handles both orders: event while mounted, or pending slot consumed on mount.
  React.useEffect(() => {
    const pending = consumePendingVendor();
    if (pending) {
      setPresetVendor(pending);
      setPayOpen(true);
    }
    function onSettle(e: Event) {
      const d = (e as CustomEvent).detail ?? {};
      if (!d?.partyId) return;
      setPresetVendor(String(d.partyId));
      setPayOpen(true);
    }
    window.addEventListener("dmk:settle-vendor", onSettle);
    return () => window.removeEventListener("dmk:settle-vendor", onSettle);
  }, []);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<PayRow[]>("/api/v1/vendor-payments", {
      firmId: activeFirmId,
      vendorId: vendorFilter === "ALL" ? undefined : vendorFilter,
    })
      .then((res) => alive && setRows(res))
      .catch((e) => {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load payments", description: e.message });
        }
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, vendorFilter, refresh, toast]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId })
      .then((res) => alive && setVendors(res))
      .catch(() => alive && setVendors([]));
    return () => {
      alive = false;
    };
  }, [activeFirmId, refresh]);

  const q = query.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => {
    if (!q) return true;
    return (
      (r.vendor?.vendorName ?? "").toLowerCase().includes(q) ||
      (r.utrRef ?? "").toLowerCase().includes(q) ||
      (r.notes ?? "").toLowerCase().includes(q) ||
      r.mode.toLowerCase().includes(q) ||
      (r.allocations ?? []).some((a) => (a.purchaseOrder?.poNumber ?? "").toLowerCase().includes(q))
    );
  });

  // KPIs — computed client-side
  const now = new Date();
  const isThisMonth = (d: string) => {
    const dt = new Date(d);
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
  };
  const monthRows = (rows ?? []).filter((r) => isThisMonth(r.paymentDate));
  const monthTotal = monthRows.reduce((s, r) => s + Number(r.amount), 0);
  const allTotal = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const allocatedTotal = (rows ?? []).reduce((s, r) => s + (r.allocations ?? []).reduce((x, a) => x + Number(a.amount), 0), 0);
  const settlePct = allTotal > 0 ? (allocatedTotal / allTotal) * 100 : 0;

  function exportCsv() {
    downloadCSV("vendor-payments.csv", [
      ["Date", "Vendor", "Mode", "UTR Ref", "Amount", "Settled Against", "On Account", "Notes"],
      ...visible.map((r) => {
        const allocs = r.allocations ?? [];
        const allocated = allocs.reduce((s, a) => s + Number(a.amount), 0);
        return [
          toISODate(r.paymentDate),
          r.vendor?.vendorName ?? "",
          r.mode,
          r.utrRef ?? "",
          Number(r.amount).toFixed(2),
          allocs.map((a) => `${a.purchaseOrder?.poNumber ?? "PO"}=${Number(a.amount).toFixed(2)}`).join("; "),
          (Number(r.amount) - allocated).toFixed(2),
          r.notes ?? "",
        ];
      }),
    ]);
    toast({ title: "Exported", description: `${visible.length} payments written to CSV.` });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendor Payments"
        subtitle="Pay down vendor payables (Cr) · allocate to open purchase orders for precise AP · NEFT / UPI / Cheque / Cash"
        icon={Banknote}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-orange text-white hover:bg-dmk-orange/90"
            onClick={() => setPayOpen(true)}
          >
            <Plus className="h-4 w-4" /> Record Payment
          </Button>
        }
      />

      <div className="dmk-enter-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Paid this month" value={formatINR(monthTotal)} tone="orange" icon={Wallet} sub={`${monthRows.length} payments in ${now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`} />
        <KpiCard label="Payments this month" value={String(monthRows.length)} tone="blue" icon={ReceiptText} sub="Against vendor payables" />
        <KpiCard label="All-time paid" value={formatINR(allTotal)} tone="info" icon={Landmark} sub={`${(rows ?? []).length} payments recorded`} />
        <KpiCard
          label="Bill-wise settled"
          value={`${settlePct.toFixed(0)}%`}
          tone="success"
          icon={Package}
          sub={`${formatINR(allocatedTotal)} allocated to purchase orders`}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search vendor, UTR, PO #, notes or mode…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[230px]")}>
            <SelectValue placeholder="All vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.vendorName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
          onClick={exportCsv}
          disabled={visible.length === 0}
        >
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={6} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No payments found"
              hint="Record a payment to reduce a vendor's Cr (payable) balance."
            />
          ) : (
            <table className="dmk-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Mode</th>
                  <th>UTR / Ref</th>
                  <th>Settled Against</th>
                  <th className="text-right">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="group">
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.paymentDate)}</td>
                    <td className="text-[13px] font-medium max-w-[200px] truncate">{r.vendor?.vendorName ?? "—"}</td>
                    <td><Badge tone={modeTone(r.mode)}>{r.mode}</Badge></td>
                    <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.utrRef || "—"}</td>
                    <td><SettledAgainstCell row={r} /></td>
                    <td className="num text-[13px] font-semibold text-dmk-info">{formatINR(Number(r.amount))}</td>
                    <td className="text-[11.5px] text-dmk-text-muted max-w-[200px] truncate">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          if (!o) setPresetVendor(null);
        }}
        vendors={vendors}
        presetVendorId={presetVendor}
        onSaved={() => setRefresh((r) => r + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Record payment dialog — with per-PO settlement panel
// ═══════════════════════════════════════════════════════════════
function RecordPaymentDialog({
  open,
  onOpenChange,
  vendors,
  presetVendorId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
  presetVendorId?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [saving, setSaving] = React.useState(false);
  const [vendorId, setVendorId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<string>("NEFT");
  const [utrRef, setUtrRef] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(toISODate(new Date()));
  const [notes, setNotes] = React.useState("");

  // ── Settlement state ──
  const [openPOs, setOpenPOs] = React.useState<OpenPurchaseOrderRow[] | null>(null);
  const [poLoading, setPoLoading] = React.useState(false);
  const [allocs, setAllocs] = React.useState<Record<string, string>>({});

  const selected = vendors.find((v) => v.id === vendorId);
  const payable = Number(selected?.closingBalance ?? 0);
  const amt = num(amount);

  const allocationTotal = React.useMemo(
    () => Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0),
    [allocs]
  );
  const onAccount = amt - allocationTotal;
  const overAllocated = allocationTotal > amt + 0.009;
  const overpay = !!selected && amt > payable + 0.005;
  const hasAllocations = Object.values(allocs).some((v) => (Number(v) || 0) > 0);

  // Fetch open POs whenever the dialog opens for a vendor
  React.useEffect(() => {
    if (!open || !activeFirmId || !vendorId) {
      setOpenPOs(null);
      return;
    }
    let alive = true;
    setPoLoading(true);
    apiGet<PoAgingResponse>("/api/v1/ledger/aging-pos", {
      firmId: activeFirmId,
      vendorId,
    })
      .then((res) => {
        if (alive) setOpenPOs(res.rows ?? []);
      })
      .catch(() => {
        if (alive) setOpenPOs([]);
      })
      .finally(() => {
        if (alive) setPoLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, vendorId]);

  React.useEffect(() => {
    if (!open) {
      setVendorId("");
      setAmount("");
      setMode("NEFT");
      setUtrRef("");
      setPaymentDate(toISODate(new Date()));
      setNotes("");
      setAllocs({});
      setOpenPOs(null);
      autoAllocArmed.current = false;
    }
  }, [open]);

  // ── Settle-from-context preset (cycle 15): preselect vendor + amount ──
  const presetApplied = React.useRef<string | null>(null);
  const autoAllocArmed = React.useRef(false);
  React.useEffect(() => {
    if (!open || !presetVendorId) {
      if (!open) presetApplied.current = null;
      return;
    }
    if (presetApplied.current === presetVendorId) return;
    presetApplied.current = presetVendorId;
    setVendorId(presetVendorId);
    autoAllocArmed.current = true;
  }, [open, presetVendorId]);

  // Prefill amount with the vendor's current payable once the vendor is applied
  React.useEffect(() => {
    if (!open || !presetVendorId || vendorId !== presetVendorId) return;
    if (amount !== "") return;
    const bal = Number(vendors.find((v) => v.id === vendorId)?.closingBalance ?? 0);
    if (bal > 0.005) setAmount(bal.toFixed(2));
  }, [open, presetVendorId, vendorId, amount, vendors]);

  // Auto-allocate the preset payment oldest-first once open bills arrive
  React.useEffect(() => {
    if (!autoAllocArmed.current) return;
    if (!openPOs || openPOs.length === 0) return;
    const total = Number(vendors.find((v) => v.id === presetVendorId)?.closingBalance ?? 0);
    if (total <= 0.005) {
      autoAllocArmed.current = false;
      return;
    }
    autoAllocArmed.current = false;
    const next: Record<string, string> = {};
    let remaining = Math.round(total * 100) / 100;
    for (const po of openPOs) {
      if (remaining <= 0.009) break;
      const take = Math.min(remaining, po.outstanding);
      next[po.poId] = (Math.round(take * 100) / 100).toFixed(2);
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setAllocs(next);
  }, [openPOs, presetVendorId, vendors]);

  // Reset allocations when the vendor changes
  React.useEffect(() => {
    setAllocs({});
  }, [vendorId]);

  function autoAllocateOldestFirst() {
    if (!openPOs || amt <= 0) return;
    const next: Record<string, string> = {};
    let remaining = Math.round(amt * 100) / 100;
    for (const po of openPOs) {
      if (remaining <= 0.009) break;
      const take = Math.min(remaining, po.outstanding);
      next[po.poId] = (Math.round(take * 100) / 100).toFixed(2);
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setAllocs(next);
  }

  function setAlloc(poId: string, value: string) {
    setAllocs((prev) => ({ ...prev, [poId]: value }));
  }

  const openPoCount = openPOs?.length ?? 0;

  const canSave = !!vendorId && amt > 0 && !!mode;

  async function submit() {
    if (!activeFirmId || !canSave) return;
    if (overAllocated) {
      toast({
        variant: "destructive",
        title: "Allocation exceeds payment",
        description: `Allocated ${formatINR(allocationTotal)} but the payment is ${formatINR(amt)}.`,
      });
      return;
    }
    setSaving(true);
    try {
      const allocations = Object.entries(allocs)
        .map(([purchaseOrderId, v]) => ({ purchaseOrderId, amount: Number(v) || 0 }))
        .filter((a) => a.amount > 0);
      const res = await apiPost<{ applied: Array<{ poNumber: string }>; allocatedTotal: number }>(
        "/api/v1/vendor-payments",
        {
          firmId: activeFirmId,
          vendorId,
          paymentDate,
          amount: amt,
          mode,
          utrRef: utrRef.trim(),
          notes: notes.trim(),
          allocations,
        }
      );
      const settledCount = res.applied?.length ?? 0;
      toast({
        title: "Payment recorded",
        description:
          settledCount > 0
            ? `${formatINR(amt)} via ${mode} — settled ${settledCount} bill${settledCount !== 1 ? "s" : ""} (${formatINR(res.allocatedTotal ?? 0)})`
            : `${selected?.vendorName ?? "Vendor"} · ${formatINR(amt)} via ${mode} · Payable reduced · Journal posted`,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Payment failed",
        description: e instanceof ApiError ? e.message : "Could not record payment.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Record vendor payment</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Reduces the vendor&apos;s Cr (payable) balance and posts a balanced PAYMENT journal — optionally settle specific bills.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Vendor *">
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder="Select vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                      {" — "}
                      {Number(v.closingBalance) > 0.005
                        ? `Cr ${formatINR(Number(v.closingBalance))}`
                        : "Clear"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {selected && (
            <div className="sm:col-span-2 dmk-well px-3 py-2.5 text-[12px] flex flex-wrap items-center justify-between gap-2">
              <span className="text-dmk-text-muted">
                Current payable{" "}
                <span className={cn("font-money font-semibold", payable > 0.005 ? "text-dmk-info" : "text-dmk-success")}>
                  {payable > 0.005 ? `Cr ${formatINR(payable)}` : "Clear"}
                </span>
              </span>
              {amt > 0 && (
                <span className="text-dmk-text-muted">
                  After payment{" "}
                  <span className="font-money font-semibold text-dmk-text-secondary">
                    {payable - amt > 0.005
                      ? `Cr ${formatINR(payable - amt)}`
                      : payable - amt < -0.005
                        ? `Dr ${formatINR(amt - payable)}`
                        : "Clear"}
                  </span>
                </span>
              )}
            </div>
          )}

          <Field label="Amount *">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn(inputCls, "font-money text-right")}
              placeholder="0.00"
            />
          </Field>

          <Field label="Mode *">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="UTR / Reference" hint="Bank UTR, UPI txn ID or cheque number">
            <Input
              value={utrRef}
              onChange={(e) => setUtrRef(e.target.value)}
              className={cn(inputCls, "font-money")}
              placeholder="e.g. UTIB2026…"
            />
          </Field>

          <Field label="Payment date">
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional" />
            </Field>
          </div>
        </div>

        {/* ── PO settlement section ── */}
        {vendorId && (
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dmk-border-subtle">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-dmk-info" />
                <span className="text-[12px] font-semibold text-dmk-text-primary">Settle against open bills (purchase orders)</span>
                {poLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-dmk-text-muted" />
                ) : (
                  <span className="text-[10.5px] text-dmk-text-muted">
                    {openPoCount > 0 ? `${openPoCount} open` : "none open"}
                  </span>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={autoAllocateOldestFirst}
                disabled={amt <= 0 || openPoCount === 0}
                className="h-7 gap-1.5 px-2 text-[11px] border-dmk-border-medium text-dmk-info hover:bg-dmk-hover"
              >
                <Sparkles className="h-3 w-3" /> Auto-allocate (oldest first)
              </Button>
            </div>

            {poLoading ? (
              <div className="px-3 py-4 text-[12px] text-dmk-text-muted">Loading open bills…</div>
            ) : openPoCount === 0 ? (
              <div className="px-3 py-3 text-[11.5px] text-dmk-text-muted italic">
                No open CONFIRMED bills for this vendor — the full amount will be recorded <span className="not-italic font-medium text-dmk-text-secondary">on account</span>.
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-dmk-bg-tertiary z-10">
                    <tr className="text-[10.5px] uppercase tracking-wide text-dmk-text-muted">
                      <th className="text-left font-semibold px-3 py-1.5">Bill / PO</th>
                      <th className="text-left font-semibold px-2 py-1.5">Age</th>
                      <th className="text-right font-semibold px-2 py-1.5">Outstanding</th>
                      <th className="text-right font-semibold px-3 py-1.5 w-28">Allocate ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPOs!.map((po) => {
                      const v = Number(allocs[po.poId] || 0);
                      return (
                        <tr key={po.poId} className={cn("border-t border-dmk-border-subtle/60", v > 0 && "bg-dmk-info/5")}>
                          <td className="px-3 py-1.5">
                            <span className="font-money text-[11.5px] text-dmk-text-primary">{po.poNumber}</span>
                            <span className="ml-2 text-[10.5px] text-dmk-text-muted">{formatDate(po.poDate)}</span>
                            {(po.settled > 0.009 || po.credited > 0.009) && (
                              <span className="ml-2 text-[10px] text-dmk-text-muted">
                                {po.settled > 0.009 && <>paid {formatINR(po.settled)} </>}
                                {po.credited > 0.009 && <>· DN {formatINR(po.credited)}</>}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge tone={poBucketTone(po.bucket)}>{po.bucket}</Badge>
                            {po.isOverdue && <span className="ml-1 text-[10px] font-semibold text-dmk-danger">{po.overdueDays}d late</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-money text-dmk-text-secondary">{formatINR(po.outstanding)}</td>
                          <td className="px-3 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={po.outstanding}
                              step="0.01"
                              value={allocs[po.poId] ?? ""}
                              onChange={(e) => setAlloc(po.poId, e.target.value)}
                              className="h-7 bg-dmk-input-well border-dmk-border-subtle text-right font-money text-[11.5px] text-dmk-text-primary dmk-input"
                              placeholder="0.00"
                              aria-label={`Allocate to ${po.poNumber}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Allocation summary strip */}
            {amt > 0 && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-dmk-border-subtle bg-dmk-bg-tertiary/70 text-[11.5px]">
                <span className="text-dmk-text-muted">
                  Allocated <span className={cn("font-money font-semibold", overAllocated ? "text-dmk-danger" : "text-dmk-info")}>{formatINR(allocationTotal)}</span>
                  {" · "}On account <span className="font-money font-semibold text-dmk-text-secondary">{formatINR(Math.max(0, onAccount))}</span>
                </span>
                {hasAllocations && (
                  <button
                    type="button"
                    onClick={() => setAllocs({})}
                    className="text-[10.5px] text-dmk-text-muted hover:text-dmk-text-primary underline underline-offset-2"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {overAllocated && (
          <div className="flex items-start gap-2 rounded-md border border-dmk-danger/30 bg-[rgba(239,68,68,0.08)] px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-dmk-danger shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-dmk-danger leading-snug">
              Allocated {formatINR(allocationTotal)} exceeds the payment amount {formatINR(amt)} — reduce an allocation or raise the payment amount.
            </p>
          </div>
        )}

        {!overAllocated && overpay && (
          <p className="text-[12px] text-dmk-warning bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-md px-3 py-2">
            Amount exceeds the current payable by {formatINR(amt - payable)} — the excess will sit as a Dr (advance)
            balance for this vendor.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave || saving || overAllocated} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
