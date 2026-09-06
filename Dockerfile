# ═══════════════════════════════════════════════════════════════
# DMK Mart ERP — production Docker image (multi-stage, Bun runtime)
# Build:  docker compose up -d --build
# Logs:   docker compose logs -f
# Data:   SQLite file persists in the `erp-data` volume at /data
# ═══════════════════════════════════════════════════════════════
FROM oven/bun:1 AS base
WORKDIR /app

# ── Stage 1: dependencies ──────────────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install

# ── Stage 2: build the standalone bundle ───────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is only needed at runtime; a dummy value keeps
# prisma generate happy during the image build.
ENV DATABASE_URL="file:/tmp/build.db"
RUN bun run db:generate && bun run build

# ── Stage 3: minimal runtime ───────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/data/custom.db"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /data
VOLUME /data
EXPOSE 3000

# Ensure the schema exists on first boot, then start the server
CMD ["sh", "-c", "bunx prisma db push --skip-generate --accept-data-loss && bun ./server.js"]
