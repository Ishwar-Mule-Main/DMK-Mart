// ═══════════════════════════════════════════════════════════════
// POST /api/v1/verification/[id]/submit — team portal submission
// Body: { staffId, note?, items: [{ verificationItemId, sellableQty, damagedQty }] }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  asRecordArray,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { submitVerification } from "@/app/api/v1/_lib/verification";

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

    const result = await submitVerification(id, {
      items,
      note: getStr(body.note),
      staffId: getStr(body.staffId),
    });

    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
