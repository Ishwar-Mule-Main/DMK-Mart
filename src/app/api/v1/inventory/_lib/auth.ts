// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY PORTAL — AUTH LIBRARY
// · Passwords are NEVER stored in plain text: pbkdf2-sha256 with a
//   per-row random salt and 100k iterations (stored as
//   "pbkdf2$<iterations>$<salt>$<hash>").
// · The session is an HMAC-SHA256 signed token in an httpOnly
//   cookie — unreadable and unforgable from the browser.
// · The default account (Kunal / 1234) is lazy-seeded the first
//   time anyone hits the login endpoint, so sandbox resets and
//   fresh firms self-heal without a migration step.
// ═══════════════════════════════════════════════════════════════

import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { BusinessError } from "@/app/api/v1/_lib/api";

export const INV_SESSION_COOKIE = "dmk_inv_session";
export const INV_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32;

/** Signing secret — env-overridable, stable fallback for this single-tenant deployment. */
function sessionSecret(): string {
  return process.env.DMK_INV_SECRET || "dmk-universal-inventory-portal-v1";
}

// ─── Password hashing (pbkdf2) ────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256").toString("hex");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, iterStr, salt, hash] = stored.split("$");
    if (scheme !== "pbkdf2") return false;
    const iterations = parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || !salt || !hash) return false;
    const candidate = pbkdf2Sync(password, salt, iterations, KEY_LEN, "sha256");
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/** Lazy-seed the Kunal/1234 account for a firm (self-healing). */
export async function ensureInventoryAuth(firmId: string) {
  const existing = await db.inventoryAuth.findUnique({ where: { firmId } });
  if (existing) return existing;
  return db.inventoryAuth.create({
    data: { firmId, username: "Kunal", passwordHash: hashPassword("1234") },
  });
}

// ─── Session token (HMAC-signed, httpOnly cookie) ─────────────────

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function createSessionToken(firmId: string, username: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + INV_SESSION_TTL_MS);
  const payload = `v1.${firmId}.${username}.${expiresAt.getTime()}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export interface InvSession {
  firmId: string;
  username: string;
  expiresAt: Date;
}

export function readSessionToken(token: string | undefined): InvSession | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [v1, firmId, username, expStr, sig] = parts;
  if (v1 !== "v1") return null;
  const payload = `${v1}.${firmId}.${username}.${expStr}`;
  const expectedSig = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const expiresAt = new Date(parseInt(expStr, 10));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) return null;
  return { firmId, username: decodeURIComponent(username), expiresAt };
}

/** Enforce the portal session on an inventory API request. Throws 401 when absent/expired. */
export async function requireInvAuth(req: Request) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${INV_SESSION_COOKIE}=`))
    ?.slice(INV_SESSION_COOKIE.length + 1);
  const session = readSessionToken(raw ? decodeURIComponent(raw) : undefined);
  if (!session) {
    throw new BusinessError("ERR_INV_UNAUTHORIZED", "Inventory portal sign-in required", 401);
  }
  const firm = await db.firm.findUnique({ where: { id: session.firmId } });
  if (!firm) {
    throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found for this session", 404);
  }
  return { session, firm };
}
