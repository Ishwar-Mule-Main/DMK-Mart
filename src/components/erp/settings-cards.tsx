"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SETTINGS CARDS
// 1) Interface Language (English / हिंदी / मराठी) — instant switch
// 2) Keyboard Shortcuts — the live registry (same source as the "?"
//    help dialog), searchable, grouped by section
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Keyboard, Languages, CircleHelp } from "lucide-react";
import { Badge } from "@/components/erp/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useErpStore } from "@/store/erp-store";
import { useT, LANGS, LANG_META, type Lang } from "@/lib/i18n";
import { SHORTCUTS, SHORTCUT_SECTIONS, type ShortcutSection } from "@/lib/shortcuts-registry";
import { rankSearch } from "@/lib/search-rank";
import { cn } from "@/lib/utils";

// ── Interface language card ─────────────────────────────────────
export function LanguageCard() {
  const lang = useErpStore((s) => s.language);
  const setLang = useErpStore((s) => s.setLanguage);
  const { t } = useT();

  return (
    <div className="dmk-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <Languages className="h-4 w-4 text-dmk-gold" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("set.languageCard")}</h2>
        <Badge tone="info">{t("set.langCurrent")}: {LANG_META[lang].native}</Badge>
      </div>
      <p className="text-[12px] text-dmk-text-muted mb-3.5">{t("set.languageHint")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {LANGS.map((l: Lang) => {
          const selected = lang === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={selected}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                selected
                  ? "border-dmk-gold/60 bg-dmk-hover"
                  : "border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover/60"
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-dmk-bg-primary border border-dmk-border-subtle text-[12px] font-bold text-dmk-gold">
                {LANG_META[l].flag}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13.5px] font-semibold", selected ? "text-dmk-text-primary" : "text-dmk-text-secondary")}>
                  {LANG_META[l].native}
                </span>
                <span className="block text-[10.5px] text-dmk-text-muted">{LANG_META[l].label}</span>
              </span>
              {selected && (
                <span className="ml-auto h-2 w-2 rounded-full bg-dmk-success animate-pulse shrink-0" aria-label={t("set.langCurrent")} />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-dmk-text-muted mt-3">
        {t("hdr.language")} · Alt+L
      </p>
    </div>
  );
}

// ── Keyboard shortcuts card (company profile section) ───────────
export function KeyboardShortcutsCard() {
  const { t, lang } = useT();
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim();
    if (!q) return SHORTCUTS;
    return rankSearch(SHORTCUTS, q, (s) => [s.desc.en, s.desc.hi, s.desc.mr, s.keys, s.section]);
  }, [query]);

  const bySection = React.useMemo(() => {
    const map = new Map<ShortcutSection, typeof SHORTCUTS>();
    for (const s of filtered) {
      const arr = map.get(s.section) ?? [];
      arr.push(s);
      map.set(s.section, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div className="dmk-card p-5">
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <Keyboard className="h-4 w-4 text-dmk-yellow" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("kbs.title")}</h2>
        <Badge tone="info">{SHORTCUTS.length}</Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.dispatchEvent(new Event("dmk:open-shortcuts"))}
          className="ml-auto h-8 gap-1.5 border-dmk-border-subtle bg-dmk-input-well text-[11.5px] hover:bg-dmk-hover"
        >
          <CircleHelp className="h-3.5 w-3.5" /> ? {t("kbs.title")}
        </Button>
      </div>

      <div className="relative mb-3 max-w-xs">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("kbs.searchPlaceholder")}
          className="h-8 bg-dmk-input-well border-dmk-border-subtle text-[12px]"
          aria-label={t("kbs.searchPlaceholder")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-dmk-border-medium [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
        {SHORTCUT_SECTIONS.map((section) => {
          const items = bySection.get(section.id);
          if (!items || items.length === 0) return null;
          return (
            <section key={section.id} className="min-w-0">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-dmk-text-muted mb-1.5">
                {t(section.labelKey)}
              </h3>
              <div className="rounded-lg border border-dmk-border-subtle divide-y divide-dmk-border-subtle overflow-hidden">
                {items.map((s) => (
                  <div key={s.id} className="flex items-start gap-3 px-3 py-2 bg-dmk-bg-secondary/40 hover:bg-dmk-hover/60 transition-colors">
                    <kbd className="min-w-[84px] text-center shrink-0 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 font-mono text-[10.5px] font-semibold text-dmk-yellow">
                      {s.keys}
                    </kbd>
                    <span className="text-[12px] text-dmk-text-secondary leading-snug">{s.desc[lang]}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <p className="text-[12px] text-dmk-text-muted text-center py-6">{t("cmn.noResults")}</p>
      )}
      <p className="text-[11px] text-dmk-text-muted mt-3">{t("kbs.pressHelp")}</p>
    </div>
  );
}
