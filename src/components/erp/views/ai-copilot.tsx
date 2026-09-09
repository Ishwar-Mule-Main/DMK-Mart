"use client";

// ═══════════════════════════════════════════════════════════════
// AI INTELLIGENCE — DMK MART COPILOT (text + SPEECH-TO-SPEECH)
// POST /api/v1/ai/chat { firmId, message, language, spoken }
// Grounded in the active firm's data snapshot (server-side ZAI call).
//
// VOICE MODE: mic → on-device Web Speech recognition (en-IN/hi-IN/
// mr-IN) → auto-send with spoken:true → streamed answer spoken back
// sentence-by-sentence while tokens still arrive. Hands-free keeps
// the loop going. Server /api/v1/ai/tts + /api/v1/ai/asr are the
// fallbacks (no local voice / no Web Speech API).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Bot, Info, Send, Sparkles, User, TrendingUp, PackageSearch, Wallet, Landmark,
  Mic, MicOff, Volume2, VolumeX, Repeat, Radio,
} from "lucide-react";

import { PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { streamCopilotChat } from "@/lib/copilot-stream";
import { useErpStore } from "@/store/erp-store";
import { useT, LANG_META, type Lang } from "@/lib/i18n";
import { useVoice } from "@/lib/voice";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "copilot";
  text: string;
  /** This message was produced in voice mode (shows a speaker chip). */
  viaVoice?: boolean;
}

/** Suggested prompts — localized question banks per UI language. */
const SUGGESTIONS_BY_LANG: Record<Lang, Array<{
  category: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  iconClass: string;
  questions: string[];
}>> = {
  en: [
    { category: "Sales & profit", icon: TrendingUp, iconClass: "text-dmk-yellow", questions: ["What is my gross profit this month?", "Which product makes me the most money?", "How were sales in the last 7 days?"] },
    { category: "Cash & receivables", icon: Wallet, iconClass: "text-dmk-success", questions: ["Who owes me the most?", "How much cash do I have right now?", "Which invoices are overdue?"] },
    { category: "Stock & purchases", icon: PackageSearch, iconClass: "text-dmk-gold", questions: ["Which products are low on stock?", "Show damaged stock summary", "What did I buy from Sri Balaji?"] },
    { category: "Books & GST", icon: Landmark, iconClass: "text-dmk-info", questions: ["How much GST do I owe this month?", "What are my total expenses?", "Summarize my payables"] },
  ],
  hi: [
    { category: "बिक्री और मुनाफ़ा", icon: TrendingUp, iconClass: "text-dmk-yellow", questions: ["इस महीने मेरा सकल लाभ कितना है?", "कौन सा उत्पाद मुझे सबसे ज़्यादा कमाई देता है?", "पिछले 7 दिन की बिक्री कैसी रही?"] },
    { category: "नकद और प्राप्य", icon: Wallet, iconClass: "text-dmk-success", questions: ["मुझसे सबसे ज़्यादा कौन उधारी में है?", "अभी मेरे पास कितनी नकद है?", "कौन से इनवॉइस अतिदेय हैं?"] },
    { category: "स्टॉक और खरीद", icon: PackageSearch, iconClass: "text-dmk-gold", questions: ["किन उत्पादों में स्टॉक कम है?", "क्षतिग्रस्त स्टॉक का सारांश दिखाएँ", "मैंने Sri Balaji से क्या खरीदा?"] },
    { category: "बहियाँ और GST", icon: Landmark, iconClass: "text-dmk-info", questions: ["इस महीने मुझ पर कितना GST बाकी है?", "मेरे कुल खर्चे कितने हैं?", "मेरे देयकों का सारांश दें"] },
  ],
  mr: [
    { category: "विक्री आणि नफा", icon: TrendingUp, iconClass: "text-dmk-yellow", questions: ["या महिन्यात माझा एकूण नफा किती आहे?", "कोणते उत्पादन मला सर्वात जास्त कमाई देते?", "गेल्या 7 दिवसांतील विक्री कशी होती?"] },
    { category: "रोख आणि प्राप्य", icon: Wallet, iconClass: "text-dmk-success", questions: ["माझ्याकडे सर्वात जास्त उधारी कोणाची आहे?", "आत्ता माझ्याकडे किती रोख आहे?", "कोणती इन्व्हॉइस मुदतीनंतर आहेत?"] },
    { category: "साठा आणि खरेदी", icon: PackageSearch, iconClass: "text-dmk-gold", questions: ["कोणती उत्पादने कमी साठ्यावर आहेत?", "नुकसान साठ्याचा सारांश दाखवा", "मी Sri Balaji कडून काय खरेदी केले?"] },
    { category: "वह्या आणि GST", icon: Landmark, iconClass: "text-dmk-info", questions: ["या महिन्यात माझा किती GST बाकी आहे?", "माझे एकूण खर्च किती आहेत?", "माझी देयके सारांशित करा"] },
  ],
};

let msgSeq = 0;
function nextMsgId(): string {
  msgSeq += 1;
  return `m${Date.now()}-${msgSeq}`;
}

export default function AiCopilotView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
  const lang = useErpStore((s) => s.language);
  const { toast } = useToast();
  const { t } = useT();

  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [streamText, setStreamText] = React.useState("");

  // ── Voice state ────────────────────────────────────────────────
  const [voiceMode, setVoiceMode] = React.useState(false); // voice panel visible
  const [handsFree, setHandsFree] = React.useState(false);
  const [muted, setMuted] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const loadingRef = React.useRef(false);
  const handsFreeRef = React.useRef(handsFree);
  const mutedRef = React.useRef(muted);
  React.useEffect(() => {
    loadingRef.current = loading;
    handsFreeRef.current = handsFree;
    mutedRef.current = muted;
  }, [loading, handsFree, muted]);

  // Rotating follow-up suggestions while a conversation is active
  const SUGGESTION_GROUPS = SUGGESTIONS_BY_LANG[lang];
  const ALL_SUGGESTIONS = React.useMemo(() => SUGGESTION_GROUPS.flatMap((g) => g.questions), [SUGGESTION_GROUPS]);
  const [followUps, setFollowUps] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (messages.length === 0) {
      setFollowUps([]);
      return;
    }
    const pool = ALL_SUGGESTIONS.filter((q) => !messages.some((m) => m.role === "user" && m.text === q));
    const picked: string[] = [];
    let i = Math.floor(Date.now() / 60000);
    while (picked.length < 3 && pool.length > 0) {
      i += 1;
      picked.push(pool.splice(i % pool.length, 1)[0]);
    }
    setFollowUps(picked);
  }, [messages, ALL_SUGGESTIONS]);

  // Reset session when the active firm or language changes
  React.useEffect(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
    setStreamText("");
  }, [activeFirmId, lang]);

  // Prefetch: fire-and-forget empty ask warms the server-side snapshot
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

  // Keep the newest message in view
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, loading, streamText]);

  const voice = useVoice({
    lang,
    onFinalTranscript: (text) => {
      if (!loadingRef.current) void send(text, true);
    },
    onAnswerSpoken: () => {
      if (handsFreeRef.current && !loadingRef.current) void voice.startListening();
    },
  });

  async function send(text?: string, viaVoice = false) {
    const message = (text ?? input).trim();
    if (!message || loading || !activeFirmId) return;

    const userMsg: ChatMessage = { id: nextMsgId(), role: "user", text: message, viaVoice };
    setMessages((prev) => [...prev, userMsg]);
    if (!viaVoice) setInput("");
    setLoading(true);
    setStreamText("");

    // Last 8 turns ride along so follow-ups keep their context
    const history = messages
      .slice(-8)
      .map((m) => ({
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
            voice.speakStreamed(full, mutedRef.current);
          },
          onDone: (full) => {
            const finalText = full || "I could not generate a response. Please try again.";
            setMessages((prev) => [...prev, { id: nextMsgId(), role: "copilot", text: finalText, viaVoice }]);
            voice.flushSpeaking(finalText, mutedRef.current);
          },
          onError: (msg) => {
            streamFailed = true;
            toast({ variant: "destructive", title: t("cop.unavailable"), description: msg });
          },
        }
      );
    } catch (e) {
      streamFailed = true;
      const msg = e instanceof Error ? e.message : "Copilot request failed";
      toast({ variant: "destructive", title: t("cop.unavailable"), description: msg });
    } finally {
      // If the stream errored mid-way, keep any partial text so the
      // user still sees what was generated before the failure.
      setStreamText((partial) => {
        if (streamFailed && partial) {
          if (!mutedRef.current) voice.flushSpeaking(partial, false);
          setMessages((prev) =>
            prev.some((m) => m.text === partial)
              ? prev
              : [...prev, { id: nextMsgId(), role: "copilot" as const, text: partial, viaVoice }]
          );
        }
        return "";
      });
      setLoading(false);
    }
  }

  const toggleMic = () => {
    if (voice.listening) void voice.stopListening();
    else void voice.startListening();
  };

  const stopVoiceMode = () => {
    setHandsFree(false);
    voice.stopAll();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("cop.title")}
        subtitle={t("cop.subtitle", { n: activeFirm?.firmName ?? "—" })}
        icon={Sparkles}
      />

      {/* Grounding note */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-dmk-info mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">{t("cop.groundedNote")}</p>
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
                <p className="text-[15px] font-semibold text-dmk-text-secondary">{t("cop.askAnything")}</p>
                <p className="text-[12px] text-dmk-text-muted mt-1 max-w-sm">{t("cop.askHint")}</p>
              </div>
              {/* Suggested questions — localized */}
              <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                {SUGGESTION_GROUPS.map((g) => {
                  const GIcon = g.icon;
                  return (
                    <div key={g.category} className="dmk-well p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <GIcon className={cn("h-3.5 w-3.5", g.iconClass)} strokeWidth={1.75} />
                        <span className="text-[10.5px] uppercase tracking-wider font-bold text-dmk-text-muted">{g.category}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {g.questions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => void send(s)}
                            className="text-left text-[12px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary transition-colors rounded-md px-2 py-1.5 -mx-2"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end gap-2.5">
                    <div className="max-w-[78%] sm:max-w-[65%] rounded-xl rounded-br-sm bg-[rgba(37,99,235,0.15)] border border-[rgba(37,99,235,0.3)] px-3.5 py-2.5">
                      {m.viaVoice && (
                        <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider font-bold text-dmk-info mb-1">
                          <Radio className="h-2.5 w-2.5" /> {t("voice.transcript")}
                        </span>
                      )}
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

              {/* Streaming answer — paints token-by-token */}
              {loading && streamText && (
                <div className="flex justify-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                    <Bot className="h-3.5 w-3.5 text-dmk-blue" />
                  </div>
                  <div className="max-w-[86%] sm:max-w-[75%] rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-3.5 py-2.5">
                    <p className="text-[13px] text-dmk-text-primary whitespace-pre-wrap break-words leading-relaxed">
                      {streamText}
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 align-text-bottom bg-dmk-yellow animate-pulse rounded-[1px]" aria-hidden />
                    </p>
                  </div>
                </div>
              )}

              {/* Typing indicator — three-dot pulse (until first token) */}
              {loading && !streamText && (
                <div className="flex justify-start gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dmk-input-well border border-dmk-border-subtle">
                    <Bot className="h-3.5 w-3.5 text-dmk-blue" />
                  </div>
                  <div className="rounded-xl rounded-bl-sm bg-dmk-bg-tertiary border border-dmk-border-subtle px-4 py-3">
                    <div className="flex items-center gap-1.5" aria-label={t("cop.thinking")}>
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

        {/* ── Voice bar (speech-to-speech) ─────────────────────── */}
        {voiceMode && (
          <div className="border-t border-dmk-border-subtle bg-gradient-to-b from-dmk-input-well/60 to-transparent p-3">
            <div className="flex items-center gap-3">
              {/* Mic button */}
              <button
                type="button"
                onClick={toggleMic}
                disabled={!voice.supported || !activeFirmId || loading}
                aria-label={voice.listening ? t("voice.stop") : t("voice.tapToSpeak")}
                className={cn(
                  "relative h-12 w-12 shrink-0 rounded-full flex items-center justify-center border transition-all disabled:opacity-40",
                  voice.listening
                    ? "bg-dmk-danger border-dmk-danger text-white shadow-[0_0_0_6px_rgba(239,68,68,0.15)]"
                    : "bg-dmk-yellow border-dmk-yellow text-[#0A0F1D] hover:brightness-110"
                )}
              >
                {voice.listening && (
                  <span className="absolute inset-0 rounded-full bg-dmk-danger/40 animate-ping" aria-hidden />
                )}
                {voice.listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              {/* Status */}
              <div className="min-w-0 flex-1">
                {voice.micError === "denied" ? (
                  <p className="text-[12px] text-dmk-danger font-medium">{t("voice.micDenied")}</p>
                ) : !voice.supported ? (
                  <p className="text-[12px] text-dmk-warning font-medium">{t("voice.micUnsupported")}</p>
                ) : voice.listening ? (
                  <p className="text-[12.5px] text-dmk-text-primary font-medium truncate">
                    <span className="text-dmk-danger">●</span> {t("voice.listening")} {voice.interim && <span className="text-dmk-text-muted italic">{voice.interim}</span>}
                  </p>
                ) : voice.speaking ? (
                  <p className="text-[12.5px] text-dmk-text-primary font-medium flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-dmk-success animate-pulse" /> {t("voice.speaking")}
                  </p>
                ) : (
                  <p className="text-[12.5px] text-dmk-text-secondary">{t("voice.tapToSpeak")}</p>
                )}
                <p className="text-[10px] text-dmk-text-muted mt-0.5 flex items-center gap-1.5">
                  <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary px-1.5 py-0">{LANG_META[lang].native}</span>
                  {t("cop.voiceHint")}
                </p>
              </div>

              {/* Controls: hands-free · mute · stop */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = !handsFree;
                    setHandsFree(next);
                    if (next && !voice.listening && !loading) void voice.startListening();
                  }}
                  className={cn(
                    "h-8 gap-1.5 text-[11px] border-dmk-border-subtle",
                    handsFree ? "bg-dmk-yellow/15 text-dmk-yellow border-dmk-yellow/40" : "bg-dmk-input-well text-dmk-text-secondary"
                  )}
                  aria-pressed={handsFree}
                  title={t("voice.handsFreeOn")}
                >
                  <Repeat className="h-3 w-3" />
                  {t("voice.handsFree")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (next) voice.stopSpeaking();
                  }}
                  className={cn(
                    "h-8 w-8 p-0 border-dmk-border-subtle",
                    muted ? "bg-dmk-input-well text-dmk-text-muted" : "bg-dmk-input-well text-dmk-success"
                  )}
                  aria-pressed={muted}
                  title={muted ? t("voice.unmute") : t("voice.mute")}
                >
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stopVoiceMode}
                  className="h-8 px-2.5 text-[11px] border-dmk-border-subtle bg-dmk-input-well text-dmk-danger hover:bg-dmk-danger/10"
                >
                  {t("voice.stop")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="border-t border-dmk-border-subtle bg-dmk-input-well/40 p-3">
          {/* Follow-up suggestions while chatting */}
          {messages.length > 0 && followUps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {followUps.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={loading}
                  className="dmk-well px-2.5 py-1 text-[11px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary transition-colors rounded-full disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Voice toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !voiceMode;
                setVoiceMode(next);
                if (!next) stopVoiceMode();
              }}
              aria-pressed={voiceMode}
              aria-label={t("cop.voiceMode")}
              title={t("cop.voiceMode")}
              className={cn(
                "h-9 w-9 shrink-0 rounded-lg border flex items-center justify-center transition-colors",
                voiceMode
                  ? "bg-dmk-yellow/15 border-dmk-yellow/50 text-dmk-yellow"
                  : "bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-text-primary hover:bg-dmk-hover"
              )}
            >
              <Mic className="h-4 w-4" />
            </button>
            <form
              className="flex items-center gap-2 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={activeFirmId ? t("cop.placeholder") : t("cop.selectFirmFirst")}
                disabled={!activeFirmId || loading}
                className={cn(inputCls, "flex-1")}
                aria-label={t("cop.send")}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!activeFirmId || loading || !input.trim()}
                className="h-9 w-9 shrink-0 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85 disabled:opacity-40"
                aria-label={t("cop.send")}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
          <p className="text-[10.5px] text-dmk-text-muted mt-2">
            {t("cop.streamNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
