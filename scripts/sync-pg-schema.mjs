// ═══════════════════════════════════════════════════════════════
// sync-pg-schema.mjs — generate prisma/schema.postgres.prisma from
// prisma/schema.prisma so the two never drift.
//
// The SQLite schema (schema.prisma) is the source of truth. This
// script copies it verbatim and swaps ONLY the datasource block:
//   provider "sqlite"  →  "postgresql"
// Everything else (models, indexes, relations, defaults) is
// byte-identical, so a Vercel deployment gets the exact same
// database shape the self-hosted SQLite build uses.
//
// Run:  bun run db:sync:pg
// Re-run after ANY change to schema.prisma (CI enforces freshness).
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = join(root, "prisma", "schema.prisma");
const outPath = join(root, "prisma", "schema.postgres.prisma");

const source = readFileSync(srcPath, "utf-8");

// Replace the datasource block (provider sqlite → postgresql).
const datasourceRe = /datasource\s+db\s*\{[^}]*\}/;
if (!datasourceRe.test(source)) {
  console.error("✗ No `datasource db { … }` block found in schema.prisma");
  process.exit(1);
}

const pgDatasource = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`;

let out = source.replace(datasourceRe, pgDatasource);

// Prepend a generated-file banner ahead of the original header comment.
const banner = `// ═══════════════════════════════════════════════════════════════
// ⚠ GENERATED FILE — DO NOT EDIT BY HAND
// Mirrored from prisma/schema.prisma by scripts/sync-pg-schema.mjs
// (bun run db:sync:pg). Make schema changes in schema.prisma, then
// re-run the sync script. Used ONLY for Vercel/Postgres deploys —
// self-hosted (Hostinger/VPS) keeps the SQLite schema as-is.
// ═══════════════════════════════════════════════════════════════

`;

out = banner + out;
writeFileSync(outPath, out);
console.log(`✓ schema.postgres.prisma synced from schema.prisma (${out.split("\n").length} lines)`);
