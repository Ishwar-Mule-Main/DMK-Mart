// ═══════════════════════════════════════════════════════════════
// /api/v1/customers — B2B location-first parties + B2C counter directory
// R7: openingBalance → LedgerEntry OPENING with balanceAfter
// R8: B2B partyName = "City FirmName" | R9: B2C partyName = person name
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { addCustomerLedger } from "@/app/api/v1/_lib/party";
import { containsArms, rankSearch } from "@/lib/search-rank";

function composePartyName(customerType: string, city: string, firmName: string): string {
  if (customerType === "B2B") return `${city} ${firmName}`.trim();
  return firmName.trim();
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const search = getStr(sp.get("search"));
    const type = getStr(sp.get("type"));

    // Word-wise SQL prefilter: every query word must hit at least one
    // searchable column (AND across words, OR across columns). Case variants
    // keep the prefilter a superset on Postgres AND SQLite.
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { partyName: { contains: v } },
        { firmName: { contains: v } },
        { city: { contains: v } },
        { phone: { contains: v } },
        { gstin: { contains: v } },
      ]);

    const customers = await db.customer.findMany({
      where: {
        firmId,
        ...(type ? { customerType: type } : {}),
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      orderBy: { partyName: "asc" },
      take: 500,
    });

    // Word-wise / text-wise relevance on top of the SQL prefilter —
    // party name leads the fields.
    const ranked = rankSearch(customers, search, (c) => [c.partyName, c.phone, c.city, c.gstin]);
    return ok(ranked);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const firmName = getStr(body.firmName);
    if (!firmName) {
      throw new BusinessError("ERR_VALIDATION", "firmName is required (business name for B2B, person name for B2C)", 400);
    }

    const requestedType = getStr(body.customerType) || "B2B";
    if (!["B2B", "B2C_COUNTER"].includes(requestedType)) {
      throw new BusinessError("ERR_VALIDATION", "customerType must be B2B or B2C_COUNTER", 400);
    }
    const customerType = requestedType === "B2C_COUNTER" ? "B2C_COUNTER" : requestedType;
    const city = getStr(body.city);
    const partyName = composePartyName(customerType, city, firmName);

    // R14: B2C accounts carry no credit
    const creditLimit = customerType === "B2C_COUNTER" ? 0 : round2(getNum(body.creditLimit));
    const openingBalance = round2(getNum(body.openingBalance));

    const customer = await db.customer.create({
      data: {
        firmId: firm.id,
        partyName,
        firmName,
        city,
        stateCode: getStr(body.stateCode) || (/^\d{2}/.test(getStr(body.gstin)) ? getStr(body.gstin).slice(0, 2) : firm.stateCode),
        gstin: getStr(body.gstin),
        phone: getStr(body.phone),
        email: getStr(body.email),
        address: getStr(body.address),
        customerType,
        assignedTier: getStr(body.assignedTier) || "tier4Retailer",
        creditLimit,
        creditDays: Math.round(getNum(body.creditDays, 30)),
        openingBalance,
        closingBalance: openingBalance,
      },
    });

    if (openingBalance !== 0) {
      await addCustomerLedger(db, customer.id, {
        entryDate: new Date(),
        voucherType: "OPENING",
        voucherNo: "OPENING",
        particulars: "Opening balance brought forward",
        debit: openingBalance > 0 ? openingBalance : 0,
        credit: openingBalance < 0 ? -openingBalance : 0,
      });
    }

    return ok(customer, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
