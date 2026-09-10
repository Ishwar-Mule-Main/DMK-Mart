// ═══════════════════════════════════════════════════════════════
// PATCH+DELETE /api/v1/sales-team/members/[id] — owner manages one
// sales account: rename, reset password, toggle permission switches,
// suspend/reactivate. DELETE = soft-deactivate + recycle-bin snapshot
// (attribution history stays intact and restorable).
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
import { hashPasswordAsync } from "@/app/api/v1/_lib/verification";
import { moveToTrash } from "@/app/api/v1/_lib/trash";

const MEMBER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  username: true,
  isActive: true,
  assignedRouteId: true,
  assignedRoute: { select: { id: true, name: true } },
  canB2BBilling: true,
  canB2CPos: true,
  canSalesOrders: true,
  canManageCustomers: true,
  canViewStock: true,
  canViewInvoices: true,
  canRecordReceipts: true,
  canOverridePrice: true,
  createdAt: true,
  _count: { select: { invoices: true, salesOrders: true, receipts: true, customersCreated: true } },
} as const;

const PERM_KEYS = [
  "canB2BBilling",
  "canB2CPos",
  "canSalesOrders",
  "canManageCustomers",
  "canViewStock",
  "canViewInvoices",
  "canRecordReceipts",
  "canOverridePrice",
] as const;

/** GET — member self-check used by the /sales portal to refresh the
 *  owner's permission toggles live (login-free: id is the secret-less
 *  lookup; password never leaves the server). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const member = await db.salesMember.findUnique({
      where: { id },
      select: MEMBER_SELECT,
    });
    if (!member) throw new BusinessError("ERR_NOT_FOUND", "Sales account not found", 404);
    return ok(member);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const existing = await db.salesMember.findUnique({ where: { id } });
    if (!existing) throw new BusinessError("ERR_NOT_FOUND", "Sales account not found", 404);

    const data: Record<string, unknown> = {};
    if (body.fullName !== undefined) data.fullName = getStr(body.fullName);
    if (body.phone !== undefined) data.phone = getStr(body.phone);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.password !== undefined) {
      const pw = getStr(body.password);
      if (pw.length < 4) throw new BusinessError("ERR_VALIDATION", "Password must be at least 4 characters", 400);
      data.passwordHash = await hashPasswordAsync(pw);
    }
    if (body.username !== undefined) {
      const username = getStr(body.username).toLowerCase().trim();
      if (username !== existing.username) {
        const dupe = await db.salesMember.findFirst({
          where: { firmId: existing.firmId, username },
        });
        if (dupe) throw new BusinessError("ERR_DUPLICATE_USERNAME", `Username "${username}" is taken`, 409);
        data.username = username;
      }
    }
    if (body.assignedRouteId !== undefined) {
      const assignedRouteId = getStr(body.assignedRouteId);
      if (assignedRouteId) {
        const route = await db.deliveryRoute.findFirst({
          where: { id: assignedRouteId, firmId: existing.firmId },
          select: { id: true },
        });
        if (!route) throw new BusinessError("ERR_VALIDATION", "Selected route does not exist in this firm", 422);
        data.assignedRouteId = assignedRouteId;
      } else {
        data.assignedRouteId = null;
      }
    }
    for (const key of PERM_KEYS) {
      if (body[key] !== undefined) data[key] = Boolean(body[key]);
    }

    const member = await db.salesMember.update({ where: { id }, data, select: MEMBER_SELECT });
    return ok(member);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE = suspend + bin snapshot — attribution history stays intact
 *  and the account can be restored from Deleted Data. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.salesMember.findUnique({ where: { id } });
    if (!existing) throw new BusinessError("ERR_NOT_FOUND", "Sales account not found", 404);
    await moveToTrash({
      firmId: existing.firmId,
      entityType: "SALES_MEMBER",
      entityId: existing.id,
      label: existing.fullName,
      meta: `@${existing.username} · /sales portal`,
      snapshot: existing,
    });
    const member = await db.salesMember.update({
      where: { id },
      data: { isActive: false },
      select: MEMBER_SELECT,
    });
    return ok(member);
  } catch (e) {
    return handleApiError(e);
  }
}
