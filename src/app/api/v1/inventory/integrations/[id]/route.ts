// /api/v1/inventory/integrations/[id] — edit / revoke a platform.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, BusinessError, getBool, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;

async function load(req: NextRequest, id: string) {
  const { firm } = await requireInvAuth(req);
  const portal = await db.integrationPortal.findFirst({ where: { id, firmId: firm.id } });
  if (!portal) throw new BusinessError("ERR_PORTAL_NOT_FOUND", "Portal not found", 404);
  return { firm, portal };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { portal } = await load(req, (await ctx.params).id);
    const body = asRecord(await req.json().catch(() => ({})));
    const status = body.status === undefined ? portal.status : getStr(body.status).trim().toUpperCase();
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
      throw new BusinessError("ERR_VALIDATION", `status must be one of ${STATUSES.join(", ")}`, 422);
    }
    const updated = await db.integrationPortal.update({
      where: { id: portal.id },
      data: {
        name: body.name === undefined ? portal.name : getStr(body.name).trim() || portal.name,
        baseUrl: body.baseUrl === undefined ? portal.baseUrl : getStr(body.baseUrl).trim(),
        webhookUrl: body.webhookUrl === undefined ? portal.webhookUrl : getStr(body.webhookUrl).trim(),
        contactEmail: body.contactEmail === undefined ? portal.contactEmail : getStr(body.contactEmail).trim(),
        autoSync: body.autoSync === undefined ? portal.autoSync : getBool(body.autoSync),
        status: status as string,
      },
    });
    return ok({ portal: { ...updated, apiKey: undefined } });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { portal } = await load(req, (await ctx.params).id);
    await db.integrationPortal.delete({ where: { id: portal.id } });
    return ok({ deleted: true, name: portal.name });
  } catch (e) {
    return handleApiError(e);
  }
}
