// ═══════════════════════════════════════════════════════════════
// /api/v1/invoices/[id] — full detail (customer + line items)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, handleApiError, ok } from "@/app/api/v1/_lib/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoice = await db.invoice.findUnique({
      where: { id },
      include: {
        lineItems: {
          include: { product: { select: { id: true, unit: true, brand: true } } },
        },
        customer: {
          select: {
            id: true,
            partyName: true,
            firmName: true,
            city: true,
            stateCode: true,
            gstin: true,
            phone: true,
            address: true,
            customerType: true,
            closingBalance: true,
          },
        },
        salesReturns: { select: { id: true, creditNoteNo: true, grandTotal: true } },
        salesMember: { select: { id: true, fullName: true, username: true } },
      },
    });
    if (!invoice) throw new BusinessError("ERR_NOT_FOUND", "Invoice not found", 404);
    return ok(invoice);
  } catch (e) {
    return handleApiError(e);
  }
}
