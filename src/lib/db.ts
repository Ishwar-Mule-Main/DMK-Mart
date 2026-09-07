import { PrismaClient, Prisma } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Interactive transaction with latency-tolerant timeouts.
 *
 * Prisma's defaults (maxWait 2s / timeout 5s) are tuned for
 * database-adjacent hosts. When the app talks to a REMOTE Postgres over
 * a WAN — e.g. Vercel functions in one region and Neon/Supabase in
 * another, or a dev box far from the DB — every statement inside the
 * transaction pays a round-trip, and the transaction gets killed
 * mid-flight with "Transaction API error: Transaction not found".
 *
 * All multi-statement writes MUST go through this helper instead of
 * calling db.$transaction directly.
 */
export function dbTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(fn, { maxWait: 15_000, timeout: 60_000 })
}

/** Same latency-tolerant options, for the array (batch) form. */
export const DB_TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const
