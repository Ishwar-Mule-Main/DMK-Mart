// ═══════════════════════════════════════════════════════════════
// POST /api/v1/auth/owner-login — owner portal login.
// Body: { firmId, password } — default password is 1234.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { verifyPasswordAsync } from "@/app/api/v1/_lib/verification";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const password = getStr(body.password);
    if (!firmId || !password) {
      throw new BusinessError("ERR_VALIDATION", "Company and password are required", 400);
    }

    const firm = await db.firm.findUnique({
      where: { id: firmId },
      select: { id: true, firmName: true, firmCode: true, ownerPassword: true, logoUrl: true, financialYear: true },
    });
    if (!firm) throw new BusinessError("ERR_NOT_FOUND", "Company not found", 404);

    if (!(await verifyPasswordAsync(password, firm.ownerPassword))) {
      throw new BusinessError("ERR_INVALID_CREDENTIALS", "Incorrect owner password", 401);
    }

    return ok({
      firm: {
        id: firm.id,
        firmName: firm.firmName,
        firmCode: firm.firmCode,
        logoUrl: firm.logoUrl,
        financialYear: firm.financialYear,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
