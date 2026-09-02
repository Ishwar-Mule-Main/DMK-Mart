// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — API HELPERS (response envelope, parsers, errors)
// Every /api/v1 route responds: { ok: true, data } | { ok: false, error, code }
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { JournalError } from "@/lib/journal";

/** Typed business-rule error — mapped to a 4xx response by handleApiError. */
export class BusinessError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

// ─── Body / query parsers (no zod, manual narrow parsing) ────────

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function asRecordArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.map(asRecord);
}

export function getStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

export function getNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function getBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

export function getDate(v: unknown, fallback = new Date()): Date {
  const s = getStr(v);
  if (s) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/** Optional-date: returns null when absent/invalid. */
export function getDateOrNull(v: unknown): Date | null {
  const s = getStr(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Firm isolation ──────────────────────────────────────────────

export async function resolveFirm(firmId: string) {
  if (!firmId) {
    throw new BusinessError("ERR_VALIDATION", "firmId is required", 400);
  }
  const firm = await db.firm.findUnique({ where: { id: firmId } });
  if (!firm) {
    throw new BusinessError("ERR_FIRM_NOT_FOUND", `Firm ${firmId} not found`, 404);
  }
  return firm;
}

// ─── Error mapping (JournalError codes included) ─────────────────

export function handleApiError(e: unknown) {
  if (e instanceof BusinessError) {
    return fail(e.code, e.message, e.status);
  }
  if (e instanceof JournalError) {
    const status = e.code === "ERR_JOURNAL_UNBALANCED" ? 422 : 400;
    return fail(e.code, e.message, status);
  }
  const message = e instanceof Error ? e.message : "Unexpected server error";
  console.error("[api]", e);
  return fail("ERR_INTERNAL", message, 500);
}

// ─── Date window helpers ─────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
