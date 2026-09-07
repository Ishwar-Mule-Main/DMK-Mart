"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — API CLIENT (frontend)
// All requests relative; envelope { ok, data, error, code }
// ═══════════════════════════════════════════════════════════════

import { useErpStore } from "@/store/erp-store";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new ApiError(
      json.error || `Request failed (${res.status})`,
      json.code || "ERR_UNKNOWN",
      res.status
    );
  }
  return json.data as T;
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const all: Record<string, string | number | boolean | undefined> = { ...params };
  // Financial-year scope: the selected FY rides along on every GET so
  // transaction registers stay year-accurate app-wide. Routes that don't
  // use `fy` ignore it; an explicitly passed fy always wins.
  const fy = useErpStore.getState().financialYear;
  if (fy && all.fy === undefined) all.fy = fy;
  let url = path;
  if (all) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  const res = await fetch(url, { cache: "no-store" });
  return handle<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  return handle<T>(res);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}
