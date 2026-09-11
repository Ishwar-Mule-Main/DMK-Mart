// ═══════════════════════════════════════════════════════════════
// /api/v1/purchase-orders — list + create (PENDING, no side effects)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  fyRange,
  getDate,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { createPurchaseOrder } from "@/app/api/v1/_lib/po";
import { settledTotalsByPo } from "@/app/api/v1/_lib/settlement-ap";
import { createVerificationForPo, notifyRealtime } from "@/app/api/v1/_lib/verification";
import { containsArms, rankSearch } from "@/lib/search-rank";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const status = getStr(sp.get("status"));
    const search = getStr(sp.get("search"));
    const fy = fyRange(sp.get("fy"));

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
        { poNumber: { contains: v } },
        { vendor: { vendorName: { contains: v } } },
      ]);

    const orders = await db.purchaseOrder.findMany({
      where: {
        firmId,
        ...(fy ? { poDate: fy } : {}),
        ...(status ? { status } : {}),
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      include: {
        vendor: { select: { id: true, vendorName: true, vendorType: true, brand: true } },
        items: true,
      },
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    // AP subledger badges (cycle 17): settled/credited/outstanding on
    // CONFIRMED orders — mirrors the invoice register pattern.
    const settleMap = await settledTotalsByPo(
      firmId,
      orders.filter((o) => o.status === "CONFIRMED").map((o) => o.id)
    );
    const withSettlement = orders.map((o) => {
      if (o.status !== "CONFIRMED") return o;
      const s = settleMap.get(o.id);
      const paid = s?.settled ?? 0;
      const credited = s?.credited ?? 0;
      return {
        ...o,
        paid,
        credited,
        outstanding: Math.round((o.grandTotal - paid - credited) * 100) / 100,
      };
    });

    // Word-wise matching (chronological — newest-first register order kept).
    const ranked = rankSearch(withSettlement, search, (o) => [o.poNumber, o.vendor?.vendorName ?? ""], {
      chronological: true,
    });
    return ok(ranked);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const vendorId = getStr(body.vendorId);
    if (!vendorId) throw new BusinessError("ERR_VALIDATION", "vendorId is required", 400);

    const items = asRecordArray(body.items).map((i) => ({
      productId: getStr(i.productId),
      quantity: getNum(i.quantity),
      unitCost: getNum(i.unitCost),
    }));
    if (items.length === 0) {
      throw new BusinessError("ERR_EMPTY_ITEMS", "Purchase order requires at least one item", 400);
    }

    const po = await createPurchaseOrder({
      firmId: firm.id,
      firmStateCode: firm.stateCode,
      vendorId,
      poDate: getDate(body.poDate),
      notes: getStr(body.notes),
      vendorBillNo: getStr(body.vendorBillNo),
      vendorBillDate: getDateOrNull(body.vendorBillDate),
      items,
      invoicePrefix: firm.invoicePrefix,
      financialYear: firm.financialYear,
    });

    // Verification workflow: every raised PO lands on the verification
    // team portal immediately (product names + ordered qty only).
    await createVerificationForPo(po.id, firm.id);
    await notifyRealtime(firm.id, "verify:update", {
      kind: "po:created",
      poNumber: po.poNumber,
      verificationId: (await db.poVerification.findUnique({ where: { poId: po.id } }))?.id,
    });

    return ok(po, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
