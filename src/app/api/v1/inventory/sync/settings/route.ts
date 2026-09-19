// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/sync/settings — the 30/60-minute re-check
// cadence + auto-sync toggles. GET returns the scheduler heartbeat
// too so the portal can prove the background engine is alive.
// PATCH: { intervalMin: 30|60, autoSync, pushWebhook }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, BusinessError, getBool, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { ensureSyncSetting } from "@/lib/inventory-sync";
import { getSyncSchedulerState } from "@/lib/inventory-sync-scheduler";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const setting = await ensureSyncSetting(firm.id);
    return ok({ setting, scheduler: getSyncSchedulerState() });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const setting = await ensureSyncSetting(firm.id);

    let intervalMin = setting.intervalMin;
    if (body.intervalMin !== undefined) {
      const parsed = Number(body.intervalMin);
      if (![30, 60].includes(parsed)) {
        throw new BusinessError("ERR_VALIDATION", "intervalMin must be 30 or 60", 422);
      }
      intervalMin = parsed;
    }
    const nextRunAt = setting.lastRunAt && setting.nextRunAt
      ? new Date(Math.min(setting.nextRunAt.getTime(), Date.now() + intervalMin * 60 * 1000))
      : new Date(Date.now() + intervalMin * 60 * 1000);

    const updated = await db.inventorySyncSetting.update({
      where: { firmId: firm.id },
      data: {
        intervalMin,
        autoSync: body.autoSync === undefined ? setting.autoSync : getBool(body.autoSync),
        pushWebhook: body.pushWebhook === undefined ? setting.pushWebhook : getBool(body.pushWebhook),
        nextRunAt,
      },
    });
    return ok({ setting: updated, scheduler: getSyncSchedulerState() });
  } catch (e) {
    return handleApiError(e);
  }
}
