// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/uploads — product photo uploads for the
// inventory portal.
//  POST (multipart/form-data, field "file") → stores the bytes in
//    db/inventory-uploads/ and returns the serving URL. The stored
//    name is "<canonical-slug>.<ext>" when the client passes
//    canonicalName, so even locally-uploaded files follow the
//    Brand + Product naming standard.
//  GET /uploads/[file] → streams a stored image back.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { slugifyFileName } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";
import { MIME, UPLOAD_MAX_BYTES, uploadDir } from "@/app/api/v1/inventory/_lib/uploads-store";

export async function POST(req: NextRequest) {
  try {
    await requireInvAuth(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new BusinessError("ERR_VALIDATION", "multipart field 'file' is required", 422);
    if (file.size > UPLOAD_MAX_BYTES) throw new BusinessError("ERR_TOO_LARGE", "Image must be 5 MB or smaller", 422);
    const ext = MIME_REVERSE.get(file.type);
    if (!ext) throw new BusinessError("ERR_BAD_TYPE", "Only webp/png/jpg/gif/avif images are accepted", 422);

    const canonical = slugifyFileName(String(form.get("canonicalName") ?? ""));
    const base = canonical || `product-${Date.now()}`;
    const dir = uploadDir();
    const fileName = `${base}.${ext}`;
    // Never overwrite a different product's file — suffix on collision.
    let finalName = fileName;
    let n = 2;
    while (existsSync(join(dir, finalName)) && statSync(join(dir, finalName)).size !== file.size) {
      finalName = `${base}-${n}.${ext}`;
      n++;
    }
    writeFileSync(join(dir, finalName), Buffer.from(await file.arrayBuffer()));
    return ok({
      url: `/api/v1/inventory/uploads/${finalName}`,
      fileName: finalName,
      size: file.size,
      contentType: file.type,
    }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

const MIME_REVERSE = new Map(Object.entries(MIME).map(([k, v]) => [v, k]));
