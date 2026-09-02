// ═══════════════════════════════════════════════════════════════
// /api/v1/ledger/party — full party statement (R7)
// opening → LedgerEntry rows (chronological, running balanceAfter) → closing
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const partyType = getStr(sp.get("partyType")).toUpperCase();
    const partyId = getStr(sp.get("partyId"));
    if (!["CUSTOMER", "VENDOR"].includes(partyType)) {
      throw new BusinessError("ERR_VALIDATION", "partyType must be CUSTOMER or VENDOR", 400);
    }
    if (!partyId) throw new BusinessError("ERR_VALIDATION", "partyId is required", 400);

    if (partyType === "CUSTOMER") {
      const party = await db.customer.findFirst({ where: { id: partyId, firmId } });
      if (!party) throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found", 404);
      const entries = await db.ledgerEntry.findMany({
        where: { firmId, customerId: partyId },
        orderBy: { entryDate: "asc" },
      });
      return ok({
        partyType,
        party: {
          id: party.id,
          name: party.partyName,
          customerType: party.customerType,
          stateCode: party.stateCode,
          creditLimit: party.creditLimit,
          creditDays: party.creditDays,
        },
        opening: party.openingBalance,
        entries,
        closing: party.closingBalance,
      });
    }

    const party = await db.vendor.findFirst({ where: { id: partyId, firmId } });
    if (!party) throw new BusinessError("ERR_VENDOR_NOT_FOUND", "Vendor not found", 404);
    const entries = await db.ledgerEntry.findMany({
      where: { firmId, vendorId: partyId },
      orderBy: { entryDate: "asc" },
    });
    return ok({
      partyType,
      party: {
        id: party.id,
        name: party.vendorName,
        vendorType: party.vendorType,
        brand: party.brand,
        stateCode: party.stateCode,
        paymentTerms: party.paymentTerms,
      },
      opening: party.openingBalance,
      entries,
      closing: party.closingBalance,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
