"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — VOICE ENGINE (speech ⇄ speech, en/hi/mr)
// ═══════════════════════════════════════════════════════════════
// SPEECH IN  → Web Speech API recognition, on-device (Chrome/Edge):
//              live interim words, ~0 ms upload latency. Fallback:
//              MediaRecorder clip → POST /api/v1/ai/asr.
// SPEECH OUT → sentence-by-sentence speechSynthesis starting the
//              moment the first sentence of the streamed answer is
//              complete (audio begins while the rest still streams).
//              If the browser has no voice for hi/mr, falls back to
//              POST /api/v1/ai/tts (server-rendered WAV, cached).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import type { Lang } from "@/lib/i18n";

// ── Minimal Web Speech typings (not all TS dom libs ship them) ──
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { readonly length: number; isFinal: boolean; [i: number]: SRAlternative }
interface SRResultList { readonly length: number; [i: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string }
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const SPEECH_LANG_TAGS: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

// ── Sentence segmentation (Latin + Devanagari danda) ────────────
function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[।.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

/** Markdown → clean speakable prose. */
function toSpeakable(text: string): string {
  return text
    .replace(/[*_#`>|]/g, " ")
    .replace(/\s*[-—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── TTS speaker: on-device voices first, server WAV fallback ────
class AnswerSpeaker {
  private queue: string[] = [];
  /** True while any sentence is being spoken or queued (readable by the hook). */
  speaking = false;
  private stopped = false;
  private serverAudio: HTMLAudioElement | null = null;
  /** How many sentences of the CURRENT answer were already handed to speak(). */
  spokenCount = 0;
  onDone: (() => void) | null = null;
  onStart: (() => void) | null = null;

  async speak(text: string, lang: Lang) {
    const clean = toSpeakable(text);
    if (!clean) return;
    const sentences = splitSentences(clean);
    // Speak the FIRST sentence immediately, then queue the rest —
    // audio starts ~while generation continues.
    if (!this.speaking) {
      this.speaking = true;
      this.onStart?.();
      await this.speakOne(sentences.shift() ?? "", lang);
    }
    this.queue.push(...sentences);
    void this.drain(lang);
  }

  private async drain(lang: Lang) {
    while (this.queue.length > 0 && !this.stopped) {
      const next = this.queue.shift()!;
      await this.speakOne(next, lang);
    }
    if (this.queue.length === 0 && !this.stopped) {
      // wait for any in-flight utterance/audio then finish
      this.finishIfIdle();
    }
  }

  private finishIfIdle() {
    const synthSpeaking =
      typeof speechSynthesis !== "undefined" && speechSynthesis.speaking;
    if (!synthSpeaking && !this.serverAudio) {
      this.speaking = false;
      this.onDone?.();
    }
  }

  private speakOne(sentence: string, lang: Lang): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped || !sentence) return resolve();
      const tag = SPEECH_LANG_TAGS[lang];

      // 1) on-device voice — instant
      if (typeof speechSynthesis !== "undefined" && speechSynthesis.getVoices) {
        const voices = speechSynthesis.getVoices();
        const voice =
          voices.find((v) => v.lang?.toLowerCase() === tag.toLowerCase()) ??
          voices.find((v) => v.lang?.toLowerCase().startsWith(lang)) ??
          (lang === "en" ? voices.find((v) => v.lang?.toLowerCase().startsWith("en")) : undefined);
        if (voice) {
          const u = new SpeechSynthesisUtterance(sentence);
          u.voice = voice;
          u.lang = voice.lang;
          u.rate = 1.02;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          speechSynthesis.speak(u);
          return;
        }
      }

      // 2) server fallback — POST /api/v1/ai/tts (cached server-side)
      fetch("/api/v1/ai/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence, lang }),
      })
        .then(async (r) => {
          if (!r.ok) return resolve();
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          this.serverAudio = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            this.serverAudio = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            this.serverAudio = null;
            resolve();
          };
          void audio.play().catch(() => resolve());
        })
        .catch(() => resolve());
    });
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    if (this.serverAudio) {
      this.serverAudio.pause();
      this.serverAudio = null;
    }
    this.speaking = false;
  }

  reset() {
    this.stopped = false;
    this.speaking = false;
    this.queue = [];
  }
}

// ── Recorder fallback (browsers without Web Speech) ─────────────
class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(stream);
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start();
  }
  stop(): Promise<string | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec) return resolve(null);
      rec.onstop = async () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) return resolve(null); // silence / too short
        const b64 = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
          fr.readAsDataURL(blob);
        });
        try {
          const r = await fetch("/api/v1/ai/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: b64 }),
          });
          const j = (await r.json()) as { text?: string };
          resolve(j.text ?? null);
        } catch {
          resolve(null);
        }
      };
      rec.stop();
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// useVoice — the React hook used by the copilot UIs
// ═══════════════════════════════════════════════════════════════
export interface UseVoiceOptions {
  /** UI language — drives the recognition + voice language tag. */
  lang: Lang;
  /** Called with the FINAL transcript (web-speech or clip fallback). */
  onFinalTranscript: (text: string) => void;
  /** Called once when the spoken answer finishes (hands-free loop). */
  onAnswerSpoken?: () => void;
}

export function useVoice({ lang, onFinalTranscript, onAnswerSpoken }: UseVoiceOptions) {
  const [supported, setSupported] = React.useState(true);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState("");
  const [speaking, setSpeaking] = React.useState(false);
  const [micError, setMicError] = React.useState<string | null>(null);

  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const clipRef = React.useRef<ClipRecorder | null>(null);
  const speakerRef = React.useRef<AnswerSpeaker | null>(null);
  const wantListeningRef = React.useRef(false);
  const transcriptHandler = React.useRef(onFinalTranscript);
  const spokenHandler = React.useRef(onAnswerSpoken);
  const langRef = React.useRef(lang);

  if (speakerRef.current == null) speakerRef.current = new AnswerSpeaker();

  // Keep the latest callbacks/lang reachable from event-time closures
  // without re-binding the recognition object on every render.
  React.useEffect(() => {
    transcriptHandler.current = onFinalTranscript;
    spokenHandler.current = onAnswerSpoken;
    langRef.current = lang;
  });

  React.useEffect(() => {
    setSupported(getSRCtor() !== null || (typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined"));
    // Prime the voice list (Chrome loads it async)
    if (typeof speechSynthesis !== "undefined") {
      const warm = () => speechSynthesis.getVoices();
      warm();
      speechSynthesis.addEventListener?.("voiceschanged", warm);
      return () => speechSynthesis.removeEventListener?.("voiceschanged", warm);
    }
  }, []);

  const stopSpeaking = React.useCallback(() => {
    if (speakerRef.current) speakerRef.current.spokenCount = 0;
    speakerRef.current?.stop();
    setSpeaking(false);
  }, []);

  /** Speak a (possibly partial) streamed answer — call with the FULL text each delta. */
  const speakStreamed = React.useCallback(
    (fullText: string, muted: boolean) => {
      if (muted) return;
      const sp = speakerRef.current;
      if (!sp) return;
      const clean = toSpeakable(fullText);
      const sentences = splitSentences(clean);
      if (sentences.length === 0) return;
      // Speak only complete sentences; the final one arrives via flush.
      const complete = sentences.slice(0, -1);
      const spokenSoFar = sp.spokenCount;
      if (complete.length > spokenSoFar) {
        const fresh = complete.slice(spokenSoFar);
        sp.spokenCount = complete.length;
        for (const s of fresh) void sp.speak(s, langRef.current);
        setSpeaking(true);
      }
    },
    []
  );

  /** Speak any leftover tail and finish. */
  const flushSpeaking = React.useCallback((fullText: string, muted: boolean) => {
    if (muted) {
      setSpeaking(false);
      return;
    }
    const sp = speakerRef.current;
    if (!sp) return;
    const clean = toSpeakable(fullText);
    const sentences = splitSentences(clean);
    const spokenSoFar = sp.spokenCount;
    const tail = sentences.slice(spokenSoFar);
    sp.spokenCount = sentences.length;
    if (tail.length > 0) {
      for (const s of tail) void sp.speak(s, langRef.current);
      setSpeaking(true);
    } else if (!sp.speaking && sentences.length === 0) {
      setSpeaking(false);
    }
    // Answer finished speaking → hands-free loop callback
    const wait = setInterval(() => {
      const busy =
        (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking) || sp.speaking;
      if (!busy) {
        clearInterval(wait);
        setSpeaking(false);
        spokenHandler.current?.();
      }
    }, 250);
  }, []);

  const startListening = React.useCallback(async () => {
    setMicError(null);
    stopSpeaking();
    if (speakerRef.current) {
      speakerRef.current.reset();
      speakerRef.current.spokenCount = 0;
    }
    wantListeningRef.current = true;

    const SRCtor = getSRCtor();
    if (SRCtor) {
      try {
        const rec = new SRCtor();
        rec.lang = SPEECH_LANG_TAGS[langRef.current];
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onstart = () => setListening(true);
        rec.onresult = (e: SREvent) => {
          let interimText = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) {
              const finalText = res[0].transcript.trim();
              if (finalText) transcriptHandler.current(finalText);
            } else {
              interimText += res[0].transcript;
            }
          }
          setInterim(interimText);
        };
        rec.onerror = (e: SRErrorEvent) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setMicError("denied");
            wantListeningRef.current = false;
            setListening(false);
          } else if (e.error === "no-speech") {
            // ignore — recognition restarts via onend
          }
        };
        rec.onend = () => {
          setInterim("");
          // Hands-free: keep the mic alive until the user stops it.
          if (wantListeningRef.current) {
            try {
              rec.start();
            } catch {
              setListening(false);
            }
          } else {
            setListening(false);
          }
        };
        recRef.current = rec;
        rec.start();
      } catch {
        setMicError("denied");
        setListening(false);
      }
      return;
    }

    // Fallback: record a clip → server ASR
    if (typeof navigator !== "undefined" && navigator.mediaDevices && typeof MediaRecorder !== "undefined") {
      try {
        const clip = new ClipRecorder();
        await clip.start();
        clipRef.current = clip;
        setListening(true);
      } catch {
        setMicError("denied");
        setListening(false);
      }
    } else {
      setSupported(false);
    }
  }, [stopSpeaking]);

  const stopListening = React.useCallback(async () => {
    wantListeningRef.current = false;
    setInterim("");
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      setListening(false);
      return;
    }
    const clip = clipRef.current;
    if (clip) {
      const text = await clip.stop();
      clipRef.current = null;
      setListening(false);
      if (text) transcriptHandler.current(text);
    }
  }, []);

  const stopAll = React.useCallback(() => {
    wantListeningRef.current = false;
    void stopListening();
    stopSpeaking();
  }, [stopListening, stopSpeaking]);

  // Unmount safety: never leave the mic/speaker on
  React.useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      speakerRef.current?.stop();
    };
  }, []);

  return {
    supported,
    listening,
    interim,
    speaking,
    micError,
    startListening,
    stopListening,
    stopSpeaking,
    stopAll,
    speakStreamed,
    flushSpeaking,
  };
}
