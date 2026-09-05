// ═══════════════════════════════════════════════════════════════
// /api/v1/firms — list + create firms (R20: firm = account)
// POST seeds the Chart of Accounts and posts the OPENING journal:
//   Dr CASH openingCash, Dr BANK openingBank, Cr CAPITAL total
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, currentFyLabel, postJournal, seedChartOfAccounts } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";

export async function GET() {
  try {
    // ownerPassword never leaves the server
    const firms = await db.firm.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        firmName: true,
        firmCode: true,
        gstin: true,
        state: true,
        stateCode: true,
        address: true,
        phone: true,
        email: true,
        bankName: true,
        bankAccount: true,
        ifsc: true,
        financialYear: true,
        invoicePrefix: true,
        logoUrl: true,
        openingCash: true,
        openingBank: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return ok(firms);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));

    const firmName = getStr(body.firmName);
    const firmCode = getStr(body.firmCode).toUpperCase();
    if (!firmName || !firmCode) {
      throw new BusinessError("ERR_VALIDATION", "firmName and firmCode are required", 400);
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
        bankName: getStr(body.bankName),
        bankAccount: getStr(body.bankAccount),
        ifsc: getStr(body.ifsc),
        financialYear: getStr(body.financialYear) || currentFyLabel(),
        invoicePrefix: getStr(body.invoicePrefix) || firmCode,
        openingCash,
        openingBank,
      },
    });

    await seedChartOfAccounts(firm.id);

    // Opening capital journal — only when there is something to post
    let journal: Awaited<ReturnType<typeof postJournal>> | null = null;
    const capital = round2(openingCash + openingBank);
    if (capital > 0) {
      journal = await postJournal({
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

    return ok({ firm, journal }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
