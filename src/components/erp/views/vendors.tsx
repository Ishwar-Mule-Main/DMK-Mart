"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — VENDORS
// MANUFACTURER (brand-scoped PO products, R10) vs DISTRIBUTOR.
// Payable is Cr-positive (R7). Ledger = last 100 LedgerEntry rows.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { BookOpen, Building2, Loader2, Pencil, Plus, Search, Truck } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import type { LedgerRow, Vendor } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  StatusBadge,
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
import { TrashButton } from "@/components/erp/trash-button";
import { cn } from "@/lib/utils";

const STATES: Array<{ code: string; name: string }> = [
  { code: "27", name: "Maharashtra (27)" },
  { code: "29", name: "Karnataka (29)" },
  { code: "36", name: "Telangana (36)" },
  { code: "33", name: "Tamil Nadu (33)" },
  { code: "24", name: "Gujarat (24)" },
  { code: "07", name: "Delhi (07)" },
  { code: "09", name: "Uttar Pradesh (09)" },
  { code: "23", name: "Madhya Pradesh (23)" },
];

const TERMS: Array<{ value: string; label: string }> = [
  { value: "NET_15", label: "Net 15 days" },
  { value: "NET_30", label: "Net 30 days" },
  { value: "NET_45", label: "Net 45 days" },
  { value: "ADVANCE", label: "Advance payment" },
  { value: "COD", label: "Cash on delivery" },
];

function termsLabel(t: string): string {
  return TERMS.find((x) => x.value === t)?.label ?? (t || "—");
}

function stateName(code: string): string {
  return STATES.find((s) => s.code === code)?.name ?? (code || "—");
}

function VendorTypeBadge({ vendor }: { vendor: Vendor }) {
  if (vendor.vendorType === "MANUFACTURER") {
    return (
      <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold" title="Manufacturer — own brand">
        Mfr{vendor.brand ? ` · ${vendor.brand}` : ""}
      </span>
    );
  }
  return <Badge tone="info">Distributor</Badge>;
}

export default function VendorsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("ALL");
  const [rows, setRows] = React.useState<Vendor[] | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Vendor | null>(null);
  const [ledgerOf, setLedgerOf] = React.useState<Vendor | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<Vendor[]>("/api/v1/vendors", {
          firmId: activeFirmId,
          type: type === "ALL" ? undefined : type,
          search: query.trim(),
        });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load vendors", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, query, type, refresh, toast]);

  const totalPayable = (rows ?? []).reduce((s, v) => s + Number(v.closingBalance), 0);
  const mfrCount = (rows ?? []).filter((v) => v.vendorType === "MANUFACTURER").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendors"
        subtitle="Manufacturers with brand-scoped purchasing · Distributors · Payables (Cr)"
        icon={Truck}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Vendor
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search vendor, brand, phone or GSTIN…"
            className="pl-9"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[210px]")}>
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="MANUFACTURER">Manufacturers</SelectItem>
            <SelectItem value="DISTRIBUTOR">Distributors</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={7} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No vendors yet"
              hint="Add manufacturers (with their brand) or distributors to start purchasing."
            />
          ) : (
            <table className="dmk-table min-w-[1080px]">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Type</th>
                  <th>GSTIN</th>
                  <th>State</th>
                  <th>Phone</th>
                  <th>Payment terms</th>
                  <th className="text-right">Payable (Cr)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const payable = Number(v.closingBalance);
                  return (
                    <tr key={v.id}>
                      <td className="max-w-[220px] truncate text-[13px] font-medium">
                        {v.vendorName}
                        {!v.isActive && <span className="ml-2 text-[10.5px] text-dmk-text-muted">(inactive)</span>}
                      </td>
                      <td><VendorTypeBadge vendor={v} /></td>
                      <td className="font-money text-[11.5px] text-dmk-text-secondary">{v.gstin || "—"}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{stateName(v.stateCode)}</td>
                      <td className="font-money text-[12px] text-dmk-text-secondary">{v.phone || "—"}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{termsLabel(v.paymentTerms)}</td>
                      <td className="num text-[12.5px] font-semibold">
                        {payable > 0.005 ? (
                          <span className="text-dmk-info">Cr {formatINR(payable)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">—</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                          onClick={() => setLedgerOf(v)}
                        >
                          <BookOpen className="h-3.5 w-3.5" /> Ledger
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 ml-1.5 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                          onClick={() => {
                            setEditing(v);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <TrashButton
                          className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                          recordLabel={v.vendorName}
                          recordHint={`${v.vendorType === "MANUFACTURER" ? "Manufacturer" : "Distributor"} will be hidden from purchase orders and payments. The snapshot goes to the Deleted Data folder — restore it anytime. PO and payment history stay intact.`}
                          onConfirm={async () => {
                            try {
                              await apiDelete(`/api/v1/vendors/${v.id}`);
                              toast({ title: "Moved to Deleted Data", description: `“${v.vendorName}” can be restored from Intelligence → Deleted Data.` });
                              setRefresh((r) => r + 1);
                            } catch (e) {
                              toast({ variant: "destructive", title: "Could not delete", description: e instanceof Error ? e.message : "Unknown error" });
                            }
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {rows !== null && rows.length > 0 && (
          <div className="dmk-well px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-dmk-text-muted">
            <span>
              <span className="font-money text-dmk-text-secondary">{rows.length}</span> vendors
            </span>
            <span>
              <span className="font-money text-dmk-gold">{mfrCount}</span> manufacturers
            </span>
            <span>
              <span className="font-money text-dmk-info">Cr {formatINR(totalPayable)}</span> total payable
            </span>
          </div>
        )}
      </div>

      <VendorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => setRefresh((r) => r + 1)}
      />

      <VendorLedgerDialog vendor={ledgerOf} onClose={() => setLedgerOf(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Add / Edit dialog
// ═══════════════════════════════════════════════════════════════
function VendorFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Vendor | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    vendorName: "",
    vendorType: "DISTRIBUTOR",
    brand: "",
    gstin: "",
    stateCode: "27",
    phone: "",
    email: "",
    address: "",
    paymentTerms: "NET_30",
    openingBalance: "0",
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        vendorName: editing.vendorName ?? "",
        vendorType: editing.vendorType ?? "DISTRIBUTOR",
        brand: editing.brand ?? "",
        gstin: editing.gstin ?? "",
        stateCode: editing.stateCode || "27",
        phone: editing.phone ?? "",
        email: editing.email ?? "",
        address: editing.address ?? "",
        paymentTerms: editing.paymentTerms || "NET_30",
        openingBalance: "0",
      });
    } else {
      setForm({
        vendorName: "",
        vendorType: "DISTRIBUTOR",
        brand: "",
        gstin: "",
        stateCode: "27",
        phone: "",
        email: "",
        address: "",
        paymentTerms: "NET_30",
        openingBalance: "0",
      });
    }
  }, [open, editing]);

  // GSTIN prefix → state code display (first 2 digits)
  const gstinPrefix = form.gstin.trim().slice(0, 2);
  const gstinState = /^\d{2}$/.test(gstinPrefix)
    ? STATES.find((s) => s.code === gstinPrefix)
    : undefined;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isManufacturer = form.vendorType === "MANUFACTURER";

  async function submit() {
    if (!activeFirmId) return;
    if (!form.vendorName.trim()) {
      toast({ variant: "destructive", title: "Missing field", description: "Vendor name is required." });
      return;
    }
    if (isManufacturer && !form.brand.trim()) {
      toast({
        variant: "destructive",
        title: "Brand required",
        description: "Manufacturer vendors must carry their brand (R10 — POs are scoped to it).",
      });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiPatch<Vendor>(`/api/v1/vendors/${editing.id}`, {
          vendorName: form.vendorName.trim(),
          vendorType: form.vendorType,
          brand: form.brand.trim(),
          gstin: form.gstin.trim(),
          stateCode: form.stateCode,
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          paymentTerms: form.paymentTerms,
        });
        toast({ title: "Vendor updated", description: form.vendorName.trim() });
      } else {
        await apiPost<Vendor>("/api/v1/vendors", {
          firmId: activeFirmId,
          vendorName: form.vendorName.trim(),
          vendorType: form.vendorType,
          brand: form.brand.trim(),
          gstin: form.gstin.trim(),
          stateCode: form.stateCode,
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          paymentTerms: form.paymentTerms,
          openingBalance: Number(form.openingBalance) || 0,
        });
        toast({ title: "Vendor created", description: form.vendorName.trim() });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof ApiError ? e.message : "Could not save vendor.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{editing ? "Edit vendor" : "Add vendor"}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {isManufacturer
              ? "Manufacturer — purchases from this vendor are scoped to its brand (R10)."
              : "Distributor — all firm products are available for purchase orders."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Vendor name *">
              <Input value={form.vendorName} onChange={set("vendorName")} className={inputCls} placeholder="e.g. Sunflo Plastics Pvt Ltd" />
            </Field>
          </div>

          <Field label="Vendor type">
            <Select
              value={form.vendorType}
              onValueChange={(v) => setForm((f) => ({ ...f, vendorType: v }))}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUFACTURER">Manufacturer</SelectItem>
                <SelectItem value="DISTRIBUTOR">Distributor</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Brand"
            hint={isManufacturer ? "Only this brand's products appear in PO selection" : "Optional for distributors"}
          >
            <Input
              value={form.brand}
              onChange={set("brand")}
              className={cn(inputCls, isManufacturer && "border-dmk-gold/40")}
              placeholder={isManufacturer ? "e.g. Sunflo" : "—"}
              disabled={!isManufacturer}
            />
          </Field>

          <Field
            label="GSTIN"
            hint={gstinState ? `State derived from GSTIN: ${gstinState.name}` : "15 characters · first 2 digits = state code"}
          >
            <Input
              value={form.gstin}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().slice(0, 15);
                setForm((f) => {
                  const next = { ...f, gstin: v };
                  if (/^\d{2}$/.test(v.slice(0, 2))) next.stateCode = v.slice(0, 2);
                  return next;
                });
              }}
              className={cn(inputCls, "font-money")}
              placeholder="27ABCDE1234F1Z5"
              maxLength={15}
            />
          </Field>

          <Field label="State code" hint="Place of supply — drives CGST/SGST vs IGST on POs">
            <Select value={form.stateCode} onValueChange={(v) => setForm((f) => ({ ...f, stateCode: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} className={cn(inputCls, "font-money")} placeholder="98765 43210" />
          </Field>

          <Field label="Email">
            <Input value={form.email} onChange={set("email")} className={inputCls} placeholder="sales@vendor.in" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={set("address")} className={inputCls} placeholder="Street, city, PIN" />
            </Field>
          </div>

          <Field label="Payment terms">
            <Select value={form.paymentTerms} onValueChange={(v) => setForm((f) => ({ ...f, paymentTerms: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {TERMS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Opening balance (Cr)" hint={editing ? "Opening balance is fixed after creation" : "Amount you owe this vendor as on today"}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.openingBalance}
              onChange={set("openingBalance")}
              className={cn(inputCls, "font-money text-right")}
              disabled={!!editing}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create vendor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// Ledger dialog — vendor account statement
// ═══════════════════════════════════════════════════════════════
function VendorLedgerDialog({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const [ledger, setLedger] = React.useState<LedgerRow[] | null>(null);

  React.useEffect(() => {
    if (!vendor) return;
    let alive = true;
    setLedger(null);
    apiGet<{ vendor: Vendor; ledger: LedgerRow[] }>(`/api/v1/vendors/${vendor.id}`)
      .then((res) => alive && setLedger(res.ledger))
      .catch(() => alive && setLedger([]));
    return () => {
      alive = false;
    };
  }, [vendor]);

  const closing = Number(vendor?.closingBalance ?? 0);

  return (
    <Dialog open={!!vendor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Vendor ledger — {vendor?.vendorName}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {vendor?.vendorType === "MANUFACTURER" ? "Manufacturer" : "Distributor"}
            {vendor?.brand ? ` · ${vendor.brand}` : ""} · GSTIN <span className="font-money">{vendor?.gstin || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between dmk-well px-3 py-2.5 text-[12.5px]">
          <span className="text-dmk-text-muted">
            Opening <span className="font-money text-dmk-text-secondary">{formatINR(Number(vendor?.openingBalance ?? 0))}</span>
          </span>
          <span className="text-dmk-text-muted">
            Closing{" "}
            <span className={cn("font-money font-semibold", closing > 0.005 ? "text-dmk-info" : "text-dmk-success")}>
              {closing > 0.005 ? `Cr ${formatINR(closing)}` : "Clear"}
            </span>
          </span>
        </div>

        <div className="dmk-card overflow-hidden max-h-80 overflow-y-auto">
          {ledger === null ? (
            <LoadingRows rows={5} />
          ) : ledger.length === 0 ? (
            <EmptyState icon={BookOpen} title="No ledger rows yet" hint="GRN receipts, debit notes and payments will appear here." />
          ) : (
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Voucher #</th>
                  <th>Particulars</th>
                  <th className="text-right">Dr</th>
                  <th className="text-right">Cr</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td className="text-[11.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.entryDate)}</td>
                    <td><StatusBadge status={r.voucherType} /></td>
                    <td className="font-money text-[11px] text-dmk-text-secondary">{r.voucherNo || "—"}</td>
                    <td className="max-w-[220px] truncate text-[11.5px] text-dmk-text-secondary">{r.particulars || "—"}</td>
                    <td className="num text-[12px] text-dmk-yellow">{Number(r.debitAmount) > 0 ? formatINR(Number(r.debitAmount)) : "—"}</td>
                    <td className="num text-[12px] text-dmk-info">{Number(r.creditAmount) > 0 ? formatINR(Number(r.creditAmount)) : "—"}</td>
                    <td className="num text-[12px]">{formatINR(Number(r.balanceAfter))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
