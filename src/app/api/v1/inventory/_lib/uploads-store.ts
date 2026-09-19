// Shared storage helpers for locally-uploaded product photos
// (kept out of route files — Next.js route modules may only export
// HTTP handlers).

import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const UPLOAD_DIR = join(process.cwd(), "db", "inventory-uploads");

export function uploadDir(): string {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

export const MIME: Record<string, string> = {
  webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", avif: "image/avif",
};

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
