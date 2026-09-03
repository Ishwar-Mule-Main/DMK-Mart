// ═══════════════════════════════════════════════════════════════
// /api/v1/firms/[id] — firm detail with entity counts + profile PATCH
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

    return ok({
      firm,
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
    if (data.gstin && /^\d{2}/.test(data.gstin) && !body.stateCode) {
      data.stateCode = data.gstin.slice(0, 2);
    }

    const updated = await db.firm.update({ where: { id }, data });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
