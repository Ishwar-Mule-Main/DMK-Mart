// ═══════════════════════════════════════════════════════════════
// GET /api/v1/inventory/images/[id] — image stream + canonical
// file naming. Every download is stamped
// "Brand-Name-Product-Name.<ext>" via Content-Disposition — the
// universal naming standard applied at the file level (the source
// images live on Cloudinary with generic IDs, so the canonical
// name travels with the file itself).
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, getBool, handleApiError } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { firm } = await requireInvAuth(req);
    const product = await db.product.findFirst({
      where: { id: (await ctx.params).id, firmId: firm.id },
      select: { sku: true, name: true, brand: true, photoUrl: true, imageFileName: true },
    });
    if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found", 404);
    if (!product.photoUrl) throw new BusinessError("ERR_NO_IMAGE", "This product has no image", 404);

    // Local uploads are served from their own route — redirect keeps one source of truth on disk.
    if (product.photoUrl.startsWith("/api/v1/inventory/uploads/")) {
      return NextResponse.redirect(new URL(product.photoUrl, req.nextUrl.origin));
    }

    const upstream = await fetch(product.photoUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      throw new BusinessError("ERR_IMAGE_FETCH", `Image upstream returned ${upstream.status}`, 502);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const fileName = product.imageFileName || `${product.sku}.webp`;
    const mime = upstream.headers.get("content-type") || "image/webp";
    const res = new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=300",
      },
    });
    if (getBool(req.nextUrl.searchParams.get("download"))) {
      res.headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
    } else {
      res.headers.set("X-Canonical-File-Name", fileName);
    }
    return res;
  } catch (e) {
    return handleApiError(e);
  }
}
