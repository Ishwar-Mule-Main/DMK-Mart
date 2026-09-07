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
  CheckCircle2,
  CircleUser,
  DatabaseBackup,
  ArchiveRestore,
  FileJson2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  ArrowLeftRight,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { Badge, ErrorText, Field, PageHeader, inputCls } from "../shared";
import AiSettingsCard from "../ai-settings-card";
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
import { OWNER_USERNAME } from "@/components/auth/login-gate";
import type { Firm } from "@/types/erp";
import { cn } from "@/lib/utils";
import { AutomationCard } from "./settings-automation";

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
  const [passwordOpen, setPasswordOpen] = React.useState(false);

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
              className="h-9 gap-2 bg-dmk-yellow text-[12.5px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/85"
            >
              <Plus className="h-4 w-4" /> Create New Firm
            </Button>
          </>
        }
      />

      {/* ── Owner account — fixed username + per-company password ── */}
      {activeFirm && (
        <div className="dmk-card p-5">
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            <CircleUser className="h-4 w-4 text-dmk-yellow" />
            <h2 className="text-[15px] font-semibold text-dmk-text-primary">Owner Account</h2>
            <Badge tone="info">USERNAME {OWNER_USERNAME.toUpperCase()} · EVERY COMPANY</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-dmk-yellow/30 bg-dmk-yellow/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Username</p>
              <p className="text-[17px] font-black text-dmk-text-primary mt-1">{OWNER_USERNAME}</p>
              <p className="text-[10.5px] text-dmk-text-muted mt-0.5">Fixed — even for new company accounts</p>
            </div>
            <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-4 py-3 min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Company on this account</p>
              <p className="text-[14px] font-bold text-dmk-text-primary mt-1 truncate">{activeFirm.firmName}</p>
              <p className="text-[10.5px] text-dmk-text-muted mt-0.5 font-money truncate">
                {activeFirm.firmCode} · opens with this account&apos;s password
              </p>
            </div>
            <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-4 py-3 flex flex-col justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Password</p>
                <p className="text-[14px] font-bold text-dmk-text-secondary mt-1 tracking-[0.3em]">••••••</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-dmk-border-subtle bg-dmk-bg-primary text-[12px] hover:bg-dmk-hover"
                  onClick={() => setPasswordOpen(true)}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Change password
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-dmk-border-subtle bg-dmk-bg-primary text-[12px] hover:bg-dmk-hover"
                  onClick={() => {
                    setEditing(activeFirm);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Company details
                </Button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-dmk-text-muted mt-3">
            The username is the same on every company account — the password decides which company opens. Change account
            details (name, GSTIN, bank, address) from Company details; change this account&apos;s password from Change password.
          </p>
        </div>
      )}

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
                    <Building2 className="h-5 w-5 text-dmk-yellow" strokeWidth={1.75} />
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

      {/* ── Automation — recurring auto-post scheduler heartbeat ──── */}
      <AutomationCard />

      {/* ── Data & backup ───────────────────────────────────── */}
      <BackupCard firm={activeFirm} counts={activeFirmId ? counts[activeFirmId] : undefined} />

      {/* ── Restore from backup (envelope → brand-new firm, R1-safe) ── */}
      <RestoreCard />

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

      {/* ── DMK AI Copilot — provider settings (key rotation + model picker) ── */}
      <AiSettingsCard />

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

      {/* ── Change owner password dialog ───────────────── */}
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        firm={activeFirm ?? null}
        onSaved={() => void refreshFirms()}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OWNER ACCOUNT — change the password of the active company account.
// Username is fixed (Kunal); PATCH /api/v1/firms/[id] verifies the
// current password and enforces cross-account password uniqueness.
// ═══════════════════════════════════════════════════════════════

function ChangePasswordDialog({
  open,
  onOpenChange,
  firm,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  firm: Firm | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    if (open) {
      setForm({ current: "", next: "", confirm: "" });
      setError(null);
    }
  }, [open]);

  const mismatch = form.confirm !== "" && form.next !== form.confirm;
  const canSave = !!firm && !busy && form.current !== "" && form.next.length >= 4 && form.next === form.confirm;

  async function save() {
    if (!firm || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/firms/${firm.id}`, {
        currentPassword: form.current,
        newPassword: form.next,
      });
      toast({
        title: "Password updated",
        description: `The ${firm.firmName} account now opens with the new password — sign in with ${OWNER_USERNAME} + it next time.`,
      });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-card max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary">Change owner password</DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            Updates the password for <span className="font-semibold text-dmk-text-secondary">{firm?.firmName ?? "this account"}</span>.
            Username stays <span className="font-semibold text-dmk-text-secondary">{OWNER_USERNAME}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Current password *">
            <Input type="password" value={form.current} onChange={set("current")} placeholder="verify it's you" className={inputCls} autoComplete="current-password" />
          </Field>
          <Field label="New password *" hint="Minimum 4 characters — must be unique across company accounts">
            <Input type="password" value={form.next} onChange={set("next")} placeholder="new password" className={inputCls} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password *">
            <Input
              type="password"
              value={form.confirm}
              onChange={set("confirm")}
              placeholder="repeat new password"
              className={cn(inputCls, mismatch && "border-dmk-danger/60")}
              autoComplete="new-password"
            />
            {mismatch && <span className="text-[10.5px] text-dmk-danger">Passwords don&apos;t match yet.</span>}
          </Field>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
        <Button onClick={save} disabled={!canSave} className="w-full h-10 mt-1 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Update password
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATA & BACKUP — firm-level JSON export (R1/R20: firm = account)
// ═══════════════════════════════════════════════════════════════

function BackupCard({
  firm,
  counts,
}: {
  firm?: Firm;
  counts?: FirmCounts;
}) {
  const { toast } = useToast();
  const [exporting, setExporting] = React.useState(false);
  const [lastExport, setLastExport] = React.useState<string | null>(null);

  async function exportBackup() {
    if (!firm || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/backup?firmId=${firm.id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Export failed (${res.status})`);
      }
      const payload = await res.json();
      const stamp = new Date().toISOString().slice(0, 10);
      const totalRecords = payload?.counts
        ? Object.values(payload.counts as Record<string, number>).reduce((a, b) => a + b, 0)
        : 0;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dmk-backup-${(firm.firmCode || firm.firmName).replace(/\s+/g, "-").toLowerCase()}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLastExport(new Date().toLocaleString("en-IN"));
      toast({
        title: "Backup downloaded",
        description: `${totalRecords} records exported for ${firm.firmName}.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Backup failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setExporting(false);
    }
  }

  const recordCount = counts
    ? counts.products + counts.customers + counts.vendors + counts.invoices + counts.purchaseOrders
    : null;

  return (
    <div className="dmk-card p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <DatabaseBackup className="h-4 w-4 text-dmk-info" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">Data &amp; Backup</h2>
        {firm && <Badge tone="info">{firm.firmName}</Badge>}
      </div>
      <p className="text-[12.5px] text-dmk-text-secondary mb-3">
        Download the complete data universe of the active firm as a versioned JSON envelope — firm profile, masters,
        documents, subledger allocations, journals, inventory audit trail and GSTR-2B records. Keep it with your
        accountant or feed it into any restore pipeline.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void exportBackup()}
          disabled={!firm || exporting}
          className="h-9 gap-2 bg-dmk-info text-[12.5px] font-semibold text-white hover:bg-dmk-info/85 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseBackup className="h-3.5 w-3.5" />}
          {exporting ? "Preparing…" : "Export full backup (JSON)"}
        </Button>
        <span className="text-[11.5px] text-dmk-text-muted">
          {recordCount !== null
            ? `≈ ${recordCount} core records · ${counts?.invoices ?? 0} invoices · ${counts?.purchaseOrders ?? 0} POs`
            : "Entity counts load with the firm list"}
        </span>
        {lastExport && (
          <span className="dmk-badge bg-dmk-success/10 text-dmk-success">Last export {lastExport}</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESTORE FROM BACKUP — envelope → brand-new firm (R1-safe)
// Client reads the file with FileReader, shows a preflight preview,
// requires typing RESTORE, then posts { envelope } to the API which
// creates a fresh firm with re-keyed ids. Existing firms are never
// touched. (View-local types — src/types/erp.ts is out of scope.)
// ═══════════════════════════════════════════════════════════════

interface BackupPreview {
  fileName: string;
  format: string;
  version: number;
  generatedAt: string;
  firmName: string;
  firmCode: string;
  counts: Record<string, number>;
  totalRecords: number;
  issues: string[]; // hard blocks (format/version/firm) — restore disabled
  warnings: string[]; // soft — shown, restore still allowed
}

interface RestoreResult {
  firmId: string;
  firmName: string;
  firmCode: string;
  counts: Record<string, number>;
  warnings: string[];
  restoredAt: string;
}

const BACKUP_COUNT_KEYS: Array<[string, string]> = [
  ["products", "Products"],
  ["customers", "Customers"],
  ["vendors", "Vendors"],
  ["purchaseOrders", "POs"],
  ["invoices", "Invoices"],
  ["salesReturns", "Sales Rtns"],
  ["purchaseReturns", "Purch Rtns"],
  ["vendorPayments", "V Payments"],
  ["customerReceipts", "Receipts"],
  ["chartOfAccounts", "COA"],
  ["journalEntries", "Journals"],
  ["inventoryMovements", "Stock Moves"],
  ["stockAdjustments", "Adjusts"],
  ["ledgerEntries", "Ledger Rows"],
  ["gstr2bRecords", "GSTR-2B"],
  ["recurringTemplates", "Recur Templates"],
];

const BACKUP_NESTED_KEYS: Record<string, string[]> = {
  purchaseOrders: ["items"],
  invoices: ["lineItems"],
  salesReturns: ["items"],
  purchaseReturns: ["items"],
  vendorPayments: ["allocations"],
  customerReceipts: ["allocations"],
  journalEntries: ["lines"],
  recurringTemplates: ["items"],
};

const REQUIRED_ENV_KEYS = ["products", "customers", "chartOfAccounts", "journalEntries"];
const RESTORE_WORD = "RESTORE";

/** Accept both the pure envelope and the { ok, data } fetch wrapper our export UI writes to disk. */
function unwrapEnvelopeFile(raw: unknown): Record<string, unknown> {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof obj.format === "string" && obj.format !== "") return obj;
  const inner = obj.data;
  if (inner && typeof inner === "object" && !Array.isArray(inner) && typeof (inner as Record<string, unknown>).format === "string") {
    return inner as Record<string, unknown>;
  }
  return obj;
}

function buildRestorePreview(fileName: string, raw: unknown): BackupPreview {
  const env = unwrapEnvelopeFile(raw);
  const data = env.data && typeof env.data === "object" && !Array.isArray(env.data) ? (env.data as Record<string, unknown>) : {};
  const firm = env.firm && typeof env.firm === "object" && !Array.isArray(env.firm) ? (env.firm as Record<string, unknown>) : {};

  const issues: string[] = [];
  const warnings: string[] = [];
  const format = typeof env.format === "string" ? env.format : "";
  const version = typeof env.version === "number" ? env.version : Number(env.version);
  if (format !== "dmk-mart-erp-backup") {
    issues.push(`Not a DMK backup envelope — format is ${format ? `"${format}"` : "missing"}`);
  }
  if (version !== 1 && version !== 2) {
    issues.push(`Unsupported backup version — expected 1 or 2, got ${Number.isFinite(version) ? version : "unknown"}`);
  }
  if (typeof firm.firmName !== "string" || firm.firmName === "") {
    issues.push("Envelope is missing the firm profile (firm.firmName)");
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!Array.isArray(data[key])) {
      warnings.push(`data.${key} is missing or not an array — the API will reject this envelope`);
    }
  }

  const counts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [key] of BACKUP_COUNT_KEYS) {
    const arr = data[key];
    const n = Array.isArray(arr) ? arr.length : 0;
    totalRecords += n;
    if (Array.isArray(arr)) {
      const nested = BACKUP_NESTED_KEYS[key] ?? [];
      for (const row of arr) {
        if (!row || typeof row !== "object") continue;
        for (const nk of nested) {
          const sub = (row as Record<string, unknown>)[nk];
          if (Array.isArray(sub)) {
            // child rows count toward the "rows will be created" total,
            // but stay OUT of the parent tile so labels stay truthful
            totalRecords += sub.length;
          }
        }
      }
    }
    counts[key] = n;
  }

  return {
    fileName,
    format,
    version: Number.isFinite(version) ? version : 0,
    generatedAt: typeof env.generatedAt === "string" ? env.generatedAt : "",
    firmName: typeof firm.firmName === "string" ? firm.firmName : "",
    firmCode: typeof firm.firmCode === "string" ? firm.firmCode : "",
    counts,
    totalRecords,
    issues,
    warnings,
  };
}

function RestoreCard() {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const envRef = React.useRef<unknown>(null);
  const [preview, setPreview] = React.useState<BackupPreview | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [restoring, setRestoring] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<RestoreResult | null>(null);

  const confirmed = confirmText.trim().toUpperCase() === RESTORE_WORD;
  const blocked = (preview?.issues.length ?? 0) > 0;
  const resultTotal = result
    ? Object.values(result.counts as Record<string, number>).reduce((a, b) => a + b, 0)
    : 0;

  function resetFile() {
    setPreview(null);
    setConfirmText("");
    envRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(file: File | undefined) {
    setApiError(null);
    setResult(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw: unknown = JSON.parse(String(reader.result ?? "{}"));
        envRef.current = raw;
        setPreview(buildRestorePreview(file.name, raw));
      } catch {
        envRef.current = null;
        setPreview(null);
        setApiError("Not valid JSON — this file is not a DMK backup envelope.");
      }
    };
    reader.onerror = () => {
      setApiError("Could not read the file — try re-selecting it.");
    };
    reader.readAsText(file);
  }

  async function runRestore() {
    if (!preview || !confirmed || restoring || blocked) return;
    setRestoring(true);
    setApiError(null);
    try {
      const res = await apiPost<RestoreResult>("/api/v1/backup/restore", { envelope: envRef.current });
      setResult(res);
      setConfirmText("");
      resetFile();
      // Land the owner in the restored firm: refresh the firms list and activate it.
      const list = await apiGet<Firm[]>("/api/v1/firms");
      useErpStore.getState().setFirms(list ?? []);
      useErpStore.getState().setActiveFirm(res.firmId);
      toast({
        title: "Backup restored into a new firm",
        description: `${res.firmName} (${res.firmCode}) is now the active firm — existing firms were never touched.`,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Restore failed";
      setApiError(msg);
      toast({ variant: "destructive", title: "Restore failed", description: msg });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="dmk-card p-5 dmk-enter">
      <div className="flex items-center gap-2.5 mb-3">
        <ArchiveRestore className="h-4 w-4 text-dmk-gold" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">Restore from Backup</h2>
        <Badge tone="gold">R1 · NEW FIRM ONLY</Badge>
      </div>
      <p className="text-[12.5px] text-dmk-text-secondary mb-4">
        Restores a backup envelope into a <span className="text-dmk-text-primary font-medium">brand-new firm</span> — existing
        firms are never touched. Every record is re-keyed with fresh IDs inside a single transaction; rows that cannot be
        mapped are skipped and reported as warnings. Nothing is written until you type RESTORE.
      </p>

      {/* Success panel */}
      {result && (
        <div className="mb-4 rounded-lg border border-dmk-success/40 bg-dmk-success/10 p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-dmk-success shrink-0" />
            <span className="text-[13px] font-semibold text-dmk-success">Restored into new firm — now active</span>
          </div>
          <p className="font-money text-[12.5px] text-dmk-text-secondary">
            {result.firmName} · <span className="text-dmk-gold">{result.firmCode}</span> · restored{" "}
            {new Date(result.restoredAt).toLocaleString("en-IN")} · {resultTotal} rows written
          </p>
          <div className="flex flex-wrap gap-1.5">
            {BACKUP_COUNT_KEYS.filter(([key]) => (result.counts[key] ?? 0) > 0).map(([key, label]) => (
              <span key={key} className="dmk-badge dmk-badge-neutral font-money">
                {label} {result.counts[key]}
              </span>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <ul className="space-y-1 text-[11.5px] text-dmk-warning list-disc pl-5">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* File picker — dashed drop-zone-style button */}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Backup envelope JSON file"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={restoring}
        className="w-full rounded-lg border border-dashed border-dmk-border-medium bg-dmk-input-well/40 hover:bg-dmk-hover/60 disabled:opacity-50 px-4 py-5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-gold/60"
      >
        <span className="flex flex-col items-center gap-1.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
            {preview ? <FileJson2 className="h-4.5 w-4.5 text-dmk-gold" /> : <Upload className="h-4.5 w-4.5 text-dmk-text-muted" />}
          </span>
          <span className="text-[13px] font-semibold text-dmk-text-primary">
            {preview ? "Choose a different file…" : "Choose a backup file (.json)…"}
          </span>
          <span className="text-[11px] text-dmk-text-muted font-money">dmk-backup-&lt;firmCode&gt;-&lt;date&gt;.json · exported from Settings</span>
        </span>
      </button>

      {/* Verbatim API / parse error strip */}
      {apiError && (
        <div role="alert" className="mt-3 rounded-md border border-dmk-danger/40 bg-dmk-danger/10 px-3 py-2 text-[12.5px] text-dmk-danger">
          {apiError}
        </div>
      )}

      {/* Preflight preview */}
      {preview && (
        <div className="mt-4 rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileJson2 className="h-4 w-4 text-dmk-gold shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Preflight preview</span>
            <Badge tone={preview.version === 1 || preview.version === 2 ? "info" : "danger"}>v{preview.version}</Badge>
            {preview.issues.length === 0 ? (
              <Badge tone="success">SHAPE OK</Badge>
            ) : (
              <Badge tone="danger">INVALID</Badge>
            )}
            <span className="ml-auto text-[11px] text-dmk-text-muted font-money truncate max-w-full">{preview.fileName}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11.5px] font-money">
            <span className="text-dmk-text-muted">
              Firm <span className="text-dmk-text-primary block truncate">{preview.firmName || "—"}</span>
            </span>
            <span className="text-dmk-text-muted">
              Code <span className="text-dmk-text-primary block font-money">{preview.firmCode || "—"}</span>
            </span>
            <span className="text-dmk-text-muted">
              Generated{" "}
              <span className="text-dmk-text-secondary block font-money">
                {preview.generatedAt ? new Date(preview.generatedAt).toLocaleString("en-IN") : "—"}
              </span>
            </span>
          </div>

          <div className="dmk-enter-stagger grid grid-cols-3 sm:grid-cols-5 gap-2">
            {BACKUP_COUNT_KEYS.map(([key, label]) => (
              <div key={key} className="rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary/60 px-2 py-1.5 text-center">
                <div className="font-money text-[13px] font-semibold text-dmk-text-primary tabular-nums">{preview.counts[key] ?? 0}</div>
                <div className="text-[9.5px] uppercase tracking-wide text-dmk-text-muted truncate">{label}</div>
              </div>
            ))}
          </div>

          <p className="text-[11.5px] text-dmk-text-muted font-money">
            ≈ {preview.totalRecords} rows will be created (incl. line items, allocations &amp; journal lines) into firm
            code <span className="text-dmk-gold">{preview.firmCode ? `${preview.firmCode}-R1+` : "—"}</span> (suffixed if it exists)
          </p>

          {preview.issues.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-dmk-danger/40 bg-dmk-danger/10 px-3 py-2 text-[12px] text-dmk-danger list-disc pl-6">
              {preview.issues.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="space-y-1 text-[11.5px] text-dmk-warning list-disc pl-5">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {/* Destructive confirmation: type RESTORE */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={`Type ${RESTORE_WORD} to enable`}
              aria-label={`Type ${RESTORE_WORD} to confirm restore`}
              disabled={restoring || blocked}
              className={cn(inputCls, "sm:max-w-56 font-money tracking-widest uppercase placeholder:normal-case placeholder:tracking-normal")}
            />
            <Button
              onClick={() => void runRestore()}
              disabled={restoring || blocked || !confirmed}
              className="h-9 gap-2 bg-dmk-gold text-[12.5px] font-bold text-[#0A0F1D] hover:bg-dmk-gold/85 disabled:opacity-40 sm:ml-auto"
            >
              {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
              {restoring ? "Restoring…" : `Restore ${preview.totalRecords} records`}
            </Button>
          </div>
          <p className="text-[10.5px] text-dmk-text-muted">
            The restore creates a new firm with suffix <span className="font-money">-R1, -R2…</span> when the code already
            exists, then switches you into it. Original firm profile is preserved unmodified (name gains “ (Restored)”).
          </p>
        </div>
      )}
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
      <DialogContent className="bg-dmk-bg-secondary border-dmk-border-medium max-h-[90vh] overflow-y-auto sm:w-[660px]">
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
            className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "create" ? "Create Firm" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
