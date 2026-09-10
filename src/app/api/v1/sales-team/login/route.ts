// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-team/login — dedicated /sales portal login.
// Body: { username, password, firmId? } — firmId optional when the
// username is unique across firms (single-firm installs).
// Returns the member with their owner-granted permission snapshot —
// the /sales sidebar builds itself from these booleans.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { verifyPasswordAsync } from "@/app/api/v1/_lib/verification";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const username = getStr(body.username).toLowerCase().trim();
    const password = getStr(body.password);
    const firmId = getStr(body.firmId);

    if (!username || !password) {
      throw new BusinessError("ERR_VALIDATION", "Username and password are required", 400);
    }

    const candidates = await db.salesMember.findMany({
      where: { username, isActive: true, ...(firmId ? { firmId } : {}) },
      include: { firm: { select: { id: true, firmName: true, firmCode: true, logoUrl: true } } },
    });
    if (candidates.length === 0) {
      throw new BusinessError("ERR_INVALID_CREDENTIALS", "No active sales account matches these credentials", 401);
    }

    let matched: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      if (await verifyPasswordAsync(password, c.passwordHash)) {
        matched = c;
        break;
      }
    }
    if (!matched) {
      throw new BusinessError("ERR_INVALID_CREDENTIALS", "Incorrect password", 401);
    }

    return ok({
      member: {
        id: matched.id,
        fullName: matched.fullName,
        username: matched.username,
        phone: matched.phone,
        assignedRouteId: matched.assignedRouteId,
        permissions: {
          canB2BBilling: matched.canB2BBilling,
          canB2CPos: matched.canB2CPos,
          canSalesOrders: matched.canSalesOrders,
          canManageCustomers: matched.canManageCustomers,
          canViewStock: matched.canViewStock,
          canViewInvoices: matched.canViewInvoices,
          canRecordReceipts: matched.canRecordReceipts,
          canOverridePrice: matched.canOverridePrice,
        },
      },
      firm: matched.firm,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
