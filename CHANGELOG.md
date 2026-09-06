# Changelog

All notable changes to **DMK Mart ERP** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Verification request assignment (`assignedToId`) in the team portal
- Team-portal toast/sound notification on new purchase order
- GRN print at PO acceptance
- Refund / settlement mode on credit-note & debit-note print documents
- Financial-year close wizard

## [0.2.1] — 2026-09-05

### Added
- **Documentation suite** — README with step-by-step install for local, VPS (systemd/Nginx/Caddy/HTTPS), Docker and cloud platforms; Dockerfile + docker-compose.yml + .dockerignore; .env.example and .z-ai-config.example templates; LICENSE (MIT); CONTRIBUTING; SECURITY; CODE_OF_CONDUCT; CHANGELOG.
- **Team verification portal** at `/team` with order verification workflow.
- **DMK AI Copilot** — chat grounded in the firm's live data snapshot, 2-column layout with automated chart generation and inventory stock-alerts panel.
- **Financial-year aware data** across every module (Indian FY: 1 Apr – 31 Mar).
- CSV bulk product upload with dry-run validation, CSV template download, and CSV exports (invoice register, stock movements, receipts, payments).

### Changed
- Yellow/gold solid buttons now render text and icons in the Midnight Navy background colour for contrast.
- Every card/container section stretches to equal height on laptop/desktop (auto height on tablet/mobile).
- Sales/purchase return forms auto-sort newest invoices/POs first (manual toggle removed).
- Sidebar panel stays collapsed and expands on hover.

### Fixed
- Customer receipts and vendor payments now immediately refresh party account balance strips and picker labels.
- Copilot composer pinned to the bottom of its container; clean mobile layout.

## [0.2.0] — 2026-08

### Added
- **Multi-firm platform** — multiple isolated company accounts under one owner login (password identifies the account), per-firm chart of accounts and opening capital journal.
- **Dual-stock inventory** — sellable vs damaged-quarantine pools, stock adjustments (damage transfer / write-off), movement ledger, low-stock alerts.
- **B2B billing** — 5-tier pricing, bulk discounts, CGST/SGST vs IGST auto-routing, dual credit barriers (limit + overdue), A4 invoice documents.
- **B2C counter POS** — CASH/UPI/CARD-only counter sales, walk-in buyers, buyer directory with visit history.
- **Purchase lifecycle** — PO draft → confirm/GRN → cancel, vendor payments, purchase returns.
- **Sales returns** with automatic damaged-stock quarantine and credit notes.
- **Real-time double-entry accounting** — trial balance, P&L, balance sheet, day book, party ledgers with running balances, receivables/payables aging.
- **Idempotent demo seeder** (`POST /api/v1/seed`) with balanced books.

[0.2.1]: https://example.com/your-repo/compare/v0.2.0...v0.2.1
[0.2.0]: https://example.com/your-repo/releases/tag/v0.2.0
