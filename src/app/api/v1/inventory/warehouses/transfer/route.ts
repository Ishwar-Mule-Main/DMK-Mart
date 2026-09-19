// POST /api/v1/inventory/warehouses/transfer — move sellable units
// between two warehouses. The Product TOTAL never changes (other
// platforms stay untouched by internal placement).

import { NextRequest } from "next/server";
import { asRecord, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { moveWarehouseStock } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { session, firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const result = await moveWarehouseStock({
      firmId: firm.id,
      productId: getStr(body.productId).trim(),
      fromWarehouseId: getStr(body.fromWarehouseId).trim(),
      toWarehouseId: getStr(body.toWarehouseId).trim(),
      quantity: getNum(body.quantity, 0),
      notes: getStr(body.notes).trim() || `Transferred by ${session.username}`,
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
