// ═══════════════════════════════════════════════════════════════
// backfill-delivery-otp.ts — one-off: every non-counter POSTED
// invoice without a Delivery OTP gets a random 4-digit code so the
// logistics OTP handshake works for orders created before the
// feature shipped. Idempotent — safe to re-run.
// Run: DATABASE_URL=<url> bun scripts/backfill-delivery-otp.ts
// ═══════════════════════════════════════════════════════════════
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const missing = await db.invoice.findMany({
    where: { isCounterSale: false, status: "POSTED", deliveryOtp: "" },
    select: { id: true, invoiceNumber: true },
  });
  let n = 0;
  for (const inv of missing) {
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    await db.invoice.update({ where: { id: inv.id }, data: { deliveryOtp: otp } });
    n++;
    console.log(`${inv.invoiceNumber} → OTP ${otp}`);
  }
  console.log(`Backfilled ${n} invoice(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
