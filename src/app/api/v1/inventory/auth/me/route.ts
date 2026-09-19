// GET /api/v1/inventory/auth/me — session probe for the /inventory
// portal shell (drives the auto-login-on-refresh). 401 when the
// signed cookie is missing/expired.

import { NextRequest } from "next/server";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { session, firm } = await requireInvAuth(req);
    return ok({
      username: session.username,
      expiresAt: session.expiresAt.toISOString(),
      firm: { id: firm.id, firmName: firm.firmName, firmCode: firm.firmCode, gstin: firm.gstin },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
