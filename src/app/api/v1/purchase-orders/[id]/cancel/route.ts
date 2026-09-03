// ═══════════════════════════════════════════════════════════════
// /api/v1/purchase-orders/[id]/cancel — PENDING → CANCELLED
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const po = await db.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw new BusinessError("ERR_NOT_FOUND", "Purchase order not found", 404);
    if (po.status !== "PENDING") {
      throw new BusinessError(
        "ERR_INVALID_STATUS",
        `PO ${po.poNumber} is ${po.status} — only PENDING orders can be cancelled`,
        409
      );
    }

    const updated = await db.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: { items: true, vendor: { select: { id: true, vendorName: true } } },
    });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
