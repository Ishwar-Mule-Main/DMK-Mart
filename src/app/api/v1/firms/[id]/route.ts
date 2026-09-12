// ═══════════════════════════════════════════════════════════════
// /api/v1/firms/[id] — firm detail with entity counts + profile PATCH
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  getBool,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import {
  hashPasswordAsync,
  verifyPasswordAsync,
  assertPasswordAvailable,
} from "@/app/api/v1/_lib/verification";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const firm = await db.firm.findUnique({ where: { id } });
    if (!firm) throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found", 404);

    const [products, customers, vendors, invoices, purchaseOrders] = await Promise.all([
      db.product.count({ where: { firmId: id } }),
      db.customer.count({ where: { firmId: id } }),
      db.vendor.count({ where: { firmId: id } }),
      db.invoice.count({ where: { firmId: id } }),
      db.purchaseOrder.count({ where: { firmId: id } }),
    ]);

    // ownerPassword hash never leaves the server
    const { ownerPassword: _omit, ...safeFirm } = firm;
    return ok({
      firm: safeFirm,
      counts: { products, customers, vendors, invoices, purchaseOrders },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

const PATCHABLE = [
  "firmName",
  "gstin",
  "state",
  "stateCode",
  "address",
  "phone",
  "email",
  "bankName",
  "bankAccount",
  "ifsc",
  "upiId",
  "upiQrUrl",
  "financialYear",
  "invoicePrefix",
  "logoUrl",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const firm = await db.firm.findUnique({ where: { id } });
    if (!firm) throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found", 404);

    const data: Record<string, string> = {};
    for (const field of PATCHABLE) {
      if (body[field] !== undefined) {
        data[field] = getStr(body[field]);
      }
    }
    // autoCreateFy is the one boolean PATCH field (1-Apr auto-open toggle)
    if (body.autoCreateFy !== undefined) {
      (data as Record<string, unknown>).autoCreateFy = getBool(body.autoCreateFy);
    }
    if (data.gstin && /^\d{2}/.test(data.gstin) && !body.stateCode) {
      data.stateCode = data.gstin.slice(0, 2);
    }

    // ── Custom UPI scanner photo (Settings → UPI & Payment QR) ──
    // Empty string clears the override (drivers fall back to the QR
    // generated from upiId). Otherwise it must be an inline image
    // data URL — same Vercel-safe pattern as expense receipts.
    if (data.upiQrUrl && data.upiQrUrl !== "") {
      const qr = data.upiQrUrl;
      if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/.test(qr)) {
        throw new BusinessError("ERR_VALIDATION", "Payment QR must be a PNG, JPG or WebP image", 400);
      }
      if (qr.length > 4_500_000) {
        throw new BusinessError("ERR_VALIDATION", "Payment QR photo is too large — keep it under 3 MB", 400);
      }
    }

    // ── Owner password change (Settings → Owner Account) ──
    // Requires the current password; the new one must not collide with
    // another company account (passwords identify accounts).
    const newPassword = getStr(body.newPassword);
    if (newPassword) {
      const currentPassword = getStr(body.currentPassword);
      if (!currentPassword) {
        throw new BusinessError("ERR_VALIDATION", "Current password is required to change the password", 400);
      }
      if (!(await verifyPasswordAsync(currentPassword, firm.ownerPassword))) {
        throw new BusinessError("ERR_INVALID_CREDENTIALS", "Current password is incorrect", 401);
      }
      if (newPassword.length < 4) {
        throw new BusinessError("ERR_VALIDATION", "New password must be at least 4 characters", 400);
      }
      if (newPassword === currentPassword) {
        throw new BusinessError("ERR_VALIDATION", "New password must be different from the current password", 400);
      }
      await assertPasswordAvailable(newPassword, id);
      data.ownerPassword = await hashPasswordAsync(newPassword);
    }

    const updated = await db.firm.update({ where: { id }, data });
    // ownerPassword hash never leaves the server
    const { ownerPassword: _omit, ...safeFirm } = updated;
    return ok(safeFirm);
  } catch (e) {
    return handleApiError(e);
  }
}
