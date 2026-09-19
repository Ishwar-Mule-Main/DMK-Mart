// ═══════════════════════════════════════════════════════════════
// POST /api/v1/inventory/auth/login — Universal Inventory portal
// sign-in. Verifies the pbkdf2 password hash, stamps lastLoginAt
// and sets the signed httpOnly session cookie.
// Body: { username: "Kunal", password: "…" }
// The password identifies the company account (same convention as
// the owner portal): exactly one firm is seeded today.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { createSessionToken, ensureInventoryAuth, INV_SESSION_COOKIE, INV_SESSION_TTL_MS, verifyPassword } from "@/app/api/v1/inventory/_lib/auth";

export async function POST(req: NextRequest) {
  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const username = getStr(body.username).trim();
    const password = getStr(body.password);
    if (!username || !password) {
      return ok({ success: false, reason: "MISSING" }, 200);
    }

    const auth = await db.inventoryAuth.findFirst({ where: { username } });
    if (!auth) {
      // Lazy-seed on first ever login attempt against the canonical
      // username so a fresh/reset database self-heals.
      const seed = await ensureInventoryAuth((await db.firm.findFirst())?.id ?? "");
      if (seed.username !== username) return ok({ success: false, reason: "INVALID" }, 200);
      if (!verifyPassword(password, seed.passwordHash)) return ok({ success: false, reason: "INVALID" }, 200);
      return issue(seed.firmId, seed.username, seed.id);
    }
    if (!verifyPassword(password, auth.passwordHash)) return ok({ success: false, reason: "INVALID" }, 200);
    return issue(auth.firmId, auth.username, auth.id);
  } catch (e) {
    return handleApiError(e);
  }

  async function issue(firmId: string, username: string, authId: string) {
    const firm = await db.firm.findUnique({ where: { id: firmId } });
    if (!firm) return ok({ success: false, reason: "INVALID" }, 200);
    await db.inventoryAuth.update({ where: { id: authId }, data: { lastLoginAt: new Date() } });
    const { token, expiresAt } = createSessionToken(firmId, username);
    const res = NextResponse.json({
      ok: true,
      data: {
        success: true,
        username,
        firm: { id: firm.id, firmName: firm.firmName, firmCode: firm.firmCode, gstin: firm.gstin },
        expiresAt: expiresAt.toISOString(),
      },
    });
    res.cookies.set(INV_SESSION_COOKIE, encodeURIComponent(token), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(INV_SESSION_TTL_MS / 1000),
    });
    return res;
  }
}
