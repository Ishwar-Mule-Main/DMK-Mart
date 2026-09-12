# Deploying DMK Mart ERP to Vercel

> **One codebase, one schema, one database.** Vercel, your local sandbox and any
> other environment all talk to the **same Neon PostgreSQL database** using the
> same single `prisma/schema.prisma` (provider `postgresql`). There is no schema
> mirror and no provider switching anymore.
>
> | | **Vercel (this guide)** | **Any other environment** |
> |---|---|---|
> | Database | **Neon PostgreSQL** (pooled connection string) | Same Neon database |
> | Schema | `prisma/schema.prisma` — the only one | Same file |
> | Recurring auto-post | **Vercel Cron** → `GET /api/v1/recurring/generate` | In-process 5-min scheduler (`src/instrumentation.ts`) |
> | Realtime (socket.io mini-service) | Not needed — portals **poll**; the emit bridge is fail-safe | `mini-services/verification-realtime` on port 3011 |
> | AI copilot config | Env vars (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`) | `.z-ai-config` file |
> | Build | `vercel.json` → `prisma generate && next build` | `bun run build` → standalone server |

---

## Step 1 — Create the Neon database

1. Create a project at [Neon](https://neon.tech).
2. Copy the **pooled** connection string (the host contains `-pooler`) and keep
   `sslmode=require`. Serverless functions must use pooling.

## Step 2 — Apply the schema to Neon

From your machine (with the pooled URL at hand):

```bash
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require" \
  bun run db:push
```

This creates every table on Neon. (If it says "already in sync", you're done.)

## Step 3 — Import the project into Vercel

1. Push this repo to GitHub, then **Vercel Dashboard → Add New → Project**.
2. Vercel auto-detects Next.js and reads `vercel.json`
   (build = `prisma generate && next build`, plus a daily cron for recurring billing).
3. Add environment variables (Project → Settings → Environment Variables —
   see `.env.example` for the template):

   | Variable | Required | Purpose |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Neon **pooled** connection string |
   | `CRON_SECRET` | recommended | Protects the cron endpoint; Vercel sends it as a Bearer header automatically |
   | `AI_BASE_URL` | optional | Copilot provider endpoint (e.g. `https://openrouter.ai/api/v1`) |
   | `AI_API_KEY` | optional | Provider API key |
   | `AI_MODEL` | optional | e.g. `z-ai/glm-5.3-flash` |

4. **Deploy.** First boot takes a couple of minutes (Prisma client generation + build).

> ⚠️ `DATABASE_URL` in Vercel and in your local `.env` should be the **same Neon
> string** — that is the whole point of the single-database setup. Anything you
> create locally is instantly visible on Vercel, and vice versa.

## Step 4 — First run on the fresh database

Open your `*.vercel.app` URL → the login screen appears (empty database) →
**"Create new company account"** → set the company details and owner password.
This seeds the Chart of Accounts (including *5510 Stock Adjustment*) and the firm defaults.
To restore a backup instead: log in → Settings → **Restore from backup JSON**
(taken from any deployment via Settings → Backup).

## Step 5 — Ongoing schema changes

Edit `prisma/schema.prisma` → run:

```bash
bun run db:push
```

…which applies the change straight to Neon and regenerates the client. Commit the
schema file; the next Vercel deploy picks it up automatically. **No mirror step, no
extra scripts.**

## Step 6 — Verify recurring auto-post (Vercel Cron)

`vercel.json` registers a daily cron (02:00 UTC) hitting `GET /api/v1/recurring/generate`.
Every due `autoPost` template is processed with an idempotent catch-up engine, so a daily
ping is sufficient (multiple missed cycles are all posted on the next pass). Manual test:

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

## Security notes

- Whoever holds `DATABASE_URL` holds the books — store it only in Vercel env vars and
  your local `.env` (gitignored). Rotate the password from Neon Console →
  Roles & Passwords if it ever leaks, then update both places.
- Neon enforces TLS (`sslmode=require`) and encrypts data at rest.

## Cost notes

- Vercel Hobby is free; the Neon free tier comfortably covers a single-firm workload
  (autosuspend keeps compute costs at zero between uses).
- The copilot costs whatever your provider charges (OpenRouter's
  `z-ai/glm-5.3-flash` ≈ ₹0.004/answer; `z-ai/glm-5.2:free` is strictly $0 with rate caps).
