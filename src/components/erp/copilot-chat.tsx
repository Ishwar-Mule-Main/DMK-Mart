"use client";

// ═══════════════════════════════════════════════════════════════
// SHARED COPILOT CHAT — compact chat widget used by the Dashboard
// and the AI Copilot view. POST /api/v1/ai/chat { firmId, message }.
// Grounded in the active firm's data snapshot (server-side ZAI call).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { inputCls } from "@/components/erp/shared";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "copilot";
  text: string;
}

export const COPILOT_SUGGESTIONS = [
  "What is my gross profit this month?",
  "Which products are low on stock?",
  "Who owes me the most?",
  "Show damaged stock summary",
  "What did I sell today?",
  "Which vendor bills are overdue?",
  "How is cash + bank looking?",
  "Top 5 products by sales value",
];

let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `m${Date.now()}-${msgSeq}`;
}

export function CopilotChat({
  className,
  heightClass = "h-[340px]",
  placeholder = "Ask about sales, stock, receivables, books…",
  onToastError,
}: {
  className?: string;
  heightClass?: string;
  placeholder?: string;
  onToastError?: (title: string, description: string) => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
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
      if (onToastError) onToastError("Copilot unavailable", msg);
      setMessages((prev) => [
        ...prev,
        { id: nextMsgId(), role: "copilot", text: `Sorry — I could not answer that right now. ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("dmk-card flex flex-col overflow-hidden", heightClass, className)}>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-dmk-input-well border border-dmk-border-subtle">
              <Bot className="h-6 w-6 text-dmk-blue" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-dmk-text-secondary">Ask your copilot about your data</p>
              <p className="text-[12.5px] text-dmk-text-muted mt-1 max-w-sm">
                Instant answers from live books, stock and receivables — start with a suggestion:
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-lg">
              {COPILOT_SUGGESTIONS.slice(0, 4).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="dmk-well px-2.5 py-1.5 text-[12.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary transition-colors rounded-lg"
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
                <div key={m.id} className="flex justify-end gap-2">
                  <div className="max-w-[80%] rounded-xl rounded-br-sm bg-[rgba(37,99,235,0.15)] border border-[rgba(37,99,235,0.3)] px-3 py-2">
                    <p className="text-[13px] text-dmk-text-primary whitespace-pre-wrap break-words">{m.text}</p>
                  </div>
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                    <User className="h-3 w-3 text-dmk-text-secondary" />
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                    <Bot className="h-3 w-3 text-dmk-blue" />
                  </div>
                  <div className="max-w-[86%] rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-3 py-2">
                    <p className="text-[13px] text-dmk-text-primary whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                  </div>
                </div>
              )
            )}

            {loading && (
              <div className="flex justify-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                  <Bot className="h-3 w-3 text-dmk-blue" />
                </div>
                <div className="rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-3 py-2.5">
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
      <div className="border-t border-dmk-border-subtle bg-dmk-input-well/40 p-2.5">
        {messages.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-2 copilot-suggest-strip">
            {COPILOT_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                disabled={loading}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dmk-border-subtle bg-dmk-bg-primary px-2.5 py-1 text-[11.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3 text-dmk-gold" /> {s}
              </button>
            ))}
          </div>
        )}
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
            placeholder={activeFirmId ? placeholder : "Select a firm first"}
            disabled={!activeFirmId || loading}
            className={cn(inputCls, "flex-1")}
            aria-label="Message the copilot"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!activeFirmId || loading || !input.trim()}
            className="h-9 w-9 shrink-0 bg-dmk-orange text-[#0A0F1D] hover:bg-dmk-orange/85 disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
