// POST /api/v1/inventory/integrations/[id]/rotate-key — issue a
// fresh API key (SHA-256 stored, raw value returned exactly once).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { generateApiKey, hashApiKey } from "@/app/api/universal/v1/_lib/portal";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm } = await requireInvAuth(req);
    const portal = await db.integrationPortal.findFirst({ where: { id: (await ctx.params).id, firmId: firm.id } });
    if (!portal) throw new BusinessError("ERR_PORTAL_NOT_FOUND", "Portal not found", 404);
    const apiKey = generateApiKey();
    await db.integrationPortal.update({ where: { id: portal.id }, data: { apiKey: hashApiKey(apiKey), status: "ACTIVE" } });
    return ok({ apiKey, message: `Key rotated for ${portal.name} — the old key stops working immediately` });
  } catch (e) {
    return handleApiError(e);
  }
}
