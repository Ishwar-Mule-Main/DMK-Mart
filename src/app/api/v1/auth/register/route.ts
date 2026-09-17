// ═══════════════════════════════════════════════════════════════
// POST /api/v1/auth/register — create a NEW company account
// ("Create new account" on the login panel)
// Every new account is a fully separate company: own products,
// customers, vendors, invoices, stock pools, chart of accounts,
// journal books, document numbering — everything is firmId-scoped.
// Body: { firmName, firmCode, password?, gstin?, state?, stateCode?,
//         phone?, email?, address?, openingCash?, openingBank? }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { createFirmWithBooks, sanitizeFirm } from "@/app/api/v1/_lib/firm-setup";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));

    const firmName = getStr(body.firmName);
    const firmCode = getStr(body.firmCode).toUpperCase();
    if (!firmName || firmName.length < 2) {
      throw new BusinessError("ERR_VALIDATION", "Company name is required (min 2 characters)", 400);
    }
    if (!firmCode || !/^[A-Z0-9]{2,12}$/.test(firmCode)) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Account code must be 2–12 letters/numbers (e.g. DMK2)",
        400
      );
    }

    const existing = await db.firm.findUnique({ where: { firmCode } });
    if (existing) {
      throw new BusinessError(
        "ERR_DUPLICATE_FIRM_CODE",
        `Account code "${firmCode}" is already taken — pick another`,
        409
      );
    }

    const password = getStr(body.password);
    if (password && password.length < 4) {
      throw new BusinessError("ERR_VALIDATION", "Password must be at least 4 characters", 400);
    }

    const { firm, journal } = await createFirmWithBooks({
      firmName,
      firmCode,
      loginPassword: password || "1234",
      gstin: getStr(body.gstin),
      state: getStr(body.state),
      stateCode: getStr(body.stateCode),
      address: getStr(body.address),
      phone: getStr(body.phone),
      email: getStr(body.email),
      openingCash: getNum(body.openingCash),
      openingBank: getNum(body.openingBank),
    });

    return ok({ firm: sanitizeFirm(firm), journal }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
