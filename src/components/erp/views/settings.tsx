"use client";

// ═══════════════════════════════════════════════════════════════
// SETTINGS — FIRM MANAGEMENT (owner workspace, R20: firm = account)
// POST/GET /api/v1/firms · PATCH /api/v1/firms/[id]
// FY switcher (R17) drives transactional view windows.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Building2,
  CalendarRange,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  ArrowLeftRight,
  TriangleAlert,
} from "lucide-react";

import { Badge, ErrorText, Field, PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
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
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import type { Firm } from "@/types/erp";
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

const FY_OPTIONS = ["2025-26", "2026-27", "2027-28"];

interface FirmCounts {
  products: number;
  customers: number;
  vendors: number;
  invoices: number;
  purchaseOrders: number;
}

interface FirmForm {
  firmName: string;
  firmCode: string;
  gstin: string;
  state: string;
  stateCode: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
  financialYear: string;
  invoicePrefix: string;
  openingCash: string;
  openingBank: string;
}

const EMPTY_FORM: FirmForm = {
  firmName: "",
  firmCode: "",
  gstin: "",
  state: "27", // holds the state CODE while the Select is bound to it
  stateCode: "27",
  address: "",
  phone: "",
  email: "",
  bankName: "",
  bankAccount: "",
  ifsc: "",
  financialYear: "2025-26",
  invoicePrefix: "",
  openingCash: "",
  openingBank: "",
};

function formFromFirm(f: Firm): FirmForm {
  return {
    firmName: f.firmName,
    firmCode: f.firmCode,
    gstin: f.gstin,
    state: f.stateCode,
    stateCode: f.stateCode,
    address: f.address,
    phone: f.phone,
    email: f.email,
    bankName: f.bankName,
    bankAccount: f.bankAccount,
    ifsc: f.ifsc,
    financialYear: f.financialYear || "2025-26",
    invoicePrefix: f.invoicePrefix,
    openingCash: "",
    openingBank: "",
  };
}

export default function SettingsView() {
  const firms = useErpStore((s) => s.firms);
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const financialYear = useErpStore((s) => s.financialYear);
  const setFirms = useErpStore((s) => s.setFirms);
  const setActiveFirm = useErpStore((s) => s.setActiveFirm);
  const setFinancialYear = useErpStore((s) => s.setFinancialYear);
  const { toast } = useToast();

  const [counts, setCounts] = React.useState<Record<string, FirmCounts>>({});
  const [refreshing, setRefreshing] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Firm | null>(null);
  const [fySaving, setFySaving] = React.useState(false);

  const activeFirm = firms.find((f) => f.id === activeFirmId);

  const refreshFirms = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await apiGet<Firm[]>("/api/v1/firms");
      setFirms(list ?? []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not refresh firms",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setRefreshing(false);
    }
  }, [setFirms, toast]);

  // Entity counts per firm (best-effort)
  React.useEffect(() => {
    if (firms.length === 0) return;
    let alive = true;
    (async () => {
      const results = await Promise.all(
        firms.map(async (f) => {
          try {
            const res = await apiGet<{ counts: FirmCounts }>(`/api/v1/firms/${f.id}`);
            return [f.id, res.counts] as const;
          } catch {
            return [f.id, null] as const;
          }
        })
      );
      if (alive) {
        const map: Record<string, FirmCounts> = {};
        for (const [id, c] of results) if (c) map[id] = c;
        setCounts(map);
      }
    })();
    return () => {
      alive = false;
    };
  }, [firms]);

  async function switchFirm(id: string) {
    if (id === activeFirmId) return;
    setActiveFirm(id);
    toast({ title: "Firm switched", description: "All views now show this firm's isolated universe." });
  }

  async function changeFy(fy: string) {
    setFinancialYear(fy);
    if (!activeFirmId) return;
    setFySaving(true);
    try {
      await apiPatch(`/api/v1/firms/${activeFirmId}`, { financialYear: fy });
      await refreshFirms();
      toast({ title: "Financial year updated", description: `Views now filter by FY ${fy} (Apr–Mar).` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "FY saved locally only",
        description: e instanceof ApiError ? e.message : "Could not persist to firm profile",
      });
    } finally {
      setFySaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings & Firms"
        subtitle="Owner workspace · firm = account · every universe fully isolated (R1, R20)"
        icon={SettingsIcon}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshFirms()}
              disabled={refreshing}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-9 gap-2 bg-dmk-orange text-[12.5px] font-semibold text-white hover:bg-dmk-orange/85"
            >
              <Plus className="h-4 w-4" /> Create New Firm
            </Button>
          </>
        }
      />

      {/* ── Firms list ──────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {firms.map((f) => {
          const isActive = f.id === activeFirmId;
          const c = counts[f.id];
          return (
            <div
              key={f.id}
              className={cn(
                "dmk-card p-5 flex flex-col gap-3",
                isActive && "ring-1 ring-dmk-gold/70 shadow-[0_0_0_1px_rgba(255,204,0,0.25)]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                    <Building2 className="h-5 w-5 text-dmk-orange" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-bold text-dmk-text-primary truncate">{f.firmName}</h2>
                    <p className="text-[11.5px] text-dmk-text-muted font-money">
                      {f.firmCode} · {f.gstin || "no GSTIN"}
                    </p>
                  </div>
                </div>
                {isActive ? (
                  <span className="dmk-badge bg-[rgba(255,204,0,0.15)] text-dmk-gold shrink-0">● ACTIVE</span>
                ) : (
                  <Badge tone="neutral">{f.stateCode}</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[11.5px]">
                <span className="text-dmk-text-muted">
                  State <span className="text-dmk-text-secondary block">{f.state || "—"}</span>
                </span>
                <span className="text-dmk-text-muted">
                  FY <span className="text-dmk-text-secondary block font-money">{f.financialYear}</span>
                </span>
                <span className="text-dmk-text-muted">
                  Prefix <span className="text-dmk-text-secondary block font-money">{f.invoicePrefix}</span>
                </span>
                <span className="text-dmk-text-muted">
                  Opening <span className="text-dmk-text-secondary block font-money">{formatINR(f.openingCash + f.openingBank)}</span>
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="dmk-badge dmk-badge-neutral">Products {c?.products ?? "—"}</span>
                <span className="dmk-badge dmk-badge-neutral">Customers {c?.customers ?? "—"}</span>
                <span className="dmk-badge dmk-badge-neutral">Vendors {c?.vendors ?? "—"}</span>
                <span className="dmk-badge dmk-badge-neutral">Invoices {c?.invoices ?? "—"}</span>
                <span className="dmk-badge dmk-badge-neutral">POs {c?.purchaseOrders ?? "—"}</span>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-dmk-border-subtle mt-1">
                {isActive ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-dmk-gold font-semibold h-9">
                    <Check className="h-4 w-4" /> Currently active firm
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void switchFirm(f.id)}
                    className="h-9 gap-2 bg-dmk-blue text-white text-[12.5px] font-semibold hover:bg-dmk-blue/85"
                  >
                    <ArrowLeftRight className="h-4 w-4" /> Switch To This Firm
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(f);
                    setEditOpen(true);
                  }}
                  className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover ml-auto"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Financial year switcher ─────────────────────── */}
      <div className="dmk-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <CalendarRange className="h-4 w-4 text-dmk-blue" />
          <h2 className="text-[15px] font-semibold text-dmk-text-primary">Financial Year</h2>
          <Badge tone="info">R17 · APR–MAR</Badge>
        </div>
        <RadioGroup
          value={financialYear || activeFirm?.financialYear || "2025-26"}
          onValueChange={(v) => void changeFy(v)}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          disabled={fySaving}
        >
          {FY_OPTIONS.map((fy) => {
            const selected = (financialYear || activeFirm?.financialYear) === fy;
            return (
              <Label
                key={fy}
                htmlFor={`fy-${fy}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors",
                  selected
                    ? "border-dmk-blue/60 bg-dmk-hover"
                    : "border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover/60"
                )}
              >
                <RadioGroupItem value={fy} id={`fy-${fy}`} className="border-dmk-border-medium" />
                <span className="flex flex-col">
                  <span className={cn("font-money text-[14px] font-semibold", selected ? "text-dmk-text-primary" : "text-dmk-text-secondary")}>
                    FY {fy}
                  </span>
                  <span className="text-[10.5px] text-dmk-text-muted">
                    Apr 1 {fy.slice(0, 4)} – Mar 31 {`20${fy.slice(5)}`}
                  </span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
        <p className="text-[11.5px] text-dmk-text-muted mt-3">
          Filters transactional views by FY — P&amp;L windows default to this year&apos;s Apr–Mar range. Books and ledgers remain continuous.
        </p>
      </div>

      {/* ── Platform info ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="dmk-card p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <ShieldCheck className="h-4 w-4 text-dmk-success" />
            <h2 className="text-[15px] font-semibold text-dmk-text-primary">Platform Info</h2>
          </div>
          <dl className="space-y-2 text-[12.5px]">
            {[
              ["Platform", "DMK Mart ERP"],
              ["Version", "v1.0.0 (delivery sprint)"],
              ["Design system", "Midnight Ledger (navy, frozen)"],
              ["Business rules", "R1 – R20 enforced (20 rules)"],
              ["Stack", "Next.js 16 · React 19 · Prisma/SQLite · Tailwind 4"],
              ["Accounting", "Double-entry, Σ Dr = Σ Cr on every voucher (R6)"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 border-b border-dmk-border-subtle/60 pb-2 last:border-0 last:pb-0">
                <dt className="text-dmk-text-muted shrink-0">{k}</dt>
                <dd className="text-dmk-text-primary text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ── Danger zone ───────────────────────────────── */}
        <div className="dmk-well border-[rgba(245,158,11,0.35)] p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <TriangleAlert className="h-4 w-4 text-dmk-warning" />
            <h2 className="text-[15px] font-semibold text-dmk-warning">Danger Zone — Isolation Guarantees</h2>
          </div>
          <ul className="space-y-2 text-[12.5px] text-dmk-text-secondary list-disc pl-5">
            <li>Platform is owner-only — no user accounts, no RBAC. <span className="text-dmk-text-primary font-medium">Firm = account.</span></li>
            <li>All data is isolated per firm: products, stock, parties, books and AI grounding never cross firms (R1).</li>
            <li>Deleting or deactivating a firm is disabled in this build to protect accounting continuity.</li>
            <li>Opening balances post an OPENING journal at creation — never edit firm openings directly.</li>
          </ul>
        </div>
      </div>

      {/* ── Create dialog ───────────────────────────────── */}
      <FirmDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSaved={(newId) => {
          void refreshFirms();
          if (newId) {
            setActiveFirm(newId);
            toast({ title: "Firm created & activated", description: "COA seeded; opening journal posted if capital was entered." });
          }
        }}
      />

      {/* ── Edit dialog ─────────────────────────────────── */}
      <FirmDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditing(null);
        }}
        mode="edit"
        firm={editing}
        onSaved={() => {
          void refreshFirms();
          toast({ title: "Firm profile updated", description: "Changes apply to invoices and GST docs immediately." });
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FIRM DIALOG (create / edit)
// ═══════════════════════════════════════════════════════════════

function FirmDialog({
  open,
  onOpenChange,
  mode,
  firm,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  firm?: Firm | null;
  onSaved: (newFirmId?: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<FirmForm>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFormError(null);
    setForm(mode === "edit" && firm ? formFromFirm(firm) : { ...EMPTY_FORM, invoicePrefix: "" });
  }, [open, mode, firm]);

  function set<K extends keyof FirmForm>(key: K, value: FirmForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const gstinPrefix = /^\d{2}/.test(form.gstin) ? form.gstin.slice(0, 2) : "";
  const createValid = form.firmName.trim() !== "" && form.firmCode.trim() !== "";
  const editValid = form.firmName.trim() !== "";
  const stateName =
    STATES.find((s) => s.code === form.state)?.name.replace(/\s*\(\d+\)$/, "") ??
    (mode === "edit" && firm ? firm.state : "Maharashtra");

  async function save() {
    setSaving(true);
    setFormError(null);
    try {
      if (mode === "create") {
        const res = await apiPost<{ firm: Firm }>("/api/v1/firms", {
          firmName: form.firmName.trim(),
          firmCode: form.firmCode.trim().toUpperCase(),
          gstin: form.gstin.trim(),
          state: stateName,
          stateCode: form.state,
          address: form.address.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          bankName: form.bankName.trim(),
          bankAccount: form.bankAccount.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          financialYear: form.financialYear,
          invoicePrefix: form.invoicePrefix.trim() || undefined,
          openingCash: Number(form.openingCash) || 0,
          openingBank: Number(form.openingBank) || 0,
        });
        onOpenChange(false);
        onSaved(res.firm.id);
      } else if (firm) {
        await apiPatch(`/api/v1/firms/${firm.id}`, {
          firmName: form.firmName.trim(),
          gstin: form.gstin.trim(),
          state: stateName,
          stateCode: form.state,
          address: form.address.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          bankName: form.bankName.trim(),
          bankAccount: form.bankAccount.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          financialYear: form.financialYear,
          invoicePrefix: form.invoicePrefix.trim(),
        });
        onOpenChange(false);
        onSaved();
      }
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Request failed";
      setFormError(msg);
      toast({ variant: "destructive", title: mode === "create" ? "Could not create firm" : "Could not update firm", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-dmk-bg-secondary border-dmk-border-medium max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">
            {mode === "create" ? "Create New Firm" : `Edit ${firm?.firmName ?? "Firm"}`}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            {mode === "create"
              ? "A new firm is a fresh isolated universe — chart of accounts is seeded automatically and the opening journal posts on save."
              : "Profile fields feed invoices, A4 documents and GST place-of-supply logic. Firm code and opening balances are immutable."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Firm Name *">
              <Input value={form.firmName} onChange={(e) => set("firmName", e.target.value)} placeholder="DMK Mart" className={inputCls} />
            </Field>
            <Field label="Firm Code *" hint={mode === "edit" ? "Immutable after creation" : "Short unique code, e.g. DMK"}>
              <Input
                value={form.firmCode}
                onChange={(e) => set("firmCode", e.target.value.toUpperCase())}
                placeholder="DMK"
                disabled={mode === "edit"}
                className={cn(inputCls, "font-money uppercase")}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="GSTIN" hint={gstinPrefix ? `First 2 digits “${gstinPrefix}” auto-map to state code` : "15 characters; first 2 digits = state code"}>
              <Input
                value={form.gstin}
                onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                placeholder="27AAAAA0000A1Z5"
                maxLength={15}
                className={cn(inputCls, "font-money uppercase")}
              />
            </Field>
            <Field label="State">
              <Select
                value={form.state}
                onValueChange={(v) => {
                  set("state", v);
                  set("stateCode", v);
                }}
              >
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-h-64">
                  {STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code} className="text-[12.5px]">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Address">
            <Textarea value={form.address} onChange={(e) => set("address", e.target.value)} rows={2} placeholder="Shop no, street, city, PIN" className="bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary dmk-input resize-none" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91…" className={inputCls} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="owner@firm.in" className={inputCls} />
            </Field>
          </div>

          <div className="dmk-well p-3 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Bank Details (printed on A4 invoices)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Bank Name">
                <Input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="HDFC Bank" className={inputCls} />
              </Field>
              <Field label="Account Number">
                <Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} className={cn(inputCls, "font-money")} />
              </Field>
              <Field label="IFSC">
                <Input value={form.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} className={cn(inputCls, "font-money uppercase")} />
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Financial Year">
              <Select value={form.financialYear} onValueChange={(v) => set("financialYear", v)}>
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium">
                  {FY_OPTIONS.map((fy) => (
                    <SelectItem key={fy} value={fy} className="text-[12.5px]">
                      FY {fy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Invoice Prefix" hint="Defaults to firm code when blank">
              <Input
                value={form.invoicePrefix}
                onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
                placeholder="DMK"
                className={cn(inputCls, "font-money uppercase")}
              />
            </Field>
          </div>

          {mode === "create" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Opening Cash (₹)" hint="Posts Dr Cash in the OPENING journal">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.openingCash}
                  onChange={(e) => set("openingCash", e.target.value)}
                  placeholder="0.00"
                  className={cn(inputCls, "text-right font-money")}
                />
              </Field>
              <Field label="Opening Bank (₹)" hint="Posts Dr Bank in the OPENING journal">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.openingBank}
                  onChange={(e) => set("openingBank", e.target.value)}
                  placeholder="0.00"
                  className={cn(inputCls, "text-right font-money")}
                />
              </Field>
            </div>
          )}

          {formError && <ErrorText>{formError}</ErrorText>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-9 border-dmk-border-subtle bg-transparent hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || (mode === "create" ? !createValid : !editValid)}
            className="h-9 gap-2 bg-dmk-orange text-white hover:bg-dmk-orange/85 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "Create Firm" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
