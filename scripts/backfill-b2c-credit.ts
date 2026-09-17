// One-time backfill: every B2C counter buyer gets the ₹1,00,000 credit
// limit (owner policy — "credit should work as b2b customers").
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const res = await db.customer.updateMany({
    where: { customerType: "B2C_COUNTER", creditLimit: { lte: 0 } },
    data: { creditLimit: 100000 },
  });
  console.log(`Backfilled creditLimit=100000 for ${res.count} B2C_COUNTER customers`);
  const total = await db.customer.count({ where: { customerType: "B2C_COUNTER" } });
  console.log(`Total B2C_COUNTER customers: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
