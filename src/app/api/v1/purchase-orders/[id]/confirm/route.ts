// ═══════════════════════════════════════════════════════════════
// /api/v1/purchase-orders/[id]/confirm — GRN (goods receipt note)
// PENDING → CONFIRMED: stock split (sellable + damaged quarantine),
// vendor payable + ledger row, balanced PURCHASE journal (R3/R6/R7)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  asRecordArray,
  getDate,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { confirmPurchaseOrder } from "@/app/api/v1/_lib/po";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const received = asRecordArray(body.received).map((r) => ({
      itemId: getStr(r.itemId),
      acceptedQty: getNum(r.acceptedQty),
      damagedQty: getNum(r.damagedQty),
    }));

    const result = await confirmPurchaseOrder(id, {
      received,
      receivedDate: getDate(body.receivedDate),
      note: getStr(body.note),
    });

    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
