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
| 17 | Worklog + cron webDevReview every 15 min | ✅ |
