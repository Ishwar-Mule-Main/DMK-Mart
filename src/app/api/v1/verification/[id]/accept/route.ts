// ═══════════════════════════════════════════════════════════════
// POST /api/v1/verification/[id]/accept — OWNER submits the verified
// request → PO confirmed via GRN pipeline: stock IN (sellable +
// damaged quarantine), vendor payable, PURCHASE journal → the money
// reaches Finance & Accounting only at this moment.
// Body: { note?, vendorBillNo?, vendorBillDate?, items?: [...] }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  asRecordArray,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { acceptVerification } from "@/app/api/v1/_lib/verification";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));

    const items = asRecordArray(body.items).map((i) => ({
      verificationItemId: getStr(i.verificationItemId),
      sellableQty: getNum(i.sellableQty),
      damagedQty: getNum(i.damagedQty),
    }));

    const result = await acceptVerification(id, {
      ...(items.length > 0 ? { items } : {}),
      note: getStr(body.note),
      ...(body.vendorBillNo !== undefined || body.vendorBillDate !== undefined
        ? {
            vendorBillNo: getStr(body.vendorBillNo),
            vendorBillDate: getDateOrNull(body.vendorBillDate),
          }
        : {}),
    });

    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
