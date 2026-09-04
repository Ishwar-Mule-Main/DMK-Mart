"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — CUSTOMER RECEIPTS (R7) + PER-INVOICE SETTLEMENT
// Money in against receivables: Dr Bank/Cash, Cr Customer A/R.
// Optional settlement: allocate the receipt against specific open
// credit invoices (oldest-first auto or manual) → precise AR aging.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, CalendarClock, ChevronDown, Download, HandCoins, Layers, Loader2, Plus, Search, Sparkles, List } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate, downloadCSV } from "@/lib/format";
import type { Customer, CustomerReceipt, InvoiceAgingResponse, OpenInvoiceRow } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput, Field, inputCls } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { consumePendingCustomer, consumePendingSettleInvoice } from "@/lib/settle-bus";
import { cn } from "@/lib/utils";

const MODES = ["NEFT", "UPI", "CHEQUE", "CASH"] as const;

function modeTone(mode: string): "success" | "info" | "warning" | "neutral" {
  switch (mode) {
    case "NEFT": return "info";
    case "UPI": return "success";
    case "CHEQUE": return "warning";
    default: return "neutral";
  }
}

function bucketTone(bucket: OpenInvoiceRow["bucket"]): "info" | "warning" | "gold" | "danger" {
  if (bucket === "0-30") return "info";
  if (bucket === "31-60") return "warning";
  if (bucket === "61-90") return "gold";
  return "danger";
}

export default function ReceiptsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [receipts, setReceipts] = React.useState<CustomerReceipt[] | null>(null);
  const [customers, setCustomers] = React.useState<Customer[] | null>(null);
  const [custFilter, setCustFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  // Customer-wise grouping — all receipts of one customer at one place
  const [groupByCustomer, setGroupByCustomer] = React.useState(true);
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const [newOpen, setNewOpen] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [presetCustomer, setPresetCustomer] = React.useState<string | null>(null);
  const [presetInvoice, setPresetInvoice] = React.useState<{ invoiceId: string; customerId: string } | null>(null);

  // Settle-from-context: party ledger "Settle" deep-links here (cycle 15).
  // Cycle 17: invoice register rows deep-link a SPECIFIC invoice.
  // Handles both orders: event while mounted, or pending slot consumed on mount.
  React.useEffect(() => {
    const pending = consumePendingCustomer();
    if (pending) {
      setPresetCustomer(pending);
      setNewOpen(true);
    }
    const pendingInv = consumePendingSettleInvoice();
    if (pendingInv) {
      setPresetInvoice(pendingInv);
      setNewOpen(true);
    }
    function onSettle(e: Event) {
      const d = (e as CustomEvent).detail ?? {};
      if (!d?.partyId) return;
      setPresetCustomer(String(d.partyId));
      setNewOpen(true);
    }
    function onSettleInvoice(e: Event) {
      const d = (e as CustomEvent).detail ?? {};
      if (!d?.invoiceId || !d?.customerId) return;
      setPresetInvoice({ invoiceId: String(d.invoiceId), customerId: String(d.customerId) });
      setNewOpen(true);
    }
    window.addEventListener("dmk:settle-party", onSettle);
    window.addEventListener("dmk:settle-invoice", onSettleInvoice);
    return () => {
      window.removeEventListener("dmk:settle-party", onSettle);
      window.removeEventListener("dmk:settle-invoice", onSettleInvoice);
    };
  }, []);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiGet<CustomerReceipt[]>("/api/v1/customer-receipts", {
          firmId: activeFirmId,
          customerId: custFilter === "all" ? undefined : custFilter,
        });
        if (alive) setReceipts(res);
      } catch (e) {
        if (alive) {
          setReceipts([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load receipts", description: e.message });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, custFilter, refresh]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2B" })
      .then((res) => alive && setCustomers(res))
      .catch(() => alive && setCustomers([]));
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  const customerMap = React.useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers]);

  const visible = React.useMemo(() => {
    const list = receipts ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const cust = r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? "";
      return (
        cust.toLowerCase().includes(q) ||
        (r.utrRef ?? "").toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q) ||
        (r.allocations ?? []).some((a) => a.invoiceNumber.toLowerCase().includes(q))
      );
    });
  }, [receipts, query, customerMap]);

  // ── Customer-wise groups: every receipt of a customer at one place ──
  const groups = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; receipts: CustomerReceipt[]; total: number }>();
    for (const r of visible) {
      const name = r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? r.customerId;
      const g = map.get(r.customerId) ?? { id: r.customerId, name, receipts: [], total: 0 };
      g.receipts.push(r);
      g.total += Number(r.amount);
      map.set(r.customerId, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [visible, customerMap]);

  function exportCsv() {
    downloadCSV("customer-receipts.csv", [
      ["Date", "Customer", "Mode", "UTR / Ref", "Settled against", "On account", "Notes", "Amount"],
      ...visible.map((r) => {
        const allocs = r.allocations ?? [];
        const allocated = allocs.reduce((s, a) => s + a.amount, 0);
        return [
          r.receiptDate.slice(0, 10),
          r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? r.customerId,
          r.mode,
          r.utrRef,
          allocs.map((a) => `${a.invoiceNumber} ₹${a.amount.toFixed(2)}`).join("; "),
          (Number(r.amount) - allocated).toFixed(2),
          r.notes,
          Number(r.amount).toFixed(2),
        ];
      }),
    ]);
  }

  if (!activeFirmId) {
    return <EmptyState icon={HandCoins} title="No active firm" hint="Select a firm from the header switcher." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Receipts"
        subtitle="Collections against receivables — allocate to invoices for precise aging (R7)"
        icon={HandCoins}
        actions={
          <Button size="sm" className="h-9 bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Record Receipt
          </Button>
        }
      />

      <div className="dmk-card p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search customer, UTR, invoice # or notes…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={custFilter} onValueChange={(v) => setCustFilter(v)}>
          <SelectTrigger className={cn(inputCls, "sm:w-64")}>
            <SelectValue placeholder="Customer" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="all">All customers</SelectItem>
            {(customers ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.partyName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 rounded-lg border border-dmk-border-subtle bg-dmk-input-well p-0.5 h-9">
          <button
            onClick={() => setGroupByCustomer(true)}
            className={cn(
              "h-8 px-3 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
              groupByCustomer ? "bg-dmk-yellow/15 text-dmk-yellow" : "text-dmk-text-muted hover:text-dmk-text-secondary"
            )}
          >
            <Layers className="h-3.5 w-3.5" /> By customer
          </button>
          <button
            onClick={() => setGroupByCustomer(false)}
            className={cn(
              "h-8 px-3 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors",
              !groupByCustomer ? "bg-dmk-yellow/15 text-dmk-yellow" : "text-dmk-text-muted hover:text-dmk-text-secondary"
            )}
          >
            <List className="h-3.5 w-3.5" /> Flat list
          </button>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={visible.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* ── Customer-wise groups — all receipts of one customer at one place ── */}
      {groupByCustomer ? (
        receipts === null ? (
          <div className="dmk-card overflow-hidden"><LoadingRows rows={6} /></div>
        ) : groups.length === 0 ? (
          <div className="dmk-card overflow-hidden"><EmptyState icon={HandCoins} title="No receipts" hint="Record a receipt to reduce a customer's outstanding balance." /></div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const open = openGroups[g.id] !== false; // default expanded
              return (
                <div key={g.id} className="dmk-card overflow-hidden">
                  <button
                    onClick={() => setOpenGroups((m) => ({ ...m, [g.id]: !open }))}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-dmk-hover/60 transition-colors text-left"
                  >
                    <ChevronDown className={cn("h-4 w-4 text-dmk-text-muted transition-transform shrink-0", open && "rotate-180 text-dmk-yellow")} />
                    <span className="h-8 w-8 rounded-full bg-dmk-blue/20 border border-dmk-blue/40 flex items-center justify-center text-[11px] font-bold text-dmk-blue shrink-0">
                      {g.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-bold text-dmk-text-primary truncate">{g.name}</span>
                      <span className="block text-[11px] text-dmk-text-muted">
                        {g.receipts.length} receipt{g.receipts.length === 1 ? "" : "s"} · latest {formatDate(g.receipts[0].receiptDate)}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[10px] uppercase tracking-widest text-dmk-text-muted">Total received</span>
                      <span className="block font-money text-[15px] font-bold text-dmk-success">{formatINR(g.total)}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-dmk-border-subtle divide-y divide-dmk-border-subtle">
                      {g.receipts.map((r) => {
                        const allocs = r.allocations ?? [];
                        const allocated = allocs.reduce((s, a) => s + a.amount, 0);
                        const onAccount = Number(r.amount) - allocated;
                        return (
                          <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                            <span className="text-dmk-text-secondary whitespace-nowrap w-24 shrink-0">{formatDate(r.receiptDate)}</span>
                            <span className="dmk-badge dmk-badge-neutral shrink-0">{r.mode}</span>
                            <span className="font-money text-dmk-text-muted truncate max-w-[140px]">{r.utrRef || "—"}</span>
                            <span className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                              {allocs.length === 0 ? (
                                <span className="text-[11.5px] text-dmk-text-muted italic">On account</span>
                              ) : (
                                <>
                                  {allocs.slice(0, 3).map((a) => (
                                    <span key={a.invoiceId} className="inline-flex items-center gap-1 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-1.5 py-0.5 text-[10.5px]">
                                      <span className="font-money text-dmk-info">{a.invoiceNumber}</span>
                                      <span className="font-money text-dmk-text-primary">{formatINR(a.amount)}</span>
                                    </span>
                                  ))}
                                  {allocs.length > 3 && <span className="text-[10.5px] text-dmk-text-muted">+{allocs.length - 3} more</span>}
                                  {onAccount > 0.009 && <span className="text-[10.5px] text-dmk-text-muted">· on acct {formatINR(onAccount)}</span>}
                                </>
                              )}
                              {r.notes && <span className="text-[10.5px] text-dmk-text-muted italic truncate max-w-[180px]">{r.notes}</span>}
                            </span>
                            <span className="font-money text-[13px] font-semibold text-dmk-success shrink-0">+{formatINR(Number(r.amount))}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {receipts === null ? (
            <LoadingRows rows={6} />
          ) : visible.length === 0 ? (
            <EmptyState icon={HandCoins} title="No receipts" hint="Record a receipt to reduce a customer's outstanding balance." />
          ) : (
            <table className="dmk-table min-w-[880px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Settled against</th>
                  <th>Mode</th>
                  <th>UTR / Ref</th>
                  <th>Notes</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const allocs = r.allocations ?? [];
                  const allocated = allocs.reduce((s, a) => s + a.amount, 0);
                  const onAccount = Number(r.amount) - allocated;
                  return (
                    <tr key={r.id} className="group">
                      <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.receiptDate)}</td>
                      <td className="max-w-[220px] truncate text-[13px] font-medium">{r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? r.customerId}</td>
                      <td className="max-w-[280px]">
                        {allocs.length === 0 ? (
                          <span className="text-[11.5px] text-dmk-text-muted italic">On account</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {allocs.slice(0, 2).map((a) => (
                              <span
                                key={a.invoiceId}
                                className="inline-flex items-center gap-1 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-1.5 py-0.5 text-[10.5px] font-medium text-dmk-text-secondary"
                                title={`${a.invoiceNumber}: ${formatINR(a.amount)}`}
                              >
                                <span className="font-money text-[10px] text-dmk-info">{a.invoiceNumber}</span>
                                <span className="font-money text-[10px] text-dmk-text-primary">{formatINR(a.amount)}</span>
                              </span>
                            ))}
                            {allocs.length > 2 && (
                              <span className="text-[10.5px] text-dmk-text-muted">+{allocs.length - 2} more</span>
                            )}
                            {onAccount > 0.009 && (
                              <span className="text-[10.5px] text-dmk-text-muted">· on acct {formatINR(onAccount)}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td><Badge tone={modeTone(r.mode)}>{r.mode}</Badge></td>
                      <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.utrRef || "—"}</td>
                      <td className="max-w-[180px] truncate text-[12px] text-dmk-text-muted">{r.notes || "—"}</td>
                      <td className="num text-[13px] font-semibold text-dmk-success">{formatINR(Number(r.amount))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      )}

      <NewReceiptDialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) {
            setPresetCustomer(null);
            setPresetInvoice(null);
          }
        }}
        customers={customers}
        presetCustomerId={presetCustomer}
        presetInvoice={presetInvoice}
        onCreated={() => setRefresh((r) => r + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Record receipt dialog — with invoice settlement allocation
// ═══════════════════════════════════════════════════════════════

function NewReceiptDialog({
  open,
  onOpenChange,
  customers,
  presetCustomerId,
  presetInvoice,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: Customer[] | null;
  presetCustomerId?: string | null;
  presetInvoice?: { invoiceId: string; customerId: string } | null;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [customerId, setCustomerId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<(typeof MODES)[number]>("NEFT");
  const [utrRef, setUtrRef] = React.useState("");
  const [receiptDate, setReceiptDate] = React.useState(toISODate(new Date()));
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // ── Settlement state ──
  const [openInvoices, setOpenInvoices] = React.useState<OpenInvoiceRow[] | null>(null);
  const [invLoading, setInvLoading] = React.useState(false);
  const [allocs, setAllocs] = React.useState<Record<string, string>>({});

  const selected = (customers ?? []).find((c) => c.id === customerId);
  const outstanding = Number(selected?.closingBalance ?? 0);
  const amt = Number(amount) || 0;

  const allocationTotal = React.useMemo(
    () => Object.values(allocs).reduce((s, v) => s + (Number(v) || 0), 0),
    [allocs]
  );
  const onAccount = amt - allocationTotal;
  const overAllocated = allocationTotal > amt + 0.009;
  const overpay = !!selected && amt > outstanding && outstanding >= 0 && amt > 0;
  const hasAllocations = Object.values(allocs).some((v) => (Number(v) || 0) > 0);

  // Fetch open invoices whenever the dialog opens for a customer
  React.useEffect(() => {
    if (!open || !activeFirmId || !customerId) {
      setOpenInvoices(null);
      return;
    }
    let alive = true;
    setInvLoading(true);
    apiGet<InvoiceAgingResponse>("/api/v1/ledger/aging-invoices", {
      firmId: activeFirmId,
      customerId,
    })
      .then((res) => {
        if (alive) setOpenInvoices(res.rows ?? []);
      })
      .catch(() => {
        if (alive) setOpenInvoices([]);
      })
      .finally(() => {
        if (alive) setInvLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, customerId]);

  React.useEffect(() => {
    if (!open) {
      setCustomerId("");
      setAmount("");
      setMode("NEFT");
      setUtrRef("");
      setNotes("");
      setReceiptDate(toISODate(new Date()));
      setAllocs({});
      setOpenInvoices(null);
      autoAllocArmed.current = false;
    }
  }, [open]);

  // ── Settle-from-context preset (cycle 15): preselect customer + amount ──
  const presetApplied = React.useRef<string | null>(null);
  const autoAllocArmed = React.useRef(false);
  React.useEffect(() => {
    if (!open || !presetCustomerId) {
      if (!open) presetApplied.current = null;
      return;
    }
    if (presetApplied.current === presetCustomerId) return;
    presetApplied.current = presetCustomerId;
    setCustomerId(presetCustomerId);
    autoAllocArmed.current = true;
  }, [open, presetCustomerId]);

  // Prefill amount with the customer's current outstanding once applied
  React.useEffect(() => {
    if (!open || !presetCustomerId || customerId !== presetCustomerId) return;
    if (amount !== "") return;
    const bal = Number((customers ?? []).find((c) => c.id === customerId)?.closingBalance ?? 0);
    if (bal > 0.005) setAmount(bal.toFixed(2));
  }, [open, presetCustomerId, customerId, amount, customers]);

  // Auto-allocate the preset receipt oldest-first once open invoices arrive
  React.useEffect(() => {
    if (!autoAllocArmed.current) return;
    if (!openInvoices || openInvoices.length === 0) return;
    const total = Number((customers ?? []).find((c) => c.id === presetCustomerId)?.closingBalance ?? 0);
    if (total <= 0.005) {
      autoAllocArmed.current = false;
      return;
    }
    autoAllocArmed.current = false;
    const next: Record<string, string> = {};
    let remaining = Math.round(total * 100) / 100;
    for (const inv of openInvoices) {
      if (remaining <= 0.009) break;
      const take = Math.min(remaining, inv.outstanding);
      next[inv.invoiceId] = (Math.round(take * 100) / 100).toFixed(2);
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setAllocs(next);
  }, [openInvoices, presetCustomerId, customers]);

  // ── Settle-from-invoice preset (cycle 17): preselect the invoice's
  // customer, then when the invoice list arrives pin the FULL
  // outstanding of that one invoice and match the receipt amount. ──
  const invPresetApplied = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open || !presetInvoice) {
      if (!open) invPresetApplied.current = null;
      return;
    }
    if (invPresetApplied.current === presetInvoice.invoiceId) return;
    invPresetApplied.current = presetInvoice.invoiceId;
    setCustomerId(presetInvoice.customerId);
  }, [open, presetInvoice]);

  React.useEffect(() => {
    if (!open || !presetInvoice || !openInvoices) return;
    const inv = openInvoices.find((r) => r.invoiceId === presetInvoice.invoiceId);
    if (!inv || inv.outstanding <= 0.009) return;
    const v = inv.outstanding.toFixed(2);
    setAllocs({ [presetInvoice.invoiceId]: v });
    setAmount(v);
  }, [open, presetInvoice, openInvoices]);

  // Reset allocations when the customer changes
  React.useEffect(() => {
    setAllocs({});
  }, [customerId]);

  function autoAllocateOldestFirst() {
    if (!openInvoices || amt <= 0) return;
    const next: Record<string, string> = {};
    let remaining = Math.round(amt * 100) / 100;
    for (const inv of openInvoices) {
      if (remaining <= 0.009) break;
      const take = Math.min(remaining, inv.outstanding);
      next[inv.invoiceId] = (Math.round(take * 100) / 100).toFixed(2);
      remaining = Math.round((remaining - take) * 100) / 100;
    }
    setAllocs(next);
  }

  function setAlloc(invId: string, value: string) {
    setAllocs((prev) => ({ ...prev, [invId]: value }));
  }

  const openInvCount = openInvoices?.length ?? 0;

  async function submit() {
    if (!activeFirmId) return;
    if (!customerId) {
      toast({ variant: "destructive", title: "Customer required", description: "Pick the B2B customer this receipt belongs to." });
      return;
    }
    if (amt <= 0) {
      toast({ variant: "destructive", title: "Invalid amount", description: "Amount must be greater than zero." });
      return;
    }
    if (overAllocated) {
      toast({ variant: "destructive", title: "Allocation exceeds receipt", description: `Allocated ${formatINR(allocationTotal)} but the receipt is ${formatINR(amt)}.` });
      return;
    }
    setSaving(true);
    try {
      const allocations = Object.entries(allocs)
        .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) || 0 }))
        .filter((a) => a.amount > 0);
      const res = await apiPost<{ applied: Array<{ invoiceNumber: string }>; allocatedTotal: number }>(
        "/api/v1/customer-receipts",
        {
          firmId: activeFirmId,
          customerId,
          receiptDate,
          amount: amt,
          mode,
          utrRef: utrRef.trim(),
          notes: notes.trim(),
          allocations,
        }
      );
      const settledCount = res.applied?.length ?? 0;
      toast({
        title: "Receipt recorded",
        description:
          settledCount > 0
            ? `${formatINR(amt)} via ${mode} — settled ${settledCount} invoice${settledCount !== 1 ? "s" : ""} (${formatINR(res.allocatedTotal ?? 0)})`
            : `${formatINR(amt)} via ${mode}${selected ? ` — ${selected.partyName}` : ""} (on account)`,
      });
      onCreated();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record receipt.";
      toast({ variant: "destructive", title: "Receipt failed", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Record customer receipt</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Payment received against outstanding receivable — optionally settle specific invoices for precise aging.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer (B2B) *">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(customers ?? []).map((c) => {
                    const bal = Number(c.closingBalance);
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {c.partyName} — {bal > 0.005 ? `Dr ${formatINR(bal)}` : "Clear"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Amount ₹ *">
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(inputCls, "font-money")} placeholder="0.00" />
            </Field>
            <Field label="Mode *">
              <Select value={mode} onValueChange={(v) => setMode(v as (typeof MODES)[number])}>
                <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="UTR / cheque ref">
              <Input value={utrRef} onChange={(e) => setUtrRef(e.target.value)} className={cn(inputCls, "font-money")} placeholder="e.g. UTIB2026…" />
            </Field>
            <Field label="Receipt date">
              <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="optional" />
            </Field>
          </div>

          {selected && (
            <div className="dmk-well px-3 py-2.5 flex items-center justify-between text-[12.5px]">
              <span className="text-dmk-text-muted">Current outstanding</span>
              <span className={cn("font-money font-semibold", outstanding > 0.005 ? "text-dmk-yellow" : "text-dmk-success")}>
                {outstanding > 0.005 ? `Dr ${formatINR(outstanding)}` : "Clear"}
              </span>
            </div>
          )}

          {/* ── Invoice settlement section ── */}
          {customerId && (
            <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-dmk-border-subtle">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-3.5 w-3.5 text-dmk-info" />
                  <span className="text-[12px] font-semibold text-dmk-text-primary">Settle against open invoices</span>
                  {invLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-dmk-text-muted" />
                  ) : (
                    <span className="text-[10.5px] text-dmk-text-muted">
                      {openInvCount > 0 ? `${openInvCount} open` : "none open"}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={autoAllocateOldestFirst}
                  disabled={amt <= 0 || openInvCount === 0}
                  className="h-7 gap-1.5 px-2 text-[11px] border-dmk-border-medium text-dmk-info hover:bg-dmk-hover"
                >
                  <Sparkles className="h-3 w-3" /> Auto-allocate (oldest first)
                </Button>
              </div>

              {invLoading ? (
                <div className="px-3 py-4 text-[12px] text-dmk-text-muted">Loading open invoices…</div>
              ) : openInvCount === 0 ? (
                <div className="px-3 py-3 text-[11.5px] text-dmk-text-muted italic">
                  No open credit invoices — the full amount will be recorded <span className="not-italic font-medium text-dmk-text-secondary">on account</span>.
                </div>
              ) : (
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-dmk-bg-tertiary z-10">
                      <tr className="text-[10.5px] uppercase tracking-wide text-dmk-text-muted">
                        <th className="text-left font-semibold px-3 py-1.5">Invoice</th>
                        <th className="text-left font-semibold px-2 py-1.5">Age</th>
                        <th className="text-right font-semibold px-2 py-1.5">Outstanding</th>
                        <th className="text-right font-semibold px-3 py-1.5 w-28">Allocate ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openInvoices!.map((inv) => {
                        const v = Number(allocs[inv.invoiceId] || 0);
                        return (
                          <tr key={inv.invoiceId} className={cn("border-t border-dmk-border-subtle/60", v > 0 && "bg-dmk-info/5")}>
                            <td className="px-3 py-1.5">
                              <span className="font-money text-[11.5px] text-dmk-text-primary">{inv.invoiceNumber}</span>
                              <span className="ml-2 text-[10.5px] text-dmk-text-muted">{formatDate(inv.invoiceDate)}</span>
                            </td>
                            <td className="px-2 py-1.5">
                              <Badge tone={bucketTone(inv.bucket)}>{inv.bucket}</Badge>
                              {inv.isOverdue && <span className="ml-1 text-[10px] font-semibold text-dmk-danger">{inv.overdueDays}d late</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right font-money text-dmk-text-secondary">{formatINR(inv.outstanding)}</td>
                            <td className="px-3 py-1.5">
                              <Input
                                type="number"
                                min={0}
                                max={inv.outstanding}
                                step="0.01"
                                value={allocs[inv.invoiceId] ?? ""}
                                onChange={(e) => setAlloc(inv.invoiceId, e.target.value)}
                                className="h-7 bg-dmk-input-well border-dmk-border-subtle text-right font-money text-[11.5px] text-dmk-text-primary dmk-input"
                                placeholder="0.00"
                                aria-label={`Allocate to ${inv.invoiceNumber}`}
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
                Allocated {formatINR(allocationTotal)} exceeds the receipt amount {formatINR(amt)} — reduce an allocation or raise the receipt amount.
              </p>
            </div>
          )}

          {!overAllocated && overpay && (
            <div className="flex items-start gap-2 rounded-md border border-dmk-warning/30 bg-[rgba(245,158,11,0.08)] px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-dmk-warning shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-dmk-warning leading-snug">
                Amount {formatINR(amt)} exceeds the outstanding {formatINR(outstanding)} — the excess will show as an advance (customer balance goes negative / Cr).
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving || !customerId || overAllocated} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
