// ═══════════════════════════════════════════════════════════════
// /api/v1/vendors/[id] — detail (+ last 100 ledger rows) + patch
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
import { moveToTrash } from "@/app/api/v1/_lib/trash";

async function getVendorOr404(id: string) {
  const vendor = await db.vendor.findUnique({ where: { id } });
  if (!vendor) throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found", 404);
  return vendor;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendor = await getVendorOr404(id);

    const rows = await db.ledgerEntry.findMany({
      where: { firmId: vendor.firmId, vendorId: id },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const ledger = rows.reverse();

    return ok({ vendor, ledger });
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
    await getVendorOr404(id);
    const body = asRecord(await request.json().catch(() => ({})));

    const data: Record<string, string | boolean> = {};
    for (const field of ["vendorName", "brand", "gstin", "stateCode", "phone", "email", "address", "paymentTerms"]) {
      if (body[field] !== undefined) data[field] = getStr(body[field]);
    }
    if (body.vendorType !== undefined) {
      const vendorType = getStr(body.vendorType);
      if (!["MANUFACTURER", "DISTRIBUTOR"].includes(vendorType)) {
        throw new BusinessError("ERR_VALIDATION", "vendorType must be MANUFACTURER or DISTRIBUTOR", 400);
      }
      data.vendorType = vendorType;
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive === true || body.isActive === "true";
    }

    const updated = await db.vendor.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE = move to the Deleted Data bin + soft delete. Restorable from
 *  the Deleted Data view; POs/payments keep their history intact. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vendor = await getVendorOr404(id);
    await moveToTrash({
      firmId: vendor.firmId,
      entityType: "VENDOR",
      entityId: vendor.id,
      label: vendor.vendorName,
      meta: `${vendor.vendorType}${vendor.brand ? ` · ${vendor.brand}` : ""}${vendor.phone ? ` · ${vendor.phone}` : ""}`,
      snapshot: vendor,
    });
    const updated = await db.vendor.update({
      where: { id },
      data: { isActive: false },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
