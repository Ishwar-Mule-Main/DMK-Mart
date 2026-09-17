// ═══════════════════════════════════════════════════════════════
// GET /api/v1/auth/accounts — public company-account directory
// for the login panel dropdown. Minimal fields only — never
// exposes passwords or book data.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";

export async function GET() {
  try {
    const accounts = await db.firm.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        firmName: true,
        firmCode: true,
        gstin: true,
        state: true,
        logoUrl: true,
        createdAt: true,
      },
    });
    return ok(accounts);
  } catch (e) {
    return handleApiError(e);
  }
}
