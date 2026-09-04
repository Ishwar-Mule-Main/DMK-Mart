// ═══════════════════════════════════════════════════════════════
// GET /api/v1/verification/team-queue — verification team portal.
// Product NAMES + ORDERED QTY only — no prices, no totals, no money.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { ensurePoVerification } from "@/app/api/v1/_lib/verification";

export async function GET(request: NextRequest) {
  try {
    const firmId = request.nextUrl.searchParams.get("firmId");
    if (!firmId) return handleApiError(new Error("firmId is required"));

    await ensurePoVerification(firmId);

    const rows = await db.poVerification.findMany({
      where: { firmId, status: { in: ["AWAITING_VERIFICATION", "SUBMITTED"] } },
      include: {
        po: {
          select: {
            id: true,
            poNumber: true,
            poDate: true,
            notes: true,
            vendor: { select: { vendorName: true, vendorType: true } },
          },
        },
        submittedBy: { select: { name: true } },
        items: {
          orderBy: { productName: "asc" },
          // team-safe fields only
          select: {
            id: true,
            productName: true,
            sku: true,
            unit: true,
            orderedQty: true,
            sellableQty: true,
            damagedQty: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Project to the exact team-safe shape (defense in depth)
    const queue = rows.map((r) => ({
      id: r.id,
      status: r.status,
      poNumber: r.po.poNumber,
      poDate: r.po.poDate,
      vendorName: r.po.vendor.vendorName,
      vendorType: r.po.vendor.vendorType,
      notes: r.po.notes,
      submittedAt: r.submittedAt,
      submittedByName: r.submittedBy?.name ?? null,
      returnReason: r.returnReason,
      submittedNote: r.submittedNote,
      itemCount: r.items.length,
      totalOrdered: r.items.reduce((s, i) => s + i.orderedQty, 0),
      items: r.items,
    }));

    return ok(queue);
  } catch (e) {
    return handleApiError(e);
  }
}
