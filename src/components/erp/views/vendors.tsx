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
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

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

const TERMS: Array<{ value: string }> = [
  { value: "NET_15" },
  { value: "NET_30" },
  { value: "NET_45" },
  { value: "ADVANCE" },
  { value: "COD" },
];

function termsLabel(t: TFn, code: string): string {
  if (code === "NET_15") return t("ven.tNet15");
  if (code === "NET_30") return t("ven.tNet30");
  if (code === "NET_45") return t("ven.tNet45");
  if (code === "ADVANCE") return t("ven.tAdvance");
  if (code === "COD") return t("ven.tCod");
  return code || "—";
}

function stateName(t: TFn, code: string): string {
  if (code === "27") return t("ven.st27");
  if (code === "29") return t("ven.st29");
  if (code === "36") return t("ven.st36");
  if (code === "33") return t("ven.st33");
  if (code === "24") return t("ven.st24");
  if (code === "07") return t("ven.st07");
  if (code === "09") return t("ven.st09");
  if (code === "23") return t("ven.st23");
  return code || "—";
}

function VendorTypeBadge({ vendor }: { vendor: Vendor }) {
  const { t } = useT();
  if (vendor.vendorType === "MANUFACTURER") {
    return (
      <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold" title={t("ven.mfrTitle")}>
        {t("ven.mfrChip")}{vendor.brand ? ` · ${vendor.brand}` : ""}
      </span>
    );
  }
  return <Badge tone="info">{t("ven.distributor")}</Badge>;
}

export default function VendorsView() {
  const { toast } = useToast();
  const { t } = useT();
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
    const timer = setTimeout(async () => {
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
            toast({ variant: "destructive", title: t("ven.toastLoadFail"), description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeFirmId, query, type, refresh, toast]);

  const totalPayable = (rows ?? []).reduce((s, v) => s + Number(v.closingBalance), 0);
  const mfrCount = (rows ?? []).filter((v) => v.vendorType === "MANUFACTURER").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("ven.title")}
        subtitle={t("ven.subtitle")}
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
            <Plus className="h-4 w-4" /> {t("ven.addVendor")}
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("ven.searchPh")}
            className="pl-9"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className={cn(inputCls, "w-full sm:w-[210px]")}>
            <SelectValue placeholder={t("ven.allTypes")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("ven.allTypes")}</SelectItem>
            <SelectItem value="MANUFACTURER">{t("ven.mfrs")}</SelectItem>
            <SelectItem value="DISTRIBUTOR">{t("ven.dists")}</SelectItem>
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
              title={t("ven.emptyTitle")}
              hint={t("ven.emptyHint")}
            />
          ) : (
            <table className="dmk-table min-w-[1080px]">
              <thead>
                <tr>
                  <th>{t("cmn.vendor")}</th>
                  <th>{t("cmn.type")}</th>
                  <th>GSTIN</th>
                  <th>{t("ven.colState")}</th>
                  <th>{t("cmn.phone")}</th>
                  <th>{t("ven.colTerms")}</th>
                  <th className="text-right">{t("ven.colPayable")}</th>
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
                        {!v.isActive && <span className="ml-2 text-[10.5px] text-dmk-text-muted">({t("ven.inactive")})</span>}
                      </td>
                      <td><VendorTypeBadge vendor={v} /></td>
                      <td className="font-money text-[11.5px] text-dmk-text-secondary">{v.gstin || "—"}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{stateName(t, v.stateCode)}</td>
                      <td className="font-money text-[12px] text-dmk-text-secondary">{v.phone || "—"}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{termsLabel(t, v.paymentTerms)}</td>
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
                          <BookOpen className="h-3.5 w-3.5" /> {t("ven.ledger")}
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
                          <Pencil className="h-3.5 w-3.5" /> {t("cmn.edit")}
                        </Button>
                        <TrashButton
                          className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                          recordLabel={v.vendorName}
                          recordHint={v.vendorType === "MANUFACTURER" ? t("ven.delHintMfr") : t("ven.delHintDist")}
                          onConfirm={async () => {
                            try {
                              await apiDelete(`/api/v1/vendors/${v.id}`);
                              toast({ title: t("ven.toastMoved"), description: t("ven.toastMovedDesc", { name: v.vendorName }) });
                              setRefresh((r) => r + 1);
                            } catch (e) {
                              toast({ variant: "destructive", title: t("ven.toastDelFail"), description: e instanceof Error ? e.message : t("cmn.unknown") });
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
              <span className="font-money text-dmk-text-secondary">{rows.length}</span> {t("ven.countVendors", { n: rows.length })}
            </span>
            <span>
              <span className="font-money text-dmk-gold">{mfrCount}</span> {t("ven.countMfrs", { n: mfrCount })}
            </span>
            <span>
              <span className="font-money text-dmk-info">Cr {formatINR(totalPayable)}</span> {t("ven.totalPayable")}
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
  const { t } = useT();
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
      toast({ variant: "destructive", title: t("ven.toastNameMissing"), description: t("ven.toastNameMissingDesc") });
      return;
    }
    if (isManufacturer && !form.brand.trim()) {
      toast({
        variant: "destructive",
        title: t("ven.toastBrandRequired"),
        description: t("ven.toastBrandRequiredDesc"),
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
        toast({ title: t("ven.toastUpdated"), description: form.vendorName.trim() });
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
        toast({ title: t("ven.toastCreated"), description: form.vendorName.trim() });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("ven.toastSaveFail"),
        description: e instanceof ApiError ? e.message : t("ven.toastSaveFailDesc"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{editing ? t("ven.editTitle") : t("ven.addTitle")}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {isManufacturer
              ? t("ven.descMfr")
              : t("ven.descDist")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label={t("ven.nameField")}>
              <Input value={form.vendorName} onChange={set("vendorName")} className={inputCls} placeholder={t("ven.namePh")} />
            </Field>
          </div>

          <Field label={t("ven.typeField")}>
            <Select
              value={form.vendorType}
              onValueChange={(v) => setForm((f) => ({ ...f, vendorType: v }))}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUFACTURER">{t("ven.manufacturer")}</SelectItem>
                <SelectItem value="DISTRIBUTOR">{t("ven.distributor")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t("cmn.brand")}
            hint={isManufacturer ? t("ven.brandHintMfr") : t("ven.brandHintDist")}
          >
            <Input
              value={form.brand}
              onChange={set("brand")}
              className={cn(inputCls, isManufacturer && "border-dmk-gold/40")}
              placeholder={isManufacturer ? t("ven.brandPhMfr") : "—"}
              disabled={!isManufacturer}
            />
          </Field>

          <Field
            label="GSTIN"
            hint={gstinState ? t("ven.gstinHintState", { state: stateName(t, gstinState.code) }) : t("ven.gstinHint")}
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

          <Field label={t("ven.stateField")} hint={t("ven.stateHint")}>
            <Select value={form.stateCode} onValueChange={(v) => setForm((f) => ({ ...f, stateCode: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{stateName(t, s.code)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("cmn.phone")}>
            <Input value={form.phone} onChange={set("phone")} className={cn(inputCls, "font-money")} placeholder="98765 43210" />
          </Field>

          <Field label={t("ven.email")}>
            <Input value={form.email} onChange={set("email")} className={inputCls} placeholder="sales@vendor.in" />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t("ven.address")}>
              <Input value={form.address} onChange={set("address")} className={inputCls} placeholder={t("ven.addressPh")} />
            </Field>
          </div>

          <Field label={t("ven.colTerms")}>
            <Select value={form.paymentTerms} onValueChange={(v) => setForm((f) => ({ ...f, paymentTerms: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {TERMS.map((term) => (
                  <SelectItem key={term.value} value={term.value}>{termsLabel(t, term.value)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("ven.openingField")} hint={editing ? t("ven.openingHintEdit") : t("ven.openingHintNew")}>
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
            {t("cmn.cancel")}
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("cmn.saveChanges") : t("ven.createBtn")}
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
  const { t } = useT();
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
          <DialogTitle className="text-dmk-text-primary">{t("ven.ledgerTitle", { name: vendor?.vendorName ?? "" })}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {vendor?.vendorType === "MANUFACTURER" ? t("ven.manufacturer") : t("ven.distributor")}
            {vendor?.brand ? ` · ${vendor.brand}` : ""} · GSTIN <span className="font-money">{vendor?.gstin || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between dmk-well px-3 py-2.5 text-[12.5px]">
          <span className="text-dmk-text-muted">
            {t("ven.opening")} <span className="font-money text-dmk-text-secondary">{formatINR(Number(vendor?.openingBalance ?? 0))}</span>
          </span>
          <span className="text-dmk-text-muted">
            {t("ven.closing")}{" "}
            <span className={cn("font-money font-semibold", closing > 0.005 ? "text-dmk-info" : "text-dmk-success")}>
              {closing > 0.005 ? `Cr ${formatINR(closing)}` : t("ven.clear")}
            </span>
          </span>
        </div>

        <div className="dmk-card overflow-hidden max-h-80 overflow-y-auto">
          {ledger === null ? (
            <LoadingRows rows={5} />
          ) : ledger.length === 0 ? (
            <EmptyState icon={BookOpen} title={t("ven.ledgerEmpty")} hint={t("ven.ledgerEmptyHint")} />
          ) : (
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>{t("cmn.date")}</th>
                  <th>{t("ven.colVoucher")}</th>
                  <th>{t("ven.colVoucherNo")}</th>
                  <th>{t("ven.colParticulars")}</th>
                  <th className="text-right">Dr</th>
                  <th className="text-right">Cr</th>
                  <th className="text-right">{t("cmn.balance")}</th>
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
            {t("cmn.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
