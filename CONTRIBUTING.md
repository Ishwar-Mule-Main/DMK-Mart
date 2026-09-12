# Contributing to DMK Mart ERP

Thank you for considering a contribution! This guide covers everything needed to get a development environment running and submit a clean change.

## 1. Prerequisites

- **Bun 1.2+** (recommended) or **Node.js 20+** — see README "Prerequisites"
- **Git**
- Basic familiarity with Next.js App Router + TypeScript

## 2. Development setup

```bash
git clone <YOUR_REPOSITORY_URL> dmk-mart-erp
cd dmk-mart-erp

bun install

# environment
cp .env.example .env
# edit .env → set DATABASE_URL to your Neon pooled connection string
# (Neon Console → Connect → "Pooled connection"; keep sslmode=require)

# database
bun run db:generate
bun run db:push

# optional: balanced demo universe
curl -X POST http://localhost:3000/api/v1/seed   # while dev server runs

# start
bun run dev        # http://localhost:3000  (login: Kunal / 1234 with seed)
```

## 3. Ground rules

These invariants keep the ERP correct — **do not break them**:

1. **Single user-visible route.** The owner ERP is a client-side SPA at `/`; the team portal lives at `/team`. All backend logic is REST under `src/app/api/v1/*` — no server actions.
2. **Response envelope.** Every API route returns `{ ok: true, data }` or `{ ok: false, error, code }`.
3. **Firm isolation.** Every query/mutation must be filtered by `firmId`.
4. **Money.** Always `round2`; every monetary event must post a **balanced journal** (Dr = Cr) via the ledger engine in `src/lib/journal.ts` / `src/app/api/v1/_lib/*`.
5. **Dual stock pools.** Sellable and damaged stock never mix (R3/R4).
6. **Schema changes** go through `prisma/schema.prisma` + `bun run db:push` (applies to the Neon database) — never mutate data by hand.

## 4. Code style

- TypeScript strict; no `any`.
- UI: Tailwind CSS 4 utility classes + shadcn/ui components (`src/components/ui`); follow the Midnight Navy token system (`dmk-*` utilities in `globals.css`).
- Money cells use the `font-money` class and are right-aligned (`.num`).
- Every view must be responsive (mobile-first) and handle loading / empty / error states.
- Keep interactions keyboard accessible; minimum 44px touch targets.

## 5. Before you open a PR

```bash
bun run lint          # 0 errors, 0 warnings in your files
bunx tsc --noEmit     # 0 type errors
bun run dev           # manually exercise the flows you touched
```

Checklist:

- [ ] Lint and type-check pass
- [ ] All new API routes follow the envelope + firmId isolation rules
- [ ] Journals balance (check Trial Balance after any money-flow change)
- [ ] Tested on desktop **and** mobile viewports
- [ ] UI copy is in English
- [ ] No secrets committed (`.env`, `.z-ai-config`, `db/*.db` stay ignored)

## 6. Commit & PR conventions

- Commit messages: imperative mood, e.g. `fix: refresh party balances after receipt posting`
- Reference module in scope: `sales:`, `purchases:`, `ledger:`, `inventory:`, `ui:`, `api:`
- Keep PRs focused — one feature or fix per PR, with a short description and screenshots for UI changes

## 7. Reporting bugs

Open an issue with: what you did, what you expected, what happened, console/dev-log excerpts, and your deployment type (local / Docker / VPS).
