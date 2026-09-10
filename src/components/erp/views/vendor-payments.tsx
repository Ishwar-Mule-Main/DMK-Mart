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
import { consumePendingVendor, consumePendingPayPo } from "@/lib/settle-bus";
import { filterByQuery } from "@/lib/search-rank";
import { useT } from "@/lib/i18n";
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
  const { t } = useT();
  const allocs = row.allocations ?? [];
  if (allocs.length === 0) {
    return <span className="text-[11.5px] italic text-dmk-text-muted">{t("vp.onAccount")}</span>;
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
          {t("vp.moreN", { n: rest, amt: formatINR(allocs.slice(2).reduce((s, a) => s + Number(a.amount), 0)) })}
        </span>
      )}
      {remainder > 0.009 && (
        <span className="text-[10.5px] text-dmk-text-muted font-money block">{t("vp.onAcctShort", { amt: formatINR(remainder) })}</span>
      )}
    </div>
  );
}

export default function VendorPaymentsView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [rows, setRows] = React.useState<PayRow[] | null>(null);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [vendorFilter, setVendorFilter] = React.useState("ALL");
  const [query, setQuery] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [payOpen, setPayOpen] = React.useState(false);
  const [presetVendor, setPresetVendor] = React.useState<string | null>(null);
  const [presetPo, setPresetPo] = React.useState<{ poId: string; vendorId: string } | null>(null);

  // Settle-from-context: party ledger "Pay" deep-links here (cycle 15).
  // Cycle 17: purchase-order rows deep-link a SPECIFIC bill.
  // Handles both orders: event while mounted, or pending slot consumed on mount.
  React.useEffect(() => {
    const pending = consumePendingVendor();
    if (pending) {
      setPresetVendor(pending);
      setPayOpen(true);
    }
    const pendingPo = consumePendingPayPo();
    if (pendingPo) {
      setPresetPo(pendingPo);
      setPresetVendor(pendingPo.vendorId);
      setPayOpen(true);
    }
    function onSettle(e: Event) {
      const d = (e as CustomEvent).detail ?? {};
      if (!d?.partyId) return;
      setPresetVendor(String(d.partyId));
      setPayOpen(true);
    }
    function onPayPo(e: Event) {
      const d = (e as CustomEvent).detail ?? {};
      if (!d?.poId || !d?.vendorId) return;
      setPresetPo({ poId: String(d.poId), vendorId: String(d.vendorId) });
      setPresetVendor(String(d.vendorId));
      setPayOpen(true);
    }
    window.addEventListener("dmk:settle-vendor", onSettle);
    window.addEventListener("dmk:pay-po", onPayPo);
    return () => {
      window.removeEventListener("dmk:settle-vendor", onSettle);
      window.removeEventListener("dmk:pay-po", onPayPo);
    };
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
            toast({ variant: "destructive", title: t("vp.toastLoadFail"), description: e.message });
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

  // Word-wise ranked filtering — payment register keeps its incoming order.
  const visible = filterByQuery(rows ?? [], query, (r) => [
    r.vendor?.vendorName ?? "",
    r.utrRef ?? "",
    (r.allocations ?? []).map((a) => a.purchaseOrder?.poNumber ?? "").join(" "),
    r.notes ?? "",
    r.mode,
  ]);

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
      [t("cmn.date"), t("cmn.vendor"), t("vp.colMode"), t("vp.colUtr"), t("cmn.amount"), t("vp.colSettled"), t("vp.onAccount"), t("cmn.notes")],
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
    toast({ title: t("vp.toastExported"), description: t("vp.toastExportedDesc", { n: visible.length }) });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("vp.title")}
        subtitle={t("vp.subtitle")}
        icon={Banknote}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
            onClick={() => setPayOpen(true)}
          >
            <Plus className="h-4 w-4" /> {t("vp.recordPayment")}
          </Button>
        }
      />

      <div className="dmk-enter-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t("vp.kpiPaid")} value={formatINR(monthTotal)} tone="orange" icon={Wallet} sub={t("vp.kpiPaidSub", { n: monthRows.length, month: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) })} />
        <KpiCard label={t("vp.kpiCount")} value={String(monthRows.length)} tone="blue" icon={ReceiptText} sub={t("vp.kpiCountSub")} />
        <KpiCard label={t("vp.kpiAllTime")} value={formatINR(allTotal)} tone="info" icon={Landmark} sub={t("vp.kpiAllTimeSub", { n: (rows ?? []).length })} />
        <KpiCard
          label={t("vp.kpiSettled")}
          value={`${settlePct.toFixed(0)}%`}
          tone="success"
          icon={Package}
          sub={t("vp.kpiSettledSub", { amt: formatINR(allocatedTotal) })}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder={t("vp.searchPh")} className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[230px]")}>
            <SelectValue placeholder={t("vp.allVendors")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("vp.allVendors")}</SelectItem>
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
              title={t("vp.emptyTitle")}
              hint={t("vp.emptyHint")}
            />
          ) : (
            <table className="dmk-table min-w-[980px]">
              <thead>
                <tr>
                  <th>{t("cmn.date")}</th>
                  <th>{t("cmn.vendor")}</th>
                  <th>{t("vp.colMode")}</th>
                  <th>{t("vp.colUtr")}</th>
                  <th>{t("vp.colSettled")}</th>
                  <th className="text-right">{t("cmn.amount")}</th>
                  <th>{t("cmn.notes")}</th>
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
          if (!o) {
            setPresetVendor(null);
            setPresetPo(null);
          }
        }}
        vendors={vendors}
        presetVendorId={presetVendor}
        presetPoId={presetPo?.poId ?? null}
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
  presetPoId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
  presetVendorId?: string | null;
  presetPoId?: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
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

  // ── Pay-from-PO preset (cycle 17): pin the FULL outstanding of the
  // specific bill once open bills arrive and match the payment amount. ──
  React.useEffect(() => {
    if (!open || !presetPoId || !openPOs) return;
    const po = openPOs.find((p) => p.poId === presetPoId);
    if (!po || po.outstanding <= 0.009) return;
    const v = po.outstanding.toFixed(2);
    setAllocs({ [presetPoId]: v });
    setAmount(v);
  }, [open, presetPoId, openPOs]);

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
        title: t("vp.toastAllocExceeds"),
        description: t("vp.toastAllocExceedsDesc", { alloc: formatINR(allocationTotal), pay: formatINR(amt) }),
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
        title: t("vp.toastRecorded"),
        description:
          settledCount > 0
            ? t("vp.toastSettled", { amt: formatINR(amt), mode, n: settledCount, alloc: formatINR(res.allocatedTotal ?? 0) })
            : t("vp.toastOnAccount", { name: selected?.vendorName ?? t("vp.vendorFallback"), amt: formatINR(amt), mode }),
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("vp.toastFailed"),
        description: e instanceof ApiError ? e.message : t("vp.toastFailedDesc"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{t("vp.dialogTitle")}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {t("vp.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label={t("vp.vendorField")}>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder={t("vp.vendorPh")} />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                      {" — "}
                      {Number(v.closingBalance) > 0.005
                        ? `Cr ${formatINR(Number(v.closingBalance))}`
                        : t("vp.clear")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {selected && (
            <div className="sm:col-span-2 dmk-well px-3 py-2.5 text-[12px] flex flex-wrap items-center justify-between gap-2">
              <span className="text-dmk-text-muted">
                {t("vp.currentPayable")}{" "}
                <span className={cn("font-money font-semibold", payable > 0.005 ? "text-dmk-info" : "text-dmk-success")}>
                  {payable > 0.005 ? `Cr ${formatINR(payable)}` : t("vp.clear")}
                </span>
              </span>
              {amt > 0 && (
                <span className="text-dmk-text-muted">
                  {t("vp.afterPayment")}{" "}
                  <span className="font-money font-semibold text-dmk-text-secondary">
                    {payable - amt > 0.005
                      ? `Cr ${formatINR(payable - amt)}`
                      : payable - amt < -0.005
                        ? `Dr ${formatINR(amt - payable)}`
                        : t("vp.clear")}
                  </span>
                </span>
              )}
            </div>
          )}

          <Field label={t("vp.amountField")}>
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

          <Field label={t("vp.modeField")}>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("vp.utrField")} hint={t("vp.utrHint")}>
            <Input
              value={utrRef}
              onChange={(e) => setUtrRef(e.target.value)}
              className={cn(inputCls, "font-money")}
              placeholder={t("vp.utrPh")}
            />
          </Field>

          <Field label={t("vp.dateField")}>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("cmn.notes")}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder={t("vp.notesPh")} />
            </Field>
          </div>
        </div>

        {/* ── PO settlement section ── */}
        {vendorId && (
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dmk-border-subtle">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-dmk-info" />
                <span className="text-[12px] font-semibold text-dmk-text-primary">{t("vp.settleTitle")}</span>
                {poLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-dmk-text-muted" />
                ) : (
                  <span className="text-[10.5px] text-dmk-text-muted">
                    {openPoCount > 0 ? t("vp.nOpen", { n: openPoCount }) : t("vp.noneOpen")}
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
                <Sparkles className="h-3 w-3" /> {t("vp.autoAllocate")}
              </Button>
            </div>

            {poLoading ? (
              <div className="px-3 py-4 text-[12px] text-dmk-text-muted">{t("vp.loadingBills")}</div>
            ) : openPoCount === 0 ? (
              <div className="px-3 py-3 text-[11.5px] text-dmk-text-muted italic">
                {t("vp.noBillsPre")} <span className="not-italic font-medium text-dmk-text-secondary">{t("vp.onAccount")}</span>{t("vp.noBillsPost")}
              </div>
            ) : (
              <div className="max-h-44 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-dmk-bg-tertiary z-10">
                    <tr className="text-[10.5px] uppercase tracking-wide text-dmk-text-muted">
                      <th className="text-left font-semibold px-3 py-1.5">{t("vp.colBillPo")}</th>
                      <th className="text-left font-semibold px-2 py-1.5">{t("vp.colAge")}</th>
                      <th className="text-right font-semibold px-2 py-1.5">{t("vp.colOutstanding")}</th>
                      <th className="text-right font-semibold px-3 py-1.5 w-28">{t("vp.colAllocate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPOs!.map((po) => {
                      const v = Number(allocs[po.poId] || 0);
                      return (
                        <tr key={po.poId} className={cn("border-t border-dmk-border-subtle/60", v > 0 && "bg-dmk-info/5")}>
                          <td className="px-3 py-1.5">
                            <span className="font-money text-[11.5px] text-dmk-text-primary">{po.poNumber}</span>
                            {po.vendorBillNo && (
                              <span className="ml-2 text-[10px] text-dmk-text-muted" title={t("vp.billTooltip")}>{t("vp.billPrefix")} {po.vendorBillNo}</span>
                            )}
                            <span className="ml-2 text-[10.5px] text-dmk-text-muted">{formatDate(po.poDate)}</span>
                            {(po.settled > 0.009 || po.credited > 0.009) && (
                              <span className="ml-2 text-[10px] text-dmk-text-muted">
                                {po.settled > 0.009 && <>{t("vp.paidN", { amt: formatINR(po.settled) })} </>}
                                {po.credited > 0.009 && <>{t("vp.dnN", { amt: formatINR(po.credited) })}</>}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <Badge tone={poBucketTone(po.bucket)}>{po.bucket}</Badge>
                            {po.isOverdue && <span className="ml-1 text-[10px] font-semibold text-dmk-danger">{t("vp.overdueDays", { n: po.overdueDays })}</span>}
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
                              aria-label={t("vp.allocAria", { po: po.poNumber })}
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
                  {t("vp.allocated")} <span className={cn("font-money font-semibold", overAllocated ? "text-dmk-danger" : "text-dmk-info")}>{formatINR(allocationTotal)}</span>
                  {" · "}{t("vp.onAccount")} <span className="font-money font-semibold text-dmk-text-secondary">{formatINR(Math.max(0, onAccount))}</span>
                </span>
                {hasAllocations && (
                  <button
                    type="button"
                    onClick={() => setAllocs({})}
                    className="text-[10.5px] text-dmk-text-muted hover:text-dmk-text-primary underline underline-offset-2"
                  >
                    {t("vp.clearAll")}
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
              {t("vp.allocExceeds", { alloc: formatINR(allocationTotal), pay: formatINR(amt) })}
            </p>
          </div>
        )}

        {!overAllocated && overpay && (
          <p className="text-[12px] text-dmk-warning bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-md px-3 py-2">
            {t("vp.overpayWarn", { amt: formatINR(amt - payable) })}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSave || saving || overAllocated} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("vp.recordPaymentBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
