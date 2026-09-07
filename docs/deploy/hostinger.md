# Self-Hosted Deployment (Hostinger VPS / any Node server)

> **This is the ORIGINAL path — preserved exactly as-is.** Use it whenever you want
> SQLite + socket.io. Nothing in this document has changed with the Vercel
> preparation; the two paths coexist in one codebase.
> (See `docs/deploy/vercel.md` for the serverless alternative.)

## What you get

- **SQLite** database file at `db/custom.db` — zero external services, trivial backups.
- **In-process recurring auto-post scheduler** — every 5 minutes, plus a catch-up pass
  at boot (`src/instrumentation.ts` → `src/lib/scheduler.ts`).
- **socket.io realtime bridge** — `mini-services/verification-realtime` (port 3011) fans
  PO-verification events to the owner + team portals. The portals also poll, so the app
  works even with the mini-service stopped.
- **Standalone production server** — `next build` produces `.next/standalone/server.js`.

## Requirements

- Node.js 20+ (or Bun 1.1+), 1 GB RAM VPS is plenty.
- A domain pointed at the VPS (optional — the server also binds `0.0.0.0:3000`).

## Step-by-step

```bash
# 1 — get the code
git clone <your-repo-url> dmk-mart-erp && cd dmk-mart-erp
bun install                        # or: npm install

# 2 — configure the environment
cp .env.example .env
# edit .env → DATABASE_URL must be an ABSOLUTE path, e.g.
#   DATABASE_URL="file:/srv/dmk-mart-erp/db/custom.db"

# 3 — create the database schema
bun run db:push

# 4 — (optional) AI copilot — any OpenAI-compatible provider
cp .z-ai-config.example .z-ai-config
# edit .z-ai-config → baseUrl / apiKey / model (e.g. OpenRouter)

# 5 — build & run
bun run build
bun run start                      # standalone server on :3000 (PORT/HOSTNAME in .env)
```

First run: open `http://<server>:3000` → **Create new company account**
(or restore a backup JSON from a previous deployment via Settings → Restore).

### Docker alternative (docker-compose included)

```bash
docker compose up -d --build
```

### Keep it running (systemd unit example)

```ini
[Unit]
Description=DMK Mart ERP
After=network.target

[Service]
WorkingDirectory=/srv/dmk-mart-erp
ExecStart=/usr/bin/bun .next/standalone/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Optional: enable the realtime bridge

```bash
cd mini-services/verification-realtime
bun install && bun run dev         # listens on 127.0.0.1:3011
```

The ERP calls it automatically at `DMK_EMIT_URL` (default `http://127.0.0.1:3011/emit`).
Behind the sandbox-style gateway, use `?XTransformPort=3011` instead of raw ports.

## Backups

- Everything lives in one file: copy `db/custom.db` (cron + rsync/rclone is enough), or
- Settings → **Backup** in the app exports a portable JSON of the whole firm, restorable
  on any deployment (self-hosted **or** Vercel).

## Notes

- Set `DMK_SCHEDULER=off` to disable the in-process scheduler (tests/QA).
- Put the app behind Caddy/Nginx for HTTPS; the included `Caddyfile` is a working example
  for the sandbox-style gateway.
