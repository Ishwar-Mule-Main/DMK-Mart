// ═══════════════════════════════════════════════════════════════
// /api/v1/estimates — GST-free quotation slips (A4 "Estimates")
// GET  ?firmId=&search= → register rows (no ledger / stock impact)
// POST → create an estimate + items (numbered EST/FY/NNNN, FY of date)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db, dbTx } from "@/lib/db";
import { BusinessError, handleApiError, ok, asRecord, asRecordArray, getStr, getNum } from "@/app/api/v1/_lib/api";
import { nextDocNumber, fyLabelForDate } from "@/lib/journal";
import { round2 } from "@/lib/gst";

// ─── GET — register list ─────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const firmId = request.nextUrl.searchParams.get("firmId") ?? "";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    if (!firmId) throw new BusinessError("EST_FIRM_REQUIRED", "firmId is required", 400);

    const where: Record<string, unknown> = { firmId };
    if (search) {
      where.OR = [
        { estimateNumber: { contains: search, mode: "insensitive" } },
        { partyName: { contains: search, mode: "insensitive" } },
        { partyCity: { contains: search, mode: "insensitive" } },
      ];
    }

    const rows = await db.estimate.findMany({
      where,
      orderBy: { estimateDate: "desc" },
      take: 300,
      select: {
        id: true,
        estimateNumber: true,
        estimateDate: true,
        partyName: true,
        partyPhone: true,
        partyCity: true,
        totalQty: true,
        totalAmount: true,
        notes: true,
        status: true,
        _count: { select: { items: true } },
      },
    });

    const estimates = rows.map((e) => ({
      id: e.id,
      estimateNumber: e.estimateNumber,
      estimateDate: e.estimateDate,
      partyName: e.partyName,
      partyPhone: e.partyPhone,
      partyCity: e.partyCity,
      totalQty: Number(e.totalQty),
      totalAmount: Number(e.totalAmount),
      notes: e.notes,
      status: e.status,
      itemCount: e._count.items,
    }));

    return ok({ estimates });
  } catch (err) {
    return handleApiError(err);
  }
}

// ─── POST — create estimate (+ items) ────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json());

    const firmId = getStr(body.firmId);
    if (!firmId) throw new BusinessError("EST_FIRM_REQUIRED", "firmId is required", 400);

    const partyName = getStr(body.partyName);
    if (!partyName) throw new BusinessError("EST_PARTY_REQUIRED", "Buyer name is required", 422);

    const rawItems = asRecordArray(body.items);
    const items = rawItems
      .map((it, i) => {
        const productName = getStr(it.productName);
        const unit = getStr(it.unit, "NOS") || "NOS";
        const quantity = getNum(it.quantity, 0);
        const rate = getNum(it.rate, 0);
        return {
          slNo: i + 1,
          productName,
          unit: unit.toUpperCase().slice(0, 8),
          quantity,
          rate: round2(rate),
          amount: round2(quantity * rate),
        };
      })
      .filter((it) => it.productName !== "" && it.quantity > 0);

    if (items.length === 0) {
      throw new BusinessError("EST_ITEMS_REQUIRED", "Add at least one item with a name and a quantity", 422);
    }

    const firm = await db.firm.findUnique({
      where: { id: firmId },
      select: { id: true, invoicePrefix: true },
    });
    if (!firm) throw new BusinessError("EST_FIRM_NOT_FOUND", "Firm not found", 404);

    const estimateDate = body.estimateDate ? new Date(getStr(body.estimateDate)) : new Date();
    if (Number.isNaN(estimateDate.getTime())) throw new BusinessError("EST_BAD_DATE", "Invalid estimate date", 422);

    const totalQty = round2(items.reduce((s, it) => s + it.quantity, 0));
    const totalAmount = round2(items.reduce((s, it) => s + it.amount, 0));

    const created = await dbTx(async (tx) => {
      const estimateNumber = await nextDocNumber("ESTIMATE", firm.id, firm.invoicePrefix, fyLabelForDate(estimateDate));
      return tx.estimate.create({
        data: {
          firmId: firm.id,
          estimateNumber,
          estimateDate,
          partyName,
          partyPhone: getStr(body.partyPhone),
          partyCity: getStr(body.partyCity),
          totalQty,
          totalAmount,
          notes: getStr(body.notes),
          status: "OPEN",
          items: { create: items },
        },
        include: { items: { orderBy: { slNo: "asc" } } },
      });
    });

    return ok({
      estimate: {
        ...created,
        totalQty: Number(created.totalQty),
        totalAmount: Number(created.totalAmount),
        items: created.items.map((it) => ({ ...it, rate: Number(it.rate), amount: Number(it.amount) })),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
