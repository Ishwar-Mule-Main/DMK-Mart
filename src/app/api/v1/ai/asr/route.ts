// ═══════════════════════════════════════════════════════════════
// /api/v1/ai/asr — backend speech-to-text FALLBACK for the voice
// copilot. The primary path is the browser's Web Speech API
// (on-device, live interim results, ~zero latency). This route
// serves browsers without that API: the client records a short
// webm/wav clip and posts it base64; the Z-AI ASR engine
// transcribes it (English / Hindi / Marathi all recognized).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const audioBase64 = getStr(body.audioBase64).replace(/^data:[^,]+,/, "");
    if (!audioBase64) {
      return ok({ error: "audioBase64 is required" }, 400);
    }
    // 15 MB hard cap — a 60s opus/webm clip is well under this.
    if (audioBase64.length > 20 * 1024 * 1024) {
      return ok({ error: "audio clip too large (max ~15 MB)" }, 413);
    }

    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const result = (await zai.audio.asr.create({ file_base64: audioBase64 })) as { text?: string };
    const text = (result?.text ?? "").trim();
    if (!text) {
      return ok({ text: "", error: "no speech detected" });
    }
    return ok({ text });
  } catch (e) {
    return handleApiError(e);
  }
}
