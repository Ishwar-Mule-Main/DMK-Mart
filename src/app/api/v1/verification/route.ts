// ═══════════════════════════════════════════════════════════════
// GET /api/v1/verification — owner portal: all verification requests
// Auto-backfills requests for PENDING POs created before the system
// existed. Supports ?status= filter.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { ensurePoVerification } from "@/app/api/v1/_lib/verification";

export async function GET(request: NextRequest) {
  try {
    const firmId = request.nextUrl.searchParams.get("firmId");
    if (!firmId) return handleApiError(new Error("firmId is required"));
    const status = request.nextUrl.searchParams.get("status") || undefined;

    await ensurePoVerification(firmId);

    const rows = await db.poVerification.findMany({
      where: { firmId, ...(status ? { status } : {}) },
      include: {
        po: {
          include: {
            vendor: { select: { id: true, vendorName: true, vendorType: true } },
            items: { select: { id: true, quantity: true, unitCost: true, totalAmount: true } },
          },
        },
        submittedBy: { select: { id: true, name: true, username: true } },
        items: { orderBy: { productName: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok(rows);
  } catch (e) {
    return handleApiError(e);
  }
}
