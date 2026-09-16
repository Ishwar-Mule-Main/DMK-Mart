// ═══════════════════════════════════════════════════════════════
// /api/v1/estimates/[id] — estimate detail + delete
// GET    → full estimate (items ordered by slNo)
// DELETE → remove a non-ledger document (no journals/stock involved)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";

// ─── GET — detail ────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const estimate = await db.estimate.findUnique({
      where: { id },
      include: { items: { orderBy: { slNo: "asc" } } },
    });
    if (!estimate) throw new BusinessError("EST_NOT_FOUND", "Estimate not found", 404);

    return ok({
      estimate: {
        ...estimate,
        totalQty: Number(estimate.totalQty),
        totalAmount: Number(estimate.totalAmount),
        items: estimate.items.map((it) => ({ ...it, rate: Number(it.rate), amount: Number(it.amount) })),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─── DELETE — remove ─────────────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.estimate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new BusinessError("EST_NOT_FOUND", "Estimate not found", 404);
    await db.estimate.delete({ where: { id } });
    return ok({ deleted: id });
  } catch (err) {
    return handleApiError(err);
  }
}
