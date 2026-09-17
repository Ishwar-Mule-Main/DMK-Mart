// ═══════════════════════════════════════════════════════════════
// FIRM ACCOUNT SETUP HELPERS
// - createFirmWithBooks: firm + Chart of Accounts + opening journal
//   (shared by POST /firms, POST /auth/register, seed)
// - sanitizeFirm: strips loginPassword before any API response
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { ACC, postJournal, seedChartOfAccounts } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import type { Firm } from "@prisma/client";

/** Default brand logo shipped with the app (public/dmk-logo.png). */
export const DEFAULT_LOGO_URL = "/dmk-logo.png";

/** Strip the sign-in secret before a firm ever reaches the client. */
export function sanitizeFirm<T extends Partial<Firm> | Record<string, unknown>>(
  firm: T
): Omit<T, "loginPassword"> {
  if (!firm || typeof firm !== "object") return firm;
  const clone = { ...firm } as Record<string, unknown>;
  delete clone.loginPassword;
  return clone as Omit<T, "loginPassword">;
}

export interface FirmSetupInput {
  firmName: string;
  firmCode: string;
  gstin?: string;
  state?: string;
  stateCode?: string;
  address?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  ifsc?: string;
  financialYear?: string;
  invoicePrefix?: string;
  logoUrl?: string;
  loginPassword?: string;
  openingCash?: number;
  openingBank?: number;
  /** Fixed posting date for the opening journal (seed/demo use). */
  postingDate?: Date;
  /** Custom narration for the opening journal. */
  openingNarration?: string;
}

/**
 * Creates the company account with fully separate books:
 * firm row → Chart of Accounts → OPENING capital journal
 * (Dr CASH / Dr BANK / Cr CAPITAL) when an opening balance exists.
 */
export async function createFirmWithBooks(input: FirmSetupInput) {
  const openingCash = round2(Math.max(0, input.openingCash ?? 0));
  const openingBank = round2(Math.max(0, input.openingBank ?? 0));
  const gstin = (input.gstin ?? "").trim();
  const stateCode =
    (input.stateCode ?? "").trim() || (/^\d{2}/.test(gstin) ? gstin.slice(0, 2) : "27");

  const firm = await db.firm.create({
    data: {
      firmName: input.firmName,
      firmCode: input.firmCode,
      gstin,
      state: input.state?.trim() || "Maharashtra",
      stateCode,
      address: input.address ?? "",
      phone: input.phone ?? "",
      email: input.email ?? "",
      bankName: input.bankName ?? "",
      bankAccount: input.bankAccount ?? "",
      ifsc: input.ifsc ?? "",
      financialYear: input.financialYear?.trim() || "2025-26",
      invoicePrefix: input.invoicePrefix?.trim() || input.firmCode,
      logoUrl: input.logoUrl?.trim() || DEFAULT_LOGO_URL,
      loginPassword: input.loginPassword?.trim() || "1234",
      openingCash,
      openingBank,
    },
  });

  // Fully separate ledger skeleton for the new company account
  await seedChartOfAccounts(firm.id);

  let journal: Awaited<ReturnType<typeof postJournal>> | null = null;
  const capital = round2(openingCash + openingBank);
  if (capital > 0) {
    journal = await postJournal({
      firmId: firm.id,
      voucherType: "OPENING",
      postingDate: input.postingDate ?? new Date(),
      narration: input.openingNarration ?? `Opening capital contribution — ${firm.firmName}`,
      lines: [
        { accountCode: ACC.CASH, entrySide: "DEBIT", amount: openingCash, narration: "Opening cash balance" },
        { accountCode: ACC.BANK, entrySide: "DEBIT", amount: openingBank, narration: "Opening bank balance" },
        { accountCode: ACC.CAPITAL, entrySide: "CREDIT", amount: capital, narration: "Owner's capital introduced" },
      ],
    });
  }

  return { firm, journal };
}
