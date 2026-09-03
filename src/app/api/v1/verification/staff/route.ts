// ═══════════════════════════════════════════════════════════════
// /api/v1/verification/staff — verification team accounts.
// GET  ?firmId=        → list (hashes stripped)
// POST { firmId, name, username, password, phone?, role? }
// Accounts are created & managed ONLY from the owner portal.
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
import { hashPasswordAsync, notifyRealtime } from "@/app/api/v1/_lib/verification";

const STAFF_SELECT = {
  id: true,
  firmId: true,
  name: true,
  username: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  _count: { select: { verifications: true, submissions: true } },
} as const;

export async function GET(request: NextRequest) {
  try {
    const firmId = request.nextUrl.searchParams.get("firmId");
    if (!firmId) return handleApiError(new Error("firmId is required"));
    const staff = await db.verificationStaff.findMany({
      where: { firmId },
      select: STAFF_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return ok(staff);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const name = getStr(body.name);
    const username = getStr(body.username).toLowerCase().trim();
    const password = getStr(body.password);

    if (!firmId || !name || !username || !password) {
      throw new BusinessError("ERR_VALIDATION", "name, username and password are required", 400);
    }
    if (password.length < 4) {
      throw new BusinessError("ERR_VALIDATION", "Password must be at least 4 characters", 400);
    }

    const firm = await db.firm.findUnique({ where: { id: firmId } });
    if (!firm) throw new BusinessError("ERR_NOT_FOUND", "Firm not found", 404);

    const dupe = await db.verificationStaff.findFirst({ where: { firmId, username } });
    if (dupe) {
      throw new BusinessError("ERR_DUPLICATE_USERNAME", `Username "${username}" already exists in this firm`, 409);
    }

    const staff = await db.verificationStaff.create({
      data: {
        firmId,
        name,
        username,
        passwordHash: await hashPasswordAsync(password),
        phone: getStr(body.phone),
        role: getStr(body.role) || "VERIFIER",
      },
      select: STAFF_SELECT,
    });

    await notifyRealtime(firmId, "staff:update", { kind: "created", name });
    return ok(staff, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
