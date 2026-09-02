# Task 3-a — Backend API Layer (full-stack-developer)

## Status: COMPLETE

## What was built
Full REST API under `src/app/api/v1/**` (Next.js 16 App Router route handlers) for DMK Mart ERP:
firms, products (+bulk-upload/template), customers, vendors, purchase-orders (+confirm/cancel),
purchase-returns, vendor-payments, invoices, sales-returns, customer-receipts, stock/adjustment,
ledger (journals/trial-balance/pnl/balance-sheet/day-book/party/aging), inventory (movements/low-stock),
dashboard, reports, ai/chat (ZAI backend-only), seed (idempotent demo data).

## Conventions honored
- Envelope: `{ ok: true, data }` / `{ ok: false, error, code, status }` via `_lib/api.ts` ok()/fail().
- Dynamic route params are `Promise<{id}>` and awaited.
- firmId isolation on every query (resolveFirm 404s unknown firms).
- All amounts round2'd (@/lib/gst). JournalError codes mapped in handleApiError.
- Domain engines in `_lib/` are shared by routes AND the seed route (seed posts through the exact same
  createInvoice / confirmPurchaseOrder / createSalesReturn / payments code paths → journals always balance).

## Business rules verified live (dev server + curl/bun smoke suite)
- TB balanced (Dr=Cr) before and after ~20 mutations; Balance Sheet balanced=true.
- R3/R4 pools: oversell → 422 ERR_INSUFFICIENT_SELLABLE_STOCK; damaged drawn only by returns/write-off.
- R13 barriers: (balance+total) > limit → 422 ERR_CUSTOMER_CREDIT_LOCK; any POSTED credit invoice older
  than creditDays → 422 ERR_CUSTOMER_CREDIT_LOCK (message names the invoice).
- R14: counter sale with CREDIT → 422 ERR_INVALID_PAYMENT_MODE.
- R12: ERR_INVALID_TIER_HIERARCHY / ERR_INVALID_GST_RATE / ERR_DUPLICATE_SKU (409) all fire.
- ERR_JOURNAL_UNBALANCED on unbalanced manual entry (422).
- AI chat returns grounded, exact-figure answer.

## Key files for downstream agents
- `src/app/api/v1/_lib/api.ts` — ok/fail/parsers/resolveFirm/handleApiError (USE THESE in new routes).
- `src/app/api/v1/_lib/party.ts` — balance + ledger + movement + stock guards.
- `src/app/api/v1/_lib/dashboard.ts` — buildDashboard(firmId) → KPI payload (reused by ai/chat).
- `src/app/api/v1/_lib/aging.ts` / `_lib/pnl.ts` — reusable report engines.
- Seed: POST /api/v1/seed → { firmId, ... } (skips if any firm exists).

## Notes / deviations
- Day-book cash/bank opening = journal-line-derived (OPENING journal already books openingCash/Bank).
- postJournal executes after the mutation $transaction (engine uses global client; can't take a tx).
- Bulk-upload commit: opening stock applied on CREATE only; updates never touch stock pools.
- Numbering unified on nextDocNumber() → e.g. `DMK/2025-26/INV/0001`.

## Lint
`bun run lint` → clean (exit 0).
