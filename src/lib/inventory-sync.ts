// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY — SYNC ENGINE
// The 30/60-minute re-check that keeps every platform honest:
//   1. Canonical naming — any product missing its
//      "Brand Name + Product Name" file-name stamp gets one.
//   2. Warehouse↔total rollup invariant (Σ rows == Product total).
//   3. Outbound push — new/updated products since each portal's
//      last sync are POSTed to its registered webhook URL.
//   4. Everything lands in SyncLog (durable audit trail).
//
// Runs in-process from src/instrumentation.ts (nodejs runtime),
// singleton-guarded, kill-switch DMK_SYNC_SCHEDULER=off.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { publicProductView } from "@/app/api/universal/v1/_lib/portal";
import { canonicalImageFileName, reconcileWarehouseRollup } from "@/app/api/v1/inventory/_lib/inventory";

export interface ReconcileSummary {
  firmId: string;
  trigger: "AUTO" | "MANUAL";
  renamed: number;
  rollupChecked: number;
  rollupFixed: number;
  pushedTo: Array<{ portal: string; pushed: number; ok: boolean; detail: string }>;
  durationMs: number;
}

/** Durable audit row for one sync action. */
export async function logSync(entry: {
  firmId: string;
  portalId?: string | null;
  portalName?: string;
  trigger?: "AUTO" | "MANUAL" | "API";
  direction?: "INBOUND" | "OUTBOUND" | "RECONCILE";
  action: string;
  productsSeen?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  status?: "RUNNING" | "OK" | "PARTIAL" | "ERROR";
  message?: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}) {
  try {
    return await db.syncLog.create({
      data: {
        firmId: entry.firmId,
        portalId: entry.portalId ?? null,
        portalName: entry.portalName ?? "",
        trigger: entry.trigger ?? "AUTO",
        direction: entry.direction ?? "RECONCILE",
        action: entry.action,
        productsSeen: entry.productsSeen ?? 0,
        created: entry.created ?? 0,
        updated: entry.updated ?? 0,
        skipped: entry.skipped ?? 0,
        status: entry.status ?? "OK",
        message: (entry.message ?? "").slice(0, 500),
        startedAt: entry.startedAt ?? new Date(),
        finishedAt: entry.finishedAt ?? null,
        durationMs: entry.durationMs ?? null,
      },
    });
  } catch (e) {
    console.error("[inventory-sync] logSync failed:", e);
    return null;
  }
}

export async function ensureSyncSetting(firmId: string) {
  const existing = await db.inventorySyncSetting.findUnique({ where: { firmId } });
  if (existing) return existing;
  return db.inventorySyncSetting.create({
    data: { firmId, intervalMin: 30, autoSync: true, pushWebhook: true, nextRunAt: new Date(Date.now() + 30 * 60 * 1000) },
  });
}

/** One full reconciliation pass for a firm. Never throws. */
export async function runUniversalReconcile(firmId: string, trigger: "AUTO" | "MANUAL" = "AUTO"): Promise<ReconcileSummary> {
  const startedAt = new Date();
  const t0 = Date.now();
  const summary: ReconcileSummary = { firmId, trigger, renamed: 0, rollupChecked: 0, rollupFixed: 0, pushedTo: [], durationMs: 0 };

  const log = await logSync({ firmId, trigger, action: "FULL_RECONCILE", status: "RUNNING", startedAt });

  try {
    // 1 — canonical file-name stamp for unnamed products
    const unnamed = await db.product.findMany({
      where: { firmId, imageFileName: "" },
      select: { id: true, name: true, brand: true, photoUrl: true },
      take: 1000,
    });
    for (const p of unnamed) {
      const canonical = canonicalImageFileName(p.brand, p.name, p.photoUrl);
      await db.product.update({ where: { id: p.id }, data: { imageFileName: canonical } });
      summary.renamed += 1;
    }

    // 2 — warehouse↔total invariant (batched; the remainder catches the next tick)
    const rollup = await reconcileWarehouseRollup(firmId, 500);
    summary.rollupChecked = rollup.checked;
    summary.rollupFixed = rollup.fixed;

    // 3 — outbound delta push to every auto-sync portal with a webhook
    const setting = await ensureSyncSetting(firmId);
    const portals = await db.integrationPortal.findMany({
      where: { firmId, status: "ACTIVE", autoSync: true },
    });
    for (const portal of portals) {
      if (!portal.webhookUrl) {
        summary.pushedTo.push({ portal: portal.name, pushed: 0, ok: true, detail: "no webhook configured — pull mode" });
        await db.integrationPortal.update({
          where: { id: portal.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: "OK", lastSyncMessage: "Pull mode (no webhook)" },
        });
        continue;
      }
      try {
        const delta = await db.product.findMany({
          where: {
            firmId,
            ...(portal.lastSyncAt ? { updatedAt: { gt: portal.lastSyncAt } } : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let okPush = false;
        let detail = "";
        try {
          const res = await fetch(portal.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": "outbound", "X-DMK-Source": "dmk-inventory" },
            body: JSON.stringify({
              type: "CATALOG_DELTA",
              source: "DMK Universal Inventory",
              generatedAt: new Date().toISOString(),
              changedCount: delta.length,
              products: delta.map(publicProductView),
            }),
            signal: controller.signal,
          });
          okPush = res.ok;
          detail = `HTTP ${res.status}`;
        } finally {
          clearTimeout(timer);
        }
        summary.pushedTo.push({ portal: portal.name, pushed: delta.length, ok: okPush, detail });
        await db.integrationPortal.update({
          where: { id: portal.id },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: okPush ? "OK" : "ERROR",
            lastSyncMessage: `Push ${delta.length} products — ${detail}`,
          },
        });
        await logSync({
          firmId, portalId: portal.id, portalName: portal.name, trigger,
          direction: "OUTBOUND", action: "PUSH_PRODUCTS",
          productsSeen: delta.length, status: okPush ? "OK" : "ERROR", message: detail,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        summary.pushedTo.push({ portal: portal.name, pushed: 0, ok: false, detail });
        await db.integrationPortal.update({
          where: { id: portal.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: "ERROR", lastSyncMessage: detail.slice(0, 300) },
        });
        await logSync({ firmId, portalId: portal.id, portalName: portal.name, trigger, direction: "OUTBOUND", action: "PUSH_PRODUCTS", status: "ERROR", message: detail });
      }
    }

    // 4 — close the log + arm the next run
    summary.durationMs = Date.now() - t0;
    const intervalMin = Math.max(5, Math.min(720, setting.intervalMin || 30));
    await db.inventorySyncSetting.update({
      where: { firmId },
      data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + intervalMin * 60 * 1000) },
    });
    if (log) {
      await db.syncLog.update({
        where: { id: log.id },
        data: {
          status: summary.pushedTo.some((p) => !p.ok) ? "PARTIAL" : "OK",
          message: `renamed ${summary.renamed} · rollup fixed ${summary.rollupFixed}/${summary.rollupChecked} · pushed ${summary.pushedTo.map((p) => `${p.portal}:${p.pushed}`).join(", ") || "nobody"}`,
          finishedAt: new Date(),
          durationMs: summary.durationMs,
          productsSeen: summary.rollupChecked,
          updated: summary.rollupFixed + summary.renamed,
        },
      });
    }
    return summary;
  } catch (e) {
    summary.durationMs = Date.now() - t0;
    const message = e instanceof Error ? e.message : String(e);
    if (log) {
      await db.syncLog.update({
        where: { id: log.id },
        data: { status: "ERROR", message: message.slice(0, 500), finishedAt: new Date(), durationMs: summary.durationMs },
      }).catch(() => undefined);
    }
    return summary;
  }
}
