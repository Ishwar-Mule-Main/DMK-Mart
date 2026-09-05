"use client";

// ═══════════════════════════════════════════════════════════════
// COMPANY DIALOGS — opened from the header company menu (right end).
// · CompanyDetailsDialog — view & edit the active firm's profile
//   (name, GSTIN, contacts, address, bank, invoice prefix)
//   via PATCH /api/v1/firms/[id].
// · ChangePasswordDialog — change the owner password of the active
//   company account (verifies current password, enforces uniqueness
//   across company accounts) via the same PATCH endpoint.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Building2, KeyRound, Loader2, CalendarRange } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Firm } from "@/types/erp";

const inputCls =
  "h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus-visible:ring-dmk-yellow/40";

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[10.5px] uppercase tracking-wider text-dmk-text-muted">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-dmk-text-muted">{hint}</p>}
    </div>
  );
}

// ── Company details ─────────────────────────────────────────────

const DETAIL_FIELDS: Array<{ key: keyof Firm; label: string; placeholder: string; hint?: string; span?: boolean }> = [
  { key: "firmName", label: "Company name", placeholder: "Legal trade name" },
  { key: "gstin", label: "GSTIN", placeholder: "27XXXXX0000X1X5", hint: "State code auto-derives from the first 2 digits" },
  { key: "phone", label: "Phone", placeholder: "+91 …" },
  { key: "email", label: "Email", placeholder: "accounts@…" },
  { key: "address", label: "Registered address", placeholder: "Street, city, PIN", span: true },
  { key: "bankName", label: "Bank name", placeholder: "Bank & branch" },
  { key: "ifsc", label: "IFSC", placeholder: "HDFC0001234" },
  { key: "bankAccount", label: "Account number", placeholder: "A/C number" },
  { key: "invoicePrefix", label: "Invoice prefix", placeholder: "INV", hint: "Printed on tax invoices" },
];

export function CompanyDetailsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [autoCreateFy, setAutoCreateFy] = React.useState(true);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    setLoading(true);
    apiGet<{ firm: Firm }>(`/api/v1/firms/${activeFirmId}`)
      .then(({ firm }) => {
        setForm({
          firmName: firm.firmName,
          gstin: firm.gstin,
          phone: firm.phone,
          email: firm.email,
          address: firm.address,
          bankName: firm.bankName,
          ifsc: firm.ifsc,
          bankAccount: firm.bankAccount,
          invoicePrefix: firm.invoicePrefix,
        });
        setAutoCreateFy(firm.autoCreateFy ?? true);
      })
      .catch(() => toast({ variant: "destructive", title: "Could not load company details" }))
      .finally(() => setLoading(false));
  }, [open, activeFirmId, toast]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!activeFirmId || saving) return;
    if (!form.firmName?.trim()) {
      toast({ variant: "destructive", title: "Company name is required" });
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/api/v1/firms/${activeFirmId}`, { ...form, autoCreateFy });
      toast({ title: "Company details updated", description: "Changes apply to invoices and GST documents immediately." });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not save company details",
        description: e instanceof ApiError ? e.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-w-lg max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary flex items-center gap-2">
            <Building2 className="h-4 w-4 text-dmk-blue" /> Company details
          </DialogTitle>
          <DialogDescription className="text-[11.5px] text-dmk-text-muted">
            Profile of the company this account opens — printed on invoices, debit/credit notes and GST documents.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-dmk-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading company profile…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DETAIL_FIELDS.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                className={f.span ? "sm:col-span-2" : undefined}
              >
                <Input
                  value={form[f.key] ?? ""}
                  onChange={set(f.key)}
                  placeholder={f.placeholder}
                  className={inputCls}
                  autoComplete="off"
                />
              </Field>
            ))}
          </div>
        )}

        {/* Financial-year automation */}
        <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-dmk-text-primary flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5 text-dmk-gold" /> Auto-open next financial year
            </p>
            <p className="text-[10.5px] leading-relaxed text-dmk-text-muted mt-1">
              ON — the next year's books open themselves on 1 April. OFF — every section locks after
              31 March until you open the new year from the FY menu.
            </p>
          </div>
          <Switch
            checked={autoCreateFy}
            onCheckedChange={setAutoCreateFy}
            aria-label="Auto-open next financial year on 1 April"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={loading || saving}
            className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Change password ─────────────────────────────────────────────

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firmName = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId)?.firmName);
  const { toast } = useToast();
  const [form, setForm] = React.useState({ current: "", next: "", confirm: "" });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm({ current: "", next: "", confirm: "" });
  }, [open]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!activeFirmId || saving) return;
    if (!form.current || !form.next) {
      toast({ variant: "destructive", title: "Current and new password are required" });
      return;
    }
    if (form.next !== form.confirm) {
      toast({ variant: "destructive", title: "New passwords do not match" });
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/api/v1/firms/${activeFirmId}`, {
        currentPassword: form.current,
        newPassword: form.next,
      });
      toast({
        title: "Password updated",
        description: `The ${firmName ?? "company"} account now opens with the new password.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not change the password",
        description: e instanceof ApiError ? e.message : "Request failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-dmk-warning" /> Change password
          </DialogTitle>
          <DialogDescription className="text-[11.5px] text-dmk-text-muted">
            Updates the password for <span className="font-semibold text-dmk-text-secondary">{firmName ?? "this account"}</span>.
            The username stays the same — the password decides which company opens.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Current password *">
            <Input type="password" value={form.current} onChange={set("current")} placeholder="verify it's you" className={inputCls} autoComplete="current-password" />
          </Field>
          <Field label="New password *" hint="Minimum 4 characters — must differ from the current one">
            <Input type="password" value={form.next} onChange={set("next")} placeholder="new password" className={inputCls} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password *">
            <Input type="password" value={form.confirm} onChange={set("confirm")} placeholder="repeat new password" className={inputCls} autoComplete="new-password" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving}
            className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Update password
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
