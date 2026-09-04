"use client";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — DMK AI COPILOT (hero container at the top of the app)
// The first thing on the Dashboard: the user talks to the Copilot
// before anything else. POST /api/v1/ai/chat { firmId, message } →
// { reply } — grounded on the active firm's live books/stock/AR only.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Bot,
  CornerDownLeft,
  Loader2,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Msg {
  id: number;
  role: "user" | "copilot";
  text: string;
}

const SUGGESTIONS: Array<{ group: string; items: string[] }> = [
  {
    group: "Sales",
    items: ["Today's sales and collections?", "Top selling products this month?"],
  },
  {
    group: "Stock",
    items: ["Which products are low on stock?", "How much damaged stock do I carry?"],
  },
  {
    group: "Finance",
    items: ["How is my cash + bank position?", "Top overdue customers this month?"],
  },
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
    <section
      aria-label="DMK AI Copilot"
      className="dmk-card relative overflow-hidden"
    >
      {/* Hero accent strip */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-dmk-yellow via-dmk-warning/50 to-transparent" />

      <div className="p-4 sm:p-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-dmk-yellow" />
            </span>
            <div>
              <h2 className="text-[16px] font-semibold text-dmk-text-primary flex items-center gap-2">
                DMK AI Copilot
                <span className="dmk-badge bg-dmk-success/12 text-dmk-success h-5 px-2 text-[9px]">
                  LIVE · YOUR BOOKS
                </span>
              </h2>
              <p className="text-[11.5px] text-dmk-text-muted">
                Talk to your ERP — instant answers from sales, stock, receivables and ledgers, grounded on this firm only
              </p>
            </div>
          </div>
          <button
            onClick={() => setView("ai")}
            className="text-[11.5px] font-semibold text-dmk-blue hover:underline shrink-0 self-start sm:self-auto"
          >
            Open full Copilot →
          </button>
        </div>

        {/* Body: chat pane + quick-ask rail */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_270px] gap-4">
          {/* Chat pane */}
          <div className="min-w-0">
            <div
              ref={scrollRef}
              className="min-h-[150px] max-h-[280px] overflow-y-auto space-y-2 pr-1 mb-3"
            >
              {messages.length === 0 && !loading && (
                <div className="flex items-start gap-2">
                  <span className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow">
                    <Bot className="h-3 w-3" />
                  </span>
                  <p className="max-w-[82%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary">
                    Ask me anything about this firm — sales, receivables, stock, GST or P&amp;L.
                    I read the live books, so every answer reflects real postings.
                  </p>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={cn("flex items-start gap-2", m.role === "user" && "flex-row-reverse")}>
                  <span
                    className={cn(
                      "h-6 w-6 rounded-full flex items-center justify-center shrink-0",
                      m.role === "user"
                        ? "bg-dmk-blue/20 border border-dmk-blue/40 text-dmk-blue"
                        : "bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow"
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
                className="h-11 w-full rounded-lg bg-dmk-input-well border border-dmk-border-subtle pl-3 pr-11 text-[13px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus:outline-none focus:border-dmk-yellow/50"
                aria-label="Ask AI Copilot"
              />
              <button
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-dmk-yellow text-[#0A0F1D] flex items-center justify-center disabled:opacity-40 transition-opacity"
                aria-label="Send question"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
              </button>
            </div>

            {/* Mobile quick asks — horizontal chips (rail hidden below lg) */}
            <div className="flex lg:hidden flex-wrap gap-1.5 mt-2.5">
              {SUGGESTIONS.flatMap((g) => g.items).slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="text-[11px] rounded-full border border-dmk-border-subtle bg-dmk-input-well px-2.5 py-1 text-dmk-text-secondary hover:border-dmk-yellow/40 hover:text-dmk-text-primary transition-colors text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Quick-ask rail (desktop) */}
          <aside className="hidden lg:flex flex-col rounded-xl border border-dmk-border-subtle bg-dmk-input-well/60 p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted mb-2.5">
              Quick asks
            </p>
            <div className="space-y-3 flex-1">
              {SUGGESTIONS.map((g) => (
                <div key={g.group}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-disabled mb-1">
                    {g.group}
                  </p>
                  <div className="space-y-1">
                    {g.items.map((s) => (
                      <button
                        key={s}
                        onClick={() => void send(s)}
                        className="block w-full text-left text-[11.5px] rounded-md border border-dmk-border-subtle bg-dmk-bg-secondary/60 px-2.5 py-1.5 text-dmk-text-secondary hover:border-dmk-yellow/40 hover:text-dmk-text-primary transition-colors leading-snug"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 pt-2.5 border-t border-dmk-border-subtle text-[10.5px] text-dmk-text-muted flex items-start gap-1.5 leading-snug">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-dmk-success mt-0.5" />
              Grounded on this firm&apos;s journals only — no data leaves your books.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
