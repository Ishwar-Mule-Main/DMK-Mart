// ═══════════════════════════════════════════════════════════════
// /api/v1/vendor-payments — paydown of vendor payable (Cr-positive ↓)
// Journal: Dr AP, Cr CASH/BANK — voucherType PAYMENT (R6/R7)
// Engine shared with seed in _lib/payments.ts
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  asRecord,
  getDate,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { createVendorPayment } from "@/app/api/v1/_lib/payments";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const vendorId = getStr(sp.get("vendorId"));
    const payments = await db.vendorPayment.findMany({
      where: { firmId, ...(vendorId ? { vendorId } : {}) },
      include: {
        vendor: { select: { id: true, vendorName: true } },
        allocations: {
          select: { amount: true, purchaseOrder: { select: { poNumber: true } } },
        },
      },
      orderBy: { paymentDate: "desc" },
      take: 200,
    });
    return ok(payments);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const result = await createVendorPayment(firm, {
      vendorId: getStr(body.vendorId),
      paymentDate: getDate(body.paymentDate),
      amount: getNum(body.amount),
      mode: getStr(body.mode) || "NEFT",
      utrRef: getStr(body.utrRef),
      notes: getStr(body.notes),
      allocations: Array.isArray(body.allocations)
        ? body.allocations
            .map((a: unknown) => {
              const r = asRecord(a);
              return { invoiceId: getStr(r.purchaseOrderId ?? r.poId ?? r.invoiceId), amount: getNum(r.amount) };
            })
            .filter((a: { invoiceId: string; amount: number }) => a.invoiceId && a.amount > 0)
        : [],
    });

    return ok(result, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
