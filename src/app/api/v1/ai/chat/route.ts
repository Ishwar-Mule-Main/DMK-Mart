// ═══════════════════════════════════════════════════════════════
// /api/v1/ai/chat — DMK Mart ERP Copilot (backend-only LLM call)
//
// FAST: token streaming (SSE) when body.stream=true — first words
// paint in ~1s instead of waiting for the full completion; the data
// snapshot is built once per firm and cached in memory for 30s; the
// answer is capped (max_tokens) and thinking is disabled.
//
// ACCURATE: the model is grounded on a live JSON snapshot of the
// firm's books (same engines as the dashboard/reports) covering
// sales, stock, receivables, P&L, expenses, GST and purchases; the
// grounding is sent with the proper `system` role; low temperature;
// the last few conversation turns ride along so follow-ups
// ("and yesterday?") stay in context.
//
// Every reply also carries a `chart` — an intent-derived
// visualization built from the SAME snapshot, streamed as the first
// `meta` event so the UI can render it while text still generates.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { buildCopilotChart, salesTrendChart } from "./chart";
import { buildCopilotContext } from "@/app/api/v1/_lib/copilotContext";
import {
  createAiClient,
  resolveAiModel,
  translateAiError,
} from "@/app/api/v1/_lib/aiModel";

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: string } }>;
}

/** OpenAI-style SSE chunk (provider stream). */
interface StreamChunk {
  choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
}

/** Sanitized conversation history: user/assistant turns only, bounded. */
interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is { role: string; content: string } =>
        !!t &&
        typeof t === "object" &&
        typeof (t as { content?: unknown }).content === "string" &&
        ((t as { role?: unknown }).role === "user" || (t as { role?: unknown }).role === "assistant")
    )
    .slice(-8)
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: t.content.slice(0, 2000),
    }));
}

function buildSystemPrompt(
  snapshot: Record<string, unknown>,
  snapshotAgeSec: number,
  language = "en",
  spoken = false
): string {
  const today = String(snapshot.today ?? "");
  const ageNote =
    snapshotAgeSec > 5 ? ` The snapshot was loaded ${snapshotAgeSec}s ago — treat it as “right now”.` : "";
  const langInstruction =
    language === "hi"
      ? "8. REPLY LANGUAGE: Answer in हिंदी (Hindi, Devanagari script). Keep brand names, SKUs, invoice numbers, person names and the ₹ figures exactly as they appear in the snapshot."
      : language === "mr"
        ? "8. REPLY LANGUAGE: Answer in मराठी (Marathi, Devanagari script). Keep brand names, SKUs, invoice numbers, person names and the ₹ figures exactly as they appear in the snapshot."
        : "8. REPLY LANGUAGE: Answer in English.";
  const spokenInstruction = spoken
    ? [
        "9. SPEECH MODE: This answer will be READ ALOUD. Write plain flowing sentences only:",
        "   - NO markdown, NO bullets, NO asterisks, NO headings, NO tables, NO line-break symbols.",
        "   - Say numbers naturally (e.g. “₹2,284” → keep the digits, they are pronounced by the reader).",
        "   - Maximum 80 words. Direct answer first, then the essential context. End with a short helpful nudge if useful.",
      ].join("\n")
    : "";
  return [
    "You are the DMK Mart ERP Copilot — the business assistant of an Indian trading firm (plastic goods distribution).",
    `Today's date is ${today}. All figures are INR and come from the live books snapshot below.${ageNote}`,
    "",
    "ANSWER RULES (strict):",
    "1. Answer in at most 120 words. Lead with the direct answer in one line, then at most 4 bullet points.",
    "2. Quote EXACT figures from the snapshot with the ₹ symbol and Indian digit grouping (e.g. ₹2,284).",
    "3. Always state the period you are quoting (today / last 7 days / this month / last 30 days).",
    "4. Use '* ' for bullets and **bold** for key numbers. No headings, no tables, no markdown code blocks.",
    "5. If the snapshot does not contain the answer, say exactly what is missing and suggest where to find it (e.g. Reports, Invoice Register). NEVER invent or estimate numbers that are not in the snapshot.",
    "6. For GST questions use gstSummaryThisMonth and repeat its caveat about the ITC estimate.",
    langInstruction,
    spokenInstruction,
    "",
    "DATA SNAPSHOT (JSON):",
    JSON.stringify(snapshot),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Parse an OpenAI-compatible SSE stream into content deltas. */
async function* iterateSseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as StreamChunk;
            const delta =
              chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? "";
            if (delta) yield delta;
          } catch {
            // skip malformed keepalive/comment lines
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // stream already closed
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const message = getStr(body.message);
    const wantsStream = body.stream === true;
    const history = sanitizeHistory(body.history);
    // Reply language: en (default) | hi | mr. `spoken` switches the prompt
    // to speech-friendly output (no markdown, shorter) for voice mode.
    const language = getStr(body.language) === "hi" ? "hi" : getStr(body.language) === "mr" ? "mr" : "en";
    const spoken = body.spoken === true;

    if (!firmId) {
      return handleApiError(new Error("firmId is required"));
    }

    // Empty ask — the dashboard hero uses this to get its resting
    // visual (7-day sales trend) without spending an LLM call.
    if (!message) {
      const ctx = await buildCopilotContext(firmId);
      return ok({
        reply: "Ask me anything about your firm's sales, stock, receivables, GST or books.",
        chart: salesTrendChart(ctx.chartContext.trend),
      });
    }

    const ctx = await buildCopilotContext(firmId);
    const chart = buildCopilotChart(message, ctx.chartContext);

    // AI client: saved settings (db) → env vars → .z-ai-config files.
    // When nothing is configured the copilot degrades gracefully —
    // the rest of the ERP is unaffected.
    const { client: zai, source: aiSource } = await createAiClient();
    if (!zai) {
      const reply =
        "The AI copilot is not configured on this deployment. Open Settings → DMK AI Copilot to save an API key and model (no redeploy needed), or set the AI_BASE_URL / AI_API_KEY environment variables. Every other part of the ERP works fully without it.";
      return ok({ reply, chart, aiConfigured: false });
    }

    const model = await resolveAiModel();
    const snapshotAgeSec = Math.max(0, Math.round((Date.now() - ctx.builtAt.getTime()) / 1000));
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: buildSystemPrompt(ctx.snapshot, snapshotAgeSec, language, spoken) },
      ...history,
      { role: "user", content: message },
    ];

    // ── Streaming mode (SSE): meta → delta* → done ──────────────
    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Record<string, unknown>) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

          try {
            // Chart first — it only depends on the snapshot.
            send({ type: "meta", chart, model: model ?? null, source: aiSource });

            const completion = (await zai.chat.completions.create({
              ...(model ? { model } : {}),
              messages,
              thinking: { type: "disabled" },
              temperature: 0.2,
              max_tokens: 700,
              stream: true,
            })) as ReadableStream<Uint8Array> | ChatCompletionShape;

            // Provider honored the stream → forward deltas.
            if (completion instanceof ReadableStream) {
              for await (const delta of iterateSseChunks(completion)) {
                send({ type: "delta", text: delta });
              }
            } else {
              // Provider ignored stream:true and returned JSON —
              // degrade to a single delta so the UI still works.
              const full = completion.choices?.[0]?.message?.content?.trim() ?? "";
              if (full) send({ type: "delta", text: full });
            }

            send({ type: "done", aiConfigured: aiSource !== "none" });
          } catch (e) {
            send({ type: "error", message: translateAiError(e) });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── Non-streaming mode (backward compatible) ─────────────────
    const completion = (await zai.chat.completions.create({
      ...(model ? { model } : {}),
      messages,
      thinking: { type: "disabled" },
      temperature: 0.2,
      max_tokens: 700,
    })) as ChatCompletionShape;

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return ok({
        reply: "I could not generate a response from the current data. Please try again.",
        chart,
        aiConfigured: aiSource !== "none",
      });
    }
    return ok({ reply, chart, aiConfigured: aiSource !== "none" });
  } catch (e) {
    return handleApiError(e);
  }
}
