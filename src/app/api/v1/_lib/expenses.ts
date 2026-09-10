// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — OPERATIONAL EXPENSE CORE
// Single-screen "Record Expense" engine shared by the expense
// routes. Every save posts a balanced PAYMENT journal:
//   DEBIT  → the category's expense account (5301–5307)
//   CREDIT → the money source (Cash Drawer 1000 / Bank 1010 / CC 2500)
// so the cash drawer, day book and P&L stay true to the paisa.
// ═══════════════════════════════════════════════════════════════

import { db, dbTx } from "@/lib/db";
import { ACC, fyLabelForDate, postJournal } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";
import type { Prisma } from "@prisma/client";

/** COA account that carries the CC facility debt (money owed to the bank). */
export const ACC_CC = "2500";

/** Money-source account for each payment source. */
export const SOURCE_ACCOUNT: Record<string, string> = {
  CASH_DRAWER: ACC.CASH, // 1000 — physical shop cash drawer
  BANK_CURRENT: ACC.BANK, // 1010 — HDFC current account (UPI / NEFT)
  BANK_CC: ACC_CC, // 2500 — bank cash-credit facility (debt grows)
};

/** Indirect-expense COA accounts backing the default categories. */
const EXPENSE_ACCOUNTS: Array<{ code: string; name: string }> = [
  { code: "5301", name: "Staff Salaries & Wages" },
  { code: "5302", name: "Electricity Bills (Shop & Warehouse)" },
  { code: "5303", name: "Driver Food, Tea & Daily Allowances" },
  { code: "5304", name: "Vehicle Fuel, Logistics & Tolls" },
  { code: "5305", name: "Office Supplies & Stationery" },
  { code: "5306", name: "Shop Maintenance & Repairs" },
  { code: "5307", name: "Bank Interest & CC Finance Charges" },
];

/**
 * Guarantee the expense engine's COA accounts exist for a firm:
 * the seven Indirect-Expense accounts (5301–5307) plus the Bank
 * Cash Credit facility (2500). Idempotent — safe to call on every save.
 */
export async function ensureExpenseAccounts(firmId: string): Promise<void> {
  await Promise.all([
    ...EXPENSE_ACCOUNTS.map((a) =>
      db.chartOfAccount.upsert({
        where: { firmId_accountCode: { firmId, accountCode: a.code } },
        update: {},
        create: {
          firmId,
          accountCode: a.code,
          accountName: a.name,
          accountGroup: "Indirect Expenses",
          accountClass: "EXPENSE",
        },
      })
    ),
    db.chartOfAccount.upsert({
      where: { firmId_accountCode: { firmId, accountCode: ACC_CC } },
      update: {},
      create: {
        firmId,
        accountCode: ACC_CC,
        accountName: "Bank Cash Credit (CC) Facility",
        accountGroup: "Current Liabilities",
        accountClass: "LIABILITY",
      },
    }),
  ]);
}

/** The default DMK Mart chart of expense categories — trilingual. */
export const DEFAULT_EXPENSE_CATEGORIES: Array<{
  code: string;
  nameEnglish: string;
  nameHindi: string;
  nameMarathi: string;
  description: string;
  accountCode: string;
  sortOrder: number;
}> = [
  {
    code: "4100",
    nameEnglish: "Staff Salaries & Daily Helper Wages",
    nameHindi: "स्टाफ वेतन एवं दैनिक हेल्पर मजदूरी",
    nameMarathi: "स्टाफ वेतन व दैनिक हेल्पर मजुरी",
    description: "Monthly salaries and daily helper wages",
    accountCode: "5301",
    sortOrder: 1,
  },
  {
    code: "4200",
    nameEnglish: "Shop & Warehouse Electricity (MSEDCL)",
    nameHindi: "दुकान एवं गोदाम बिजली बिल (MSEDCL)",
    nameMarathi: "दुकाण व गोदाम वीज बिल (MSEDCL)",
    description: "MSEDCL electricity bills for shop and warehouse",
    accountCode: "5302",
    sortOrder: 2,
  },
  {
    code: "4300",
    nameEnglish: "Food, Tea & Driver Daily Allowances",
    nameHindi: "खाना, चाय व ड्राइवर दैनिक भत्ता (नाश्ता/चाय/भत्ता)",
    nameMarathi: "जेवण, चहा व ड्रायव्हर दैनिक भत्ता (नाश्ता/चहा/भत्ता)",
    description: "नाश्ता, चहा, जेवण — daily staff & driver allowances",
    accountCode: "5303",
    sortOrder: 3,
  },
  {
    code: "4400",
    nameEnglish: "Vehicle Fuel, Delivery Logistics & Tolls",
    nameHindi: "वाहन ईंधन, डिलीवरी लॉजिस्टिक्स व टोल (डीज़ल/गाडी खर्च)",
    nameMarathi: "वाहन डिझेल, डिलिव्हरी लॉजिस्टिक्स व टोल (गाडी खर्च)",
    description: "Diesel, petrol, highway tolls and delivery vehicle costs",
    accountCode: "5304",
    sortOrder: 4,
  },
  {
    code: "4500",
    nameEnglish: "Office Supplies, Packaging Tape & Stationery",
    nameHindi: "ऑफिस सामग्री, पैकेजिंग टेप व स्टेशनरी",
    nameMarathi: "ऑफिस साहित्य, पॅकेजिंग टेप व स्टेशनरी",
    description: "Stationery, packaging tape, printer and shop supplies",
    accountCode: "5305",
    sortOrder: 5,
  },
  {
    code: "4600",
    nameEnglish: "Shop Maintenance & Repairs",
    nameHindi: "दुकान रखरखाव व मरम्मत",
    nameMarathi: "दुकाण देखभाल व दुरुस्ती",
    description: "Repairs, maintenance, plumbing, electrical fixes",
    accountCode: "5306",
    sortOrder: 6,
  },
  {
    code: "4700",
    nameEnglish: "Bank Interest & CC Account Finance Charges",
    nameHindi: "बैंक ब्याज व सीसी खाता वित्तीय शुल्क",
    nameMarathi: "बँक व्याज व सीसी खाते वित्तीय शुल्क",
    description: "CC facility interest, bank charges and processing fees",
    accountCode: "5307",
    sortOrder: 7,
  },
];

/** Seed the default trilingual expense categories for a firm. Idempotent. */
export async function seedExpenseCategories(firmId: string): Promise<void> {
  await Promise.all(
    DEFAULT_EXPENSE_CATEGORIES.map((c) =>
      db.expenseCategory.upsert({
        where: { firmId_code: { firmId, code: c.code } },
        update: {},
        create: { firmId, ...c },
      })
    )
  );
}

/** EXP-{FY-start-year}-{0001} — e.g. "EXP-2026-0042".
 *  Uses the HIGHEST existing sequence (not the row count) so deleting
 *  an older voucher can never collide with a newer number. */
export async function nextExpenseVoucherNumber(firmId: string, expenseDate: Date): Promise<string> {
  const vouchers = await db.expenseVoucher.findMany({
    where: { firmId },
    select: { voucherNumber: true },
  });
  const maxSeq = vouchers.reduce((m, v) => {
    const match = v.voucherNumber.match(/-(\d{4,})$/);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const year = fyLabelForDate(expenseDate).split("-")[0];
  return `EXP-${year}-${String(maxSeq + 1).padStart(4, "0")}`;
}

export interface ExpenseInput {
  expenseDate: Date;
  categoryId: string;
  amount: number;
  paymentSource: string;
  paidTo?: string;
  vehicleNumber?: string;
  tripId?: string;
  narration?: string;
  receiptFileUrl?: string | null;
  createdBy?: string;
}

const MAX_RECEIPT_BYTES = 4_500_000; // ~4.5 MB data-URL ceiling (Vercel-safe)

/** Validate + create one expense voucher with its PAYMENT journal. */
export async function createExpenseVoucher(
  firmId: string,
  input: ExpenseInput
): Promise<{ voucher: Prisma.ExpenseVoucherGetPayload<{ include: { category: true; journalEntry: true } }>; journal: Prisma.JournalEntryGetPayload<{ include: { lines: true } }> }> {
  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BusinessError("ERR_VALIDATION", "Expense amount must be greater than zero", 400);
  }
  if (amount > 99_999_999) {
    throw new BusinessError("ERR_VALIDATION", "Expense amount is unrealistically large", 400);
  }
  if (!SOURCE_ACCOUNT[input.paymentSource]) {
    throw new BusinessError("ERR_VALIDATION", "paymentSource must be CASH_DRAWER, BANK_CURRENT or BANK_CC", 400);
  }
  if (input.receiptFileUrl && input.receiptFileUrl.length > MAX_RECEIPT_BYTES) {
    throw new BusinessError("ERR_VALIDATION", "Receipt photo is too large — keep it under ~3 MB", 400);
  }

  await ensureExpenseAccounts(firmId);

  const category = await db.expenseCategory.findFirst({
    where: { id: input.categoryId, firmId },
  });
  if (!category) throw new BusinessError("ERR_CATEGORY_NOT_FOUND", "Expense category not found for this firm", 404);
  if (!category.isActive) {
    throw new BusinessError("ERR_CATEGORY_INACTIVE", "This expense category has been switched off", 400);
  }

  const voucherNumber = await nextExpenseVoucherNumber(firmId, input.expenseDate);

  const voucher = await dbTx(async (tx) =>
    tx.expenseVoucher.create({
      data: {
        firmId,
        voucherNumber,
        expenseDate: input.expenseDate,
        categoryId: category.id,
        amount,
        paymentSource: input.paymentSource as never,
        paidTo: (input.paidTo ?? "").slice(0, 120),
        vehicleNumber: (input.vehicleNumber ?? "").slice(0, 40),
        tripId: input.tripId ?? "",
        narration: (input.narration ?? "").slice(0, 400),
        receiptFileUrl: input.receiptFileUrl ?? null,
        createdBy: input.createdBy || "OWNER",
      },
    })
  );

  const categoryName = category.nameEnglish;
  const journal = await postJournal({
    firmId,
    voucherType: "PAYMENT",
    postingDate: input.expenseDate,
    narration: `${category.code} ${categoryName}${input.paidTo ? ` — paid to ${input.paidTo}` : ""}${
      input.narration ? ` — ${input.narration}` : ""
    }`,
    referenceDocId: voucher.id,
    lines: [
      { accountCode: category.accountCode, entrySide: "DEBIT", amount, narration: categoryName },
      { accountCode: SOURCE_ACCOUNT[input.paymentSource], entrySide: "CREDIT", amount },
    ],
  });

  const linked = await db.expenseVoucher.update({
    where: { id: voucher.id },
    data: { journalEntryId: journal.id },
    include: { category: true, journalEntry: { include: { lines: true } } },
  });

  return { voucher: linked, journal };
}

/**
 * Delete an expense voucher the accounting-correct way: the original
 * journal stays immutable (audit trail), a mirror reversal PAYMENT
 * journal (Dr money-source / Cr expense) cancels its effect, then the
 * voucher row is removed. Drawer / bank / P&L return to their prior state.
 */
export async function reverseAndDeleteExpenseVoucher(
  firmId: string,
  voucherId: string
): Promise<{ reversalJournalNumber: string }> {
  const voucher = await db.expenseVoucher.findFirst({
    where: { id: voucherId, firmId },
    include: { category: true },
  });
  if (!voucher) throw new BusinessError("ERR_EXPENSE_NOT_FOUND", "Expense voucher not found for this firm", 404);

  await ensureExpenseAccounts(firmId);

  const reversal = await postJournal({
    firmId,
    voucherType: "PAYMENT",
    postingDate: new Date(),
    narration: `Reversal of ${voucher.voucherNumber} (${voucher.category.nameEnglish} ₹${round2(
      voucher.amount
    ).toFixed(2)}) — expense entry deleted by owner`,
    referenceDocId: voucher.id,
    lines: [
      { accountCode: SOURCE_ACCOUNT[voucher.paymentSource] ?? ACC.CASH, entrySide: "DEBIT", amount: voucher.amount },
      { accountCode: voucher.category.accountCode, entrySide: "CREDIT", amount: voucher.amount },
    ],
  });

  await db.expenseVoucher.delete({ where: { id: voucher.id } });

  return { reversalJournalNumber: reversal.voucherNumber };
}
