"use client";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — AI CHAT CARD (compact Copilot anchored on the cockpit)
// POST /api/v1/ai/chat { firmId, message } → { reply }
// Grounded on the active firm's live books/stock/receivables only.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Bot, CornerDownLeft, Loader2, Sparkles, User } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Msg {
  id: number;
  role: "user" | "copilot";
  text: string;
}

const SUGGESTED = [
  "Today's sales and collections?",
  "Which products are low on stock?",
  "Top overdue customers this month?",
  "How is my cash + bank position?",
];

let seq = 0;
const nextId = () => ++seq;

export function DashboardAiChat() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || loading || !activeFirmId) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: message }]);
    setInput("");
    setLoading(true);
    try {
      const res = await apiPost<{ reply: string }>("/api/v1/ai/chat", { firmId: activeFirmId, message });
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "copilot", text: res.reply || "I could not generate a response — try again." },
      ]);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI Copilot unavailable",
        description: e instanceof ApiError ? e.message : "Request failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dmk-card p-4 flex flex-col lg:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-8 rounded-lg bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-dmk-yellow" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-dmk-text-primary flex items-center gap-2">
              Ask AI Copilot
              <span className="dmk-badge bg-dmk-success/12 text-dmk-success h-5 px-2 text-[9px]">LIVE · YOUR BOOKS</span>
            </h2>
            <p className="text-[11px] text-dmk-text-muted">Instant answers from sales, stock, receivables and ledgers — grounded on this firm only</p>
          </div>
        </div>
        <button
          onClick={() => setView("ai")}
          className="text-[11.5px] font-semibold text-dmk-blue hover:underline shrink-0"
        >
          Open full Copilot →
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-[132px] max-h-[240px] overflow-y-auto space-y-2 pr-1 mb-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-1.5 py-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="text-[11.5px] rounded-full border border-dmk-border-subtle bg-dmk-input-well px-3 py-1.5 text-dmk-text-secondary hover:border-dmk-yellow/40 hover:text-dmk-text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex items-start gap-2", m.role === "user" && "flex-row-reverse")}>
            <span
              className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center shrink-0",
                m.role === "user" ? "bg-dmk-blue/20 border border-dmk-blue/40 text-dmk-blue" : "bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow"
              )}
            >
              {m.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            </span>
            <p
              className={cn(
                "max-w-[82%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-dmk-blue/12 border border-dmk-blue/25 text-dmk-text-primary"
                  : "bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary"
              )}
            >
              {m.text}
            </p>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-dmk-text-muted pl-8">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Copilot is checking the books…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="relative">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask about sales, stock, receivables, P&L…"
          className="h-10 w-full rounded-lg bg-dmk-input-well border border-dmk-border-subtle pl-3 pr-11 text-[13px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus:outline-none focus:border-dmk-yellow/50"
          aria-label="Ask AI Copilot"
        />
        <button
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md bg-dmk-yellow text-[#0A0F1D] flex items-center justify-center disabled:opacity-40 transition-opacity"
          aria-label="Send question"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
