"use client";

// ═══════════════════════════════════════════════════════════════
// DMK VERIFICATION PORTAL — the verification team's own workspace.
// A completely separate shell from the owner ERP: the team sees ONLY
// product names + ordered quantities, with two inputs per line —
// ACTUAL SELLABLE and DAMAGED. No prices, no totals, no money.
// Live-linked to the owner portal over the realtime bus (with a 15s
// polling heartbeat so the connection never truly breaks).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  PackageSearch,
  PackageCheck,
  PackageX,
  LogOut,
  Wifi,
  WifiOff,
  ScanSearch,
  ClipboardCheck,
  Undo2,
  History,
  RefreshCw,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useVerificationBus } from "@/hooks/use-verification-bus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/erp/shared";
import { EmptyState, LoadingRows, ErrorText } from "@/components/erp/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface TeamItem {
  id: string;
  productName: string;
  sku: string;
  unit: string;
  orderedQty: number;
  sellableQty: number | null;
  damagedQty: number | null;
}

interface QueueRow {
  id: string;
  status: "AWAITING_VERIFICATION" | "SUBMITTED";
  poNumber: string;
  poDate: string;
  vendorName: string;
  vendorType: string;
  notes: string;
  submittedAt: string | null;
  submittedByName: string | null;
  returnReason: string;
  submittedNote: string;
  itemCount: number;
  totalOrdered: number;
  items: TeamItem[];
}

export function VerificationPortal() {
  const session = useErpStore((s) => s.session);
  const logout = useErpStore((s) => s.logout);
  const firmId = session?.firmId ?? null;
  const { toast } = useToast();
  const { connected, tick } = useVerificationBus(firmId);

  const [queue, setQueue] = React.useState<QueueRow[] | null>(null);
  const [verifyOf, setVerifyOf] = React.useState<QueueRow | null>(null);

  const load = React.useCallback(async () => {
    if (!firmId) return;
    try {
      const list = await apiGet<QueueRow[]>("/api/v1/verification/team-queue", { firmId });
      setQueue(list ?? []);
    } catch (e) {
      if (e instanceof ApiError) {
        toast({ variant: "destructive", title: "Could not load the queue", description: e.message });
      }
    }
  }, [firmId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    if (!firmId) return;
    if (tick > 0) load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [tick, firmId, load]);

  const awaiting = (queue ?? []).filter((q) => q.status === "AWAITING_VERIFICATION");
  const submitted = (queue ?? []).filter((q) => q.status === "SUBMITTED");

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      {/* Portal header — distinct from owner chrome */}
      <header className="fixed top-0 inset-x-0 z-50 h-14 bg-[#0D1527]/95 backdrop-blur border-b-2 border-dmk-yellow/60">
        <div className="h-full px-3 sm:px-5 flex items-center gap-3">
          <img src="/dmk-logo.png" alt="DMK Mart logo" width={34} height={34} className="rounded-full" />
          <div className="leading-tight min-w-0">
            <p className="text-[13.5px] font-black text-dmk-text-primary truncate">
              DMK Verification Portal
            </p>
            <p className="text-[9.5px] uppercase tracking-[0.18em] text-dmk-yellow truncate">
              {session?.firmName} · goods-in checkpoint
            </p>
          </div>
          <div className="flex-1" />
          <span
            className={cn(
              "dmk-badge h-8 px-2.5 gap-1.5",
              connected ? "bg-dmk-success/15 text-dmk-success" : "bg-dmk-warning/15 text-dmk-warning"
            )}
            title={connected ? "Live link with owner portal" : "Reconnecting — polling keeps data fresh every 15s"}
          >
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{connected ? "OWNER LINK LIVE" : "RECONNECTING"}</span>
          </span>
          <div className="h-8 px-2.5 rounded-lg bg-dmk-input-well border border-dmk-border-subtle hidden sm:flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-dmk-blue/25 border border-dmk-blue/50 flex items-center justify-center text-[11px] font-bold text-dmk-blue">
              {(session?.staffName ?? "?").slice(0, 1)}
            </span>
            <span className="text-[12px] font-semibold text-dmk-text-primary">{session?.staffName}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50"
          >
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 mt-14 px-3 sm:px-5 py-4 max-w-[1200px] w-full mx-auto space-y-4">
        {/* Checkpoint KPIs — counts only */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 dmk-enter-stagger">
          <PortalKpi label="Waiting for you" value={String(awaiting.length)} icon={PackageSearch} tone="gold" />
          <PortalKpi label="Sent to owner" value={String(submitted.length)} icon={ClipboardCheck} tone="info" />
          <PortalKpi
            label="Units to count"
            value={String(awaiting.reduce((s, q) => s + q.totalOrdered, 0))}
            icon={ScanSearch}
            tone="default"
          />
          <PortalKpi
            label="Damaged found"
            value={String((queue ?? []).reduce((s, q) => s + q.items.reduce((x, i) => x + (i.damagedQty ?? 0), 0), 0))}
            icon={PackageX}
            tone="danger"
          />
        </div>

        <Tabs defaultValue="todo" className="space-y-4 dmk-enter">
          <TabsList className="bg-dmk-input-well border border-dmk-border-subtle h-10">
            <TabsTrigger value="todo" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-[#0A0F1D]">
              <PackageSearch className="h-4 w-4" /> To verify
              {awaiting.length > 0 && <span className="ml-1 rounded-full bg-dmk-danger px-1.5 text-[10px] font-bold text-white">{awaiting.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="done" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-[#0A0F1D]">
              <History className="h-4 w-4" /> Sent to owner
            </TabsTrigger>
          </TabsList>

          <TabsContent value="todo" className="mt-0">
            <QueueList
              rows={awaiting}
              loading={queue === null}
              emptyHint="New purchase orders arrive here the moment the owner raises them — count what the vendor delivered and submit."
              onVerify={setVerifyOf}
            />
          </TabsContent>

          <TabsContent value="done" className="mt-0">
            <QueueList
              rows={submitted}
              loading={queue === null}
              emptyHint="Nothing awaiting the owner's acceptance right now."
              onVerify={setVerifyOf}
              sentMode
            />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60">
        <div className="max-w-[1200px] mx-auto px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5">
          <p className="text-[11px] text-dmk-text-muted">DMK Verification Portal · counts only — pricing & books stay in the owner portal</p>
          <p className="text-[11px] text-dmk-text-muted flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3" /> live sync {connected ? "over realtime link" : "via 15s polling"}
          </p>
        </div>
      </footer>

      {verifyOf && <VerifyDialog row={verifyOf} onClose={() => setVerifyOf(null)} onDone={() => { setVerifyOf(null); load(); }} />}
    </div>
  );
}

// ─── KPI well ─────────────────────────────────────────────────────

function PortalKpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: "default" | "gold" | "info" | "danger";
}) {
  const toneCls = { default: "text-dmk-text-primary", gold: "text-dmk-yellow", info: "text-dmk-info", danger: "text-dmk-danger" }[tone];
  return (
    <div className="dmk-kpi p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{label}</span>
        <Icon className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />
      </div>
      <span className={cn("font-money text-[20px] font-semibold leading-none", toneCls)}>{value}</span>
    </div>
  );
}

// ─── Queue list ───────────────────────────────────────────────────

function QueueList({
  rows,
  loading,
  emptyHint,
  onVerify,
  sentMode,
}: {
  rows: QueueRow[];
  loading: boolean;
  emptyHint: string;
  onVerify: (r: QueueRow) => void;
  sentMode?: boolean;
}) {
  if (loading) {
    return (
      <div className="dmk-card overflow-hidden">
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="dmk-card">
        <EmptyState icon={sentMode ? History : PackageSearch} title={sentMode ? "Nothing sent yet" : "All clear"} hint={emptyHint} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      {rows.map((q) => (
        <section key={q.id} className="dmk-card p-4 min-w-0 dmk-enter">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-money text-[13.5px] font-bold text-dmk-gold">{q.poNumber}</span>
                {q.status === "AWAITING_VERIFICATION" ? (
                  q.returnReason ? (
                    <Badge tone="warning">
                      <Undo2 className="h-3 w-3" /> SENT BACK
                    </Badge>
                  ) : (
                    <Badge tone="warning">TO VERIFY</Badge>
                  )
                ) : (
                  <Badge tone="info">
                    <ClipboardCheck className="h-3 w-3" /> WITH OWNER
                  </Badge>
                )}
              </div>
              <p className="text-[12px] text-dmk-text-secondary truncate mt-0.5">
                {q.vendorName} · {q.vendorType} · {formatDate(q.poDate)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-money text-[15px] font-bold text-dmk-text-primary">{q.totalOrdered}</p>
              <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">units ordered</p>
            </div>
          </div>

          {q.returnReason && (
            <p className="mt-2 text-[11.5px] text-dmk-warning bg-dmk-warning/10 border border-dmk-warning/25 rounded-md px-2.5 py-1.5">
              Owner sent this back: {q.returnReason}
            </p>
          )}
          {q.status === "SUBMITTED" && (
            <p className="mt-2 text-[11.5px] text-dmk-info">
              Submitted {q.submittedAt ? formatDate(q.submittedAt) : ""} by {q.submittedByName ?? "you"} — waiting for the owner to accept.
            </p>
          )}

          {/* Items — product names + ordered qty ONLY */}
          <div className="mt-3 rounded-lg border border-dmk-border-subtle overflow-hidden">
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Ordered</th>
                  <th className="text-right">Sellable</th>
                  <th className="text-right">Damaged</th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <p className="text-[12.5px] font-medium whitespace-nowrap">{i.productName}</p>
                      <p className="text-[10.5px] text-dmk-text-muted font-money">{i.sku}</p>
                    </td>
                    <td className="num">{i.orderedQty} {i.unit}</td>
                    <td className="num text-dmk-success">{i.sellableQty ?? "—"}</td>
                    <td className={cn("num", (i.damagedQty ?? 0) > 0 ? "text-dmk-danger" : "")}>{i.damagedQty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {q.status === "AWAITING_VERIFICATION" && (
            <Button onClick={() => onVerify(q)} className="mt-3 w-full h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
              <PackageCheck className="h-4 w-4" /> Count & verify this delivery
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── Verify dialog — the two-input checkpoint ─────────────────────

function VerifyDialog({ row, onClose, onDone }: { row: QueueRow; onClose: () => void; onDone: () => void }) {
  const session = useErpStore((s) => s.session);
  const { toast } = useToast();
  const [sellable, setSellable] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(row.items.map((i) => [i.id, i.sellableQty ?? i.orderedQty]))
  );
  const [damaged, setDamaged] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(row.items.map((i) => [i.id, i.damagedQty ?? 0]))
  );
  const [note, setNote] = React.useState(row.submittedNote || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const over = row.items.filter((i) => (sellable[i.id] ?? 0) + (damaged[i.id] ?? 0) > i.orderedQty + 1e-9);
  const damagedTotal = row.items.reduce((s, i) => s + (damaged[i.id] ?? 0), 0);
  const valid = over.length === 0;

  async function submit() {
    if (!session?.staffId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/verification/${row.id}/submit`, {
        staffId: session.staffId,
        note,
        items: row.items.map((i) => ({
          verificationItemId: i.id,
          sellableQty: sellable[i.id] ?? 0,
          damagedQty: damaged[i.id] ?? 0,
        })),
      });
      toast({
        title: `Counts sent to owner — ${row.poNumber}`,
        description: damagedTotal > 0 ? `${damagedTotal} damaged unit(s) flagged for quarantine.` : "All sellable — the owner can now accept the delivery.",
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Submit failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
            <ScanSearch className="h-5 w-5 text-dmk-yellow" /> Verify delivery — {row.poNumber}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {row.vendorName} · entered the warehouse {formatDate(row.poDate)}. Enter what actually arrived — sellable vs damaged.
          </DialogDescription>
        </DialogHeader>

        <div className="dmk-well overflow-x-auto [&>*]:min-w-0">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right w-[86px]">Ordered</th>
                <th className="text-right w-[120px]">Actual sellable</th>
                <th className="text-right w-[120px]">Damaged</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((i) => {
                const total = (sellable[i.id] ?? 0) + (damaged[i.id] ?? 0);
                const isOver = total > i.orderedQty + 1e-9;
                return (
                  <tr key={i.id} className={cn(isOver && "bg-dmk-danger/5")}>
                    <td>
                      <p className="text-[12.5px] font-medium whitespace-nowrap">{i.productName}</p>
                      <p className="text-[10.5px] text-dmk-text-muted font-money">{i.sku} · {i.unit}</p>
                    </td>
                    <td className="num text-[13px]">{i.orderedQty}</td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={sellable[i.id] ?? 0}
                        onChange={(e) => setSellable((s) => ({ ...s, [i.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        className="h-9 text-right font-money text-[13px] bg-dmk-input-well border-dmk-border-subtle"
                        aria-label={`Actual sellable count for ${i.productName}`}
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={damaged[i.id] ?? 0}
                        onChange={(e) => setDamaged((s) => ({ ...s, [i.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        className={cn(
                          "h-9 text-right font-money text-[13px] bg-dmk-input-well border-dmk-border-subtle",
                          isOver ? "border-dmk-danger text-dmk-danger" : (damaged[i.id] ?? 0) > 0 ? "border-dmk-warning/60" : ""
                        )}
                        aria-label={`Damaged count for ${i.productName}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 text-[11.5px]">
          <span className="dmk-badge bg-dmk-success/15 text-dmk-success">
            <PackageCheck className="h-3 w-3" /> sellable {row.items.reduce((s, i) => s + (sellable[i.id] ?? 0), 0)}
          </span>
          <span className={cn("dmk-badge", damagedTotal > 0 ? "bg-dmk-danger/15 text-dmk-danger" : "bg-dmk-input-well text-dmk-text-muted")}>
            <PackageX className="h-3 w-3" /> damaged {damagedTotal}
          </span>
          <span className="text-dmk-text-muted">sellable + damaged cannot exceed ordered</span>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Note for the owner (optional)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 2 cartons crushed on one corner" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]" />
        </div>

        {over.length > 0 && (
          <ErrorText>
            {over.map((i) => `${i.productName}: ${totalOf(sellable, damaged, i)} / ${i.orderedQty}`).join(" · ")} — total exceeds the ordered quantity.
          </ErrorText>
        )}
        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="h-10 border-dmk-border-medium">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !valid} className="h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
            <ClipboardCheck className="h-4 w-4" /> {busy ? "Sending…" : "Send counts to owner"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function totalOf(sellable: Record<string, number>, damaged: Record<string, number>, i: { id: string }) {
  return (sellable[i.id] ?? 0) + (damaged[i.id] ?? 0);
}
