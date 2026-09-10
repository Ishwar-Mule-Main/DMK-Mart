# I18N CONVENTIONS — Task 55 (Whole-project trilingual EN · हिंदी · मराठी)

Read this file COMPLETELY before writing any code. These conventions are binding.

## Mission

The owner demands: **"every single word in the whole project must be translated into English, Hindi and Marathi."**
Your job: extract every user-visible hardcoded string from your assigned view files into the i18n
dictionaries and render them through `t()`, providing all three language values.

## Infrastructure (already wired — do NOT modify)

- `src/lib/i18n/index.ts` — `useT()` hook: `const { t, lang, setLang } = useT();` then `t("key")`.
  Also `tNow("key")` for non-render code paths. `t()` falls back: selected lang → en → key itself.
- `src/lib/i18n/dictionaries.ts` — core keys (`nav.*`, `hdr.*`, `cmn.*`, `exp.*`, etc.).
- `src/lib/i18n/dicts/batch-<domain>.ts` — **YOUR ONLY dict file.** Three objects: `en<Domain>`,
  `hi<Domain>`, `mr<Domain>` (already exported; fill them). All three MUST stay key-aligned,
  same keys, same order. English is canonical.
- Merged automatically by dictionaries.ts spreads. `DictKey` is derived from `en` — a key missing
  in `en` batch = TS error; a key present in `en` but missing in `hi/mr` = silent English fallback
  (forbidden — parity required).
- Language switcher already lives in the header; language persists in zustand.

## What must be translated

Every string a user can SEE or hear:
- Page titles/subtitles, section headings, KPI labels
- Table column headers (`<th>`), table cell static text
- Buttons, links, chips/badges with static words, toggle labels
- Form labels, placeholders, helper/hint text
- Dialog titles, descriptions, confirm/cancel texts, AlertDialog bodies
- Toast titles and descriptions (success + error)
- Empty states, loading messages, error messages
- `aria-label`s and `title`/`tooltip` attributes
- Tab labels, breadcrumb-ish text, status label maps
- Strings inside ternaries: `{paid ? "Paid" : "Unpaid"}` → `t()`
- Template-literal labels: `` `Total ${x}` `` → `t("x.total", { n: x })`

## What must NOT be translated

- Data values from the API/database (names, addresses, account names, product names, voucher numbers)
- Enum VALUES sent to the API (`"PENDING"`, `"CASH"` etc. — translate the display labels only)
- Brand/technical tokens: GSTIN, GST, UPI, SKU, HSN, SAC, OTP, PO, SO, GRN, COA, CC, NEFT, IFSC,
  MSEDCL, PDF, CSV, XLSX, A4, B2B, B2C, KPI, AI, ID, PIN, QR, ISO, FY, P&L, TB, BS, AR, AP,
  DRAFT/CONFIRMED (as code-like mono chips if they were code-like before)
- Numbers, currency ₹, dates (formats already localized where relevant)
- localStorage keys, CSS classes, testids, URLs, API paths
- `lang`, `title` in `<html>` metadata of server components
- Code comments stay English

## Key naming

- Prefix per view file, short + stable. Your task prompt tells you your exact prefixes.
- Pattern: `<prefix>.<what>` in camelCase, e.g. `bil.title`, `bil.saveBtn`, `bil.errNoLines`,
  `bil.colRate`, `bil.toastSaved`. Descriptive but not verbose.
- Interpolation: `t("so.items", { n: 5 })` with dictionary `"so.items": "Items ({n})"`.
  Preserve `{var}` exactly in all three languages.
- **REUSE before creating**: grep `src/lib/i18n/dictionaries.ts` for existing keys first —
  `cmn.*` (cancel/save/delete/edit/add/search/date/name/amount/quantity/rate/notes/print/export/
  refresh/close/confirm/noResults/loading…), `nav.*`, `hdr.*`, `exp.*`, `cmn.customer`, `cmn.sku`,
  `cmn.brand`, `cmn.category` etc. If an existing core key fits, use it; do NOT duplicate.

## Code patterns

Import: `import { useT } from "@/lib/i18n";` then `const { t } = useT();` at the top of the component.

1. Simple text:
   ```tsx
   <h1>Reports & Exports</h1>   →   <h1>{t("rep.title")}</h1>
   ```

2. Attribute strings:
   ```tsx
   <Input placeholder="Search products…" />  →  <Input placeholder={t("prod.searchPh")} />
   ```

3. Toasts (including inside handlers — `t` from the enclosing component works; if a handler lives
   outside a component use `tNow`):
   ```tsx
   toast({ title: "Saved", description: "Invoice created" })
   → toast({ title: t("bil.toastSaved"), description: t("bil.toastSavedDesc") })
   ```

4. **Module-scope label maps are a TRAP** (no hook access at module scope):
   ```tsx
   // BEFORE (module scope):
   const STATUS_LABELS: Record<string, string> = { PENDING: "Pending", PAID: "Paid" };
   // AFTER — turn into a function receiving t, call it inside the component:
   const statusLabel = (t: TFn, s: string) =>
     s === "PENDING" ? t("bil.stPending") : s === "PAID" ? t("bil.stPaid") : s;
   // then in component:  statusLabel(t, row.status)
   ```
   Export `type TFn = (key: string, vars?: Record<string, string | number>) => string;` locally
   if needed, or inline the function type.

5. Ternaries → move the words into dict keys:
   ```tsx
   {isCounter ? "Counter Sale" : "B2B Sale"}  →  {t(isCounter ? "bil.counter" : "bil.b2b")}
   ```

6. Counts/plurals — Hindi/Marathi have no "-s" plural; use one key with `{n}`:
   `{items.length} item{items.length === 1 ? "" : "s"}` → `t("bil.items", { n: items.length })`

7. Month/date names (optional nicety where user-facing month names appear): use
   `lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN"` locale, mirroring
   `expense-reports.tsx`. Do not break existing formatting logic.

8. If a string already uses `t()`, LEAVE IT. Fill gaps only. If an existing key's English wording
   must change, do NOT change core keys — add your own batch key instead.

## Translation quality — glossary (binding terms)

Keep these consistent across ALL batches. English (en) — Hindi (hi) — Marathi (mr):

| EN | HI | MR |
|---|---|---|
| Sales | बिक्री | विक्री |
| Purchase | खरीद | खरेदी |
| Invoice | इनवॉइस | बिल / इनवॉइस |
| Tax Invoice | कर इनवॉइस | कर इनवॉइस |
| Bill | बिल | बिल |
| Customer | ग्राहक | ग्राहक |
| Vendor / Supplier | विक्रेता | पुरवठादार |
| Product | उत्पाद | उत्पादन |
| Stock | स्टॉक | साठा |
| Inventory | इन्वेंटरी | इन्व्हेंटरी |
| Quantity | मात्रा | प्रमाण |
| Rate / Price | दर | दर |
| Amount | राशि / रकम | रक्कम |
| Total | कुल / कुल राशि | एकूण |
| Subtotal | उप-योग | उप-एकूण |
| Grand Total | कुल योग | एकूण बेरीज |
| Discount | छूट | सूट |
| Tax | कर | कर |
| Ledger | खाता बही | खातेवही |
| Journal | जर्नल | जर्नल |
| Balance | शेष | शिल्लक |
| Debit | डेबिट | डेबिट |
| Credit | क्रेडिट | क्रेडिट |
| Profit | लाभ | नफा |
| Loss | हानि | तोटा |
| Expense | खर्च | खर्च |
| Income | आय | उत्पन्न |
| Report | रिपोर्ट | अहवाल |
| Statement | विवरणी | विवरणपत्र |
| Trial Balance | ट्रायल बैलेंस | ट्रायल बॅलन्स |
| Balance Sheet | चिट्ठा | ताळेबंद |
| Profit & Loss | लाभ-हानि | नफा-तोटा |
| Day Book | रोज़नामचा | रोजनिशी |
| Receipt | रसीद | पावती |
| Payment | भुगतान | पेमेंट |
| Cash | नकद | रोख |
| Bank | बैंक | बँक |
| Salary | वेतन | पगार |
| Account | खाता | खाते |
| Financial Year | वित्तीय वर्ष | आर्थिक वर्ष |
| Save | सहेजें | जतन करा |
| Delete | हटाएँ | हटवा |
| Edit | संपादित करें | संपादित करा |
| Cancel | रद्द करें | रद्द करा |
| Confirm | पुष्टि करें | पुष्टी करा |
| Search | खोजें | शोधा |
| Add | जोड़ें | जोडा |
| Print | प्रिंट करें | प्रिंट करा |
| Export / Download | निर्यात / डाउनलोड | निर्यात / डाउनलोड |
| Date | तारीख | दिनांक |
| Name | नाम | नाव |
| Address | पता | पत्ता |
| Phone / Mobile | मोबाइल | मोबाइल |
| Status | स्थिति | स्थिती |
| Actions | कार्य | कृती |
| Loading | लोड हो रहा है… | लोड होत आहे… |
| No records | कोई रिकॉर्ड नहीं | कोणतेही रेकॉर्ड नाहीत |
| Success | सफल | यशस्वी |
| Error | त्रुटि | त्रुटी |
| Warning | चेतावनी | चेतावणी |
| Settings | सेटिंग्स | सेटिंग्ज |
| Back | वापस | मागे |
| Next | आगे | पुढे |
| Previous | पिछला | मागील |
| Open | खोलें | उघडा |
| Close | बंद करें | बंद करा |
| View | देखें | पहा |
| Details | विवरण | तपशील |
| Remarks / Notes | टिप्पणी | शेरा |
| Driver | ड्राइवर | चालक |
| Vehicle | वाहन | वाहन |
| Trip | ट्रिप | ट्रिप / फेरी |
| Route | मार्ग | मार्ग |
| Delivery | डिलीवरी | वितरण |
| Dispatch | डिस्पैच | डिस्पॅच |
| Warehouse / Godown | गोदाम | गोदाम |
| Shop | दुकान | दुकान |
| Verification | सत्यापन | पडताळणी |
| Pending | लंबित | प्रलंबित |
| Approved | स्वीकृत | मंजूर |
| Rejected | अस्वीकृत | नाकारले |
| Completed | पूर्ण | पूर्ण |
| Active | सक्रिय | सक्रिय |
| Suspended | निलंबित | निलंबित |
| Unit | इकाई | एकक |
| Category | श्रेणी | श्रेणी |
| Brand | ब्रांड | ब्रँड |
| Outstanding / Due | बाकी | बाकी |
| Collection | वसूली | वसुली |
| Credit Limit | क्रेडिट सीमा | क्रेडिट मर्यादा |
| Bill To | बिल प्राप्तकर्ता | बिल प्राप्तकर्ता |
| Walk-in | वॉक-इन | वॉक-इन |
| Counter Sale | काउंटर बिक्री | काउंटर विक्री |
| Bill / Invoice No. | बिल संख्या | बिल क्रमांक |
| Signature | हस्ताक्षर | स्वाक्षरी |
| Jurisdiction | क्षेत्राधिकार | क्षेत्राधिकार |

Style rules:
- Respectful plural imperative for verbs (करें / करा), never rude singular.
- Natural Devanagari phrasing, not word-by-word transliteration of English grammar.
- Keep `{placeholders}`, ₹, numbers in Western digits.
- Match the tone of existing core keys (see dictionaries.ts hi/mr blocks).

## Hard constraints

- ONLY touch: your assigned view files + your ONE batch dict file. NEVER dictionaries.ts,
  shared.tsx, header, app-shell, other batches' files, API routes, Prisma schema.
- Do NOT restructure/renamed existing exports in your batch dict file (names `en<Domain>`,
  `hi<Domain>`, `mr<Domain>` are pre-wired).
- Keep all JSX/logic behavior identical — this is a string-extraction pass, not a refactor.
  The ONLY allowed logic changes: module-scope label maps converted to `t`-taking functions,
  ternary text moved into `t(...)`.
- Dev server is already running (HMR live). Do NOT start/stop/restart it. Do NOT run `bun run build`.
- If `bunx tsc --noEmit` gets OOM-killed, wait 30s and retry once.

## Your QA gate (must pass before you finish)

1. `bunx tsc --noEmit` → 0 errors (project-wide).
2. `bunx eslint <your touched files>` → 0 problems.
3. Key parity: for your batch file, count `"xxx":` occurrences per block — en count == hi count ==
   mr count. (Write a tiny node/bun one-liner to verify; do not leave the script file behind —
   run it via stdin or delete it after.)
4. `grep -nE '(placeholder|title|aria-label|label|hint|description)=\{?"[A-Z][a-z]' <files> | grep -v "t("` →
   only acceptable hits are enum-ish/code-like tokens (e.g. `"PDF"`). Every human-readable phrase
   must be through `t()`.
5. Spot-read your diff: no logic drift, all `t(` keys exist in your batch file (or core dict).

## Handover

Append ONE section to `/home/z/my-project/worklog.md` using a SINGLE atomic Bash heredoc
(`cat >> /home/z/my-project/worklog.md <<'EOF' … EOF`) with exactly this shape:

```
---
Task ID: <your task id, e.g. 55-a>
Agent: full-stack-developer
Task: <one line>

Work Log:
- <concrete steps>

Stage Summary:
- <key results / decisions / artifacts>
```

Also write the same content to `/home/z/my-project/agent-ctx/<task-id>-full-stack-developer.md`.
Do NOT overwrite worklog content; append only. Read worklog.md tail FIRST to know what earlier
agents did.
