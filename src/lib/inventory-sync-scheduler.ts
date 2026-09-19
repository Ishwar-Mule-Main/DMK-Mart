// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY — AUTO-SYNC SCHEDULER
// Ticks every 60 s; when a firm's InventorySyncSetting is due
// (30 or 60-minute cadence, autoSync on) it runs the full
// reconciliation pass. Singleton via globalThis — survives dev
// hot-reload. Kill switch: DMK_SYNC_SCHEDULER=off.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { runUniversalReconcile } from "@/lib/inventory-sync";

export const SYNC_TICK_MS = 60 * 1000;
const START_DELAY_MS = 30 * 1000;

interface SyncSchedulerState {
  startedAt: string | null;
  lastHeartbeat: string | null;
  ticks: number;
  runs: number;
  running: boolean;
  lastError: string | null;
  timer: ReturnType<typeof setInterval> | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __dmkSyncScheduler?: SyncSchedulerState };

function state(): SyncSchedulerState {
  if (!g.__dmkSyncScheduler) {
    g.__dmkSyncScheduler = {
      startedAt: null, lastHeartbeat: null, ticks: 0, runs: 0,
      running: false, lastError: null, timer: null, startupTimer: null,
    };
  }
  return g.__dmkSyncScheduler;
}

async function tick() {
  const s = state();
  s.lastHeartbeat = new Date().toISOString();
  s.ticks += 1;
  if (s.running) return;
  s.running = true;
  try {
    const due = await db.inventorySyncSetting.findMany({
      where: { autoSync: true, nextRunAt: { lte: new Date() } },
      select: { firmId: true },
    });
    for (const row of due) {
      const summary = await runUniversalReconcile(row.firmId, "AUTO");
      s.runs += 1;
      console.log(
        `[inventory-sync] AUTO pass firm=${row.firmId} renamed=${summary.renamed} rollup=${summary.rollupFixed}/${summary.rollupChecked} pushed=${summary.pushedTo.length} in ${summary.durationMs}ms`
      );
    }
    s.lastError = null;
  } catch (e) {
    s.lastError = e instanceof Error ? e.message : String(e);
    console.error("[inventory-sync] tick failed:", s.lastError);
  } finally {
    s.running = false;
  }
}

export function startSyncScheduler() {
  if (process.env.DMK_SYNC_SCHEDULER === "off") return;
  const s = state();
  if (s.timer) return; // already running
  s.startedAt = new Date().toISOString();
  s.startupTimer = setTimeout(() => {
    void tick();
    s.timer = setInterval(() => void tick(), SYNC_TICK_MS);
  }, START_DELAY_MS);
  console.log("[inventory-sync] auto-sync scheduler armed (60 s tick, cadence per firm 30/60 min)");
}

export function getSyncSchedulerState() {
  const s = state();
  return {
    startedAt: s.startedAt,
    lastHeartbeat: s.lastHeartbeat,
    ticks: s.ticks,
    runs: s.runs,
    running: s.running,
    lastError: s.lastError,
  };
}
