// GET /api/v1/inventory/sync/logs — durable sync audit trail.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getNum, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const take = Math.min(200, Math.max(10, getNum(req.nextUrl.searchParams.get("limit"), 50)));
    const logs = await db.syncLog.findMany({
      where: { firmId: firm.id },
      orderBy: { startedAt: "desc" },
      take,
    });
    return ok({ logs });
  } catch (e) {
    return handleApiError(e);
  }
}
