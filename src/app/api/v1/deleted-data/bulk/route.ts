// ═══════════════════════════════════════════════════════════════
// POST /api/v1/deleted-data/bulk — bin-wide operations.
//   { action: "restore-all" }  → restore every in-bin item (per-item
//                                success/failure, conflicts skipped)
//   { action: "empty-bin" }    → purge every in-bin item forever
// An optional entityType narrows the sweep to one folder (e.g. empty
// only the PRODUCT folder).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { isTrashEntityType, purgeFromTrash, restoreFromTrash } from "@/app/api/v1/_lib/trash";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    await resolveFirm(firmId);

    const action = getStr(body.action);
    if (action !== "restore-all" && action !== "empty-bin") {
      throw new BusinessError("ERR_VALIDATION", 'action must be "restore-all" or "empty-bin"', 400);
    }
    const type = getStr(body.entityType);
    if (type && !isTrashEntityType(type)) {
      throw new BusinessError("ERR_VALIDATION", `Unknown entity type "${type}"`, 400);
    }

    const items = await db.deletedRecord.findMany({
      where: {
        firmId,
        restoredAt: null,
        ...(type ? { entityType: type } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    let succeeded = 0;
    let failed = 0;
    const failures: Array<{ label: string; reason: string }> = [];

    for (const item of items) {
      try {
        if (action === "restore-all") {
          await restoreFromTrash(item.id);
        } else {
          await purgeFromTrash(item.id);
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        failures.push({
          label: item.label,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return ok({
      action,
      attempted: items.length,
      succeeded,
      failed,
      failures: failures.slice(0, 5),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
