// ═══════════════════════════════════════════════════════════════
// AI IMAGE ↔ NAME VERIFIER
// The owner's rule: the product name printed ON each image must
// match the catalog name exactly. This engine fetches each product
// image, has the vision model read the name off the artwork, and
// compares it against the catalog name + brand with a tolerant
// token match.
//
// Verdicts: MATCHED · MISMATCH · UNREADABLE (no text on image) ·
// NO_IMAGE · PENDING (not yet checked). Results are stamped on the
// Product row (imageVerified / imageMatchName / imageVerifiedAt)
// so every platform can see the audit state.
// ═══════════════════════════════════════════════════════════════

import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { canonicalImageFileName } from "@/app/api/v1/inventory/_lib/inventory";

export type Verdict = "MATCHED" | "MISMATCH" | "UNREADABLE" | "NO_IMAGE" | "ERROR";

export interface VerifyResult {
  productId: string;
  sku: string;
  name: string;
  verdict: Verdict;
  textOnImage: string;
  detail: string;
}

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "and", "with", "for", "pc", "pcs"].includes(t));
}

/** Tolerant name match:
 *  (a) the catalog's core name tokens are covered by the image text, OR
 *  (b) the image text is a strict SUBSET of catalog+brand tokens —
 *      the artwork may show only the model ("FEGT-139") while the
 *      catalog adds the line name ("Falcon FEGT-139"): no contradiction.
 *  Genuine mismatches ("EASY DRIVE" vs "FALCON") fail both rules. */
export function namesMatch(catalogName: string, brand: string, imageText: string): boolean {
  const nameTokens = normalizeTokens(catalogName);
  const brandTokens = normalizeTokens(brand);
  const imageTokens = normalizeTokens(imageText);
  if (nameTokens.length === 0 || imageTokens.length === 0) return false;
  const imageSet = new Set(imageTokens);

  // strip brand words and sizes from the name — those rarely appear on artwork
  const coreTokens = nameTokens.filter(
    (t) => !brandTokens.includes(t) && !/^\d+(\.\d+)?(l|ml|kg|g|mm|cm|inch|in|pc)?$/.test(t)
  );
  const target = coreTokens.length > 0 ? coreTokens : nameTokens;

  const tokenHit = (t: string): boolean => {
    if (imageSet.has(t)) return true;
    for (const it of imageSet) {
      if (it.includes(t) || t.includes(it)) return true;
    }
    return false;
  };

  // (a) catalog covered by image
  let covered = 0;
  for (const t of target) if (tokenHit(t)) covered += 1;
  const coverage = covered / target.length;
  if (coverage >= 0.75 || covered === target.length) return true;

  // (b) image ⊆ catalog ∪ brand — artwork says less, never contradicts
  const allowed = new Set([...nameTokens, ...brandTokens]);
  const allImageAgree = imageTokens.every((t) =>
    allowed.has(t) || [...allowed].some((a) => a.includes(t) || t.includes(a))
  );
  return allImageAgree && imageTokens.length <= target.length + 1;
}

/** Smaller, cheaper fetch for vision: shrink cloudinary URLs to 480px. */
function visionUrl(photoUrl: string): string {
  try {
    const u = new URL(photoUrl);
    if (u.hostname === "res.cloudinary.com") {
      u.pathname = u.pathname.replace("/upload/", "/upload/c_scale,w_480/");
      u.search = "";
      return u.toString();
    }
    return photoUrl;
  } catch {
    return photoUrl;
  }
}

async function readNameOffImage(photoUrl: string): Promise<string> {
  const zai = await ZAI.create();
  // Retry with long backoff — the vision API 429s under rapid bursts
  // and the quota window can be a full minute or more.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * attempt));
      const res = await zai.chat.completions.createVision({
        model: "glm-4.6v",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Read the product name / model name printed, embossed or stickered on this product image. " +
                  "Reply with ONLY that exact name text. If there is no readable name text at all, reply exactly: NONE",
              },
              { type: "image_url", image_url: { url: visionUrl(photoUrl) } },
            ],
          },
        ],
        thinking: { type: "disabled" as const },
      });
      return (res.choices[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Verify a batch of products (sequential — the vision model is happier and so is the network). */
export async function verifyProductImages(
  firmId: string,
  opts: { productIds?: string[]; limit?: number; recheckAll?: boolean }
): Promise<{ results: VerifyResult[]; matched: number; mismatch: number; unreadable: number; errors: number }> {
  const limit = Math.min(30, Math.max(1, opts.limit ?? 8));
  const where: Record<string, unknown> = {
    firmId,
    photoUrl: { not: null },
    // default sweep = never-checked products; mismatches are re-verified
    // explicitly (recheckAll or productIds) so one batch never loops on them
    ...(opts.recheckAll ? {} : { imageVerified: "PENDING" }),
    ...(opts.productIds?.length ? { id: { in: opts.productIds } } : {}),
  };
  const products = await db.product.findMany({
    where,
    select: { id: true, sku: true, name: true, brand: true, photoUrl: true, imageFileName: true },
    orderBy: { name: "asc" },
    take: limit,
  });

  const results: VerifyResult[] = [];
  let matched = 0, mismatch = 0, unreadable = 0, errors = 0;

  for (const p of products) {
    // pace the vision calls — the upstream API rate-limits rapid bursts
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const text = await readNameOffImage(p.photoUrl!);
      let verdict: Verdict;
      let detail: string;
      if (!text || /^none$/i.test(text)) {
        verdict = "UNREADABLE";
        detail = "No readable name text found on the image — needs a human look";
      } else if (namesMatch(p.name, p.brand, text)) {
        verdict = "MATCHED";
        detail = `Image says "${text}" — matches catalog name`;
      } else {
        verdict = "MISMATCH";
        detail = `Image says "${text}" but catalog says "${p.name}"`;
      }
      await db.product.update({
        where: { id: p.id },
        data: { imageVerified: verdict, imageMatchName: text || "(no text detected)", imageVerifiedAt: new Date() },
      });
      if (verdict === "MATCHED") matched++;
      else if (verdict === "MISMATCH") mismatch++;
      else if (verdict === "UNREADABLE") unreadable++;
      results.push({ productId: p.id, sku: p.sku, name: p.name, verdict, textOnImage: text, detail });
    } catch (e) {
      errors++;
      results.push({
        productId: p.id, sku: p.sku, name: p.name, verdict: "ERROR",
        textOnImage: "", detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { results, matched, mismatch, unreadable, errors };
}

/** Backfill canonical file names for the whole catalog (idempotent). */
export async function backfillImageFileNames(firmId: string): Promise<{ updated: number }> {
  const products = await db.product.findMany({
    where: { firmId },
    select: { id: true, name: true, brand: true, photoUrl: true, imageFileName: true },
  });
  let updated = 0;
  for (const p of products) {
    const canonical = canonicalImageFileName(p.brand, p.name, p.photoUrl);
    if (canonical !== p.imageFileName) {
      await db.product.update({ where: { id: p.id }, data: { imageFileName: canonical } });
      updated += 1;
    }
  }
  return { updated };
}
