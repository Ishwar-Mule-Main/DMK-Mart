"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — VENDOR PAYMENTS
// Paydown of vendor payable (Cr-positive ↓) via NEFT/UPI/CHEQUE/CASH
// with UTR reference. Journal: Dr AP, Cr Bank/Cash (R6/R7).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Banknote, Download, Landmark, Loader2, Plus, ReceiptText, Search, Wallet } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate, downloadCSV } from "@/lib/format";
import type { Vendor } from "@/types/erp";
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
import { cn } from "@/lib/utils";

interface PayRow {
  id: string;
  vendorId: string;
  vendor?: { id: string; vendorName: string } | null;
  paymentDate: string;
  amount: number;
  mode: string;
  utrRef: string;
  notes: string;
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

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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
      r.mode.toLowerCase().includes(q)
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

  function exportCsv() {
    downloadCSV("vendor-payments.csv", [
      ["Date", "Vendor", "Mode", "UTR Ref", "Amount", "Notes"],
      ...visible.map((r) => [
        toISODate(r.paymentDate),
        r.vendor?.vendorName ?? "",
        r.mode,
        r.utrRef ?? "",
        Number(r.amount).toFixed(2),
        r.notes ?? "",
      ]),
    ]);
    toast({ title: "Exported", description: `${visible.length} payments written to CSV.` });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendor Payments"
        subtitle="Pay down vendor payables (Cr) · NEFT / UPI / Cheque / Cash with UTR reference"
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard label="Paid this month" value={formatINR(monthTotal)} tone="orange" icon={Wallet} sub={`${monthRows.length} payments in ${now.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`} />
        <KpiCard label="Payments this month" value={String(monthRows.length)} tone="blue" icon={ReceiptText} sub="Receipts against vendor payables" />
        <KpiCard label="All-time paid" value={formatINR(allTotal)} tone="info" icon={Landmark} sub={`${(rows ?? []).length} payments recorded`} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search vendor, UTR, notes or mode…" className="pl-9" />
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
            <table className="dmk-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Mode</th>
                  <th>UTR / Ref</th>
                  <th className="text-right">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.paymentDate)}</td>
                    <td className="text-[13px] font-medium max-w-[200px] truncate">{r.vendor?.vendorName ?? "—"}</td>
                    <td><Badge tone={modeTone(r.mode)}>{r.mode}</Badge></td>
                    <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.utrRef || "—"}</td>
                    <td className="num text-[13px] font-semibold text-dmk-info">{formatINR(Number(r.amount))}</td>
                    <td className="text-[11.5px] text-dmk-text-muted max-w-[220px] truncate">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <RecordPaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        vendors={vendors}
        onSaved={() => setRefresh((r) => r + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Record payment dialog
// ═══════════════════════════════════════════════════════════════
function RecordPaymentDialog({
  open,
  onOpenChange,
  vendors,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
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

  React.useEffect(() => {
    if (!open) return;
    setVendorId("");
    setAmount("");
    setMode("NEFT");
    setUtrRef("");
    setPaymentDate(toISODate(new Date()));
    setNotes("");
  }, [open]);

  const vendor = vendors.find((v) => v.id === vendorId);
  const payable = Number(vendor?.closingBalance ?? 0);
  const amt = num(amount);
  const overpay = !!vendor && amt > payable + 0.005;

  const canSave = !!vendorId && amt > 0 && !!mode;

  async function submit() {
    if (!activeFirmId || !canSave) return;
    setSaving(true);
    try {
      await apiPost<PayRow>("/api/v1/vendor-payments", {
        firmId: activeFirmId,
        vendorId,
        paymentDate,
        amount: amt,
        mode,
        utrRef: utrRef.trim(),
        notes: notes.trim(),
      });
      toast({
        title: "Payment recorded",
        description: `${vendor?.vendorName ?? "Vendor"} · ${formatINR(amt)} via ${mode} · Payable reduced · Journal posted`,
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
      <DialogContent className="sm:max-w-lg dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Record vendor payment</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Reduces the vendor&apos;s Cr (payable) balance and posts a balanced PAYMENT journal.
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

          {vendor && (
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

        {overpay && (
          <p className="text-[12px] text-dmk-warning bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-md px-3 py-2">
            Amount exceeds the current payable by {formatINR(amt - payable)} — the excess will sit as a Dr (advance)
            balance for this vendor.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave || saving} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
