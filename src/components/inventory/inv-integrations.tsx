"use client";

// ═══════════════════════════════════════════════════════════════
// INV-INTEGRATIONS — registered platforms sharing this inventory.
// Register · rotate API keys (SHA-256 at rest, shown once) ·
// webhook health pings · suspension/revocation.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { invGet, invPost, invPatch, invDelete, timeAgo, type InvPortal } from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Plug, Plus, KeyRound, RefreshCcwDot, Radio, Copy, Loader2, ShieldCheck, Ban, CheckCircle2, XCircle, Store, Building2, ShoppingBag,
} from "lucide-react";

const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> = {
  ERP: { label: "DMK Mart ERP", icon: Building2 },
  B2B_STORE: { label: "B2B ecommerce platform", icon: Store },
  FRANCHISE_B2C: { label: "Franchise & B2C software", icon: ShoppingBag },
};

export function InvIntegrations() {
  const { toast } = useToast();
  const [portals, setPortals] = React.useState<InvPortal[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const d = await invGet<{ portals: InvPortal[] }>("/api/v1/inventory/integrations");
      setPortals(d.portals);
    } catch (e) {
      toast({ title: "Load failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setPortals([]);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Integrations</h1>
          <p className="text-[12px] text-dmk-text-muted mt-0.5">Every platform here reads the same products and the same totals — through its own API key.</p>
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Register platform
        </Button>
      </div>

      {portals === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : portals.length === 0 ? (
        <div className="dmk-card p-10 text-center">
          <Plug className="h-8 w-8 text-dmk-text-muted mx-auto" />
          <p className="mt-3 text-[13px] text-dmk-text-secondary">No platforms linked yet.</p>
          <p className="mt-1 text-[11.5px] text-dmk-text-muted">Follow the Setup Guide to connect the ERP, your B2B store and the Franchise/B2C software.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Register the first platform
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {portals.map((p) => (
            <PortalCard key={p.id} portal={p} onChanged={() => void load()} />
          ))}
        </div>
      )}

      <PortalCreate open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
    </div>
  );
}

function PortalCard({ portal, onChanged }: { portal: InvPortal; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const r = await invPost<{ apiKey: string; message: string }>(`/api/v1/inventory/integrations/${portal.id}/rotate-key`);
      await navigator.clipboard.writeText(r.apiKey).catch(() => undefined);
      toast({ title: "API key rotated", description: "New key copied to your clipboard — paste it into the platform now." });
      onChanged();
    } catch (e) {
      toast({ title: "Rotation failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const r = await invPost<{ reachable: boolean; detail: string }>(`/api/v1/inventory/integrations/${portal.id}/test`);
      toast({ title: r.reachable ? "Webhook reachable" : "No response", description: r.detail });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    setBusy(true);
    try {
      await invPatch(`/api/v1/inventory/integrations/${portal.id}`, { status: portal.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await invDelete(`/api/v1/inventory/integrations/${portal.id}`);
      toast({ title: `${portal.name} removed`, description: "Its API key stopped working immediately." });
      onChanged();
    } catch (e) {
      toast({ title: "Revoke failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const meta = KIND_META[portal.kind] ?? { label: portal.kind, icon: Plug };
  const Icon = meta.icon;

  return (
    <div className="dmk-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="h-9 w-9 rounded-lg bg-dmk-yellow/10 border border-dmk-yellow/25 flex items-center justify-center shrink-0">
            <Icon className="h-4.5 w-4.5 text-dmk-yellow" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[14px] font-bold text-dmk-text-primary">{portal.name}</p>
              <span className="dmk-badge h-5 px-1.5 text-[9.5px]">{meta.label}</span>
              <span className={cn("dmk-badge h-5 px-1.5 text-[9.5px]", portal.status === "ACTIVE" ? "dmk-badge-success" : "bg-amber-500/15 text-amber-400")}>
                {portal.status}
              </span>
              {portal.autoSync && <span className="dmk-badge h-5 px-1.5 gap-1 text-[9.5px] bg-dmk-blue/10 text-dmk-blue"><RefreshCcwDot className="h-3 w-3" /> AUTO-SYNC</span>}
            </div>
            <p className="mt-1 text-[11px] text-dmk-text-muted font-mono">{portal.apiKeyMasked}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-dmk-text-muted">
              <span className="inline-flex items-center gap-1">
                {portal.lastSyncStatus === "OK" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : portal.lastSyncStatus === "ERROR" ? <XCircle className="h-3 w-3 text-red-400" /> : <Radio className="h-3 w-3" />}
                Last sync {timeAgo(portal.lastSyncAt)}{portal.lastSyncMessage ? ` · ${portal.lastSyncMessage}` : ""}
              </span>
              {portal.webhookUrl && <span className="truncate max-w-[280px] font-mono text-[10px]">↗ {portal.webhookUrl}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={rotate} disabled={busy}>
            <KeyRound className="h-3 w-3" /> Rotate key
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={test} disabled={busy}>
            <Radio className="h-3 w-3" /> Ping webhook
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={toggleStatus} disabled={busy}>
            <Ban className="h-3 w-3" /> {portal.status === "ACTIVE" ? "Suspend" : "Activate"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={revoke} disabled={busy}>
            Revoke
          </Button>
        </div>
      </div>
    </div>
  );
}

function PortalCreate({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", kind: "ERP", baseUrl: "", webhookUrl: "", contactEmail: "", autoSync: true });

  async function create() {
    setBusy(true);
    try {
      const r = await invPost<{ apiKey: string; message: string }>("/api/v1/inventory/integrations", form);
      await navigator.clipboard.writeText(r.apiKey).catch(() => undefined);
      onCreated();
      onOpenChange(false);
      setForm({ name: "", kind: "ERP", baseUrl: "", webhookUrl: "", contactEmail: "", autoSync: true });
      setCreatedKey(r.apiKey);
    } catch (e) {
      toast({ title: "Registration failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const [createdKey, setCreatedKey] = React.useState<string | null>(null);

  // The one-time key reveal dialog
  if (createdKey) {
    return (
      <Dialog open onOpenChange={() => { setCreatedKey(null); onCreated(); }}>
        <DialogContent className="max-w-[520px] dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Platform registered — copy the key now
            </DialogTitle>
            <DialogDescription className="text-[11.5px]">
              This is the only time the full key is shown (only its SHA-256 hash is stored). It has been copied to your clipboard.
            </DialogDescription>
          </DialogHeader>
          <div className="dmk-well rounded-lg p-3 flex items-center gap-2">
            <code className="flex-1 font-mono text-[11.5px] text-dmk-yellow break-all">{createdKey}</code>
            <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-[10.5px]" onClick={() => { void navigator.clipboard.writeText(createdKey); toast({ title: "Copied" }); }}>
              <Copy className="h-3 w-3" /> Copy
            </Button>
          </div>
          <p className="text-[11px] text-dmk-text-muted">Next: open the Setup Guide and follow the steps for this platform&apos;s kind.</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[15px]">Register platform</DialogTitle>
          <DialogDescription className="text-[11.5px]">A unique API key is generated for this platform. Keys are stored hashed and shown once.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Platform name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="DMK B2B Store" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Kind</Label>
            <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Platform kind">
              {Object.entries(KIND_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Base URL (informational)</Label>
            <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder="https://b2b.dmkmart.in" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Webhook URL (for automatic pushes)</Label>
            <Input value={form.webhookUrl} onChange={(e) => setForm((f) => ({ ...f, webhookUrl: e.target.value }))} placeholder="https://b2b.dmkmart.in/api/dmk-inventory/sync" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Contact email</Label>
            <Input value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} placeholder="dev@dmkmart.in" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-dmk-text-secondary">
            <input type="checkbox" checked={form.autoSync} onChange={(e) => setForm((f) => ({ ...f, autoSync: e.target.checked }))} className="accent-[var(--accent-yellow)]" />
            Include in the automatic 30/60-min re-check
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" className="h-8 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={create} disabled={busy || !form.name.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Register &amp; generate key
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
