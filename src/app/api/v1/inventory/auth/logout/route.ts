// POST /api/v1/inventory/auth/logout — clears the portal session cookie.

import { NextResponse } from "next/server";
import { INV_SESSION_COOKIE } from "@/app/api/v1/inventory/_lib/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true, data: { loggedOut: true } });
  res.cookies.set(INV_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
