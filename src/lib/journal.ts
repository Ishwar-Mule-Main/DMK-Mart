// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — DOUBLE-ENTRY JOURNAL ENGINE
// Sacred invariant: Σ Debits ≡ Σ Credits (to the paisa)
// Journals are immutable after posting. Reversals create new entries.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { round2 } from "./gst";

export type VoucherType =
  | "SALES"
  | "PURCHASE"
  | "RECEIPT"
  | "PAYMENT"
  | "JOURNAL"
  | "CONTRA"
  | "CREDIT_NOTE"
  | "DEBIT_NOTE"
  | "OPENING";

export interface JournalLineInput {
  accountCode: string; // resolved within the firm's COA
  entrySide: "DEBIT" | "CREDIT";
  amount: number;
  narration?: string;
}

export interface PostJournalInput {
  firmId: string;
  voucherType: VoucherType;
  postingDate: Date;
  narration: string;
  referenceDocId?: string;
  lines: JournalLineInput[];
}

export class JournalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Sequential voucher numbering: {PREFIX}/{FY}/{TYPE}/{0001} */
export async function nextVoucherNumber(
  firmId: string,
  voucherType: VoucherType,
  invoicePrefix: string,
  fy: string
): Promise<string> {
  const count = await db.journalEntry.count({
    where: { firmId, voucherType },
  });
  return `${invoicePrefix}/${fy}/${voucherType.slice(0, 3)}/${String(count + 1).padStart(4, "0")}`;
}

/** Sequential document numbering for a specific doc family. */
export async function nextDocNumber(
  family: "INVOICE" | "PO" | "CN" | "DN",
  firmId: string,
  invoicePrefix: string,
  fy: string
): Promise<string> {
  let count = 0;
  if (family === "INVOICE") count = await db.invoice.count({ where: { firmId } });
  else if (family === "PO") count = await db.purchaseOrder.count({ where: { firmId } });
  else if (family === "CN") count = await db.salesReturn.count({ where: { firmId } });
  else count = await db.purchaseReturn.count({ where: { firmId } });
  const suffix = { INVOICE: "INV", PO: "PO", CN: "CN", DN: "DN" }[family];
  return `${invoicePrefix}/${fy}/${suffix}/${String(count + 1).padStart(4, "0")}`;
}

/**
 * Post a balanced journal entry. Throws ERR_JOURNAL_UNBALANCED when
 * ΣDr ≠ ΣCr (to the paisa). Creates entry + lines atomically.
 */
export async function postJournal(input: PostJournalInput) {
  const lines = input.lines
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .filter((l) => l.amount !== 0);
  if (lines.length < 2) {
    throw new JournalError("ERR_JOURNAL_UNBALANCED", "Journal requires at least two non-zero lines");
  }

  const totalDebit = round2(lines.filter((l) => l.entrySide === "DEBIT").reduce((s, l) => s + l.amount, 0));
  const totalCredit = round2(lines.filter((l) => l.entrySide === "CREDIT").reduce((s, l) => s + l.amount, 0));

  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new JournalError(
      "ERR_JOURNAL_UNBALANCED",
      `Σ Debits (₹${totalDebit.toFixed(2)}) ≠ Σ Credits (₹${totalCredit.toFixed(2)}) — entry rejected`
    );
  }

  const accounts = await db.chartOfAccount.findMany({
    where: { firmId: input.firmId, accountCode: { in: lines.map((l) => l.accountCode) } },
  });
  const accountMap = new Map(accounts.map((a) => [a.accountCode, a]));
  for (const l of lines) {
    if (!accountMap.has(l.accountCode)) {
      throw new JournalError("ERR_ACCOUNT_NOT_FOUND", `Account ${l.accountCode} not found in firm COA`);
    }
  }

  const voucherNumber = await nextVoucherNumber(
    input.firmId,
    input.voucherType,
    (await db.firm.findUnique({ where: { id: input.firmId } }))?.invoicePrefix ?? "DMK",
    (await db.firm.findUnique({ where: { id: input.firmId } }))?.financialYear ?? "25-26"
  );

  return db.journalEntry.create({
    data: {
      firmId: input.firmId,
      voucherNumber,
      voucherType: input.voucherType,
      postingDate: input.postingDate,
      referenceDocId: input.referenceDocId ?? "",
      narration: input.narration,
      totalDebit,
      totalCredit,
      lines: {
        create: lines.map((l) => {
          const acc = accountMap.get(l.accountCode)!;
          return {
            accountId: acc.id,
            accountName: acc.accountName,
            entrySide: l.entrySide,
            debitAmount: l.entrySide === "DEBIT" ? l.amount : 0,
            creditAmount: l.entrySide === "CREDIT" ? l.amount : 0,
            narration: l.narration ?? input.narration,
          };
        }),
      },
    },
    include: { lines: true },
  });
}

/** Standard account codes used by the auto-posting engine. */
export const ACC = {
  CASH: "1000",
  BANK: "1010",
  UPI_CLEARING: "1020",
  AR: "1100", // Sundry Debtors
  INVENTORY: "1200", // Finished Goods Stock
  ITC: "1300", // GST Input Tax Credit
  AP: "2000", // Sundry Creditors
  GST_CGST: "2100",
  GST_SGST: "2110",
  GST_IGST: "2120",
  CAPITAL: "3000",
  RETAINED: "3100",
  SALES: "4000",
  SALES_RETURNS: "4100",
  COGS: "5000",
  PURCHASES: "5100",
  FREIGHT: "5200",
  OPEX: "5300",
  ROUND_OFF: "5400",
  DAMAGE_LOSS: "5500",
} as const;

/** Seed the standard Chart of Accounts for a firm. */
export async function seedChartOfAccounts(firmId: string) {
  const coa: Array<{ code: string; name: string; group: string; cls: string }> = [
    { code: ACC.CASH, name: "Cash in Hand", group: "Current Assets", cls: "ASSET" },
    { code: ACC.BANK, name: "Bank Account", group: "Current Assets", cls: "ASSET" },
    { code: ACC.UPI_CLEARING, name: "UPI Clearing Account", group: "Current Assets", cls: "ASSET" },
    { code: ACC.AR, name: "Sundry Debtors (Accounts Receivable)", group: "Current Assets", cls: "ASSET" },
    { code: ACC.INVENTORY, name: "Inventory Asset", group: "Current Assets", cls: "ASSET" },
    { code: ACC.ITC, name: "GST Input Tax Credit (ITC)", group: "Current Assets", cls: "ASSET" },
    { code: ACC.AP, name: "Sundry Creditors (Accounts Payable)", group: "Current Liabilities", cls: "LIABILITY" },
    { code: ACC.GST_CGST, name: "Output CGST Payable", group: "Current Liabilities", cls: "LIABILITY" },
    { code: ACC.GST_SGST, name: "Output SGST Payable", group: "Current Liabilities", cls: "LIABILITY" },
    { code: ACC.GST_IGST, name: "Output IGST Payable", group: "Current Liabilities", cls: "LIABILITY" },
    { code: ACC.CAPITAL, name: "Owner's Capital", group: "Equity", cls: "EQUITY" },
    { code: ACC.RETAINED, name: "Retained Earnings", group: "Equity", cls: "EQUITY" },
    { code: ACC.SALES, name: "Domestic Sales Revenue", group: "Direct Income", cls: "REVENUE" },
    { code: ACC.SALES_RETURNS, name: "Sales Returns (Contra)", group: "Direct Income", cls: "REVENUE" },
    { code: ACC.COGS, name: "Cost of Goods Sold", group: "Direct Expenses", cls: "EXPENSE" },
    { code: ACC.PURCHASES, name: "Purchases", group: "Direct Expenses", cls: "EXPENSE" },
    { code: ACC.FREIGHT, name: "Freight Inward", group: "Direct Expenses", cls: "EXPENSE" },
    { code: ACC.OPEX, name: "Operating Expenses", group: "Indirect Expenses", cls: "EXPENSE" },
    { code: ACC.ROUND_OFF, name: "Round-Off", group: "Indirect Expenses", cls: "EXPENSE" },
    { code: ACC.DAMAGE_LOSS, name: "Damaged Stock Write-Off", group: "Indirect Expenses", cls: "EXPENSE" },
  ];
  await db.chartOfAccount.createMany({
    data: coa.map((a) => ({
      firmId,
      accountCode: a.code,
      accountName: a.name,
      accountGroup: a.group,
      accountClass: a.cls,
    })),
  });
}
