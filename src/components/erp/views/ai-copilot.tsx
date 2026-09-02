"use client";

// ═══════════════════════════════════════════════════════════════
// AI INTELLIGENCE — DMK MART COPILOT
// POST /api/v1/ai/chat { firmId, message } → { reply }
// Grounded in the active firm's data snapshot (server-side ZAI call).
// Session-local messages; resets when the active firm changes.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Bot, Info, Send, Sparkles, User } from "lucide-react";

import { PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "copilot";
  text: string;
}

const SUGGESTIONS = [
  "What is my gross profit this month?",
  "Which products are low on stock?",
  "Who owes me the most?",
  "Show damaged stock summary",
];

let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `m${Date.now()}-${msgSeq}`;
}

export default function AiCopilotView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Reset session when the active firm changes
  React.useEffect(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
  }, [activeFirmId]);

  // Keep the newest message in view
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || loading || !activeFirmId) return;

    const userMsg: ChatMessage = { id: nextMsgId(), role: "user", text: message };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await apiPost<{ reply: string }>("/api/v1/ai/chat", {
        firmId: activeFirmId,
        message,
      });
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "copilot", text: res.reply || "I could not generate a response. Please try again." },
      ]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Copilot request failed";
      toast({ variant: "destructive", title: "Copilot unavailable", description: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI Copilot"
        subtitle={`Grounded business assistant · ${activeFirm?.firmName ?? "no firm selected"}`}
        icon={Sparkles}
      />

      {/* Grounding note */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          Copilot answers are grounded in your active firm&apos;s data only — sales, stock,
          receivables, books and GST snapshots. No other firm&apos;s data is visible to it.
        </p>
      </div>

      {/* Chat panel */}
      <div className="dmk-card flex flex-col h-[calc(100vh-330px)] min-h-[420px] overflow-hidden">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-dmk-input-well border border-dmk-border-subtle">
                <Bot className="h-7 w-7 text-dmk-blue" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-dmk-text-secondary">Ask your copilot anything</p>
                <p className="text-[12px] text-dmk-text-muted mt-1 max-w-sm">
                  Instant answers from live books, stock and receivables — try one of these:
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary transition-colors rounded-lg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end gap-2.5">
                    <div className="max-w-[78%] sm:max-w-[65%] rounded-xl rounded-br-sm bg-[rgba(37,99,235,0.15)] border border-[rgba(37,99,235,0.3)] px-3.5 py-2.5">
                      <p className="text-[13px] text-dmk-text-primary whitespace-pre-wrap break-words">{m.text}</p>
                    </div>
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                      <User className="h-3.5 w-3.5 text-dmk-text-secondary" />
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                      <Bot className="h-3.5 w-3.5 text-dmk-blue" />
                    </div>
                    <div className="max-w-[86%] sm:max-w-[75%] rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-3.5 py-2.5">
                      <p className="text-[13px] text-dmk-text-primary whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                    </div>
                  </div>
                )
              )}

              {/* Typing indicator — three-dot pulse */}
              {loading && (
                <div className="flex justify-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                    <Bot className="h-3.5 w-3.5 text-dmk-blue" />
                  </div>
                  <div className="rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-4 py-3">
                    <div className="flex items-center gap-1.5" aria-label="Copilot is thinking">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="h-1.5 w-1.5 rounded-full bg-dmk-text-muted animate-pulse"
                          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Input row */}
        <div className="border-t border-dmk-border-subtle bg-dmk-input-well/40 p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={activeFirmId ? "Ask about sales, stock, receivables, books…" : "Select a firm first"}
              disabled={!activeFirmId || loading}
              className={cn(inputCls, "flex-1")}
              aria-label="Message the copilot"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!activeFirmId || loading || !input.trim()}
              className="h-9 w-9 shrink-0 bg-dmk-orange text-white hover:bg-dmk-orange/85 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <p className="text-[10.5px] text-dmk-text-muted mt-2">
            Answers quote exact figures from the current snapshot · may take a few seconds
          </p>
        </div>
      </div>
    </div>
  );
}
