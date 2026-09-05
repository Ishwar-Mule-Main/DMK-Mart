// ═══════════════════════════════════════════════════════════════
// /api/v1/customers/[id] — detail (+ last 100 ledger rows) + patch + delete
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { moveToTrash } from "@/app/api/v1/_lib/trash";

async function getCustomerOr404(id: string) {
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found", 404);
  return customer;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customer = await getCustomerOr404(id);

    const rows = await db.ledgerEntry.findMany({
      where: { firmId: customer.firmId, customerId: id },
      orderBy: { entryDate: "desc" },
      take: 100,
    });
    // Chronological order so balanceAfter chains read naturally
    const ledger = rows.reverse();

    return ok({ customer, ledger });
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
    const customer = await getCustomerOr404(id);
    const body = asRecord(await request.json().catch(() => ({})));

    const data: Record<string, string | number | boolean> = {};
    for (const field of ["firmName", "city", "gstin", "phone", "email", "address", "stateCode", "assignedTier"]) {
      if (body[field] !== undefined) data[field] = getStr(body[field]);
    }
    if (body.creditLimit !== undefined) {
      data.creditLimit = round2(getNum(body.creditLimit, customer.creditLimit));
    }
    if (body.creditDays !== undefined) {
      data.creditDays = Math.round(getNum(body.creditDays, customer.creditDays));
    }
    if (body.isActive !== undefined) {
      data.isActive = body.isActive === true || body.isActive === "true";
    }

    // R8: recompute location-first name when city / firmName change on B2B
    const newCity = data.city !== undefined ? String(data.city) : customer.city;
    const newFirmName = data.firmName !== undefined ? String(data.firmName) : customer.firmName;
    if (customer.customerType === "B2B" && (data.city !== undefined || data.firmName !== undefined)) {
      data.partyName = `${newCity} ${newFirmName}`.trim();
    } else if (customer.customerType === "B2C_COUNTER" && data.firmName !== undefined) {
      data.partyName = newFirmName.trim();
    }

    const updated = await db.customer.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE = move to the Deleted Data bin + soft delete (row is referenced
 *  by invoices/ledger forever). Restorable from the Deleted Data view. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customer = await getCustomerOr404(id);
    await moveToTrash({
      firmId: customer.firmId,
      entityType: "CUSTOMER",
      entityId: customer.id,
      label: customer.partyName,
      meta: `${customer.customerType === "B2C_COUNTER" ? "B2C Counter" : "B2B"}${customer.city ? ` · ${customer.city}` : ""}${customer.phone ? ` · ${customer.phone}` : ""}`,
      snapshot: customer,
    });
    const updated = await db.customer.update({
      where: { id },
      data: { isActive: false },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
