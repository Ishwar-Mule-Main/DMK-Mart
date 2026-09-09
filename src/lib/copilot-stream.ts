"use client";

// ═══════════════════════════════════════════════════════════════
// streamCopilotChat — client helper for /api/v1/ai/chat.
// Requests the SSE stream (stream: true) and reports progress:
//   onDelta(delta, fullText) — each token chunk (fullText accumulates)
//   onDone(fullText)         — stream finished cleanly
//   onError(message)         — provider error surfaced by the server
// Falls back to the JSON endpoint when the response isn't an SSE
// stream (older deployments, proxies that buffer) so callers never
// need a second code path.
// ═══════════════════════════════════════════════════════════════

import { ApiError } from "@/lib/api-client";

export interface CopilotStreamHandlers {
  onDelta: (delta: string, fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export interface CopilotStreamPayload {
  firmId: string;
  message: string;
  /** Recent conversation turns for follow-up context. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface SseEvent {
  type?: string;
  text?: string;
  message?: string;
  reply?: string;
  aiConfigured?: boolean;
}

async function readSse(
  res: Response,
  handlers: CopilotStreamHandlers
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let errored = false;

  const handleEvent = (raw: string) => {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let evt: SseEvent;
      try {
        evt = JSON.parse(payload) as SseEvent;
      } catch {
        continue;
      }
      if (evt.type === "delta" && evt.text) {
        full += evt.text;
        handlers.onDelta(evt.text, full);
      } else if (evt.type === "error") {
        errored = true;
        handlers.onError(evt.message || "Copilot request failed");
      }
      // meta/done are informational for the caller — done ends the loop.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) handleEvent(part);
    }
    if (buffer.trim()) handleEvent(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // stream already closed
    }
  }

  if (!errored) handlers.onDone(full);
}

export async function streamCopilotChat(
  payload: CopilotStreamPayload,
  handlers: CopilotStreamHandlers
): Promise<void> {
  const res = await fetch("/api/v1/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, stream: true }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  // SSE path — the happy path.
  if (res.ok && contentType.includes("text/event-stream") && res.body) {
    await readSse(res, handlers);
    return;
  }

  // Fallback: JSON envelope ({ok,data:{reply}}) — legacy/buffered path.
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: { reply?: string };
    error?: string;
    code?: string;
  };

  if (!res.ok || json.ok === false) {
    throw new ApiError(json.error || `Request failed (${res.status})`, json.code || "ERR_UNKNOWN", res.status);
  }

  const reply = json.data?.reply ?? "";
  if (reply) {
    handlers.onDelta(reply, reply);
    handlers.onDone(reply);
  } else {
    handlers.onError("I could not generate a response. Please try again.");
  }
}
