"use client";

// ═══════════════════════════════════════════════════════════════
// LOGIN GATE — two doors, two URLs, one brand.
// · OWNER  → "/"      (full ERP workspace)  · TEAM  → "/team"
// Each URL renders ONLY its own door — the two logins are never
// shown together. A small cross-link hops between the addresses.
//
// OWNER IDENTITY: the username is always "Kunal" — on the login
// card and on every new company account. The PASSWORD identifies
// which company account opens (one password per company).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, Users, Lock, ShieldCheck, ArrowRight, Loader2, Plus, CircleUser, ShoppingCart, ShieldAlert } from "lucide-react";
import { useErpStore, type ErpSession, type SalesPermissions } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import type { Firm } from "@/types/erp";
import { cn } from "@/lib/utils";

type Door = "owner" | "team" | "sales";

/** Every door shows the other two cross-links except its own. */
function isTeamLinkHidden(door: Door): boolean {
  return door === "team";
}

export const TEAM_LOGIN_URL = "/team";
export const OWNER_LOGIN_URL = "/";
export const SALES_LOGIN_URL = "/sales";

/** The one fixed owner username across every company account. */
export const OWNER_USERNAME = "Kunal";

export function LoginGate({ door }: { door: Door }) {
  const { firms, setFirms, setSession, setActiveFirm } = useErpStore();
  const [firmsLoaded, setFirmsLoaded] = React.useState(firms.length > 0);

  React.useEffect(() => {
    if (firms.length === 0) {
      apiGet<Firm[]>("/api/v1/firms")
        .then((list) => {
          setFirms(list ?? []);
          setFirmsLoaded(true);
        })
        .catch(() => setFirmsLoaded(true));
    }
  }, [firms.length, setFirms]);

  const isOwner = door === "owner";
  const isSales = door === "sales";

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      <div className="flex-1 flex items-center justify-center px-4 py-10 relative overflow-hidden">
        <div aria-hidden className={cn("pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[720px] rounded-full blur-3xl", isOwner ? "bg-dmk-yellow/10" : isSales ? "bg-emerald-500/10" : "bg-dmk-blue/10")} />
        <div className="w-full max-w-[420px] dmk-card p-7 relative dmk-enter">
          <div className="flex flex-col items-center text-center gap-3">
            <img src="/dmk-logo.png" alt="DMK Mart logo" width={72} height={72} className="rounded-full" />
            <div>
              <p className="text-[19px] font-black tracking-tight text-dmk-text-primary">
                {isOwner ? "DMK Mart ERP" : isSales ? "DMK Sales Portal" : "DMK Verification Portal"}
              </p>
              <p className="text-[11.5px] text-dmk-text-muted mt-0.5">
                {isOwner ? "Trading · Distribution · Bookkeeping" : isSales ? "Sales team workspace · billing & orders" : "Owner link · goods-in checkpoint"}
              </p>
            </div>
            <span
              className={cn(
                "dmk-badge h-7 px-3 gap-1.5",
                isOwner ? "bg-dmk-yellow/15 text-dmk-yellow" : isSales ? "bg-emerald-500/15 text-emerald-400" : "bg-dmk-blue/15 text-dmk-blue"
              )}
            >
              {isOwner ? <CircleUser className="h-3.5 w-3.5" /> : isSales ? <ShoppingCart className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
              {isOwner ? `Signed in as ${OWNER_USERNAME}` : isSales ? "Sales team login" : "Verification team login"}
            </span>
          </div>

          {isOwner ? (
            <OwnerDoor firms={firms} firmsLoaded={firmsLoaded} onSignedIn={setSession} onPickFirm={setActiveFirm} />
          ) : isSales ? (
            <SalesDoor onSignedIn={setSession} />
          ) : (
            <TeamDoor onSignedIn={setSession} />
          )}

          {/* Cross-links — the three doors live at different addresses */}
          <div className="mt-5 flex flex-col gap-1.5">
            {!isOwner && (
              <a
                href={OWNER_LOGIN_URL}
                className="w-full text-[11.5px] font-semibold text-dmk-text-muted hover:text-dmk-yellow flex items-center justify-center gap-1.5 transition-colors"
              >
                <Building2 className="h-3.5 w-3.5" /> Company owner? Sign in at the owner portal
              </a>
            )}
            {!isSales && (
              <a
                href={SALES_LOGIN_URL}
                className="w-full text-[11.5px] font-semibold text-dmk-text-muted hover:text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
              >
                <ShoppingCart className="h-3.5 w-3.5" /> Sales team member? Sign in at the sales portal
              </a>
            )}
            {!isTeamLinkHidden(door) && (
              <a
                href={TEAM_LOGIN_URL}
                className="w-full text-[11.5px] font-semibold text-dmk-text-muted hover:text-dmk-blue flex items-center justify-center gap-1.5 transition-colors"
              >
                <Users className="h-3.5 w-3.5" /> Verification team member? Sign in at the team portal
              </a>
            )}
          </div>
        </div>
      </div>
      <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60 py-3 text-center">
        <p className="text-[11px] text-dmk-text-muted">DMK Mart ERP · AI-Native Trading, Distribution &amp; Bookkeeping Platform</p>
      </footer>
    </div>
  );
}

// ─── Owner door — username pinned to Kunal, password picks the account ──

function OwnerDoor({
  firms,
  onSignedIn,
  onPickFirm,
}: {
  firms: Firm[];
  firmsLoaded: boolean;
  onSignedIn: (s: ErpSession) => void;
  onPickFirm: (id: string) => void;
}) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [registerOpen, setRegisterOpen] = React.useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ firm: { id: string; firmName: string } }>("/api/v1/auth/owner-login", {
        username: OWNER_USERNAME,
        password,
        // disambiguates legacy accounts that still share the default password
        preferFirmId: useErpStore.getState().activeFirmId ?? firms[0]?.id ?? "",
      });
      onPickFirm(res.firm.id);
      onSignedIn({ role: "OWNER", firmId: res.firm.id, firmName: res.firm.firmName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Creating an account signs straight into the new company workspace.
  async function handleCreated(firm: { id: string; firmName: string }, pw: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ firm: { id: string; firmName: string } }>("/api/v1/auth/owner-login", {
        username: OWNER_USERNAME,
        password: pw,
        preferFirmId: firm.id,
      });
      onPickFirm(res.firm.id);
      onSignedIn({ role: "OWNER", firmId: res.firm.id, firmName: res.firm.firmName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Account created — sign in with your new password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={signIn} className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="owner-username" className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">
          Username
        </Label>
        <div className="relative">
          <CircleUser className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-yellow" />
          <Input
            id="owner-username"
            value={OWNER_USERNAME}
            readOnly
            aria-readonly="true"
            className="pl-9 h-11 bg-dmk-input-well/60 border-dmk-border-subtle text-[14px] font-semibold text-dmk-text-primary cursor-default select-all"
          />
        </div>
        <p className="text-[10.5px] text-dmk-text-muted">Every company account opens with this same username.</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Company password"
            className="pl-9 h-11 bg-dmk-input-well border-dmk-border-subtle text-[14px] tracking-widest"
            aria-label="Company password"
            autoFocus
          />
        </div>
        <p className="text-[10.5px] text-dmk-text-muted">Your password identifies the company account that opens.</p>
      </div>

      {error && <p className="text-[12px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2">{error}</p>}

      <Button type="submit" disabled={busy || !password} className="w-full h-11 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold text-[13.5px]">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        Sign in to workspace
      </Button>

      <button
        type="button"
        onClick={() => setRegisterOpen(true)}
        className="w-full text-[12px] font-semibold text-dmk-yellow hover:underline flex items-center justify-center gap-1.5 py-1"
      >
        <Plus className="h-3.5 w-3.5" /> Create new company account
      </button>

      <p className="text-[10.5px] text-dmk-text-muted text-center leading-relaxed">
        Default owner password is <span className="font-mono text-dmk-text-secondary">1234</span> · team members sign in at{" "}
        <span className="font-mono text-dmk-text-secondary">/team</span>
      </p>

      <RegisterFirmDialog open={registerOpen} onOpenChange={setRegisterOpen} onCreated={handleCreated} />
    </form>
  );
}

// ─── Team door ────────────────────────────────────────────────────

function TeamDoor({ onSignedIn }: { onSignedIn: (s: ErpSession) => void }) {
  const { firms } = useErpStore();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{
        staff: { id: string; name: string; username: string; role: string };
        firm: { id: string; firmName: string };
      }>("/api/v1/verification/login", { username, password });
      onSignedIn({
        role: "TEAM",
        firmId: res.firm.id,
        firmName: res.firm.firmName,
        staffId: res.staff.id,
        staffName: res.staff.name,
        staffUsername: res.staff.username,
        // Portal role (VERIFIER | SUPERVISOR | DRIVER) — picks which team
        // screen renders: drivers get the delivery trip view.
        staffRole: res.staff.role,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={signIn} className="mt-5 space-y-4">
      <div className="rounded-lg border border-dmk-blue/30 bg-dmk-blue/10 px-3 py-2.5 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-dmk-blue mt-0.5 shrink-0" />
        <p className="text-[11.5px] leading-relaxed text-dmk-text-secondary">
          Team accounts are created by the owner from the owner portal. This door opens the dedicated{" "}
          <span className="font-semibold text-dmk-text-primary">goods verification portal</span> — counts only, no money.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Username</Label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. ravi"
          className="h-11 bg-dmk-input-well border-dmk-border-subtle text-[14px]"
          aria-label="Team username"
          autoComplete="username"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••"
            className="pl-9 h-11 bg-dmk-input-well border-dmk-border-subtle text-[14px] tracking-widest"
            aria-label="Team password"
          />
        </div>
      </div>

      {error && <p className="text-[12px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2">{error}</p>}

      <Button type="submit" disabled={busy || !username || !password} className="w-full h-11 bg-dmk-blue text-white hover:bg-dmk-blue/90 font-bold text-[13.5px]">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
        Open verification portal
      </Button>
      {firms.length === 0 && <p className="text-[10.5px] text-dmk-text-muted text-center">Create a company first — team accounts belong to a company.</p>}
    </form>
  );
}

// ─── Sales door — dedicated /sales workspace for sales staff ──────

function SalesDoor({ onSignedIn }: { onSignedIn: (s: ErpSession) => void }) {
  const { firms, setFirms, setActiveFirm } = useErpStore();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (firms.length === 0) {
      apiGet<Firm[]>("/api/v1/firms")
        .then((list) => setFirms(list ?? []))
        .catch(() => undefined);
    }
  }, [firms.length, setFirms]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{
        member: {
          id: string;
          fullName: string;
          username: string;
          permissions: SalesPermissions;
        };
        firm: { id: string; firmName: string };
      }>("/api/v1/sales-team/login", { username, password });
      setActiveFirm(res.firm.id);
      onSignedIn({
        role: "SALES",
        firmId: res.firm.id,
        firmName: res.firm.firmName,
        salesId: res.member.id,
        salesName: res.member.fullName,
        salesUsername: res.member.username,
        // Snapshot of the owner's section toggles — the portal sidebar
        // and every view gate themselves against this snapshot.
        salesPerms: res.member.permissions,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={signIn} className="mt-5 space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
        <p className="text-[11.5px] leading-relaxed text-dmk-text-secondary">
          Sales accounts are created by the owner from{" "}
          <span className="font-semibold text-dmk-text-primary">Settings → Sales Team</span>. Your sidebar shows exactly the
          sections the owner enabled for you — purchases, costs and accounts stay private.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Username</Label>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. rahul.sales"
          className="h-11 bg-dmk-input-well border-dmk-border-subtle text-[14px]"
          aria-label="Sales username"
          autoComplete="username"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••"
            className="pl-9 h-11 bg-dmk-input-well border-dmk-border-subtle text-[14px] tracking-widest"
            aria-label="Sales password"
          />
        </div>
      </div>

      {error && <p className="text-[12px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2">{error}</p>}

      <Button type="submit" disabled={busy || !username || !password} className="w-full h-11 bg-emerald-500 text-[#06281B] hover:bg-emerald-500/90 font-bold text-[13.5px]">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
        Open sales workspace
      </Button>
      {firms.length === 0 && <p className="text-[10.5px] text-dmk-text-muted text-center">Create a company first — sales accounts belong to a company.</p>}
    </form>
  );
}

// ─── Create company account — same username, new password ────────

function RegisterFirmDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (firm: { id: string; firmName: string }, password: string) => void;
}) {
  const { setFirms } = useErpStore();
  const [form, setForm] = React.useState({ firmName: "", firmCode: "", password: "", confirm: "", gstin: "", phone: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const passwordsMatch = form.password.length >= 4 && form.password === form.confirm;
  const canCreate = form.firmName.trim() !== "" && form.firmCode.trim() !== "" && passwordsMatch && !busy;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ firm: { id: string; firmName: string; firmCode: string } }>("/api/v1/auth/register-firm", {
        firmName: form.firmName.trim(),
        firmCode: form.firmCode.trim(),
        password: form.password,
        gstin: form.gstin,
        phone: form.phone,
      });
      const list = await apiGet<Firm[]>("/api/v1/firms");
      setFirms(list ?? []);
      onOpenChange(false);
      setForm({ firmName: "", firmCode: "", password: "", confirm: "", gstin: "", phone: "" });
      onCreated(res.firm, form.password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the company account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-card">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary">Create company account</DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            A fully isolated workspace — its own books, stock, team and owner password.
          </DialogDescription>
        </DialogHeader>

        {/* Fixed username banner — Kunal for every account */}
        <div className="rounded-lg border border-dmk-yellow/30 bg-dmk-yellow/10 px-3 py-2.5 flex items-center gap-2">
          <CircleUser className="h-4 w-4 text-dmk-yellow shrink-0" />
          <p className="text-[11.5px] leading-relaxed text-dmk-text-secondary">
            Username stays <span className="font-bold text-dmk-text-primary">{OWNER_USERNAME}</span> for every company account — only
            the password changes.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Company name</Label>
            <Input value={form.firmName} onChange={set("firmName")} placeholder="DMK Mart" className="h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Firm code</Label>
            <Input value={form.firmCode} onChange={set("firmCode")} placeholder="DMK" className="h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px] uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Username</Label>
            <Input value={OWNER_USERNAME} readOnly aria-readonly="true" className="h-10 bg-dmk-input-well/60 border-dmk-border-subtle text-[13px] font-semibold text-dmk-text-primary cursor-default" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">New password</Label>
            <Input type="password" value={form.password} onChange={set("password")} placeholder="min 4 chars" className="h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px]" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Confirm password</Label>
            <Input
              type="password"
              value={form.confirm}
              onChange={set("confirm")}
              placeholder="repeat password"
              className={cn(
                "h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px]",
                form.confirm !== "" && !passwordsMatch && "border-dmk-danger/60"
              )}
              autoComplete="new-password"
            />
            {form.confirm !== "" && !passwordsMatch && <p className="text-[10.5px] text-dmk-danger">Passwords don&apos;t match yet.</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">GSTIN (optional)</Label>
            <Input value={form.gstin} onChange={set("gstin")} className="h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">Phone (optional)</Label>
            <Input value={form.phone} onChange={set("phone")} className="h-10 bg-dmk-input-well border-dmk-border-subtle text-[13px]" />
          </div>
        </div>
        {error && <p className="text-[12px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2 mt-3">{error}</p>}
        <Button onClick={create} disabled={!canCreate} className="w-full h-10 mt-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create company &amp; open workspace
        </Button>
      </DialogContent>
    </Dialog>
  );
}
