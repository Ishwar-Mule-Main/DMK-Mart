"use client";

// ═══════════════════════════════════════════════════════════════
// INV-SYNC — the 30/60-minute re-check engine, controlled.
// Settings (cadence, auto-sync, webhook push) · run-now ·
// scheduler heartbeat · durable SyncLog audit trail.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { invGet, invPost, invPatch, timeAgo, type SyncLogRow, type InvSessionInfo } from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RefreshCw, Play, Activity, Clock, Webhook, Loader2, CircleCheck, CircleX, CircleDashed } from "lucide-react";

interface SyncSetting {
  intervalMin: number;
  autoSync: boolean;
  pushWebhook: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}
interface SchedulerInfo {
  startedAt: string | null;
  lastHeartbeat: string | null;
  ticks: number;
  runs: number;
  running: boolean;
  lastError: string | null;
}

export function InvSync({ session }: { session: InvSessionInfo }) {
  const { toast } = useToast();
  const [setting, setSetting] = React.useState<SyncSetting | null>(null);
  const [scheduler, setScheduler] = React.useState<SchedulerInfo | null>(null);
  const [logs, setLogs] = React.useState<SyncLogRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        invGet<{ setting: SyncSetting; scheduler: SchedulerInfo }>("/api/v1/inventory/sync/settings"),
        invGet<{ logs: SyncLogRow[] }>("/api/v1/inventory/sync/logs", { limit: 60 }),
      ]);
      setSetting(s.setting);
      setScheduler(s.scheduler);
      setLogs(l.logs);
    } catch (e) {
      toast({ title: "Load failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  async function patch(body: Record<string, unknown>, label: string) {
    try {
      const r = await invPatch<{ setting: SyncSetting }>("/api/v1/inventory/sync/settings", body);
      setSetting(r.setting);
      toast({ title: label });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const r = await invPost<{ summary: { renamed: number; rollupChecked: number; rollupFixed: number; pushedTo: Array<{ portal: string; pushed: number; ok: boolean }> }; message: string }>("/api/v1/inventory/sync/run");
      toast({ title: "Reconciliation complete", description: r.message });
      await load();
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Sync Center</h1>
          <p className="text-[12px] text-dmk-text-muted mt-0.5">The universal re-check: catalog naming, warehouse↔total rollups and platform pushes.</p>
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={runNow} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run now
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Cadence</p>
            <Clock className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
          </div>
          {setting === null ? <Skeleton className="h-7 w-16 mt-2" /> : (
            <div className="mt-2 flex items-center gap-1.5">
              {[30, 60].map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ intervalMin: m }, `Re-check every ${m} minutes`)}
                  className={cn(
                    "dmk-badge h-7 px-2.5 text-[11px] font-bold transition-colors",
                    setting.intervalMin === m ? "bg-dmk-yellow text-black" : "bg-dmk-hover text-dmk-text-muted hover:text-dmk-text-primary"
                  )}
                  aria-pressed={setting.intervalMin === m}
                >
                  {m} min
                </button>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10.5px] text-dmk-text-muted">Auto re-check interval for all platforms</p>
        </div>

        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Auto-sync</p>
            <Activity className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
          </div>
          {setting === null ? <Skeleton className="h-7 w-16 mt-2" /> : (
            <button
              onClick={() => patch({ autoSync: !setting.autoSync }, setting.autoSync ? "Auto-sync paused" : "Auto-sync resumed")}
              className={cn("mt-2 dmk-badge h-7 px-2.5 text-[11px] font-bold", setting.autoSync ? "dmk-badge-success" : "bg-amber-500/15 text-amber-400")}
              aria-pressed={setting.autoSync}
            >
              {setting.autoSync ? "RUNNING" : "PAUSED"}
            </button>
          )}
          <p className="mt-1.5 text-[10.5px] text-dmk-text-muted">
            Next pass {setting?.nextRunAt ? new Date(setting.nextRunAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"} · last {timeAgo(setting?.lastRunAt)}
          </p>
        </div>

        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Webhook push</p>
            <Webhook className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
          </div>
          {setting === null ? <Skeleton className="h-7 w-16 mt-2" /> : (
            <button
              onClick={() => patch({ pushWebhook: !setting.pushWebhook }, setting.pushWebhook ? "Push disabled — pull mode only" : "Push enabled")}
              className={cn("mt-2 dmk-badge h-7 px-2.5 text-[11px] font-bold", setting.pushWebhook ? "dmk-badge-success" : "bg-dmk-hover text-dmk-text-muted")}
              aria-pressed={setting.pushWebhook}
            >
              {setting.pushWebhook ? "PUSH ON" : "PULL ONLY"}
            </button>
          )}
          <p className="mt-1.5 text-[10.5px] text-dmk-text-muted">Push catalog deltas to registered webhooks</p>
        </div>

        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Engine</p>
            <RefreshCw className={cn("h-4 w-4", scheduler?.running ? "text-dmk-blue animate-spin" : "text-dmk-yellow")} strokeWidth={1.75} />
          </div>
          <p className="mt-2 text-[15px] font-black text-dmk-text-primary">
            {scheduler ? `${scheduler.ticks} ticks` : "—"}
          </p>
          <p className="mt-1.5 text-[10.5px] text-dmk-text-muted">
            {scheduler?.running ? "pass in progress · " : ""}{scheduler?.lastError ? <span className="text-red-400">error: {scheduler.lastError}</span> : `heartbeat ${timeAgo(scheduler?.lastHeartbeat)}`}
          </p>
        </div>
      </div>

      {/* Log trail */}
      <div className="dmk-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13.5px] font-bold text-dmk-text-primary">Sync audit trail</p>
          <span className="text-[10.5px] text-dmk-text-muted">durable — survives restarts</span>
        </div>
        {logs === null ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
        ) : logs.length === 0 ? (
          <p className="dmk-well rounded-lg p-6 text-center text-[12px] text-dmk-text-muted">
            No sync runs yet. Press “Run now”, or wait for the next scheduled pass.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            {logs.map((l) => (
              <div key={l.id} className="dmk-well rounded-lg px-3 py-2 flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {l.status === "OK" ? <CircleCheck className="h-3.5 w-3.5 text-emerald-400" /> : l.status === "ERROR" ? <CircleX className="h-3.5 w-3.5 text-red-400" /> : l.status === "PARTIAL" ? <CircleDashed className="h-3.5 w-3.5 text-amber-400" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-dmk-blue" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[11.5px] font-bold text-dmk-text-primary">{l.action}</span>
                    <span className="dmk-badge h-4.5 px-1.5 text-[9px]">{l.trigger}</span>
                    <span className="dmk-badge h-4.5 px-1.5 text-[9px]">{l.direction}</span>
                    {l.portalName && <span className="text-[10.5px] text-dmk-blue">{l.portalName}</span>}
                    <span className="ml-auto text-[10px] text-dmk-text-muted shrink-0">{timeAgo(l.startedAt)}{l.durationMs ? ` · ${l.durationMs}ms` : ""}</span>
                  </div>
                  {l.message && <p className="mt-0.5 text-[11px] text-dmk-text-muted truncate">{l.message}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10.5px] text-dmk-text-muted text-center">
        Signed in as {session.username} · the engine also runs fully unattended inside the server (60 s watchdog tick)
      </p>
    </div>
  );
}
