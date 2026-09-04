// ═══════════════════════════════════════════════════════════════
// POST /api/v1/auth/register-firm — "Create company account" from the
// login panel. Creates the firm (fully isolated data) + Chart of
// Accounts + owner password, and posts the OPENING capital journal.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, postJournal, seedChartOfAccounts } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { hashPasswordAsync } from "@/app/api/v1/_lib/verification";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));

    const firmName = getStr(body.firmName);
    const firmCode = getStr(body.firmCode).toUpperCase();
    const password = getStr(body.password);
    if (!firmName || !firmCode || !password) {
      throw new BusinessError("ERR_VALIDATION", "Company name, code and owner password are required", 400);
    }
    if (password.length < 4) {
      throw new BusinessError("ERR_VALIDATION", "Owner password must be at least 4 characters", 400);
    }

    const existing = await db.firm.findUnique({ where: { firmCode } });
    if (existing) {
      throw new BusinessError("ERR_DUPLICATE_FIRM_CODE", `Firm code "${firmCode}" is already in use`, 409);
    }

    const gstin = getStr(body.gstin);
    const stateCode = getStr(body.stateCode) || (/^\d{2}/.test(gstin) ? gstin.slice(0, 2) : "27");
    const openingCash = round2(Math.max(0, getNum(body.openingCash)));
    const openingBank = round2(Math.max(0, getNum(body.openingBank)));

    const firm = await db.firm.create({
      data: {
        firmName,
        firmCode,
        gstin,
        state: getStr(body.state) || "Maharashtra",
        stateCode,
        address: getStr(body.address),
        phone: getStr(body.phone),
        email: getStr(body.email),
        financialYear: getStr(body.financialYear) || "2025-26",
        invoicePrefix: getStr(body.invoicePrefix) || firmCode,
        openingCash,
        openingBank,
        logoUrl: "/dmk-logo.png",
        ownerPassword: await hashPasswordAsync(password),
      },
    });

    await seedChartOfAccounts(firm.id);

    const capital = round2(openingCash + openingBank);
    if (capital > 0) {
      await postJournal({
        firmId: firm.id,
        voucherType: "OPENING",
        postingDate: new Date(),
        narration: `Opening capital contribution — ${firm.firmName}`,
        lines: [
          { accountCode: ACC.CASH, entrySide: "DEBIT", amount: openingCash, narration: "Opening cash balance" },
          { accountCode: ACC.BANK, entrySide: "DEBIT", amount: openingBank, narration: "Opening bank balance" },
          { accountCode: ACC.CAPITAL, entrySide: "CREDIT", amount: capital, narration: "Owner's capital introduced" },
        ],
      });
    }

    return ok(
      { firm: { id: firm.id, firmName: firm.firmName, firmCode: firm.firmCode } },
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
