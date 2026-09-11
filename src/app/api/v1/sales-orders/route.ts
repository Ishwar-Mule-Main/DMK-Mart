// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-orders — SO booking (phone/PDF orders for delivery).
// GET  ?firmId=&salesMemberId=&status=&search= → order book
// POST → book a new SO (sales portal stamps salesMemberId; no stock
//         or journal impact until the office converts it to an invoice)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";
import { fyLabelForDate, nextDocNumber } from "@/lib/journal";
import { containsArms, rankSearch } from "@/lib/search-rank";

const ORDER_INCLUDE = {
  customer: { select: { id: true, partyName: true, phone: true, city: true } },
  salesMember: { select: { id: true, fullName: true, username: true } },
  items: true,
  _count: { select: { items: true } },
} as const;

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));
    const salesMemberId = getStr(sp.get("salesMemberId"));
    const status = getStr(sp.get("status"));
    const search = getStr(sp.get("search"));

    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { orderNumber: { contains: v } },
        { notes: { contains: v } },
        { customer: { partyName: { contains: v } } },
        { customer: { phone: { contains: v } } },
      ]);

    const orders = await db.salesOrder.findMany({
      where: {
        firmId: firm.id,
        ...(salesMemberId ? { salesMemberId } : {}),
        ...(status ? { status } : {}),
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      include: ORDER_INCLUDE,
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });

    const ranked = rankSearch(orders, search, (o) => [
      o.orderNumber,
      o.customer?.partyName ?? "",
      o.customer?.phone ?? "",
      o.notes,
    ]);

    const totals = {
      count: ranked.length,
      booked: ranked.filter((o) => o.status === "BOOKED").length,
      estimatedAmount: round2(ranked.reduce((s, o) => s + o.estimatedTotal, 0)),
    };

    return ok({ orders: ranked, totals });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const customerId = getStr(body.customerId);
    if (!customerId) {
      throw new BusinessError("ERR_VALIDATION", "A customer is required for a sales order", 400);
    }
    const customer = await db.customer.findFirst({
      where: { id: customerId, firmId: firm.id },
      select: { id: true },
    });
    if (!customer) throw new BusinessError("ERR_VALIDATION", "Customer not found in this firm", 422);

    // Attribution — the /sales portal stamps its member id; validated.
    const salesMemberId = getStr(body.salesMemberId);
    if (salesMemberId) {
      const member = await db.salesMember.findFirst({
        where: { id: salesMemberId, firmId: firm.id },
        select: { id: true },
      });
      if (!member) throw new BusinessError("ERR_VALIDATION", "Sales member not found in this firm", 422);
    }

    const rawItems = asRecordArray(body.items).filter((i) => getStr(i.productId) && getNum(i.quantity) > 0);
    if (rawItems.length === 0) {
      throw new BusinessError("ERR_VALIDATION", "Add at least one item with a quantity", 400);
    }

    const productIds = [...new Set(rawItems.map((i) => getStr(i.productId)))];
    const products = await db.product.findMany({
      where: { id: { in: productIds }, firmId: firm.id },
    });
    if (products.length !== productIds.length) {
      throw new BusinessError("ERR_VALIDATION", "One or more products do not exist in this firm", 422);
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    const items = rawItems.map((i) => {
      const product = productMap.get(getStr(i.productId))!;
      const quantity = getNum(i.quantity);
      const unitPrice = i.unitPrice !== undefined ? round2(getNum(i.unitPrice)) : round2(product.tier4Retailer);
      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice,
        totalAmount: round2(quantity * unitPrice),
        notes: getStr(i.notes),
      };
    });
    const estimatedTotal = round2(items.reduce((s, i) => s + i.totalAmount, 0));

    const orderDate = body.orderDate !== undefined ? new Date(getStr(body.orderDate)) : new Date();
    const safeDate = Number.isNaN(orderDate.getTime()) ? new Date() : orderDate;

    const order = await db.salesOrder.create({
      data: {
        firmId: firm.id,
        orderNumber: await nextDocNumber("SO", firm.id, firm.invoicePrefix, fyLabelForDate(safeDate)),
        orderDate: safeDate,
        customerId,
        estimatedTotal,
        notes: getStr(body.notes),
        salesMemberId: salesMemberId || null,
        items: { create: items },
      },
      include: ORDER_INCLUDE,
    });

    return ok(order, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
