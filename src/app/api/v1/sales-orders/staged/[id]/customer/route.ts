// ═══════════════════════════════════════════════════════════════
// POST /api/v1/sales-orders/staged/[id]/customer — Quick-Add modal
// "NEW CUSTOMER DETECTED IN PDF" → save to the master directory with
// one click and attach to this order (pre-filled from the scan).
// { businessName, contactPerson?, phone, address?, city?, gstin?,
//   assignedTier?, creditLimit? }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  BusinessError,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";
import { shapeStagedOrder } from "@/app/api/v1/_lib/stagedOrders";

const TIER_KEYS = ["tier1Distributor", "tier2Wholesale", "tier3SemiWholesale", "tier4Retailer", "tier5Mrp"];

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const staged = await db.stagedOrderUpload.findUnique({ where: { id } });
    if (!staged) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);
    if (staged.status !== "NEEDS_REVIEW") {
      throw new BusinessError("ERR_INVALID_STATE", "This upload has already been processed", 409);
    }

    const businessName = getStr(body.businessName) || staged.extractedBusinessName;
    if (!businessName) {
      throw new BusinessError("ERR_VALIDATION", "Business name is required", 400);
    }

    // Duplicate guard — same digits already in the directory?
    const phone = getStr(body.phone) || staged.extractedPhone;
    if (phone) {
      const digits = phone.replace(/\D/g, "").slice(-10);
      if (digits.length === 10) {
        const existing = await db.customer.findFirst({
          where: { firmId: staged.firmId, phone: { contains: digits } },
          select: { id: true, partyName: true },
        });
        if (existing) {
          throw new BusinessError(
            "ERR_DUPLICATE_CUSTOMER",
            `Phone ${digits} already belongs to "${existing.partyName}" — pick them in the customer field instead.`,
            409
          );
        }
      }
    }

    const tier = TIER_KEYS.includes(getStr(body.assignedTier)) ? getStr(body.assignedTier) : "tier4Retailer";
    const customer = await db.customer.create({
      data: {
        firmId: staged.firmId,
        partyName: businessName.slice(0, 120),
        firmName: businessName.slice(0, 120),
        phone,
        address: getStr(body.address) || staged.extractedAddress,
        city: getStr(body.city) || staged.extractedCity,
        gstin: (getStr(body.gstin) || staged.extractedGstin).toUpperCase(),
        customerType: "B2B",
        assignedTier: tier,
        creditLimit: Math.max(0, getNum(body.creditLimit, 50000)),
        creditDays: 30,
        stateCode: "27",
      },
      select: { id: true, partyName: true },
    });

    await db.stagedOrderUpload.update({
      where: { id },
      data: {
        matchedCustomerId: customer.id,
        customerMatchMethod: "NEW",
        customerMatchScore: 1,
      },
    });

    const detail = await shapeStagedOrder(id);
    return ok({ customer, staged: detail }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
