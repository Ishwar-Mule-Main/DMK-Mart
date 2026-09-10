// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/unassigned-orders — the trip planner's pool:
//   • POSTED, non-counter invoices with no TripStop yet, AND
//   • CONFIRMED sales orders (deep-scanned / phone bookings) still
//     waiting for a truck — they convert to tax invoices at trip time.
// Optionally narrowed to one route (customer city ∈ route towns) and
// searched word-wise over [order no, shop, town, phone].
// otherTowns=1 + routeId INVERTS the narrowing: only orders whose
// customer city is NOT on the route (empty-city customers included) —
// the owner's "pull from other towns" warning-flow pool.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  cityMatchesRoute,
  computeLineAgg,
  computeOrderAgg,
  splitRouteTowns,
} from "@/app/api/v1/_lib/logistics";
import { containsArms, rankSearch } from "@/lib/search-rank";
import { round2 } from "@/lib/gst";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);
    const routeId = getStr(sp.get("routeId"));
    const search = getStr(sp.get("search"));
    // otherTowns=1 (or true) + routeId → invert the route narrowing.
    const otherTowns = ["1", "true"].includes((sp.get("otherTowns") ?? "").trim().toLowerCase());

    // Optional route scope — also returns the route so the UI can label
    // the planner ("Nagar Route · Wagholi, Shikrapur, …").
    let route: { id: string; name: string; towns: string } | undefined;
    let townSet: Set<string> | undefined;
    if (routeId) {
      const found = await db.deliveryRoute.findFirst({ where: { id: routeId, firmId } });
      if (!found) throw new BusinessError("ERR_ROUTE_NOT_FOUND", "Route not found for this firm", 404);
      route = { id: found.id, name: found.name, towns: found.towns };
      townSet = splitRouteTowns(found.towns);
    }

    // Word-wise SQL prefilter: AND across words, OR across the four
    // searchable columns; case variants keep it a superset on both
    // Postgres and SQLite — the JS ranker makes the final call.
    const words = search
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .slice(0, 6);
    const fieldContains = (w: string) =>
      containsArms(w, (v) => [
        { invoiceNumber: { contains: v } },
        { customer: { partyName: { contains: v } } },
        { customer: { city: { contains: v } } },
        { customer: { phone: { contains: v } } },
      ]);

    const invoices = await db.invoice.findMany({
      where: {
        firmId,
        status: "POSTED",
        isCounterSale: false,
        // Prisma optional one-to-one: invoice with no TripStop row yet.
        tripStop: { is: null },
        ...(words.length > 0 ? { AND: words.map((w) => ({ OR: fieldContains(w) })) } : {}),
      },
      include: {
        customer: true,
        lineItems: {
          include: { product: { select: { piecesPerBox: true, weightGrams: true } } },
        },
      },
      orderBy: { invoiceDate: "desc" },
      take: 200,
    });

    // Route narrowing: customer city must be one of the route's towns —
    // or, with otherTowns, the inverse (NOT on the route; empty-city
    // customers have no route so they belong in the inverted pool too).
    const scoped = townSet
      ? otherTowns
        ? invoices.filter((inv) => !cityMatchesRoute(inv.customer?.city, townSet!))
        : invoices.filter((inv) => cityMatchesRoute(inv.customer?.city, townSet!))
      : invoices;

    // Word-wise matching on top of the prefilter — chronological mode
    // preserves the newest-first base order while dropping non-matches.
    const ranked = rankSearch(scoped, search, (inv) => [
      inv.invoiceNumber,
      inv.customer?.partyName ?? "",
      inv.customer?.city ?? "",
      inv.customer?.phone ?? "",
    ], { chronological: true });

    const orders = ranked.map((inv) => {
      const agg = computeOrderAgg(inv);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerId: inv.customerId,
        shopName: inv.customer?.partyName ?? "",
        town: inv.customer?.city ?? "",
        address: inv.customer?.address ?? "",
        phone: inv.customer?.phone ?? "",
        amount: agg.amount,
        paymentMode: inv.paymentMode,
        boxes: agg.boxes,
        loosePieces: agg.loosePieces,
        weightKg: agg.weightKg,
        itemCount: agg.itemCount,
      };
    });

    let shops = 0;
    let boxes = 0;
    let loosePieces = 0;
    let weightKg = 0;
    let amount = 0;
    let expectedCash = 0;
    let expectedUpi = 0;
    const seenCustomers = new Set<string>();
    for (const o of orders) {
      if (o.customerId) seenCustomers.add(o.customerId);
      boxes += o.boxes;
      loosePieces += o.loosePieces;
      weightKg += o.weightKg;
      amount += o.amount;
      if (o.paymentMode === "CASH") expectedCash += o.amount;
      else if (o.paymentMode === "UPI") expectedUpi += o.amount;
    }

    // ── CONFIRMED sales orders share the pool ────────────────
    // They carry no tax invoice yet (raised at trip placement), so the
    // same route narrowing / search runs over the SO book.
    const salesOrderRows = await db.salesOrder.findMany({
      where: { firmId, status: "CONFIRMED", convertedInvoiceId: null },
      include: {
        customer: true,
        items: {
          include: { product: { select: { piecesPerBox: true, weightGrams: true } } },
        },
      },
      orderBy: { orderDate: "desc" },
      take: 200,
    });
    const soOrders = salesOrderRows
      .filter((so) => so.customer !== null)
      .filter((so) => {
        if (!townSet) return true;
        const on = cityMatchesRoute(so.customer?.city, townSet);
        return otherTowns ? !on : on;
      })
      .filter((so) =>
        words.length === 0
          ? true
          : words.every((w) =>
              [so.orderNumber, so.notes, so.customer?.partyName ?? "", so.customer?.city ?? "", so.customer?.phone ?? ""]
                .join(" ")
                .toLowerCase()
                .includes(w.toLowerCase())
            )
      )
      .map((so) => {
        let b = 0;
        let loose = 0;
        let w = 0;
        for (const line of so.items) {
          const l = computeLineAgg(line);
          b += l.boxes;
          loose += l.loosePieces;
          w += l.weightKg;
        }
        return {
          // The SO id rides in invoiceId — the planner's selection key —
          // while salesOrderId + source mark it for trip-time conversion.
          invoiceId: so.id,
          invoiceNumber: so.orderNumber,
          invoiceDate: so.orderDate,
          customerId: so.customerId,
          shopName: so.customer?.partyName ?? "",
          town: so.customer?.city ?? "",
          address: so.customer?.address ?? "",
          phone: so.customer?.phone ?? "",
          amount: round2(so.estimatedTotal),
          paymentMode: "CREDIT", // collected at the stop per trip settlement
          boxes: b,
          loosePieces: loose,
          weightKg: round2(w),
          itemCount: so.items.length,
          source: "SO",
          salesOrderId: so.id,
        };
      });

    for (const o of soOrders) {
      if (o.customerId) seenCustomers.add(o.customerId);
      boxes += o.boxes;
      loosePieces += o.loosePieces;
      weightKg += o.weightKg;
      amount += o.amount;
    }
    const mergedOrders = [...orders, ...soOrders];

    return ok({
      ...(route ? { route } : {}),
      orders: mergedOrders,
      totals: {
        shops: seenCustomers.size,
        boxes,
        loosePieces,
        weightKg: round2(weightKg),
        amount: round2(amount),
        expectedCash: round2(expectedCash),
        expectedUpi: round2(expectedUpi),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
