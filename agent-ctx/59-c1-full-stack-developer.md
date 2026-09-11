# Task 59-c1 — DMK Mart ERP i18n: platform batch + dashboard / dashboard-ai-chat / deleted-data

## Scope (per assignment)
- Filled `src/lib/i18n/dicts/batch-platform.ts` (three empty exports → 203 keys × 3 languages).
- Wired `src/components/erp/views/dashboard.tsx`, `dashboard-ai-chat.tsx`, `deleted-data.tsx` with `useT()`.
- Did NOT touch finance views, logistics, verification, settings, or any other wave's files.

## Files changed (exactly 4)
1. `src/lib/i18n/dicts/batch-platform.ts` — en/hi/mrPlatform, 203 keys each, verified key-aligned.
2. `src/components/erp/views/dashboard.tsx`
3. `src/components/erp/views/dashboard-ai-chat.tsx` (static chrome only; AI answers untouched)
4. `src/components/erp/views/deleted-data.tsx`

## Key layout (batch-platform.ts)
- `dash.*` × 87 — dashboard: KPI labels/subs/drillHints, Sales Trend, AR Aging, Top Products, Low Stock rail, Recent Transactions (`TXN_LABEL_KEY` enum→key map), GST compliance pulse, AR + AP overdue pulses (status ribbons, mini stats, meters, aria-labels, notes/fallbacks).
- `cop.*` × 47 — dashboard AI copilot static chrome: live stock-alerts panel (header, ALERT count one/many, stats, OUT/LOW badges, thr/short/dmg row labels, sync states), hero header/badge/tagline, empty greeting, thinking indicator, 6 suggested questions (`cop.sug1q…sug6q` + groups `cop.sug1g…sug6g`), input/mic/send placeholders+arias, `cop.noResponse`, error toast keys.
- `del.*` × 69 — deleted data: header, Restore All / Empty Bin dialogs, folder chips (`TYPE_META` → labelKey/folderKey), 4 KPIs, search, show-restored, empty states, table headers, row badges, purge dialog, footer, 15 toasts incl. bulk scope (`del.scopeBin` + `del.folderWord`, scopeCap preserved).
- Reused core keys: nav.dashboard, nav.invoices, nav.stock, nav.daybook, nav.lowStock, nav.gstr2b, nav.deleted, cmn.refresh/cancel/status/actions/type/restore, dash.lowStockSub (cop list aria).

## Gotchas handled (useful for later platform-wave agents)
- Shadowing fixes: `data.recentTransactions.map((t, i)` → `txn` (dashboard); `.map((t)` → `.map((k)` (deleted-data folder chips); `const t = setInterval(...)` → `timer` (dashboard-ai-chat effect).
- Pulse helper components take `t: TFn` prop (they live outside the main component).
- `load` useCallback got `t` added to deps (dash.loadFailed fallback).
- English plural strings ("{n} item(s)") handled via single interpolation keys instead of conditional "s" suffixes.
- Untranslated by design: enum codes (INVOICE/PURCHASE_ORDER/…), money/dates, recharts hex colors, AI-generated answers, API-provided label/meta/note/reason strings.

## Verification
- Scripted check: all 216 reachable keys in the 3 views exist in batch-platform.ts or dictionaries.ts core → 0 missing; hi/mr blocks 203/203 aligned, 0 empty values.
- `bun run lint` → exit 0, clean.
- Dev log tail: "✓ Compiled" with no errors after changes.

Full log appended to `/home/z/my-project/worklog.md` (Task ID: 59-c1).
