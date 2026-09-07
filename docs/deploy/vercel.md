# Deploying DMK Mart ERP to Vercel

> **Read this first:** Vercel is **serverless** — the SQLite file database and the
> in-process/socket.io machinery of the self-hosted build cannot run there.
> The repo therefore ships **two parallel deployment paths** that share one codebase:
>
> | | **Vercel (this guide)** | **Hostinger / VPS (self-hosted)** |
> |---|---|---|
> | Database | Hosted **PostgreSQL** (Neon / Supabase / Vercel Postgres) | **SQLite** file (`db/custom.db`) — untouched |
> | Recurring auto-post | **Vercel Cron** → `GET /api/v1/recurring/generate` | In-process 5-min scheduler (`src/instrumentation.ts`) |
> | Realtime (socket.io mini-service) | Not needed — portals **poll**; the emit bridge is fail-safe | `mini-services/verification-realtime` on port 3011 |
> | AI copilot config | Env vars (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`) | `.z-ai-config` file |
> | Build | `vercel.json` → postgres Prisma client + `next build` | `bun run build` → standalone server (unchanged) |
>
> The Prisma schema for Vercel is **generated** from the SQLite source of truth:
> `prisma/schema.postgres.prisma` is produced by `bun run db:sync:pg` — never edit it by hand.

---

## Step 0 — One-time local preparation

Generate/refresh the Postgres mirror schema (run after every change to `prisma/schema.prisma`):

```bash
bun run db:sync:pg
```

## Step 1 — Create a hosted Postgres database

1. Create a free project at [Neon](https://neon.tech) (or Supabase / Vercel Postgres).
2. Copy the **pooled** connection string (Neon: the `-pooler` hostname;
   Supabase: the *Transaction pooler* URL on port `6543`). Serverless functions must use pooling.

## Step 2 — Push the schema to your Postgres database

From your machine (with the connection URL at hand):

```bash
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dmk?sslmode=require" \
  bun run db:push:pg
```

This creates every table on the hosted DB. **It never touches your local SQLite file.**

## Step 3 — Import the project into Vercel

1. Push this repo to GitHub, then **Vercel Dashboard → Add New → Project**.
2. Vercel auto-detects Next.js and reads `vercel.json`
   (build = `prisma generate --schema prisma/schema.postgres.prisma && next build`,
   plus a daily cron for recurring billing).
3. Add environment variables (Project → Settings → Environment Variables —
   see `.env.vercel.example` for a copy-paste template):

   | Variable | Required | Purpose |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Postgres pooled connection string |
   | `CRON_SECRET` | recommended | Protects the cron endpoint; Vercel sends it as a Bearer header automatically |
   | `AI_BASE_URL` | optional | Copilot provider endpoint (e.g. `https://openrouter.ai/api/v1`) |
   | `AI_API_KEY` | optional | Provider API key |
   | `AI_MODEL` | optional | e.g. `z-ai/glm-5.3-flash` |

4. **Deploy.** First boot takes a couple of minutes (Prisma client generation + build).

## Step 4 — First run on the fresh database

Open your `*.vercel.app` URL → the login screen appears (empty database) →
**"Create new company account"** → set the company details and owner password.
This seeds the Chart of Accounts (including *5510 Stock Adjustment*) and the firm defaults.
To restore a backup instead: log in → Settings → **Restore from backup JSON**
(taken from any deployment via Settings → Backup).

## Step 5 — Verify recurring auto-post (Vercel Cron)

`vercel.json` registers a daily cron (02:00 UTC) hitting `GET /api/v1/recurring/generate`.
Every due `autoPost` template is processed with the same idempotent catch-up engine the
self-hosted scheduler uses, so a daily ping is sufficient (multiple missed cycles are all
posted on the next pass). Manual test:

```bash
curl "https://<your-app>.vercel.app/api/v1/recurring/generate?secret=<CRON_SECRET>"
```

## Behaviour differences on Vercel (by design)

- **Recurring scheduler**: the in-process interval is skipped (`VERCEL=1` guard in
  `src/instrumentation.ts`) — Vercel Cron drives it instead.
- **Realtime**: `notifyRealtime` POSTs to `DMK_EMIT_URL` are fire-and-forget with a 1.5 s
  timeout; on Vercel they simply no-op. Both portals keep working via their polling loops.
- **AI copilot**: without AI env vars it replies with a friendly "not configured" note
  (HTTP 200, `aiConfigured: false`) — never a 500.
- **No background processes**: nothing else in the ERP depends on long-lived state.

## Cost notes

- Vercel Hobby is free; Neon/Supabase free tiers comfortably cover a single-firm workload.
- The copilot costs whatever your provider charges (OpenRouter's
  `z-ai/glm-5.3-flash` ≈ ₹0.004/answer; `z-ai/glm-5.2:free` is strictly $0 with rate caps).
