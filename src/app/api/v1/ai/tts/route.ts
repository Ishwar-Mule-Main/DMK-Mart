// ═══════════════════════════════════════════════════════════════
// /api/v1/ai/tts — backend text-to-speech for the voice copilot.
//
// PRIMARY voice path is the browser's on-device speechSynthesis
// (zero network latency). This route is the FALLBACK when the
// browser has no installed voice for Hindi/Marathi — it renders
// WAV audio server-side via the Z-AI TTS engine (24 kHz) and is
// cached in memory so repeated answers replay instantly.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";

// ── Tiny LRU-ish cache: hash → wav buffer (1h, max 60 clips) ──
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 60;
const ttsCache = new Map<string, { buffer: Buffer; at: number }>();

function cacheGet(key: string): Buffer | null {
  const hit = ttsCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    ttsCache.delete(key);
    return null;
  }
  // refresh recency
  hit.at = Date.now();
  ttsCache.delete(key);
  ttsCache.set(key, hit);
  return hit.buffer;
}

function cacheSet(key: string, buffer: Buffer) {
  if (ttsCache.size >= CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    if (oldest) ttsCache.delete(oldest);
  }
  ttsCache.set(key, { buffer, at: Date.now() });
}

/** Strip markdown/symbols so the voice engine reads clean prose. */
function speakableText(raw: string): string {
  return raw
    .replace(/[*_#`>|]/g, " ")
    .replace(/\s*[-—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const rawText = getStr(body.text);
    const lang = getStr(body.lang) || "en";
    const speedRaw = Number(body.speed);
    const speed = Number.isFinite(speedRaw) ? Math.min(2, Math.max(0.5, speedRaw)) : 1.05;

    if (!rawText) {
      return ok({ error: "text is required" }, 400);
    }

    // TTS input limit is 1024 chars — spoken answers are ≤80 words, so
    // truncating at 900 is a safe hard stop.
    const text = speakableText(rawText).slice(0, 900);
    if (!text) return ok({ error: "nothing speakable in text" }, 400);

    const key = createHash("sha1").update(`${lang}:${speed}:${text}`).digest("hex");
    const cached = cacheGet(key);
    if (cached) {
      return new Response(new Uint8Array(cached), {
        headers: { "Content-Type": "audio/wav", "X-TTS-Cache": "hit" },
      });
    }

    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const response = await zai.audio.tts.create({
      input: text,
      voice: "tongtong",
      speed,
      response_format: "wav",
      stream: false,
    });
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    if (buffer.length < 100) {
      return ok({ error: "empty audio from TTS engine" }, 502);
    }
    cacheSet(key, buffer);
    return new Response(new Uint8Array(buffer), {
      headers: { "Content-Type": "audio/wav", "X-TTS-Cache": "miss" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
