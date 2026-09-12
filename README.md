# DMK Mart ERP

A production-ready, GST-compliant, **multi-company ERP** for Indian retail & wholesale trade — built on **Next.js 16**, **Prisma + Neon PostgreSQL**, and **Tailwind CSS 4 + shadcn/ui**.

> Single owner, multiple company accounts. Real-time **double-entry accounting**, **dual-stock inventory** (sellable + damaged), B2B tier pricing, B2C counter sales (POS), full purchase lifecycle, credit control, AI copilot, and a team verification portal — all in one app.

---

## Table of Contents

1. [Features](#-features)
2. [Tech Stack](#-tech-stack)
3. [Prerequisites](#-prerequisites)
4. [Step-by-Step: Install & Run Locally](#-step-by-step-install--run-locally)
5. [Step-by-Step: First Login & Demo Data](#-step-by-step-first-login--demo-data)
6. [Step-by-Step: Deploy on Any Server (VPS) with HTTPS](#-step-by-step-deploy-on-any-server-vps-with-https)
7. [Step-by-Step: Deploy with Docker](#-step-by-step-deploy-with-docker)
8. [Step-by-Step: Deploy on Cloud Platforms (Web)](#-step-by-step-deploy-on-cloud-platforms-web)
9. [Step-by-Step: Install & Develop Using AI Tools](#-step-by-step-install--develop-using-ai-tools)
10. [Environment Variables](#-environment-variables)
11. [NPM Scripts Reference](#-npm-scripts-reference)
12. [API Overview](#-api-overview)
13. [Project Structure](#-project-structure)
14. [Troubleshooting](#-troubleshooting)
15. [Security Notes for Production](#-security-notes-for-production)

---

## ✨ Features

| Module | Capabilities |
|---|---|
| **Multi-Firm** | Multiple isolated company accounts under one owner login (password identifies the account), per-firm chart of accounts, opening capital journal |
| **Inventory** | Dual-stock pools (sellable vs damaged quarantine), low-stock alerts, stock adjustments (damage transfer / write-off), full movement ledger, CSV bulk upload with dry-run validation, product tier pricing (5 tiers), GST + HSN |
| **Sales (B2B)** | Typeahead billing, tier + bulk-discount pricing, CGST/SGST vs IGST auto-routing (intra/inter-state), credit control (limit barrier + overdue barrier), A4 invoice documents, invoice register with CSV export |
| **Sales (B2C POS)** | Counter sales with CASH/UPI/CARD only (no credit), walk-in buyers, buyer directory with visit & lifetime-spend history |
| **Sales Returns** | Return against invoice, items auto-quarantined to Damaged Stock, credit notes |
| **Purchases** | PO lifecycle (draft → confirm/GRN → cancel), vendor-scoped products, purchase returns (with Send-to-Purchase-Return from sales return), vendor payments |
| **Accounting** | Real-time double-entry ledger engine, trial balance, P&L, balance sheet, day book, party ledgers with running balances, receivables/payables aging |
| **AI Copilot** | "DMK AI" chat grounded in the firm's live data snapshot, with automated chart generation (requires [Z.ai SDK](#-environment-variables) credentials; app works fully without it) |
| **Team Portal** | `/team` — verification team portal for order verification workflow |
| **Financial Year** | FY-aware data across every module (Indian FY: 1 Apr – 31 Mar) |

---

## 🧱 Tech Stack

- **Framework:** [Next.js 16](https://nextjs.org) (App Router, standalone output) + React 19
- **Language:** TypeScript 5 (strict)
- **Styling:** Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons + Framer Motion
- **Database:** [Neon PostgreSQL](https://neon.tech) (serverless Postgres) via [Prisma ORM 6](https://prisma.io) — one database for local dev and production
- **State:** Zustand (client) + TanStack Query (server state)
- **Charts:** Recharts
- **Runtime:** [Bun](https://bun.sh) 1.2+ (recommended) — Node.js 20+ also works
- **AI:** `z-ai-web-dev-sdk` (backend-only) for the AI copilot

---

## ✅ Prerequisites

| Tool | Version | Required? |
|---|---|---|
| **Bun** | 1.2+ | Recommended (all scripts below assume it) |
| **or Node.js** | 20 LTS or newer | Alternative to Bun (use `npm`/`pnpm` instead of `bun`) |
| **Git** | any | To clone the repository |
| **Docker** | 24+ | Only if deploying with Docker |

Install Bun (Linux/macOS/WSL):

```bash
curl -fsSL https://bun.sh/install | bash
```

Install Bun on Windows (PowerShell):

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

> Node.js users: download from <https://nodejs.org> and replace `bun` with `npm` in every command below. Node-specific differences are noted inline.

---

## 🚀 Step-by-Step: Install & Run Locally

### Step 1 — Get the source code

```bash
git clone <YOUR_REPOSITORY_URL> dmk-mart-erp
cd dmk-mart-erp
```

*(Or copy the project folder directly if you received it as an archive.)*

### Step 2 — Install dependencies

```bash
bun install
```

> **Node.js users:** `npm install`

### Step 3 — Configure the environment

Copy the shipped template and add your Neon connection string:

```bash
cp .env.example .env
```

Then edit `.env` and point `DATABASE_URL` at your **Neon pooled connection** (Neon Console → your project → Connect → enable "Pooled connection"; the host contains `-pooler`):

```bash
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
```

> Keep `sslmode=require`. `.env` is gitignored on purpose — the only **required** variable is `DATABASE_URL` (see [Environment Variables](#-environment-variables)).

### Step 4 — Create the database schema

```bash
bun run db:generate   # generates the Prisma client
bun run db:push       # applies every table to the Neon database
```

> **Node.js users:** `npx prisma generate && npx prisma db push`

You should see: `The database is already in sync with the Prisma schema.` (first run: `now in sync`).

### Step 5 — Start the development server

```bash
bun run dev
```

Open **<http://localhost:3000>** — the ERP login screen appears.

> **Node.js users:** `npm run dev`

### Step 6 (optional) — Verify code quality

```bash
bun run lint    # ESLint
bunx tsc --noEmit   # TypeScript type check
```

---

## 🔑 Step-by-Step: First Login & Demo Data

### Option A — Load the demo company (recommended for evaluation)

With the dev server running, POST the idempotent seeder once:

```bash
curl -X POST http://localhost:3000/api/v1/seed
```

This creates the demo universe — *"DMK Mart"* firm, 24 products, 12 customers, 4 vendors, purchase orders, invoices, returns, receipts/payments, and balanced books.

**Default demo credentials:**

| Portal | URL | Username | Password |
|---|---|---|---|
| Owner ERP | `/` (http://localhost:3000) | `Kunal` (pinned) | `1234` |
| Team verification portal | `/team` | — | see team login screen |

> The seeder is **idempotent**: if any firm already exists it is skipped, so you can safely run it more than once.

### Option B — Create your own company account

On the login screen click **Create Company Account** and provide:

1. Company name, company code (unique), owner password (min 4 chars, must be unique across accounts)
2. Optional: GSTIN, state, opening cash / opening bank

A chart of accounts and opening capital journal are created automatically. Login afterwards with username `Kunal` + **your** password — the password identifies the company account.

---

## 🌐 Step-by-Step: Deploy on Any Server (VPS) with HTTPS

Tested pattern for Ubuntu 22.04/24.04 — works on AWS EC2, DigitalOcean, Hetzner, Oracle Cloud, Contabo, or any Linux box.

### Step 1 — Prepare the server

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx
```

### Step 2 — Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### Step 3 — Clone and build the app

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone <YOUR_REPOSITORY_URL> dmk-mart-erp
sudo chown -R $USER:$USER /var/www/dmk-mart-erp
cd dmk-mart-erp

bun install

# Environment (production)
cat > .env <<'EOF'
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
EOF

# Push schema, then build the standalone production bundle
bun run db:generate
bun run db:push
bun run build
```

The build script produces a **standalone** server (`.next/standalone/server.js`) — no `node_modules` needed at runtime.

### Step 4 — Run as a systemd service (auto-start & restart)

```bash
sudo tee /etc/systemd/system/dmk-erp.service > /dev/null <<'EOF'
[Unit]
Description=DMK Mart ERP (Next.js standalone)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/dmk-mart-erp
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/root/.bun/bin/bun /var/www/dmk-mart-erp/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dmk-erp
sudo systemctl status dmk-erp
```

> Prefer Node? Swap `ExecStart` for:
> `ExecStart=/usr/bin/node /var/www/dmk-mart-erp/.next/standalone/server.js`

> Prefer PM2? `sudo npm i -g pm2 && pm2 start .next/standalone/server.js --name dmk-erp --time && pm2 save && pm2 startup`

### Step 5 — Reverse proxy with Nginx

```bash
sudo tee /etc/nginx/sites-available/dmk-erp > /dev/null <<'EOF'
server {
    listen 80;
    server_name erp.yourdomain.com;   # ← your domain or server IP

    client_max_body_size 20M;         # product CSV uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/dmk-erp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Step 6 — Free HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.yourdomain.com
```

Your ERP is now live at **https://erp.yourdomain.com** 🎉

### Alternative — Caddy (auto-HTTPS, simpler config)

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
erp.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

---

## 🐳 Step-by-Step: Deploy with Docker

The Docker self-host files were removed when the project consolidated onto **Neon PostgreSQL** — a container no longer needs a data volume, it only needs `DATABASE_URL` in its environment pointing at Neon (same image flow as the VPS/systemd section above). To re-introduce Docker, wrap the standalone server in a simple image and inject `DATABASE_URL` at runtime.

---

## ☁️ Step-by-Step: Deploy on Cloud Platforms (Web)

### Vercel (serverless — full guide in `docs/deploy/vercel.md`)

Vercel and your local sandbox share the **same Neon database and the same schema** — no mirrors, no provider switching:

- **Database:** Neon PostgreSQL. The single `prisma/schema.prisma` (provider `postgresql`) is the one source of truth; `vercel.json` builds with plain `prisma generate`.
- **Schema changes:** edit `prisma/schema.prisma` → `bun run db:push` (applies straight to Neon) → commit. Vercel picks it up on the next deploy — no extra steps.
- **Recurring auto-post:** Vercel Cron (already wired in `vercel.json`) replaces the in-process scheduler, which is skipped automatically on serverless.
- **AI copilot:** configured with env vars (`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`) — e.g. OpenRouter — instead of the `.z-ai-config` file; degrades gracefully when absent.
- **Realtime:** the socket.io emit bridge is fire-and-forget; both portals poll, so nothing breaks on serverless.

```bash
# one-time: apply the schema to your Neon database
bun run db:push
# then import the repo in the Vercel dashboard and add the env vars from .env.example
```

### Railway / Render / Fly.io

1. Create a new service from your Git repository.
2. Build command: `bun install && bun run db:generate && bun run build`
3. Start command: `NODE_ENV=production bun .next/standalone/server.js`
4. Add the environment variable:
   - `DATABASE_URL=<your Neon pooled connection string>`
   - `NODE_ENV=production`
5. Deploy — no volumes needed; the books live in Neon.

---

## 🤖 Step-by-Step: Install & Develop Using AI Tools

This codebase is AI-friendly: it already contains a root-level **`AGENTS.md`** blueprint (the standard file AI coding tools auto-read), a product brain (`docs/brain/BRAIN.md`), and a PRD (`docs/blueprint/BluePrint.txt`) that AI coding tools can read for context.

### Claude Code (terminal)

```bash
npm i -g @anthropic-ai/claude-code
cd dmk-mart-erp
claude          # starts an interactive session inside the project
```

Example prompts:

```text
> Follow AGENTS.md and docs/brain/BRAIN.md. Run the dev server and fix any error you see.
> Add a new report view for monthly GST summary under /api/v1/reports.
```

### Cursor / Windsurf (desktop IDE)

1. Install from <https://cursor.com> (or <https://windsurf.com>).
2. **File → Open Folder…** → select `dmk-mart-erp`.
3. The agent auto-picks up `AGENTS.md` as project rules; keep `docs/blueprint/BluePrint.txt` open in a tab for product context.
4. Ask in chat: *"Run `bun run dev` and summarize the app"*, then iterate with change requests.

### GitHub Copilot (VS Code / JetBrains)

1. Install the **GitHub Copilot** + **Copilot Chat** extensions.
2. Open the project folder; Copilot Chat indexes the repo automatically.
3. Use `@workspace` questions like *"@workspace where is the invoice creation engine?"* (`src/app/api/v1/_lib/invoice.ts`).

### Any terminal AI agent (Aider, OpenHands, etc.)

```bash
pip install aider-chat
cd dmk-mart-erp
aider --model gpt-4o    # or any configured model
```

**Tips for AI tools on this repo:**

- The only user-visible page is `/` (a client-side SPA view-switcher); all backend logic lives under `src/app/api/v1/*`.
- Every API response is enveloped: `{ ok: true, data }` or `{ ok: false, error, code }`.
- Money is always `round2`; journals must stay balanced (Dr = Cr) — tell your AI to respect rule R6 in `docs/brain/BRAIN.md`.
- After schema edits run `bun run db:push` — it applies straight to the Neon database.

---

## 🔐 Environment Variables

**Short answer: only ONE — `DATABASE_URL`.** Copy `.env.example` → `.env` and set it. Never commit your real `.env`.

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://USER:PASS@ep-…-pooler…/neondb?sslmode=require` | Neon pooled connection string |
| `NODE_ENV` | prod only | `production` | Set automatically by the start script / systemd |
| `PORT` | optional | `3000` | Port for the standalone server |
| `HOSTNAME` | optional | `0.0.0.0` | Bind address for the standalone server |

> **AI Copilot note:** the "DMK AI" chat uses `z-ai-web-dev-sdk` on the backend. On your own server it is configured via a **`.z-ai-config` JSON file** (not an env var) — copy `.z-ai-config.example`, set `baseUrl` (an OpenAI-compatible endpoint including `/v1`), `apiKey`, and **`model`**, then place the file in the project root, your home directory, or `/etc/`. The app resolves the model in this order: `AI_MODEL` env var → `model` field in `.z-ai-config` → provider default. Example (free-tier OpenRouter GLM):
>
> ```json
> {
>   "baseUrl": "https://openrouter.ai/api/v1",
>   "apiKey": "sk-or-v1-…",
>   "model": "z-ai/glm-5.3-flash"
> }
> ```
>
> Inside the Z.ai sandbox it works out of the box with no file. **Every other module works fully without any AI config** — the chat endpoint simply returns an error toast if the provider is unreachable.

---

## 📜 NPM Scripts Reference

| Script | What it does |
|---|---|
| `bun run dev` | Development server on port **3000** (logs to `dev.log`) |
| `bun run build` | Production build (standalone) + copies `static/` & `public/` into the bundle |
| `bun run start` | Runs the standalone production server (Bun) |
| `bun run lint` | ESLint across the project |
| `bun run db:generate` | Generate the Prisma client |
| `bun run db:push` | Apply `prisma/schema.prisma` to the Neon database (+ regenerate client) |
| `bun run db:migrate` | Create/apply a dev migration |
| `bun run db:reset` | Drop & recreate the database |

---

## 🔌 API Overview

All endpoints live under **`/api/v1`** (envelope: `{ok, data}` / `{ok, error, code}`):

```
auth/owner-login   auth/register-firm
seed                                        # idempotent demo data
firms  firms/[id]                           # company accounts
products  products/[id]  products/bulk-upload  products/template
customers  customers/[id]                   # B2B + B2C, party ledgers
vendors   vendors/[id]
invoices  invoices/[id]                     # B2B + counter sales
sales-returns  purchase-returns
purchase-orders  purchase-orders/[id]  purchase-orders/[id]/confirm|cancel
customer-receipts  vendor-payments
stock/adjustment  inventory/movements  inventory/low-stock
ledger/{journals,trial-balance,pnl,balance-sheet,day-book,party,aging}
dashboard  reports  ai/chat
```

Health check after deploying:

```bash
curl http://localhost:3000/api/v1/dashboard   # → {"ok":true,...}
```

---

## 📁 Project Structure

```
dmk-mart-erp/
├── .github/workflows/ci.yml    # CI: lint + type-check on every push
├── AGENTS.md                   # AI-tool project rules (root convention)
├── docs/
│   ├── blueprint/              # Original PRD & architecture blueprint
│   ├── brain/                  # Product brain + delivery reviews
│   ├── dev-notes/              # Build-phase engineering notes
│   └── uploads/                # Reference images & data files
├── prisma/schema.prisma        # Full data model — Neon PostgreSQL (Firm, Product, Invoice, Journal…)
├── scripts/                    # Maintenance scripts (data backfills)
├── src/
│   ├── app/
│   │   ├── page.tsx            # The ERP SPA (owner portal)
│   │   ├── team/page.tsx       # Team verification portal
│   │   └── api/v1/             # All REST endpoints
│   │       ├── _lib/           # Shared engines (invoice, po, salesReturn,
│   │       │                   #   payments, aging, pnl, dashboard…)
│   │       └── …route files
│   ├── components/erp/         # ERP shell + all views
│   │   └── views/              # One file per functional screen
│   ├── components/auth/        # Login gate
│   ├── components/ui/          # shadcn/ui primitives
│   ├── lib/                    # journal engine, GST, pricing, db client
│   └── store/                  # Zustand store (firm, FY, view, session)
├── examples/                   # WebSocket mini-service reference demo
├── mini-services/              # Standalone sidecar services (socket.io)
├── worklog.md                  # Development log
└── (README, LICENSE, CHANGELOG, CONTRIBUTING, SECURITY,
    CODE_OF_CONDUCT, .env.example…)
```

---

## 🛠 Troubleshooting

| Symptom | Fix |
|---|---|
| `Error: Query engine library not found` / Prisma client errors | Run `bun run db:generate`, restart the server |
| `P1001: Can't reach the database` | Check `DATABASE_URL` is the Neon pooled string (host contains `-pooler`) and the Neon project isn't suspended |
| Port 3000 already in use | `PORT=3001 bun run dev` (or stop the other process: `lsof -ti:3000 \| xargs kill -9`) |
| Login rejected on a fresh install | No firm exists yet — POST `/api/v1/seed` (demo login `Kunal` / `1234`) or create a company account on the login screen |
| AI Copilot says it can't answer | SDK credentials missing on self-hosted servers; all other features are unaffected |
| Build fails with type errors | `next.config.ts` ignores build type errors by design; still, run `bunx tsc --noEmit` to inspect real issues |
| File uploads fail behind Nginx | Ensure `client_max_body_size 20M;` in the server block |
| Data missing on localhost | You are on the shared Neon database — the same books Vercel sees; there is no separate local DB anymore |

---

## 🔒 Security Notes for Production

1. **Change the default password immediately** — demo login `Kunal / 1234` is for evaluation only. Change it from **Company Settings** inside the app.
2. Serve **only over HTTPS** (Certbot or Caddy auto-TLS).
3. **Backups are automatic** — Neon keeps point-in-time history; review **Console → Restore** and set the retention you're comfortable with. Whoever holds `DATABASE_URL` holds the books — rotate the Neon password if it ever leaks.

4. Restrict direct access to port 3000 (firewall to localhost only) so traffic always flows through the TLS proxy:

   ```bash
   sudo ufw allow 80,443/tcp && sudo ufw deny 3000/tcp && sudo ufw enable
   ```

5. Consider IP allow-listing or VPN for the `/team` portal if verification staff are internal.

---

## 📦 Repository Files

| File | Purpose |
|---|---|
| `README.md` | This guide — install, deploy, develop |
| `LICENSE` | MIT license |
| `CHANGELOG.md` | Release history (Keep a Changelog format) |
| `CONTRIBUTING.md` | Dev setup, ground rules (balanced journals, firm isolation…), PR checklist |
| `SECURITY.md` | Security model, hardening checklist, private vulnerability reporting |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 |
| `.env.example` | Environment template (copy to `.env`) |
| `.z-ai-config.example` | AI copilot credential template (copy to `.z-ai-config`) |
| `.dockerignore` | Docker build context exclusions (image wiring now documented in the Docker section) |
| `.editorconfig` | Consistent formatting across editors |
| `AGENTS.md` | Project rules for AI coding tools (Claude Code, Cursor, Copilot…) |
| `docs/` | Blueprint PRD, product brain, dev notes, reference uploads |
| `.github/workflows/ci.yml` | CI — lint + type-check on every push |
| `prisma/schema.prisma` | Full database schema |
| `worklog.md` | Full development history |

---

**Questions or issues?** Check [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev workflow, [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities, and [`docs/blueprint/BluePrint.txt`](./docs/blueprint/BluePrint.txt) for the complete product specification.
