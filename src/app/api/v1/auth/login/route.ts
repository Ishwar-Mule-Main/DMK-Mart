// ═══════════════════════════════════════════════════════════════
// POST /api/v1/auth/login — company-account sign-in
// Body: { firmId?, firmCode?, password }
// Demo credentials per owner request: password "1234" (per firm).
// Returns the signed-in firm (sanitized — never the password).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { sanitizeFirm } from "@/app/api/v1/_lib/firm-setup";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const firmCode = getStr(body.firmCode).toUpperCase();
    const password = getStr(body.password);

    if (!firmId && !firmCode) {
      throw new BusinessError("ERR_VALIDATION", "Select a company account to sign in", 400);
    }
    if (!password) {
      throw new BusinessError("ERR_VALIDATION", "Password is required", 400);
    }

    const firm = firmId
      ? await db.firm.findUnique({ where: { id: firmId } })
      : await db.firm.findUnique({ where: { firmCode } });

    if (!firm || !firm.isActive) {
      throw new BusinessError("ERR_ACCOUNT_NOT_FOUND", "No company account matches that selection", 404);
    }
    if (firm.loginPassword !== password) {
      throw new BusinessError("ERR_INVALID_PASSWORD", "Incorrect password for this company account", 401);
    }

    return ok({ firm: sanitizeFirm(firm) });
  } catch (e) {
    return handleApiError(e);
  }
}
