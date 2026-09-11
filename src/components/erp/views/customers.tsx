"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — CUSTOMERS & BUYERS
// B2B location-first parties (R8) with tier + credit control (R13)
// and B2C counter directory (R9 — name + phone, no credit, R14).
// Ledger = last 100 LedgerEntry rows from /customers/[id].
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { BookOpen, Building2, History, Loader2, Pencil, Plus, Search, Store, Users } from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { TIERS } from "@/lib/pricing";
import { useT } from "@/lib/i18n";
import type { Customer, Invoice, LedgerRow } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput, Field, inputCls, StatusBadge } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  { code: "37", name: "Andhra Pradesh (37)" },
  { code: "32", name: "Kerala (32)" },
  { code: "19", name: "West Bengal (19)" },
  { code: "21", name: "Odisha (21)" },
  { code: "10", name: "Bihar (10)" },
  { code: "06", name: "Haryana (06)" },
  { code: "08", name: "Rajasthan (08)" },
  { code: "03", name: "Punjab (03)" },
];

function tierLabel(key: string): string {
  return TIERS.find((t) => t.key === key)?.label ?? (key || "—");
}

function tierBadgeTone(key: string): "info" | "success" | "warning" | "neutral" {
  switch (key) {
    case "tier1Distributor": return "info";
    case "tier2Wholesale": return "success";
    case "tier3SemiWholesale": return "warning";
    default: return "neutral";
  }
}

export default function CustomersView() {
  return (
    <div className="space-y-4">
      <PageHeader title="Customers & Buyers" subtitle="B2B location-first parties with credit control · B2C counter directory" icon={Users} />
      <Tabs defaultValue="b2b" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="b2b" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Building2 className="h-4 w-4" /> B2B Customers
          </TabsTrigger>
          <TabsTrigger value="b2c" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Store className="h-4 w-4" /> B2C Counter Buyers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="b2b" className="mt-0"><B2BTab /></TabsContent>
        <TabsContent value="b2c" className="mt-0"><B2CTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B2B TAB
// ═══════════════════════════════════════════════════════════════
function B2BTab() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const firmStateCode = firm?.stateCode ?? "27";

  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<Customer[] | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [ledgerOf, setLedgerOf] = React.useState<Customer | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2B", search: query.trim() });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load customers", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, query, refresh]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search party name, city, phone or GSTIN…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Button
          size="sm"
          className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> New B2B Customer
        </Button>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Building2} title="No B2B customers" hint="Add your first trade party — naming is location-first, e.g. “Latur Ishwar Mule”." />
          ) : (
            <table className="dmk-table min-w-[1020px]">
              <thead>
                <tr>
                  <th>{t("cust.colPartyName")}</th>
                  <th>{t("cust.colCity")}</th>
                  <th>{t("cust.colState")}</th>
                  <th>GSTIN</th>
                  <th>{t("cust.colTier")}</th>
                  <th className="text-right">{t("cust.colCreditLimit")}</th>
                  <th className="text-right">{t("cust.colOutstanding")}</th>
                  <th className="text-right">{t("cust.colDays")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const outstanding = Number(c.closingBalance);
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[240px] truncate text-[13px] font-medium">{c.partyName}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{c.city || "—"}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{c.stateCode || "—"}</td>
                      <td className="font-money text-[11.5px] text-dmk-text-secondary">{c.gstin || "—"}</td>
                      <td><Badge tone={tierBadgeTone(c.assignedTier)}>{tierLabel(c.assignedTier)}</Badge></td>
                      <td className="num text-[12.5px]">{formatINR(Number(c.creditLimit))}</td>
                      <td className={cn("num text-[12.5px] font-semibold", outstanding > 0.005 ? "text-dmk-yellow" : "text-dmk-success")}>
                        {outstanding > 0.005 ? `Dr ${formatINR(outstanding)}` : "Clear"}
                      </td>
                      <td className="num text-[12.5px]">{c.creditDays}</td>
                      <td className="text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setLedgerOf(c)}>
                          <BookOpen className="h-3.5 w-3.5" /> Ledger
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 ml-1.5 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                          onClick={() => {
                            setEditing(c);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <TrashButton
                          className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                          recordLabel={c.partyName}
                          recordHint={`${c.customerType === "B2C_COUNTER" ? "Counter buyer" : "B2B party"}${c.city ? ` from ${c.city}` : ""} will be hidden from billing and lists. The snapshot goes to the Deleted Data folder — restore it anytime. Invoices and ledger history stay intact.`}
                          onConfirm={async () => {
                            try {
                              await apiDelete(`/api/v1/customers/${c.id}`);
                              toast({ title: "Moved to Deleted Data", description: `“${c.partyName}” can be restored from Intelligence → Deleted Data.` });
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
      </div>

      <B2BFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={editing}
        firmStateCode={firmStateCode}
        onSaved={() => setRefresh((r) => r + 1)}
        onRefresh={() => setRefresh((r) => r + 1)}
      />

      <LedgerDialog customer={ledgerOf} onClose={() => setLedgerOf(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// B2B create / edit dialog
// ═══════════════════════════════════════════════════════════════
function B2BFormDialog({
  open,
  onOpenChange,
  editing,
  firmStateCode,
  onSaved,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: Customer | null;
  firmStateCode: string;
  onSaved: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  // /sales portal — attribution for customers created by a sales member.
  const session = useErpStore((s) => s.session);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    city: "",
    firmName: "",
    gstin: "",
    phone: "",
    email: "",
    address: "",
    stateCode: firmStateCode,
    assignedTier: "tier3SemiWholesale",
    creditLimit: "0",
    creditDays: "30",
    openingBalance: "0",
  });

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        city: editing.city ?? "",
        firmName: editing.firmName ?? "",
        gstin: editing.gstin ?? "",
        phone: editing.phone ?? "",
        email: editing.email ?? "",
        address: editing.address ?? "",
        stateCode: editing.stateCode || firmStateCode,
        assignedTier: editing.assignedTier || "tier3SemiWholesale",
        creditLimit: String(editing.creditLimit ?? 0),
        creditDays: String(editing.creditDays ?? 30),
        openingBalance: "0",
      });
    } else {
      setForm({
        city: "",
        firmName: "",
        gstin: "",
        phone: "",
        email: "",
        address: "",
        stateCode: firmStateCode,
        assignedTier: "tier3SemiWholesale",
        creditLimit: "0",
        creditDays: "30",
        openingBalance: "0",
      });
    }
  }, [open, editing, firmStateCode]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!activeFirmId) return;
    if (!form.city.trim() || !form.firmName.trim()) {
      toast({ variant: "destructive", title: "Missing fields", description: "City and firm name are required — party name becomes “City FirmName”." });
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiPatch(`/api/v1/customers/${editing.id}`, {
          city: form.city.trim(),
          firmName: form.firmName.trim(),
          gstin: form.gstin.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          stateCode: form.stateCode,
          assignedTier: form.assignedTier,
          creditLimit: Number(form.creditLimit) || 0,
          creditDays: Number(form.creditDays) || 0,
        });
        toast({ title: "Customer updated", description: `${form.city.trim()} ${form.firmName.trim()}` });
      } else {
        await apiPost<Customer>("/api/v1/customers", {
          firmId: activeFirmId,
          customerType: "B2B",
          city: form.city.trim(),
          firmName: form.firmName.trim(),
          gstin: form.gstin.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          stateCode: form.stateCode,
          assignedTier: form.assignedTier,
          creditLimit: Number(form.creditLimit) || 0,
          creditDays: Number(form.creditDays) || 0,
          openingBalance: Number(form.openingBalance) || 0,
          // /sales portal attribution — stamp "Created By" with the signed-in member.
          ...(session?.role === "SALES" && session.salesId ? { salesMemberId: session.salesId } : {}),
        });
        toast({ title: "Customer created", description: `${form.city.trim()} ${form.firmName.trim()} added to the trade directory.` });
      }
      onRefresh();
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not save customer.";
      toast({ variant: "destructive", title: "Save failed", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{editing ? "Edit B2B customer" : "New B2B customer"}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">Location-first naming (R8) — party name is composed as “City FirmName”.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City *">
            <Input value={form.city} onChange={set("city")} placeholder="e.g. Latur" className={inputCls} />
          </Field>
          <Field label="Firm name *">
            <Input value={form.firmName} onChange={set("firmName")} placeholder="e.g. Ishwar Mule" className={inputCls} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.gstin} onChange={set("gstin")} placeholder="27…" className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="State code">
            <Select value={form.stateCode} onValueChange={(v) => setForm((f) => ({ ...f, stateCode: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assigned tier">
            <Select value={form.assignedTier} onValueChange={(v) => setForm((f) => ({ ...f, assignedTier: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIERS.slice(0, 4).map((t) => (
                  <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Credit limit ₹">
            <Input type="number" min={0} value={form.creditLimit} onChange={set("creditLimit")} className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="Credit days">
            <Input type="number" min={0} value={form.creditDays} onChange={set("creditDays")} className={cn(inputCls, "font-money")} />
          </Field>
          {!editing && (
            <>
              <Field label="Opening balance ₹ (Dr +)" hint="Positive = receivable (Dr). Posts an OPENING ledger row.">
                <Input type="number" step="0.01" value={form.openingBalance} onChange={set("openingBalance")} className={cn(inputCls, "font-money")} />
              </Field>
              <Field label="Email">
                <Input value={form.email} onChange={set("email")} className={inputCls} placeholder="optional" />
              </Field>
            </>
          )}
          {editing && (
            <Field label="Email">
              <Input value={form.email} onChange={set("email")} className={inputCls} placeholder="optional" />
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={set("address")} className={inputCls} placeholder="optional" />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editing ? "Save changes" : "Create customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// Ledger dialog — opening + last 100 rows + closing
// ═══════════════════════════════════════════════════════════════
function LedgerDialog({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const [ledger, setLedger] = React.useState<LedgerRow[] | null>(null);

  React.useEffect(() => {
    if (!customer) return;
    let alive = true;
    setLedger(null);
    apiGet<{ customer: Customer; ledger: LedgerRow[] }>(`/api/v1/customers/${customer.id}`)
      .then((res) => alive && setLedger(res.ledger))
      .catch(() => alive && setLedger([]));
    return () => {
      alive = false;
    };
  }, [customer]);

  const closing = Number(customer?.closingBalance ?? 0);

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">Party ledger — {customer?.partyName}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            GSTIN <span className="font-money">{customer?.gstin || "—"}</span> · Credit {formatINR(Number(customer?.creditLimit ?? 0))} / {customer?.creditDays ?? 0} days
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between dmk-well px-3 py-2.5 text-[12.5px]">
          <span className="text-dmk-text-muted">Opening <span className="font-money text-dmk-text-secondary">{formatINR(Number(customer?.openingBalance ?? 0))}</span></span>
          <span className="text-dmk-text-muted">
            Closing{" "}
            <span className={cn("font-money font-semibold", closing > 0.005 ? "text-dmk-yellow" : "text-dmk-success")}>
              {closing > 0.005 ? `Dr ${formatINR(closing)}` : "Clear"}
            </span>
          </span>
        </div>

        <div className="dmk-card overflow-hidden max-h-80 overflow-y-auto">
          {ledger === null ? (
            <LoadingRows rows={5} />
          ) : ledger.length === 0 ? (
            <EmptyState icon={BookOpen} title="No ledger rows yet" hint="Invoices, credit notes and receipts will appear here." />
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
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// B2C TAB — counter buyers directory
// ═══════════════════════════════════════════════════════════════
function B2CTab() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<Customer[] | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [historyOf, setHistoryOf] = React.useState<Customer | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2C_COUNTER", search: query.trim() });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load buyers", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, query, refresh]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search buyers by name or phone…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> New Buyer
        </Button>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Store} title="No counter buyers" hint="Buyers need just a name + phone — each gets a ₹1,00,000 credit limit automatically (credit works like B2B)." />
          ) : (
            <table className="dmk-table min-w-[860px]">
              <thead>
                <tr>
                  <th>{t("cmn.name")}</th>
                  <th>{t("cmn.phone")}</th>
                  <th className="text-right">{t("cust.colVisits")}</th>
                  <th className="text-right">{t("cust.colLifetime")}</th>
                  <th className="text-right">{t("cust.colCreditLimit")}</th>
                  <th className="text-right">{t("cust.colCreditAvail")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="text-[13px] font-medium">{c.partyName}</td>
                    <td className="font-money text-[12.5px] text-dmk-text-secondary">{c.phone || "—"}</td>
                    <td className="num text-[12.5px]">{c.visitCount}</td>
                    <td className="num text-[12.5px] text-dmk-gold">{formatINR(Number(c.lifetimeSpend))}</td>
                    <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(c.creditLimit))}</td>
                    <td className={cn("num text-[12.5px] font-semibold", Number(c.closingBalance) > 0.005 ? "text-dmk-gold" : "text-dmk-success")}>
                      {formatINR(Math.max(0, Number(c.creditLimit) - Number(c.closingBalance)))}
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setHistoryOf(c)}>
                        <History className="h-3.5 w-3.5" /> History
                      </Button>
                      <TrashButton
                        className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                        recordLabel={c.partyName}
                        recordHint="The counter buyer will be hidden from B2C billing. The snapshot goes to the Deleted Data folder — restore it anytime. Past visits and spend stay in history."
                        onConfirm={async () => {
                          try {
                            await apiDelete(`/api/v1/customers/${c.id}`);
                            toast({ title: "Moved to Deleted Data", description: `“${c.partyName}” can be restored from Intelligence → Deleted Data.` });
                            setRefresh((r) => r + 1);
                          } catch (e) {
                            toast({ variant: "destructive", title: "Could not delete", description: e instanceof Error ? e.message : "Unknown error" });
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <NewBuyerDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => setRefresh((r) => r + 1)} />
      <BuyerHistoryDialog buyer={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

function NewBuyerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!activeFirmId) return;
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    setSaving(true);
    try {
      // creditLimit/creditDays omitted — server injects the ₹1,00,000 auto limit.
      await apiPost<Customer>("/api/v1/customers", {
        firmId: activeFirmId,
        customerType: "B2C_COUNTER",
        firmName: name.trim(),
        phone: phone.trim(),
        city: "",
        stateCode: firm?.stateCode ?? "",
        assignedTier: "tier4Retailer",
      });
      toast({ title: "Buyer added", description: `${name.trim()} · ${t("b2c.autoCreditNote")}` });
      setName("");
      setPhone("");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Create failed", description: e instanceof ApiError ? e.message : "Unknown error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{t("cust.newBuyerTitle")}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">{t("b2c.newBuyerDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} className={cn(inputCls, "font-money")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add buyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BuyerHistoryDialog({ buyer, onClose }: { buyer: Customer | null; onClose: () => void }) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);

  React.useEffect(() => {
    if (!buyer || !activeFirmId) return;
    let alive = true;
    setInvoices(null);
    apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, customerId: buyer.id })
      .then((res) => alive && setInvoices(res))
      .catch(() => alive && setInvoices([]));
    return () => {
      alive = false;
    };
  }, [buyer, activeFirmId]);

  return (
    <Dialog open={!!buyer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{buyer?.partyName}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted font-money">
            {buyer?.phone || "—"} · {buyer?.visitCount ?? 0} visits · lifetime {formatINR(Number(buyer?.lifetimeSpend ?? 0))}
            <br />
            <span className="text-dmk-gold">Credit {formatINR(Number(buyer?.creditLimit ?? 0))}</span>
            {" · available "}
            {formatINR(Math.max(0, Number(buyer?.creditLimit ?? 0) - Number(buyer?.closingBalance ?? 0)))}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {invoices === null ? (
            <LoadingRows rows={3} />
          ) : invoices.length === 0 ? (
            <EmptyState icon={History} title="No purchases yet" />
          ) : (
            <div className="dmk-well overflow-hidden">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="font-money text-[12px]">{i.invoiceNumber}</td>
                      <td className="text-[12px] text-dmk-text-secondary">{formatDate(i.invoiceDate)}</td>
                      <td><Badge tone="success">{i.paymentMode}</Badge></td>
                      <td className="num text-[12.5px]">{formatINR(Number(i.grandTotal))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
