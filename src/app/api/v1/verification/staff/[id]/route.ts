// ═══════════════════════════════════════════════════════════════
// PATCH+DELETE /api/v1/verification/staff/[id] — owner portal manages
// each team account: rename, reset password, activate/deactivate.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { hashPasswordAsync, notifyRealtime } from "@/app/api/v1/_lib/verification";
import { moveToTrash } from "@/app/api/v1/_lib/trash";

const STAFF_SELECT = {
  id: true,
  firmId: true,
  name: true,
  username: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  _count: { select: { verifications: true, submissions: true } },
} as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const existing = await db.verificationStaff.findUnique({ where: { id } });
    if (!existing) throw new BusinessError("ERR_NOT_FOUND", "Team account not found", 404);

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = getStr(body.name);
    if (body.phone !== undefined) data.phone = getStr(body.phone);
    if (body.role !== undefined) data.role = getStr(body.role) || existing.role;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.password !== undefined) {
      const pw = getStr(body.password);
      if (pw.length < 4) throw new BusinessError("ERR_VALIDATION", "Password must be at least 4 characters", 400);
      data.passwordHash = await hashPasswordAsync(pw);
    }
    if (body.username !== undefined) {
      const username = getStr(body.username).toLowerCase().trim();
      if (username !== existing.username) {
        const dupe = await db.verificationStaff.findFirst({
          where: { firmId: existing.firmId, username },
        });
        if (dupe) throw new BusinessError("ERR_DUPLICATE_USERNAME", `Username "${username}" is taken`, 409);
        data.username = username;
      }
    }

    const staff = await db.verificationStaff.update({ where: { id }, data, select: STAFF_SELECT });
    await notifyRealtime(existing.firmId, "staff:update", { kind: "updated", name: staff.name });
    return ok(staff);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE = deactivate (soft) — keeps verification history intact.
 *  Snapshotted to the Deleted Data bin so the owner can restore it. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.verificationStaff.findUnique({ where: { id } });
    if (!existing) throw new BusinessError("ERR_NOT_FOUND", "Team account not found", 404);
    await moveToTrash({
      firmId: existing.firmId,
      entityType: "VERIFICATION_STAFF",
      entityId: existing.id,
      label: existing.name,
      meta: `@${existing.username} · ${existing.role}`,
      snapshot: existing,
    });
    const staff = await db.verificationStaff.update({
      where: { id },
      data: { isActive: false },
      select: STAFF_SELECT,
    });
    await notifyRealtime(existing.firmId, "staff:update", { kind: "deactivated", name: staff.name });
    return ok(staff);
  } catch (e) {
    return handleApiError(e);
  }
}
