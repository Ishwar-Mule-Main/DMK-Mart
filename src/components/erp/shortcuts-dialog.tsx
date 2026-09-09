"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — KEYBOARD SHORTCUTS HELP DIALOG (?)
// Renders straight from shortcuts-registry.ts — the SAME list the
// Settings → Keyboard Shortcuts card shows, so the two can never
// drift apart. Opened by the global "?" key or the dm event bus.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Keyboard, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SHORTCUTS, SHORTCUT_SECTIONS, type ShortcutSection } from "@/lib/shortcuts-registry";
import { useT } from "@/lib/i18n";
import { rankSearch } from "@/lib/search-rank";
import { cn } from "@/lib/utils";

export function ShortcutsDialog() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const { t, lang } = useT();

  React.useEffect(() => {
    const openEv = () => setOpen(true);
    window.addEventListener("dmk:open-shortcuts", openEv);
    return () => window.removeEventListener("dmk:open-shortcuts", openEv);
  }, []);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="dmk-card border-dmk-border-medium sm:w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary text-[16px] flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center">
              <Keyboard className="h-4 w-4 text-dmk-yellow" />
            </span>
            {t("kbs.title")}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            {t("kbs.subtitle")} · {t("kbs.pressHelp")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dmk-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("kbs.searchPlaceholder")}
            className="h-9 pl-8 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]"
            aria-label={t("kbs.searchPlaceholder")}
          />
        </div>

        <div className="overflow-y-auto min-h-0 flex-1 -mx-1 px-1 space-y-4 pb-1">
          {SHORTCUT_SECTIONS.map((section) => {
            const items = bySection.get(section.id);
            if (!items || items.length === 0) return null;
            return (
              <section key={section.id}>
                <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-dmk-text-muted mb-1.5">
                  {t(section.labelKey)}
                </h3>
                <div className="rounded-lg border border-dmk-border-subtle divide-y divide-dmk-border-subtle overflow-hidden">
                  {items.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-3 py-2 bg-dmk-bg-secondary/40 hover:bg-dmk-hover/60 transition-colors">
                      <kbd className="min-w-[92px] text-center rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 py-1 font-mono text-[11px] font-semibold text-dmk-yellow shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]">
                        {s.keys}
                      </kbd>
                      <span className="text-[12.5px] text-dmk-text-secondary leading-snug">{s.desc[lang]}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <p className={cn("text-[12px] text-dmk-text-muted text-center py-6")}>{t("cmn.noResults")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
