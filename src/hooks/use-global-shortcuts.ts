"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — GLOBAL KEYBOARD SHORTCUTS (installed once in the shell)
// Implements every shortcut declared in shortcuts-registry.ts:
//   ⌘K/Ctrl+K palette (handled in command-palette.tsx)
//   ? → shortcuts help · / → search · G→<key> navigation chords
//   Alt+L → cycle UI language (EN → हिंदी → मराठी)
// All ignored while typing in inputs/textareas/contenteditable.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { G_CHORDS } from "@/lib/shortcuts-registry";
import { useErpStore, type ViewId, type UiLanguage } from "@/store/erp-store";

const LANG_CYCLE: UiLanguage[] = ["en", "hi", "mr"];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable || target.getAttribute("role") === "textbox";
}

export function useGlobalShortcuts() {
  React.useEffect(() => {
    let chordPending = false;
    let chordTimer: ReturnType<typeof setTimeout> | null = null;

    const clearChord = () => {
      chordPending = false;
      if (chordTimer) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const key = e.key;
      const lower = key.toLowerCase();

      // ? → shortcuts help (Shift+/ ; not while typing)
      if (key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        window.dispatchEvent(new Event("dmk:open-shortcuts"));
        return;
      }

      // / → open the search palette (not while typing)
      if (key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        window.dispatchEvent(new Event("dmk:open-palette"));
        return;
      }

      // Alt+L → cycle UI language
      if (e.altKey && lower === "l" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const cur = useErpStore.getState().language;
        const next = LANG_CYCLE[(LANG_CYCLE.indexOf(cur) + 1) % LANG_CYCLE.length];
        useErpStore.getState().setLanguage(next);
        return;
      }

      // Any typing target cancels a pending chord
      if (isTypingTarget(e.target)) {
        clearChord();
        return;
      }
      // Modifiers + letters are never chords
      if (e.metaKey || e.ctrlKey || e.altKey) {
        clearChord();
        return;
      }

      // G chord: press G, then the destination key within 1.5s
      if (chordPending) {
        const view = G_CHORDS[lower];
        if (view) {
          e.preventDefault();
          useErpStore.getState().setView(view as ViewId);
        }
        clearChord();
        return;
      }
      if (lower === "g" && !e.shiftKey) {
        chordPending = true;
        chordTimer = setTimeout(clearChord, 1500);
        return;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearChord();
    };
  }, []);
}
