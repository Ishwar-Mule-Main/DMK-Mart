// ═══════════════════════════════════════════════════════════════
// /api/v1/vendors — manufacturers (brand-scoped, R10) + distributors
// R7: openingBalance (Cr-positive) → LedgerEntry OPENING
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
import { addVendorLedger } from "@/app/api/v1/_lib/party";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const search = getStr(sp.get("search"));
    const type = getStr(sp.get("type"));

    const vendors = await db.vendor.findMany({
      where: {
        firmId,
        ...(type ? { vendorType: type } : {}),
        ...(search
          ? {
              OR: [
                { vendorName: { contains: search } },
                { brand: { contains: search } },
                { phone: { contains: search } },
                { gstin: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { vendorName: "asc" },
      take: 500,
    });
    return ok(vendors);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const vendorName = getStr(body.vendorName);
    if (!vendorName) {
      throw new BusinessError("ERR_VALIDATION", "vendorName is required", 400);
    }
    const vendorType = getStr(body.vendorType) || "DISTRIBUTOR";
    if (!["MANUFACTURER", "DISTRIBUTOR"].includes(vendorType)) {
      throw new BusinessError("ERR_VALIDATION", "vendorType must be MANUFACTURER or DISTRIBUTOR", 400);
    }

    const openingBalance = round2(getNum(body.openingBalance));

    const vendor = await db.vendor.create({
      data: {
        firmId: firm.id,
        vendorName,
        vendorType,
        brand: vendorType === "MANUFACTURER" ? getStr(body.brand) : getStr(body.brand),
        gstin: getStr(body.gstin),
        stateCode: getStr(body.stateCode) || (/^\d{2}/.test(getStr(body.gstin)) ? getStr(body.gstin).slice(0, 2) : firm.stateCode),
        phone: getStr(body.phone),
        email: getStr(body.email),
        address: getStr(body.address),
        paymentTerms: getStr(body.paymentTerms) || "NET_30",
        openingBalance,
        closingBalance: openingBalance,
      },
    });

    if (openingBalance !== 0) {
      await addVendorLedger(db, vendor.id, {
        entryDate: new Date(),
        voucherType: "OPENING",
        voucherNo: "OPENING",
        particulars: "Opening balance brought forward",
        debit: openingBalance < 0 ? -openingBalance : 0,
        credit: openingBalance > 0 ? openingBalance : 0,
      });
    }

    return ok(vendor, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
