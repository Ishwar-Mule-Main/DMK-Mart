"use client";

// ═══════════════════════════════════════════════════════════════
// DASHBOARD — DMK AI COPILOT (hero container at the top of the app)
// Two columns: LEFT = chat with horizontally scrolling suggested
// questions · RIGHT = automated visualization that redraws from the
// grounded snapshot for every copilot answer (line / bars / donut).
// POST /api/v1/ai/chat { firmId, message } → { reply, chart }.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
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
import type { CopilotChart } from "@/types/erp";

interface Msg {
  id: number;
  role: "user" | "copilot";
  text: string;
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

const DONUT_PALETTE = ["#ffc300", "#2563eb", "#22c55e", "#ef4444", "#38bdf8"];

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "#0D1527",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 10,
  fontSize: 11,
  padding: "6px 10px",
  color: "#e6e9f0",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

const AXIS_TICK = { fill: "#8b93a7", fontSize: 10 };

function fmtMoney(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function compactMoney(n: number): string {
  return `₹${Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
}

function compactNum(n: number): string {
  return Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
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

// ── Right-column visual renderers ───────────────────────────────

function TrendViz({ chart }: { chart: Extract<CopilotChart, { kind: "line" }> }) {
  return (
    <ResponsiveContainer width="100%" height={225}>
      <AreaChart data={chart.points} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="copilotTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffc300" stopOpacity={0.32} />
            <stop offset="100%" stopColor="#ffc300" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={4} />
        <YAxis
          tickFormatter={(v: number) => compactMoney(v)}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [fmtMoney(Number(value)), "Billed"]}
          cursor={{ stroke: "rgba(255,195,0,0.35)", strokeDasharray: "4 4" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#ffc300"
          strokeWidth={2}
          fill="url(#copilotTrendFill)"
          dot={{ r: 2.5, fill: "#ffc300", strokeWidth: 0 }}
          activeDot={{ r: 4.5, fill: "#ffc300", stroke: "#0A0F1D", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function HBarViz({ chart }: { chart: Extract<CopilotChart, { kind: "hbar" }> }) {
  const fmt = (n: number) => (chart.unit === "inr" ? fmtMoney(n) : `${n}`);
  return (
    <ResponsiveContainer width="100%" height={Math.max(170, chart.items.length * 46 + 24)}>
      <BarChart data={chart.items} layout="vertical" margin={{ top: 4, right: 52, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => (chart.unit === "inr" ? compactMoney(v) : compactNum(v))}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          tick={{ fill: "#c3c9d6", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: string) => (v.length > 15 ? `${v.slice(0, 14)}…` : v)}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _name, item) => {
            const hint = (item?.payload as { hint?: string } | undefined)?.hint;
            return [fmt(Number(value)), hint || chart.title];
          }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={15}>
          {chart.items.map((it, i) => (
            <Cell
              key={i}
              fill={it.color ?? (chart.unit === "inr" ? "#ffc300" : "#38bdf8")}
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            fontSize={9.5}
            fill="#8b93a7"
            formatter={(l: React.ReactNode) =>
              chart.unit === "inr" ? compactMoney(Number(l)) : compactNum(Number(l))
            }
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DonutViz({ chart }: { chart: Extract<CopilotChart, { kind: "donut" }> }) {
  const slices = chart.slices.filter((s) => s.value > 0);
  return (
    <div>
      <div className="relative">
        <ResponsiveContainer width="100%" height={165}>
          <PieChart>
            <Pie
              data={slices.length > 0 ? slices : [{ label: "None", value: 1, color: "#2a3247" }]}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="90%"
              paddingAngle={slices.length > 1 ? 3 : 0}
              stroke="none"
              startAngle={90}
              endAngle={-270}
            >
              {(slices.length > 0 ? slices : [{ color: "#2a3247" }]).map((s, i) => (
                <Cell key={i} fill={s.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => [fmtMoney(Number(value)), String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-[9px] uppercase tracking-wider text-dmk-text-muted">{chart.centerLabel}</p>
          <p className="text-[15px] font-bold text-dmk-text-primary font-money leading-tight">
            {fmtMoney(chart.centerValue)}
          </p>
        </div>
      </div>
      {/* Legend with values */}
      <div className="mt-2 space-y-1">
        {chart.slices.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 text-[11px]">
            <span
              className="h-2 w-2 rounded-sm shrink-0"
              style={{ background: s.color ?? DONUT_PALETTE[i % DONUT_PALETTE.length] }}
              aria-hidden
            />
            <span className="text-dmk-text-secondary truncate flex-1">{s.label}</span>
            <span className="font-money font-semibold text-dmk-text-primary">{fmtMoney(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VisualAnswer({ chart, updating }: { chart: CopilotChart | null; updating: boolean }) {
  if (!chart) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-dmk-yellow" />
        <p className="text-[11.5px] text-dmk-text-muted">Reading the books to draw your first visual…</p>
      </div>
    );
  }
  const empty =
    (chart.kind === "line" && chart.points.length === 0) ||
    (chart.kind === "hbar" && chart.items.length === 0) ||
    (chart.kind === "donut" && chart.slices.every((s) => s.value <= 0));

  return (
    <div key={`${chart.topic}-${chart.title}`} className="dmk-enter flex flex-col flex-1 min-h-0">
      {empty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <BarChart3 className="h-6 w-6 text-dmk-text-disabled" />
          <p className="text-[12px] font-medium text-dmk-text-secondary">Nothing to chart here yet</p>
          <p className="text-[11px] text-dmk-text-muted">The books show no matching data for this question.</p>
        </div>
      ) : chart.kind === "line" ? (
        <TrendViz chart={chart} />
      ) : chart.kind === "hbar" ? (
        <HBarViz chart={chart} />
      ) : (
        <DonutViz chart={chart} />
      )}
      {updating && (
        <p className="mt-1 text-[10.5px] text-dmk-text-muted flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Updating the visual from the latest answer…
        </p>
      )}
    </div>
  );
}

// ── Main container ──────────────────────────────────────────────

export function DashboardAiChat() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const { toast } = useToast();

  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [chart, setChart] = React.useState<CopilotChart | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Resting visual: 7-day sales trend (server answers without an LLM call).
  React.useEffect(() => {
    if (!activeFirmId) return;
    let cancelled = false;
    apiPost<{ chart?: CopilotChart }>("/api/v1/ai/chat", { firmId: activeFirmId, message: "" })
      .then((res) => {
        if (!cancelled && res.chart) setChart(res.chart);
      })
      .catch(() => {
        /* the chat itself still works — visual just stays on the greeting */
      });
    return () => {
      cancelled = true;
    };
  }, [activeFirmId]);

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
      const res = await apiPost<{ reply: string; chart?: CopilotChart }>("/api/v1/ai/chat", {
        firmId: activeFirmId,
        message,
      });
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "copilot", text: res.reply || "I could not generate a response — try again." },
      ]);
      if (res.chart) setChart(res.chart);
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

        {/* Body: LEFT chat + horizontal asks · RIGHT live visual */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
          {/* ── LEFT: chat interface ── */}
          <div className="min-w-0 flex flex-col">
            <div
              ref={scrollRef}
              className="min-h-[150px] max-h-[260px] overflow-y-auto space-y-2 pr-1 mb-3"
            >
              {messages.length === 0 && !loading && (
                <div className="flex items-start gap-2">
                  <span className="h-6 w-6 rounded-full flex items-center justify-center shrink-0 bg-dmk-yellow/15 border border-dmk-yellow/30 text-dmk-yellow">
                    <Bot className="h-3 w-3" />
                  </span>
                  <p className="max-w-[82%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed bg-dmk-input-well border border-dmk-border-subtle text-dmk-text-secondary">
                    Ask me anything about this firm — sales, receivables, stock, GST or P&amp;L.
                    I read the live books, so every answer reflects real postings — and the visual
                    on the right redraws with each answer.
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

            {/* Horizontally scrolling suggested questions (all breakpoints) */}
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
          </div>

          {/* ── RIGHT: automated visual from the copilot's answer ── */}
          <aside
            className="rounded-xl border border-dmk-border-subtle bg-dmk-bg-secondary/60 p-3.5 flex flex-col min-h-[330px]"
            aria-label="Copilot visual answer"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-dmk-yellow" />
                Visual answer
              </p>
              {chart && (
                <span
                  className={cn(
                    "dmk-badge h-5 px-2 text-[9px] bg-dmk-yellow/12 text-dmk-yellow",
                    loading && "animate-pulse"
                  )}
                >
                  {loading ? "UPDATING…" : chart.topic}
                </span>
              )}
            </div>
            {chart && (
              <>
                <p className="text-[12.5px] font-semibold text-dmk-text-primary leading-tight">{chart.title}</p>
                <p className="text-[10.5px] text-dmk-text-muted mb-2.5">{chart.subtitle}</p>
              </>
            )}
            <VisualAnswer chart={chart} updating={loading} />
            <p className="mt-3 pt-2.5 border-t border-dmk-border-subtle text-[10.5px] text-dmk-text-muted flex items-start gap-1.5 leading-snug">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-dmk-success mt-0.5" />
              Charted from this firm&apos;s journals only — no data leaves your books.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
