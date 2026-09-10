// ═══════════════════════════════════════════════════════════════
// GET /api/v1/sales-orders/staged/[id]/file — the original document.
// Served as binary with its content type so <img> and <iframe> can
// preview PDFs/images directly without bloating the JSON payloads.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError } from "@/app/api/v1/_lib/api";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const staged = await db.stagedOrderUpload.findUnique({ where: { id } });
    if (!staged) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);
    if (!staged.originalFileData) {
      throw new BusinessError("ERR_NOT_FOUND", "This upload has no stored document (pasted text)", 404);
    }
    const match = staged.originalFileData.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (!match) throw new BusinessError("ERR_INTERNAL", "Stored document is unreadable", 500);
    const [, mime, b64] = match;
    const bytes = Buffer.from(b64, "base64");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(staged.originalFileName || "order")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
