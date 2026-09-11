"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — I18N HOOK
// useT() → { t, lang, setLang } wired to the persisted zustand store.
// Falls back: selected language → English → the key itself.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { DICTS, LANGS, LANG_META, type DictKey, type Lang } from "./dictionaries";
import { useErpStore } from "@/store/erp-store";

export { LANGS, LANG_META };
export type { Lang, DictKey };

/** Shape of the `t()` translator — useful for helper signatures outside components. */
export type TFn = (key: DictKey | string, vars?: Record<string, string | number>) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: DictKey | string, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang];
  const raw = dict[key as DictKey] ?? DICTS.en[key as DictKey] ?? String(key);
  return interpolate(raw, vars);
}

/** Main hook: `const { t, lang, setLang } = useT();` */
export function useT() {
  const lang = useErpStore((s) => s.language);
  const setLang = useErpStore((s) => s.setLanguage);
  const t = React.useCallback(
    (key: DictKey | string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang]
  );
  // Keep <html lang> in sync (a11y + Devanagari font shaping)
  React.useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang === "en" ? "en" : lang;
  }, [lang]);
  return { t, lang, setLang, speechTag: LANG_META[lang].speechTag };
}

/** Non-hook translator for use outside components (event handlers, helpers). */
export function tNow(key: DictKey | string, vars?: Record<string, string | number>): string {
  const lang = useErpStore.getState().language;
  return translate(lang, key, vars);
}
