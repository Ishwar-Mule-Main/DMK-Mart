# DMK MART ERP — ROADMAP (Delivery Sprint)

| Task | Description | Status |
|---|---|---|
| 1 | Prisma schema: Firm, Product, Customer, Vendor, PurchaseOrder(+Items), Invoice(+LineItems), SalesReturn(+Items), PurchaseReturn(+Items), VendorPayment, CustomerReceipt, ChartOfAccount, JournalEntry(+Lines), InventoryMovement, LedgerEntry + db push | ✅ |
| 2 | Core libs: gst.ts, pricing.ts, journal.ts (postJournal w/ balance enforcement), format.ts (INR, words), types | ✅ |
| 3 | Seed engine (chart of accounts per firm + demo firm data) | ✅ |
| 4 | API routes: firms, products (+bulk-upload, template), customers, vendors | ✅ |
| 5 | API routes: purchase-orders (+confirm/cancel), purchase-returns, vendor-payments | ✅ |
| 6 | API routes: invoices, sales-returns, customer-receipts | ✅ |
| 7 | API routes: ledger (journals, TB, P&L, BS, daybook, party, aging), inventory (movements, low-stock, adjustment), dashboard | ✅ |
| 8 | API route: ai/chat (LLM copilot grounded in firm data) | ✅ |
| 9 | Design system: globals.css tokens + app shell (header w/ firm+FY switchers, sidebar, sticky footer) | ✅ |
| 10 | Frontend: Dashboard (KPIs, charts, alerts) | ✅ |
| 11 | Frontend: Products, Bulk Upload, Stock Levels, Movements, Low Stock | ✅ |
| 12 | Frontend: Fast Billing (B2B), B2C Counter, Customers, Sales Returns, Receipts | ✅ |
| 13 | Frontend: Vendors, Purchase Orders, GRN, Purchase Returns, Vendor Payments | ✅ |
| 14 | Frontend: Finance (Journals, TB, P&L, BS, Daybook, Aging, Party Ledgers) | ✅ |
| 15 | Frontend: Invoices & Docs (A4 preview/print), Reports + CSV export, AI Copilot, Settings | ✅ |
| 16 | QA: lint, dev server, agent-browser E2E (golden paths), fixes | ✅ |
| 18 | Cycle 12: ⌘K palette, KPI drill-downs, WAC valuation report, motion polish | ✅ |
| 19 | Cycle 13: per-invoice AR settlement (ReceiptAllocation) + precise invoice aging + sparklines | ✅ |
| 20 | Cycle 14: per-PO AP settlement (PaymentAllocation) + PO-wise aging + GSTR-2B reconciliation view | ✅ |
| 21 | Cycle 16: vendor bill capture on POs + bill-first GSTR-2B matching + overdue-AR dashboard pulse + aging→ledger drill-throughs + net KPI fix | ✅ |
| 22 | Cycle 17: settle/pay deep links from registers + GSTR-1 sales report + Action Center bell + print pipeline | ✅ |
| 23 | Cycle 18: product profitability report (margin vs WAC) + day-book cash-flow trend chart + batch statement print + firm JSON backup/export | ✅ |
| 24 | Cycle 20: subscription ledger (invoice templateId stamps + run history) + hold/skip window on templates + backup v2 (templates in envelope) + AP overdue pulse card | ✅ |
| 25 | Cycle 21: recurring auto-post scheduler (in-process, engine shared) + Settings automation heartbeat card + AUTO provenance badges + party-ledger settlement drill-down + GSTR-2B period stepper | ✅ |
| 17 | Worklog + cron webDevReview every 15 min | ✅ |
