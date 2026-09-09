"use client";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — DMK AI COPILOT (hero container at the top of the app)
// Two columns: LEFT = chat that fills the column with the input
// pinned to the BOTTOM of the container (messages grow above it,
// horizontal suggested-questions strip sits just above the input)
// · RIGHT = live Inventory Stock Alerts (out-of-stock + low-stock,
// auto-synced from /inventory/low-stock every 60s).
// Chat: POST /api/v1/ai/chat { firmId, message } → { reply }.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CornerDownLeft,
  Loader2,
  Mic,
  PackageX,
  Sparkles,
  User,
  Volume2,
} from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { streamCopilotChat } from "@/lib/copilot-stream";
import { useErpStore } from "@/store/erp-store";
import { useVoice } from "@/lib/voice";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Msg {
  id: number;
  role: "user" | "copilot";
  text: string;
}

/** Slice of GET /inventory/low-stock used by the right-column alerts panel. */
interface StockAlert {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  stockQuantity: number;
  damagedStock: number;
  purchaseCost: number;
  lowStockThreshold: number;
  shortfall: number;
  stockValue: number;
}

/** Suggested questions — one horizontally scrollable strip on every breakpoint. */
const SUGGESTIONS: Array<{ q: string; group: string; dot: string }> = [
  { q: "Today's sales and collections?", group: "Sales", dot: "#ffc300" },
  { q: "Top selling products this month?", group: "Sales", dot: "#ffc300" },
  { q: "Which products are low on stock?", group: "Stock", dot: "#22c55e" },
  { q: "How much damaged stock do I carry?", group: "Stock", dot: "#22c55e" },
  { q: "How is my cash + bank position?", group: "Finance", dot: "#38bdf8" },
  { q: "Top overdue customers this month?", group: "Finance", dot: "#38bdf8" },
];

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

let seq = 0;
const nextId = () => ++seq;

/** Light markdown for copilot bubbles: **bold** → strong, "* " bullets → •. */
function BoldParts({ line }: { line: string }) {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="text-dmk-text-primary font-semibold">
            {p}
          </strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </>
  );
}

function CopilotText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.replace(/^\s*\*\s+/, "• "));
  return (
    <>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && "\n"}
          <BoldParts line={line} />
        </React.Fragment>
      ))}
    </>
  );
}

// ── RIGHT column: live inventory stock alerts ───────────────────

function StockAlertRow({ alert }: { alert: StockAlert }) {
  const out = alert.stockQuantity <= 0;
  const low = !out && alert.stockQuantity <= alert.lowStockThreshold;
  // Fill ratio against the reorder threshold — 0 for out-of-stock.
  const fillPct =
    alert.lowStockThreshold > 0
      ? Math.max(0, Math.min(100, (alert.stockQuantity / alert.lowStockThreshold) * 100))
      : alert.stockQuantity > 0
        ? 100
        : 0;

  return (
    <li className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-dmk-text-primary truncate leading-tight">
            {alert.name}
          </p>
          <p className="text-[10px] text-dmk-text-muted truncate mt-0.5">
            {alert.sku}
            {alert.category ? ` · ${alert.category}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "dmk-badge h-5 px-1.5 text-[8.5px] shrink-0 font-bold tracking-wide",
            out
              ? "bg-dmk-danger/15 text-dmk-danger border border-dmk-danger/30"
              : "bg-dmk-warning/15 text-dmk-warning border border-dmk-warning/30"
          )}
        >
          {out ? "OUT" : "LOW"}
        </span>
      </div>

      {/* Stock vs threshold meter */}
      <div className="mt-2">
        <div className="h-1.5 rounded-full bg-dmk-border-subtle/60 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", out ? "bg-dmk-danger" : "bg-dmk-warning")}
            style={{ width: `${Math.max(fillPct, out ? 0 : 6)}%` }}
            role="progressbar"
            aria-label={`${alert.name} stock level`}
            aria-valuenow={alert.stockQuantity}
            aria-valuemin={0}
            aria-valuemax={alert.lowStockThreshold}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span className={cn("font-money font-semibold", out ? "text-dmk-danger" : "text-dmk-warning")}>
            {alert.stockQuantity} {alert.unit}
            <span className="text-dmk-text-muted font-normal"> / thr {alert.lowStockThreshold}</span>
          </span>
          <span className="text-dmk-text-muted">
            short <span className="font-money text-dmk-text-secondary">{alert.shortfall}</span>
            {alert.damagedStock > 0 && (
              <>
                {" · "}dmg <span className="text-dmk-text-secondary">{alert.damagedStock}</span>
              </>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

function StockAlertsPanel({ firmId }: { firmId: string | null }) {
  const setView = useErpStore((s) => s.setView);
  const [alerts, setAlerts] = React.useState<StockAlert[] | null>(null);
  const [syncing, setSyncing] = React.useState(false);

  const load = React.useCallback(() => {
    if (!firmId) return;
    setSyncing(true);
    apiGet<StockAlert[]>("/api/v1/inventory/low-stock", { firmId })
      .then((list) => setAlerts(Array.isArray(list) ? list : []))
      .catch(() => {
        /* panel keeps the last snapshot — chat is unaffected */
      })
      .finally(() => setSyncing(false));
  }, [firmId]);

  // Initial load + auto-refresh every 60s (live stock sync).
  React.useEffect(() => {
    if (!firmId) return;
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [firmId, load]);

  const outCount = alerts?.filter((a) => a.stockQuantity <= 0).length ?? 0;
  const lowCount = (alerts?.length ?? 0) - outCount;
  const restockCost =
    alerts?.reduce((sum, a) => sum + Math.max(0, a.shortfall) * a.purchaseCost, 0) ?? 0;

  return (
    <aside
      className="rounded-xl border border-dmk-border-subtle bg-dmk-bg-secondary/60 p-3.5 flex flex-col min-h-[340px] lg:min-h-0 lg:h-full"
      aria-label="Inventory stock alerts"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted flex items-center gap-1.5">
          <PackageX className="h-3.5 w-3.5 text-dmk-warning" />
          Inventory stock alerts
        </p>
        {alerts && alerts.length > 0 && (
          <span
            className={cn(
              "dmk-badge h-5 px-2 text-[9px] font-bold",
              outCount > 0
                ? "bg-dmk-danger/15 text-dmk-danger"
                : "bg-dmk-warning/15 text-dmk-warning"
            )}
          >
            {alerts.length} ALERT{alerts.length === 1 ? "" : "S"}
          </span>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
        <div className="rounded-lg bg-dmk-danger/10 border border-dmk-danger/20 px-2 py-1.5">
          <p className="text-[14px] font-bold text-dmk-danger font-money leading-none">{outCount}</p>
          <p className="text-[9px] text-dmk-text-muted mt-1 uppercase tracking-wide">Out of stock</p>
        </div>
        <div className="rounded-lg bg-dmk-warning/10 border border-dmk-warning/20 px-2 py-1.5">
          <p className="text-[14px] font-bold text-dmk-warning font-money leading-none">{lowCount}</p>
          <p className="text-[9px] text-dmk-text-muted mt-1 uppercase tracking-wide">Low stock</p>
        </div>
        <div className="rounded-lg bg-dmk-input-well border border-dmk-border-subtle px-2 py-1.5">
          <p className="text-[14px] font-bold text-dmk-text-primary font-money leading-none">
            {fmtMoney(restockCost)}
          </p>
          <p className="text-[9px] text-dmk-text-muted mt-1 uppercase tracking-wide">Restock est.</p>
        </div>
      </div>

      {/* Alert list (scrollable) */}
      {alerts === null ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-dmk-warning" />
          <p className="text-[11.5px] text-dmk-text-muted">Syncing live stock levels…</p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-dmk-success" />
          <p className="text-[12px] font-medium text-dmk-text-secondary">All stock levels are healthy</p>
          <p className="text-[11px] text-dmk-text-muted">
            Nothing is at or below its reorder threshold right now.
          </p>
        </div>
      ) : (
        <ul
          className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5 max-h-[320px] lg:max-h-none [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-dmk-border-medium [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
          aria-label="Products at or below reorder threshold"
        >
          {alerts.map((a) => (
            <StockAlertRow key={a.id} alert={a} />
          ))}
        </ul>
      )}

      <p className="mt-2.5 pt-2.5 border-t border-dmk-border-subtle text-[10.5px] text-dmk-text-muted flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 leading-snug">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              syncing ? "bg-dmk-yellow animate-pulse" : "bg-dmk-success"
            )}
            aria-hidden
          />
          {syncing ? "Syncing…" : "Auto-syncs with live stock"}
        </span>
        <button
          onClick={() => setView("inventory/low-stock")}
          className="text-[10.5px] font-semibold text-dmk-blue hover:underline shrink-0 inline-flex items-center gap-0.5"
        >
          Open inventory <ArrowRight className="h-3 w-3" />
        </button>
      </p>
    </aside>
  );
}

// ── Main container ──────────────────────────────────────────────

export function DashboardAiChat() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const lang = useErpStore((s) => s.language);
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [streamText, setStreamText] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const loadingRef = React.useRef(false);
  React.useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Voice (speech-to-speech): one-shot mic → send → spoken answer
  const voice = useVoice({
    lang,
    onFinalTranscript: (text) => {
      if (!loadingRef.current) void send(text, true);
    },
  });

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading, streamText]);

  // Prefetch: fire-and-forget empty ask warms the server-side snapshot
  // cache so the first question starts streaming immediately.
  React.useEffect(() => {
    if (!activeFirmId) return;
    fetch("/api/v1/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firmId: activeFirmId, message: "" }),
    }).catch(() => {
      /* prefetch is best-effort */
    });
  }, [activeFirmId]);

  async function send(text?: string, viaVoice = false) {
    const message = (text ?? input).trim();
    if (!message || loading || !activeFirmId) return;
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: message }]);
    setInput("");
    setLoading(true);
    setStreamText("");

    // Last 8 turns ride along so follow-ups keep their context
    const history = messages.slice(-8).map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    }));

    let streamFailed = false;
    try {
      await streamCopilotChat(
        { firmId: activeFirmId, message, history, language: lang, spoken: viaVoice },
        {
          onDelta: (_delta, full) => {
            setStreamText(full);
            voice.speakStreamed(full, false);
          },
          onDone: (full) => {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), role: "copilot", text: full || "I could not generate a response — try again." },
            ]);
            voice.flushSpeaking(full || "", false);
          },
          onError: (msg) => {
            streamFailed = true;
            toast({ variant: "destructive", title: "AI Copilot unavailable", description: msg });
          },
        }
      );
    } catch (e) {
      streamFailed = true;
      toast({
        variant: "destructive",
        title: "AI Copilot unavailable",
        description: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      // Preserve any partial answer produced before a mid-stream error.
      setStreamText((partial) => {
        if (streamFailed && partial) {
          voice.flushSpeaking(partial, false);
          setMessages((prev) =>
            prev.some((m) => m.text === partial)
              ? prev
              : [...prev, { id: nextId(), role: "copilot" as const, text: partial }]
          );
        }
        return "";
      });
      setLoading(false);
    }
  }

  return (
    <section aria-label="DMK AI Copilot" className="dmk-card relative overflow-hidden">
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

        {/* Body: LEFT chat (input pinned to the bottom) · RIGHT live stock alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] lg:h-[450px] gap-4">
          {/* ── LEFT: chat interface, composer anchored at the bottom ── */}
          <div className="min-w-0 flex flex-col min-h-0">
            <div
              ref={scrollRef}
              className="flex-1 min-h-[150px] max-h-[280px] lg:max-h-none overflow-y-auto space-y-2 pr-1"
              aria-label="Copilot conversation"
            >
              {messages.length === 0 && !loading && (
                <div className="flex items-start gap-2">
                  <span className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow">
                    <Bot className="h-3 w-3" />
                  </span>
                  <p className="max-w-[82%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary">
                    Ask me anything about this firm — sales, receivables, stock, GST or P&amp;L.
                    I read the live books, so every answer reflects real postings — and the
                    stock alerts on the right stay live.
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
                    {m.role === "copilot" ? <CopilotText text={m.text} /> : m.text}
                  </p>
                </div>
              ))}

              {/* Streaming answer — paints token-by-token */}
              {loading && streamText && (
                <div className="flex items-start gap-2">
                  <span className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow">
                    <Bot className="h-3 w-3" />
                  </span>
                  <p className="max-w-[82%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary">
                    <CopilotText text={streamText} />
                    <span className="inline-block w-1.5 h-3.5 ml-0.5 align-text-bottom bg-dmk-yellow animate-pulse rounded-[1px]" aria-hidden />
                  </p>
                </div>
              )}
              {loading && !streamText && (
                <div className="flex items-center gap-2 text-[12px] text-dmk-text-muted pl-8">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Copilot is checking the books…
                </div>
              )}
            </div>

            {/* Horizontally scrolling suggested questions (sit just above the composer) */}
            <div className="relative mt-2.5">
              <div
                className="flex gap-1.5 overflow-x-auto pb-1.5 -mx-1 px-1 scroll-smooth [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-dmk-border-medium [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
                role="listbox"
                aria-label="Suggested questions"
              >
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.q}
                    role="option"
                    aria-selected={false}
                    title={s.group}
                    onClick={() => void send(s.q)}
                    disabled={loading}
                    className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dmk-border-subtle bg-dmk-input-well px-3 py-1.5 text-[11.5px] text-dmk-text-secondary hover:border-dmk-yellow/40 hover:text-dmk-text-primary transition-colors disabled:opacity-50"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ background: s.dot }}
                      aria-hidden="true"
                    />
                    {s.q}
                  </button>
                ))}
              </div>
              {/* Right-edge fade hinting the strip scrolls */}
              <div
                className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#0A0F1D] to-transparent"
                aria-hidden="true"
              />
            </div>

            {/* Input — pinned to the bottom of the container */}
            <div className="relative mt-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={voice.listening ? "Listening… speak now" : "Ask about sales, stock, receivables, P&L…"}
                className="h-11 w-full rounded-lg bg-dmk-input-well border border-dmk-border-subtle pl-3 pr-[72px] text-[13px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus:outline-none focus:border-dmk-yellow/50"
                aria-label="Ask AI Copilot"
              />
              {/* Voice mic — speech-to-speech */}
              <button
                onClick={() => (voice.listening ? void voice.stopListening() : void voice.startListening())}
                disabled={loading}
                className={cn(
                  "absolute right-9.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md flex items-center justify-center transition-colors disabled:opacity-40",
                  voice.listening
                    ? "bg-dmk-danger text-white animate-pulse"
                    : "bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-yellow"
                )}
                aria-label={voice.listening ? "Stop listening" : "Ask by voice"}
                title={voice.listening ? "Stop listening" : "Ask by voice (speech-to-speech)"}
              >
                {voice.speaking ? <Volume2 className="h-4 w-4 text-dmk-success" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md bg-dmk-yellow text-[#0A0F1D] flex items-center justify-center disabled:opacity-40 transition-opacity"
                aria-label="Send question"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* ── RIGHT: live inventory stock alerts ── */}
          <StockAlertsPanel firmId={activeFirmId} />
        </div>
      </div>
    </section>
  );
}
