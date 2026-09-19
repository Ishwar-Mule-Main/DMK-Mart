// POST /api/v1/inventory/verify-images — run the AI image↔name
// verifier on a batch. Body: { limit?, productIds?, recheckAll? }
// GET — verification status rollup.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, getNum, asStringArray, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { verifyProductImages } from "@/app/api/v1/inventory/_lib/verify";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const agg = await db.product.groupBy({ by: ["imageVerified"], where: { firmId: firm.id }, _count: true });
    const map: Record<string, number> = {};
    for (const a of agg) map[a.imageVerified] = a._count;
    const mismatches = await db.product.findMany({
      where: { firmId: firm.id, imageVerified: "MISMATCH" },
      select: { id: true, sku: true, name: true, brand: true, photoUrl: true, imageMatchName: true, imageVerifiedAt: true },
      orderBy: { name: "asc" },
      take: 50,
    });
    return ok({ status: map, mismatches });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const result = await verifyProductImages(firm.id, {
      limit: getNum(body.limit, 8),
      productIds: asStringArray(body.productIds),
      recheckAll: body.recheckAll === true,
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
