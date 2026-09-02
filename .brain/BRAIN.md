# DMK MART ERP — BRAIN

## 1. Product Identity

**DMK Mart ERP** is an AI-native Trading, Distribution & Bookkeeping platform for a single owner (Kunal Dnyaneshwar Kolapkar) operating plastic-goods trading firms (DMK Mart, DMK Traders, DMK Polymers, DMK Plastics). It manages: orders (purchase + sales), finance (double-entry books), inventory (dual-stock), parties, GST compliance, and AI copilot — in one navy-themed unified platform.

**Single-owner model:** NO users/roles/RBAC. **Firm = account.** Owner switches firms via header switcher. Every entity scoped by `firm_id`.

**7 Functional Pillars:**
1. Sales — B2B invoicing + B2C counter POS + returns + credit control
2. Purchase — vendors + PO + GRN + purchase returns + payments
3. Inventory — dual-stock + bulk upload + low-stock alerts + movements
4. Finance & Accounting — journals, ledgers, TB, P&L, BS, daybook
5. Tax & Compliance — GST (CGST/SGST/IGST) + HSN + A4 invoices + ITC
6. AI Intelligence — copilot + alerts + decision support
7. Dashboard & Reports — KPIs + exports

## 2. Business Rules (R1–R20)

| # | Rule |
|---|------|
| R1 | Every firm is a fully isolated universe — own products, stock, parties, books. |
| R2 | Products loaded primarily via bulk CSV/Excel upload. |
| R3 | Sellable and damaged stock ALWAYS separate. Damaged is never sold. |
| R4 | Sales returns of broken items go to DAMAGED stock, never sellable. |
| R5 | Purchase returns reduce damaged stock and vendor payable. |
| R6 | Every transaction posts a balanced double-entry journal (ΣDr = ΣCr). |
| R7 | All parties have opening and closing balances (Dr/Cr polarity). |
| R8 | B2B customers use location-first naming ("Latur Ishwar Mule"). |
| R9 | B2C counter maintains buyer directory (name + phone). |
| R10 | Manufacturer vendors show own-brand products; distributors show all. |
| R11 | Quantity-based bulk discounts apply in SALES only. |
| R12 | 5-tier pricing: Distributor ≤ Wholesale ≤ Semi-Wholesale ≤ Retailer ≤ MRP. |
| R13 | Credit sales blocked when limit exceeded or overdue past grace. |
| R14 | B2C / walk-in accounts have NO credit limit. |
| R15 | Currency strictly INR (₹), 2 decimals. |
| R16 | Documents follow A4 print standards. |
| R17 | Financial year switching (FY 2025-26, 2026-27, Apr–Mar). |
| R18 | Every order/return/payment carries a date; books update on that date. |
| R19 | Low-stock alerts at configurable thresholds. |
| R20 | Owner-only platform. No user accounts. Firm = account. |

## 3. Architecture

- **Frontend:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4 + shadcn/ui (New York), Lucide icons, Recharts. Single SPA at `/` (client-side view switching — only `/` is user-visible).
- **State:** Zustand store (`src/store/erp-store.ts`) for active firm, FY, current view.
- **Backend:** Next.js API routes under `/api/v1/*` (REST). `db = @/lib/db` (Prisma, SQLite at `db/custom.db`).
- **DB:** Prisma ORM + SQLite. All tables carry `firmId`. Amounts as Decimal (string in JSON) or Float with 2-decimal rounding.
- **Engines:** `src/lib/gst.ts` (GST split), `src/lib/pricing.ts` (5-tier + bulk discount), `src/lib/journal.ts` (balanced posting), `src/lib/format.ts` (INR format, amount-in-words).

## 4. Data Model (Prisma entities)

Firm → Product, Customer, Vendor, PurchaseOrder(+Item), Invoice(+LineItem), SalesReturn(+Item), PurchaseReturn(+Item), VendorPayment, CustomerReceipt, ChartOfAccount, JournalEntry(+Line), InventoryMovement, StockAdjustment, LedgerEntry (party ledger).

Key invariants:
- JournalEntry.totalDebit === totalCredit (validated in app layer; SQLite has no CHECK via Prisma — enforce in `postJournal()`).
- Product.stockQuantity (sellable) & product.damagedStock — billing only draws from sellable.
- Party closing balance = opening + Σ(debit-natural) transactions.

## 5. API Surface (all under /api/v1)

| Route | Methods | Purpose |
|---|---|---|
| /api/v1/firms | GET, POST | List/create firms |
| /api/v1/firms/[id] | GET, PATCH | Firm detail/update |
| /api/v1/products | GET, POST | List (search/filter)/create |
| /api/v1/products/[id] | GET, PATCH, DELETE | CRUD |
| /api/v1/products/bulk-upload | POST | CSV import with validation |
| /api/v1/products/template | GET | CSV template download |
| /api/v1/customers | GET, POST | incl. B2C directory search |
| /api/v1/customers/[id] | GET, PATCH | CRUD |
| /api/v1/vendors | GET, POST | List/create |
| /api/v1/vendors/[id] | GET, PATCH | CRUD |
| /api/v1/purchase-orders | GET, POST | List/create PO |
| /api/v1/purchase-orders/[id] | GET, PATCH | Detail / re-edit PENDING |
| /api/v1/purchase-orders/[id]/confirm | POST | GRN: stock split + journal + payable |
| /api/v1/purchase-orders/[id]/cancel | POST | Cancel PENDING |
| /api/v1/purchase-returns | GET, POST | Debit note |
| /api/v1/vendor-payments | GET, POST | Payments |
| /api/v1/invoices | GET, POST | Sales invoice (B2B credit check) |
| /api/v1/invoices/[id] | GET | Detail |
| /api/v1/sales-returns | GET, POST | Credit note → damaged stock |
| /api/v1/customer-receipts | GET, POST | Receipts |
| /api/v1/stock/adjustment | POST | Sellable→damaged transfer / write-off |
| /api/v1/ledger/journals | GET, POST | Journal list / manual entry |
| /api/v1/ledger/trial-balance | GET | TB |
| /api/v1/ledger/pnl | GET | P&L |
| /api/v1/ledger/balance-sheet | GET | Balance sheet |
| /api/v1/ledger/day-book | GET | Daybook |
| /api/v1/ledger/party | GET | Party ledger |
| /api/v1/ledger/aging | GET | AR/AP aging |
| /api/v1/inventory/movements | GET | Movement ledger |
| /api/v1/inventory/low-stock | GET | Alerts |
| /api/v1/dashboard | GET | KPIs |
| /api/v1/ai/chat | POST | Copilot (LLM grounded in firm data) |
| /api/v1/seed | POST | Demo data seeder |

## 6. Design System — Midnight Ledger (FROZEN)

CSS variables (globals.css):
```
--bg-primary:#0A0F1D  --bg-secondary:#111C32  --bg-tertiary:#16233F
--bg-input-well:#0B1426  --bg-surface-hover:#1D2D4F
--border-subtle:#1E2D4A  --border-medium:#2A3F66
--accent-blue:#2563EB  --accent-gold:#FFCC00  --accent-orange:#FF6B00
--text-primary:#E8EEF9  --text-secondary:#A7B4CC  --text-muted:#6B7A99  --text-disabled:#45516B
--success:#22C55E --warning:#F59E0B --danger:#EF4444 --info:#38BDF8
```
Typography: Inter (body/headings), JetBrains Mono (money/SKU, tabular-nums).
H1 22px, H2 18px, H3 15-16px, body 13.5-14px, caption 12px, pill 10.5-11px.
Header 56px; sidebar 240px expanded / 64px collapsed (tablet/mobile → drawer); inputs ≥38px; table rows 44px; card radius 10px; input/button radius 8px.
Semantic: Dr=orange, Cr=cyan badges. Success/warning/danger/info per above.
Charts palette: #2563EB #FF6B00 #FFCC00 #22C55E #38BDF8 #A78BFA.

## 7. Active Phase

Phase: **Build (Phases 1–8 of ROADMAP executed in one delivery sprint)**.
Current task: full-stack implementation + verification.
Blockers: none.

## 8. Completed Phases

- Phase 0: Document ingestion complete. BRAIN.md + ROADMAP.md created.

## 9. Known Issues

- (none yet)

## 10. Backlog

- Offline POS (CRDT sync) — post-MVP
- E-invoice IRN + e-way bill — post-MVP
- Bank reconciliation — post-MVP
- Advanced AI forecasting — post-MVP

## 11. Integration Notes (GST & Finance)

- GST split: sellerState == buyerState → CGST=rate/2, SGST=rate/2 else IGST=rate. State code from GSTIN prefix (first 2 chars).
- Sales journal: Dr A/R (or Cash/Bank) grand; Cr Sales taxable; Cr CGST/SGST/IGST; Dr/Cr Round-Off. COGS: Dr COGS, Cr Inventory Asset.
- Purchase journal: Dr Inventory subtotal; Dr ITC tax; Cr Vendor Payable grand.
- Purchase return: Dr Vendor Payable; Cr Purchases taxable; Cr ITC reversal.
- Sales return: Dr Sales Returns taxable; Dr GST output reversal; Cr Customer A/R grand.
- Payment: Dr Vendor Payable; Cr Bank/Cash. Receipt: Dr Bank/Cash; Cr Customer A/R.
- Round-off: grand = round(exact); delta to Round-Off account.
- Bulk discount tiers (SALES only): qty≥50→20%, ≥24→15%, ≥12→12%, ≥10→8%, ≥5→5%, else 0. P_eff = tier × (1−pkg%) × (1−manual%); taxable = round(P_eff×qty,2).
- Amount in words: Indian system (Crore/Lakh/Thousand).
- Credit control B2B: (outstanding + new total) ≤ creditLimit; overdue invoices past credit_days also block.
- Voucher types: SALES, PURCHASE, RECEIPT, PAYMENT, JOURNAL, CONTRA, CREDIT_NOTE, DEBIT_NOTE, OPENING.

## 12. Session Memory

### Session: 2026-02-14 (ATLAS build start)
- Phase: Delivery sprint — all modules
- Completed: Doc ingestion (AGENTS.md, BluePrint.txt, BluePrint Theoritcal.txt, PDF blueprint). Brain initialized.
- Decisions: SPA at `/` with client view-switching (platform constraint: only `/` route). API under /api/v1. SQLite + Prisma. Seed demo data on first boot for instant demo.
- NEXT ACTION: Write Prisma schema + db push.

### Session: 2026-02-14 (Delivery sprint complete)
- Phase: ALL — full platform delivered
- Completed: Schema (16 models) · 34 API routes · 27 frontend views · Midnight Navy shell · seed engine · E2E QA (agent-browser)
- Decisions: /products GET returns {products, categories} — frontend normalized in 4 views (billing, b2c-counter, sales-returns, credit-debit-notes) · money() helper for A4 docs · sidebar auto-closes <1024px
- Verification: TB ΣDr=ΣCr=₹11,01,084.08 · BS balanced · GRN split audited in movements · lint 0/0 · mobile+desktop screenshots pass
- Blockers: none
- NEXT ACTION: Maintenance mode — cron webDevReview runs every 15 min (QA + incremental features)
