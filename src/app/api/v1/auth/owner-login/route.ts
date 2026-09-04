// ═══════════════════════════════════════════════════════════════
// POST /api/v1/auth/owner-login — owner portal login.
// The owner identity is a single fixed username ("Kunal") shared by
// every company account; the PASSWORD identifies the account.
// Body: { username?, password, preferFirmId? }
//   · username is validated but always "Kunal" (UI pins it)
//   · preferFirmId = last firm this browser used (disambiguates
//     legacy accounts that still share the default password 1234)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { verifyPasswordAsync, OWNER_USERNAME } from "@/app/api/v1/_lib/verification";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const username = getStr(body.username).trim();
    const password = getStr(body.password);
    const preferFirmId = getStr(body.preferFirmId);

    if (!password) {
      throw new BusinessError("ERR_VALIDATION", "Password is required", 400);
    }
    if (username && username.toLowerCase() !== OWNER_USERNAME.toLowerCase()) {
      throw new BusinessError("ERR_INVALID_CREDENTIALS", `Unknown owner username — the owner username is ${OWNER_USERNAME}`, 401);
    }

    const firms = await db.firm.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, firmName: true, firmCode: true, ownerPassword: true, logoUrl: true, financialYear: true },
    });

    // Password-matched sign-in — no company picker, the password IS the pick.
    const matches: typeof firms = [];
    for (const firm of firms) {
      if (await verifyPasswordAsync(password, firm.ownerPassword)) matches.push(firm);
    }
    if (matches.length === 0) {
      throw new BusinessError("ERR_INVALID_CREDENTIALS", "No company account matches this password", 401);
    }

    // Deterministic: prefer the firm this browser last used, else the oldest.
    const firm = matches.find((f) => f.id === preferFirmId) ?? matches[0];

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
