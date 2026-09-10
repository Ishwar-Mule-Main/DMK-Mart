# Task 54-e — DMK Mart ERP: Operational Expense Management UI (Record Expense + Expense Reports)

Agent: full-stack-developer
Date: 2026-02 (sandbox session)

## What was built

Two new trilingual (en/hi/mr) owner views + full nav registration for the
expense module whose backend APIs were already complete (Tasks 54-a…54-d).

### 1. `src/components/erp/views/expense-record.tsx` (new, ~840 lines)
- PageHeader (exp.title / exp.subtitle, Wallet icon) + KPI strip:
  This Month ₹total (gold), Today ₹total, voucher count — month numbers
  from a dedicated `GET /api/v1/expenses?from=<1st-of-month>&limit=500`
  (exact, server-side); Today computed client-side from that month list.
- Main form card (dmk-card p-4 sm:p-6, gap-4 grids, h-9 inputs):
  - Date (type=date, max=today, [color-scheme:dark])
  - Category Select: items show `{code} · {name in current lang}` with the
    other-language name as a muted 10.5px second line (en→Hindi,
    hi→English, mr→English) so all words stay visible; trigger shows
    `{code} · {current-lang name}` via SelectValue children override.
  - Amount: ₹ prefix span, pl-7, font-money, inputMode=decimal
  - Paid Through: 3 radio cards (role=radiogroup/radio, aria-checked,
    min-h-11): Cash Drawer (Wallet, amber/dmk-warning), Bank UPI
    (Landmark, dmk-success), Bank CC A/c (CreditCard, dmk-danger);
    default CASH_DRAWER.
  - Paid To, Vehicle (input + `<datalist id="dmk-expense-vehicles">` fed
    by deduped vehicleNumber values from GET /api/v1/logistics/trips AND
    from the fetched recent expenses), Link to Trip (Select of latest 20
    trips, label `{tripNumber} · {vehicleNumber}`, "NONE" sentinel →
    tripId omitted; Radix forbids empty SelectItem values).
  - Narration Textarea.
  - Receipt photo: hidden file input + dashed attach row (Camera icon,
    exp.attachReceipt); FileReader → dataURL; >3 MB rejected with
    destructive toast (exp.errReceiptSize); preview shows 48px thumbnail,
    filename, size (formatBytes), exp.receiptAttached badge, Remove (X,
    44px, aria-label exp.removeReceipt).
- Validation: amount>0 (exp.errAmount), category required (exp.errCategory)
  — inline `role="alert"` text + destructive toast; invalid never submits.
- Save → `POST /api/v1/expenses` (amount, paymentSource, expenseDate,
  paidTo/vehicleNumber/narration/receiptFileUrl all optional-omitted when
  empty). Success state REPLACES the form card: green CheckCircle2, exp.saved
  + voucherNumber (mono gold), exp.journalNo + journal voucherNumber, mini
  double-entry table (DEBIT/CREDIT chips via exp.debit/exp.credit + accountName
  + ₹ font-money), exp.journalPosted caption, exp.drawerImpact well when
  CASH_DRAWER, "Record Another Expense" resets. New voucher is prepended to
  the recent list optimistically + refreshTick refetch for exact KPIs.
- Recent Expenses card (exp.recentTitle, count badge): GET limit=50,
  max-h-96 overflow-y-auto (global thin scrollbar), rows = date, category
  (current lang) + code chip, voucherNumber mono, paidTo, vehicle chip,
  source Badge (CASH_DRAWER→warning amber, BANK_CURRENT→info, BANK_CC→danger),
  ₹ right font-money, 48px receipt thumbnail when present, per-row delete
  (Trash2, h-11 w-11, aria-label) → AlertDialog (exp.deleteConfirmTitle/Body,
  cancel cmn.cancel, destructive exp.delete with e.preventDefault() so a 4xx
  keeps the dialog open) → DELETE /api/v1/expenses/{id}?firmId= →
  toast exp.deleted (+ reversalJournalNumber description) → refetch.
  Loading = LoadingRows, empty = EmptyState exp.empty.

### 2. `src/components/erp/views/expense-reports.tsx` (new, ~530 lines)
- PageHeader (exp.reportTitle, PieChart icon) + month navigator actions:
  prev/next icon buttons (h-10 w-10, aria-labels exp.prevMonth/exp.nextMonth),
  input type="month" default current month, Export CSV outline button.
- Big total card: exp.totalThisMonth label + huge font-money ₹ (38px, gold)
  + `{n} {exp.vouchers}` + localized month label (en-IN/hi-IN/mr-IN).
- exp.categoryBreakdown card: API byCategory rows (already sorted desc) —
  rank number, name in current language + muted subline with the OTHER two
  language names (unique join " · "), code chip, `× count`, animated width
  bar (mount-triggered transition, percent from API, emerald/amber/red cycle
  via dmk-success/warning/danger — no blue), right ₹ font-money + percent.
- exp.sourceSplit card: 3 dmk-well tiles — exp.cashOutflow (warning),
  exp.bankOnline (success), exp.ccDebt (danger) with ₹ font-money and
  exp.cashDrawer / exp.bankUpi / exp.bankCc as descriptor lines.
- Filter bar: category Select (master list, "ALL" sentinel), source Select
  ("ALL" sentinel), SearchInput (exp.searchPh) — client-side narrowing of
  the month's vouchers (summary stays server-wide, per spec).
- Voucher table: min-w-[820px] in overflow-x-auto + max-h scroll; headers
  from t() (cmn.date, exp.colVoucher, exp.category, exp.colPaidTo,
  exp.colVehicle, exp.colSource, cmn.amount, exp.colJournal); footer well
  shows filtered count + Σ. LoadingRows skeleton; EmptyState exp.noData
  replaces the table when the filtered set is empty.
- CSV: `downloadCSV(`expenses-${month}.csv`, …)` from lib/format (adds UTF-8
  BOM) — date, voucher, code+name, paidTo, vehicle, source, amount,
  narration; exported from the month's vouchers (unfiltered), toast if none.

### 3. Nav registration (grep "finance/daybook" — 4 registration points)
- `src/store/erp-store.ts`: ViewId union += "finance/expense-record",
  "finance/expense-reports" (after "finance/coa").
- `src/components/erp/app-shell.tsx`: imports + VIEW_MAP entries.
- `src/components/erp/sidebar.tsx`: Wallet import; two NavItems in Finance &
  Accounting right after Chart of Accounts (exact NavItem shape, keys
  nav.expenseRecord / nav.expenseReports).
- `src/components/erp/command-palette.tsx`: Wallet import; two "Go to" entries
  in the same position. (use-global-shortcuts G_CHORDS is a partial map — no
  entry required; dashboard quick-links untouched.)

### 4. i18n — `src/lib/i18n/dictionaries.ts`
- 67 keys appended at the END of each of the three blocks, key-aligned:
  2 nav (nav.expenseRecord, nav.expenseReports) + 65 exp.* — all 58 specced
  strings verbatim + 7 support keys I added for table headers / placeholders:
  exp.choose, exp.colVoucher, exp.colPaidTo, exp.colVehicle, exp.colSource,
  exp.colJournal, exp.colNarration. Reused existing keys where they fit:
  cmn.date, cmn.amount, cmn.cancel, cmn.category, cmn.records none needed.

## API contract notes
- GET /api/v1/logistics/trips?firmId= → `{ trips: [{ id, tripNumber,
  vehicleNumber, routeName, driverName, stops, deliveredStops, … }] }`
  (latest-first, take 200 server-side). Used for vehicle datalist +
  recent-trip Select (slice 20).
- POST /api/v1/expenses 201 → `{ voucher: { …, category, journalEntry },
  journal: { id, voucherNumber, lines: [{ accountName, entrySide, amount }] } }`
  — verified against `_lib/expenses.ts createExpenseVoucher` (include
  category:true, journalEntry:{include:{lines:true}}); lines amounts are
  side-flattened by the route (DEBIT→debitAmount, CREDIT→creditAmount).
- DELETE → `{ deleted: true, reversalJournalNumber }`.
- GET /api/v1/expenses supports from/to/categoryId/paymentSource/q/limit.
- No contract deviations; one deliberate client decision: tripId is omitted
  (not "") when the "No trip" sentinel is selected (getStr() treats both the
  same server-side).

## Design guards honored
- Zero hex colors in JSX; dmk-* tokens only; no blue/indigo anywhere
  (rg scan of both files: clean).
- font-money on every ₹, h-9 inputs via shared inputCls, ≥44px targets for
  icon/radio/delete buttons (h-10/h-11), aria-labels on all icon buttons and
  selects, dmk-enter-stagger roots, mobile-first grids, toasts on every async
  failure, loading/empty/error states, recent list max-h-96 overflow-y-auto.
- Reused shared.tsx helpers: PageHeader, KpiCard, Badge, EmptyState,
  LoadingRows, SearchInput, Field, inputCls, ErrorText.
- Untouched: prisma/schema.prisma, src/app/api/**, invoice-docs.tsx,
  login-gate, sales/team portals, app-shell footer logic.

## QA
- `bunx tsc --noEmit` → ZERO errors project-wide (also proves ViewId exhaustiveness).
- `bun run lint` → 0 problems (fixed 2 unused eslint-disable directives on <img>).
- dev.log: no compile errors (server was not running at end of session —
  per rules I did not start it; static contract checks done against route source).
- Live curl smoke-test was not possible (port 3000 down at the time); the API
  request/response shapes were verified by reading the route + _lib source.

## Follow-ups for orchestrator
- None blocking. Optional polish: keyboard-shortcut (G-chord) for the two new
  views; dashboard quick-link card.
