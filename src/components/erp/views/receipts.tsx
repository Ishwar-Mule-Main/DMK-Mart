"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — CUSTOMER RECEIPTS (R7)
// Money in against receivables: Dr Bank/Cash, Cr Customer A/R.
// Client warns when amount > current outstanding; server posts.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, Download, HandCoins, Loader2, Plus, Search } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate, downloadCSV } from "@/lib/format";
import type { Customer, CustomerReceipt } from "@/types/erp";
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

export default function ReceiptsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [receipts, setReceipts] = React.useState<CustomerReceipt[] | null>(null);
  const [customers, setCustomers] = React.useState<Customer[] | null>(null);
  const [custFilter, setCustFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);

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
        (r.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [receipts, query, customerMap]);

  function exportCsv() {
    downloadCSV("customer-receipts.csv", [
      ["Date", "Customer", "Mode", "UTR / Ref", "Notes", "Amount"],
      ...visible.map((r) => [
        r.receiptDate.slice(0, 10),
        r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? r.customerId,
        r.mode,
        r.utrRef,
        r.notes,
        Number(r.amount).toFixed(2),
      ]),
    ]);
  }

  if (!activeFirmId) {
    return <EmptyState icon={HandCoins} title="No active firm" hint="Select a firm from the header switcher." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Receipts"
        subtitle="Collections against receivables — Dr Bank/Cash, Cr Customer A/R (R7)"
        icon={HandCoins}
        actions={
          <Button size="sm" className="h-9 bg-dmk-orange text-white hover:bg-dmk-orange/90" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> Record Receipt
          </Button>
        }
      />

      <div className="dmk-card p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search customer, UTR or notes…" className="pl-9" />
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
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={visible.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {receipts === null ? (
            <LoadingRows rows={6} />
          ) : visible.length === 0 ? (
            <EmptyState icon={HandCoins} title="No receipts" hint="Record a receipt to reduce a customer's outstanding balance." />
          ) : (
            <table className="dmk-table min-w-[780px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Receipt / Voucher info</th>
                  <th>Mode</th>
                  <th>UTR / Ref</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.receiptDate)}</td>
                    <td className="max-w-[240px] truncate text-[13px] font-medium">{r.customer?.partyName ?? customerMap.get(r.customerId)?.partyName ?? r.customerId}</td>
                    <td className="max-w-[260px] truncate text-[12px] text-dmk-text-muted">{r.notes || "—"}</td>
                    <td><Badge tone={modeTone(r.mode)}>{r.mode}</Badge></td>
                    <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.utrRef || "—"}</td>
                    <td className="num text-[13px] font-semibold text-dmk-success">{formatINR(Number(r.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <NewReceiptDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        customers={customers}
        onCreated={() => setRefresh((r) => r + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Record receipt dialog
// ═══════════════════════════════════════════════════════════════
function NewReceiptDialog({
  open,
  onOpenChange,
  customers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: Customer[] | null;
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

  const selected = (customers ?? []).find((c) => c.id === customerId);
  const outstanding = Number(selected?.closingBalance ?? 0);
  const amt = Number(amount) || 0;
  const overpay = !!selected && amt > outstanding && outstanding >= 0 && amt > 0;

  React.useEffect(() => {
    if (!open) {
      setCustomerId("");
      setAmount("");
      setMode("NEFT");
      setUtrRef("");
      setNotes("");
      setReceiptDate(toISODate(new Date()));
    }
  }, [open]);

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
    setSaving(true);
    try {
      await apiPost("/api/v1/customer-receipts", {
        firmId: activeFirmId,
        customerId,
        receiptDate,
        amount: amt,
        mode,
        utrRef: utrRef.trim(),
        notes: notes.trim(),
      });
      toast({ title: "Receipt recorded", description: `${formatINR(amt)} via ${mode}${selected ? ` — ${selected.partyName}` : ""}` });
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
      <DialogContent className="sm:max-w-lg dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Record customer receipt</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">Payment received against outstanding receivable (Dr-positive).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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

          {selected && (
            <div className="dmk-well px-3 py-2.5 flex items-center justify-between text-[12.5px]">
              <span className="text-dmk-text-muted">Current outstanding</span>
              <span className={cn("font-money font-semibold", outstanding > 0.005 ? "text-dmk-orange" : "text-dmk-success")}>
                {outstanding > 0.005 ? `Dr ${formatINR(outstanding)}` : "Clear"}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {overpay && (
            <div className="flex items-start gap-2 rounded-md border border-dmk-warning/30 bg-[rgba(245,158,11,0.08)] px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-dmk-warning shrink-0 mt-0.5" />
              <p className="text-[11.5px] text-dmk-warning leading-snug">
                Amount {formatINR(amt)} exceeds the outstanding {formatINR(outstanding)} — the excess will show as an advance (customer balance goes negative / Cr).
              </p>
            </div>
          )}

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary dmk-input resize-none" placeholder="optional" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving || !customerId} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Record receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
