// GET /api/v1/inventory/uploads/[file] — stream a locally-uploaded
// product photo (no session gate: product photos are consumed by
// every platform and by <img> tags, which cannot send cookies on
// cross-origin requests).

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { handleApiError } from "@/app/api/v1/_lib/api";
import { MIME, uploadDir } from "@/app/api/v1/inventory/_lib/uploads-store";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  try {
    const raw = (await ctx.params).file;
    // Path-traversal guard: allow only [a-z0-9-_.] names.
    if (!/^[a-z0-9-_.]+$/i.test(raw)) {
      return NextResponse.json({ ok: false, error: "Bad file name" }, { status: 400 });
    }
    const path = join(uploadDir(), raw);
    if (!existsSync(path)) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const ext = raw.split(".").pop()?.toLowerCase() ?? "";
    const buf = readFileSync(path);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
