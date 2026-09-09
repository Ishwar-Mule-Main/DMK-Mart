// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/complete — settle the day's run
// POST {firmId, notes?} — every stop delivered → CLOSE the trip:
//   • collectedCash/collectedUpi summed from stop actuals
//   • one CustomerReceipt per delivered stop that collected money
//     (SAME posting engine as the manual receipts API — ledger,
//     balance, optional allocation, RECEIPT journal)
//   • idempotent: receipts carry utrRef "TRIP <no> Stop <seq>", so a
//     retried close never double-posts
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  TRIP_CLOSABLE_STATUSES,
  getTripForFirm,
  loadTripDetail,
} from "@/app/api/v1/_lib/logistics";
import { createCustomerReceipt } from "@/app/api/v1/_lib/payments";
import { settledTotalsByInvoice, type AllocationInput } from "@/app/api/v1/_lib/settlement";
import { round2 } from "@/lib/gst";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const trip = await getTripForFirm(id, firm.id);

    if (!TRIP_CLOSABLE_STATUSES.includes(trip.status as (typeof TRIP_CLOSABLE_STATUSES)[number])) {
      throw new BusinessError(
        "ERR_INVALID_STATE",
        `Trip is ${trip.status} — only dispatched / in-progress / completed trips can be closed`,
        409
      );
    }

    const stops = await db.tripStop.findMany({
      where: { tripId: trip.id },
      orderBy: { sequence: "asc" },
      include: {
        invoice: { select: { customerId: true, paymentMode: true, grandTotal: true } },
      },
    });
    if (stops.length === 0 || stops.some((s) => s.status !== "DELIVERED")) {
      throw new BusinessError(
        "ERR_INVALID_STATE",
        "All stops must be delivered first",
        409
      );
    }

    // Actuals from the driver's stop-level entries.
    const collectedCash = round2(
      stops.filter((s) => s.collectedMode === "CASH").reduce((sum, s) => sum + s.collectedAmount, 0)
    );
    const collectedUpi = round2(
      stops.filter((s) => s.collectedMode === "UPI").reduce((sum, s) => sum + s.collectedAmount, 0)
    );

    // Receipt candidates: delivered, money collected, known customer.
    const candidates = stops.filter(
      (s) => s.collectedAmount > 0 && s.invoice.customerId
    );

    // Idempotency — utrRef is unique per trip stop, so a retried close
    // (crash between receipt posting and trip update) skips what posted.
    const utrRefs = candidates.map((s) => `TRIP ${trip.tripNumber} Stop ${s.sequence}`);
    const existing = utrRefs.length
      ? await db.customerReceipt.findMany({
          where: { firmId: firm.id, utrRef: { in: utrRefs } },
          select: { utrRef: true },
        })
      : [];
    const alreadyPosted = new Set(existing.map((r) => r.utrRef));

    // Outstanding AR per CREDIT invoice — collections against credit
    // bills settle the invoice; CASH/UPI bills stay on-account.
    const creditInvoiceIds = candidates
      .filter((s) => s.invoice.paymentMode === "CREDIT")
      .map((s) => s.invoiceId);
    const settledMap = await settledTotalsByInvoice(firm.id, creditInvoiceIds);

    let receiptsCreated = 0;
    for (const stop of candidates) {
      const utrRef = `TRIP ${trip.tripNumber} Stop ${stop.sequence}`;
      if (alreadyPosted.has(utrRef)) continue;

      const allocations: AllocationInput[] = [];
      if (stop.invoice.paymentMode === "CREDIT") {
        const s = settledMap.get(stop.invoiceId) ?? { settled: 0, credited: 0 };
        const outstanding = round2(
          Math.max(0, round2(stop.invoice.grandTotal) - s.settled - s.credited)
        );
        const alloc = round2(Math.min(stop.collectedAmount, outstanding));
        if (alloc > 0) allocations.push({ invoiceId: stop.invoiceId, amount: alloc });
      }

      await createCustomerReceipt(firm, {
        customerId: stop.invoice.customerId!,
        receiptDate: new Date(),
        amount: stop.collectedAmount,
        mode: stop.collectedMode,
        utrRef,
        notes: `Auto: delivery collection — ${stop.shopName}`,
        allocations,
      });
      receiptsCreated += 1;
    }

    const updatedTrip = await db.trip.update({
      where: { id: trip.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        collectedCash,
        collectedUpi,
        closeNotes: getStr(body.notes),
      },
    });

    const detail = await loadTripDetail(updatedTrip.id, true);
    return ok({ trip: detail, receiptsCreated });
  } catch (e) {
    return handleApiError(e);
  }
}
