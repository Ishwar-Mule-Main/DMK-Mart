// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — LOGISTICS CORE (delivery trips + OTP proof)
// Shared by every /api/v1/logistics route:
//   • aggregate math (boxes / loose pieces / weight per order)
//   • route-town matching (comma-separated town lists)
//   • trip detail loader (stops + items + owner-only OTP)
//   • delivery guards + stop-delivery transaction (OTP / signature)
// ═══════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import type { Trip, TripStop } from "@prisma/client";
import { db, dbTx } from "@/lib/db";
import { nextDocNumber, currentFyLabel } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import { BusinessError } from "./api";

// ─── Lifecycle status sets ───────────────────────────────────────

/** Trips a driver can currently work on. */
export const TRIP_ACTIVE_STATUSES = ["DISPATCHED", "IN_PROGRESS"] as const;
/** Trips that can still be closed (cash settled). */
export const TRIP_CLOSABLE_STATUSES = ["DISPATCHED", "IN_PROGRESS", "COMPLETED"] as const;
/** Trips shown in driver history. */
export const TRIP_HISTORY_STATUSES = ["COMPLETED", "CLOSED"] as const;

// ─── Route towns ─────────────────────────────────────────────────

/**
 * Split a route's comma-separated towns string into a trimmed,
 * lowercase set for membership checks ("Wagholi, Shikrapur" →
 * {"wagholi","shikrapur"}).
 */
export function splitRouteTowns(towns: string): Set<string> {
  return new Set(
    (towns ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Is a customer city part of a route's town set? (trimmed, case-insensitive) */
export function cityMatchesRoute(city: string | null | undefined, towns: Set<string>): boolean {
  const c = (city ?? "").trim().toLowerCase();
  return c !== "" && towns.has(c);
}

// ─── Aggregate math (boxes / loose pieces / weight) ──────────────

/** Minimal shape of an invoice line item needed for the split math. */
export interface LineAggSource {
  quantity: number;
  product?: { piecesPerBox?: number | null; weightGrams?: number | null } | null;
}

export interface LineAgg {
  boxes: number;
  loosePieces: number;
  weightKg: number;
}

export interface OrderAgg extends LineAgg {
  amount: number;
  itemCount: number;
}

/**
 * Per-line split: full boxes = floor(qty / piecesPerBox), the remainder
 * ships as loose pieces, weight = qty × weightGrams / 1000. Fractional
 * quantities (never the norm) round the loose remainder to whole pieces.
 */
export function computeLineAgg(line: LineAggSource): LineAgg {
  const ppb = Math.max(1, Math.floor(line.product?.piecesPerBox ?? 1));
  const boxes = Math.floor(line.quantity / ppb);
  const looseRaw = line.quantity - boxes * ppb;
  return {
    boxes,
    loosePieces: Math.round(looseRaw),
    weightKg: (line.quantity * (line.product?.weightGrams ?? 0)) / 1000,
  };
}

/**
 * Per-order aggregates for the trip planner:
 * boxes/loose summed across lines, weight rounded to 2dp,
 * amount = invoice grand total, itemCount = number of line items.
 */
export function computeOrderAgg(invoice: { grandTotal: number; lineItems: LineAggSource[] }): OrderAgg {
  let boxes = 0;
  let loosePieces = 0;
  let weightKg = 0;
  for (const line of invoice.lineItems) {
    const l = computeLineAgg(line);
    boxes += l.boxes;
    loosePieces += l.loosePieces;
    weightKg += l.weightKg;
  }
  return {
    boxes,
    loosePieces,
    weightKg: round2(weightKg),
    amount: round2(invoice.grandTotal),
    itemCount: invoice.lineItems.length,
  };
}

/** Trip-level totals from a set of per-order aggregates (+ payment modes). */
export function computeTripTotals(
  rows: Array<{ agg: OrderAgg; paymentMode: string }>
): {
  totalStops: number;
  totalBoxes: number;
  totalLoosePieces: number;
  totalWeightKg: number;
  totalAmount: number;
  expectedCash: number;
  expectedUpi: number;
} {
  let totalBoxes = 0;
  let totalLoosePieces = 0;
  let totalWeightKg = 0;
  let totalAmount = 0;
  let expectedCash = 0;
  let expectedUpi = 0;
  for (const { agg, paymentMode } of rows) {
    totalBoxes += agg.boxes;
    totalLoosePieces += agg.loosePieces;
    totalWeightKg += agg.weightKg;
    totalAmount += agg.amount;
    if (paymentMode === "CASH") expectedCash += agg.amount;
    else if (paymentMode === "UPI") expectedUpi += agg.amount;
  }
  return {
    totalStops: rows.length,
    totalBoxes,
    totalLoosePieces,
    totalWeightKg: round2(totalWeightKg),
    totalAmount: round2(totalAmount),
    expectedCash: round2(expectedCash),
    expectedUpi: round2(expectedUpi),
  };
}

// ─── Doc numbering ───────────────────────────────────────────────

/** Next trip number for a firm: {PREFIX}/{FY}/TRIP/0001 (current FY). */
export async function nextTripNumber(firmId: string, invoicePrefix: string): Promise<string> {
  return nextDocNumber("TRIP", firmId, invoicePrefix, currentFyLabel());
}

// ─── Loaders ─────────────────────────────────────────────────────

/** Invoice + customer + product-bearing line items for stop math. */
export async function loadInvoicesForStops(ids: string[]) {
  if (ids.length === 0) return [];
  return db.invoice.findMany({
    where: { id: { in: ids } },
    include: {
      customer: true,
      tripStop: { select: { id: true } }, // presence = already on a trip
      lineItems: {
        include: { product: { select: { piecesPerBox: true, weightGrams: true } } },
      },
    },
  });
}

export type StopInvoice = Awaited<ReturnType<typeof loadInvoicesForStops>>[number];

/** TripStop create payload (denormalized customer + load snapshot). */
export function buildStopCreateData(invoice: StopInvoice, sequence: number) {
  const agg = computeOrderAgg(invoice);
  return {
    invoiceId: invoice.id,
    sequence,
    shopName: invoice.customer?.partyName ?? "",
    town: invoice.customer?.city ?? "",
    address: invoice.customer?.address ?? "",
    phone: invoice.customer?.phone ?? "",
    boxes: agg.boxes,
    loosePieces: agg.loosePieces,
    weightKg: agg.weightKg,
    amount: agg.amount,
    expectedMode: invoice.paymentMode,
  };
}

/**
 * Shape check on a parsed stops list: at least one stop, no duplicate
 * orders. (`invoiceId` must already be non-empty at this point.)
 */
export function assertStopListWellFormed(stopInputs: Array<{ invoiceId: string }>) {
  if (stopInputs.length === 0) {
    throw new BusinessError("ERR_VALIDATION", "A trip needs at least one stop", 400);
  }
  const seen = new Set<string>();
  for (const s of stopInputs) {
    if (seen.has(s.invoiceId)) {
      throw new BusinessError("ERR_VALIDATION", "The same order appears twice in stops", 400);
    }
    seen.add(s.invoiceId);
  }
}

/**
 * Business validation for stops being placed on a route: every invoice
 * must be firm-scoped, POSTED, non-counter, not already on ANY trip,
 * and its customer town must belong to the route. Town offenders are
 * reported together (ERR_ORDER_NOT_ON_ROUTE); the rest fail fast.
 */
export function validateStopsForRoute(
  firmId: string,
  stopInputs: Array<{ invoiceId: string }>,
  invoicesById: Map<string, StopInvoice>,
  route: { name: string; towns: string }
): void {
  const townSet = splitRouteTowns(route.towns);
  const offending: string[] = [];
  for (const s of stopInputs) {
    const inv = invoicesById.get(s.invoiceId);
    if (!inv || inv.firmId !== firmId) {
      throw new BusinessError("ERR_VALIDATION", "One of the orders does not exist in this firm", 404);
    }
    if (inv.status !== "POSTED") {
      throw new BusinessError("ERR_VALIDATION", `Order ${inv.invoiceNumber} is not posted`, 409);
    }
    if (inv.isCounterSale) {
      throw new BusinessError("ERR_VALIDATION", `Order ${inv.invoiceNumber} is a counter sale`, 409);
    }
    if (inv.tripStop) {
      throw new BusinessError(
        "ERR_ORDER_ALREADY_ON_TRIP",
        `Order ${inv.invoiceNumber} is already on another trip`,
        409
      );
    }
    if (!inv.customer || !cityMatchesRoute(inv.customer.city, townSet)) {
      offending.push(inv.invoiceNumber);
    }
  }
  if (offending.length > 0) {
    throw new BusinessError(
      "ERR_ORDER_NOT_ON_ROUTE",
      `Order${offending.length > 1 ? "s" : ""} ${offending.join(", ")} — customer town is not on route ${route.name}`,
      422
    );
  }
}

/** Invoice select used inside stop detail (items math + OTP for owner). */
const STOP_INVOICE_SELECT = {
  invoiceNumber: true,
  lineItems: {
    select: {
      sku: true,
      productName: true,
      quantity: true,
      product: { select: { piecesPerBox: true, weightGrams: true } },
    },
  },
} satisfies Prisma.InvoiceSelect;

const STOP_INVOICE_WITH_OTP = { ...STOP_INVOICE_SELECT, deliveryOtp: true } as const;

const tripStopsInclude = (invoiceSelect: typeof STOP_INVOICE_SELECT | typeof STOP_INVOICE_WITH_OTP) => ({
  orderBy: [{ sequence: "asc" as const }],
  include: { invoice: { select: invoiceSelect } },
});

export interface TripStopItemView {
  sku: string;
  productName: string;
  quantity: number;
  boxes: number;
  loosePieces: number;
  weightKg: number;
}

/**
 * Load a trip with its stops (sequence asc); every stop carries
 * `invoiceNumber` + per-line `items[]` for the driver's load sheet.
 * `includeOtp` — owner routes ONLY: attaches the bill OTP per stop.
 * Driver-facing loaders MUST pass false so OTPs never leave the server.
 */
export async function loadTripDetail(tripId: string, includeOtp: boolean) {
  const trip = includeOtp
    ? await db.trip.findUnique({
        where: { id: tripId },
        include: { stops: tripStopsInclude(STOP_INVOICE_WITH_OTP) },
      })
    : await db.trip.findUnique({
        where: { id: tripId },
        include: { stops: tripStopsInclude(STOP_INVOICE_SELECT) },
      });
  if (!trip) return null;
  return shapeTripDetail(trip, includeOtp);
}

/** Structural input for shapeTripDetail — fits both OTP / no-OTP payloads. */
interface DetailStopInvoice {
  invoiceNumber: string;
  deliveryOtp?: string | null;
  lineItems: Array<LineAggSource & { sku: string; productName: string }>;
}

type DetailTripInput = Omit<Trip, "stops"> & {
  stops: Array<Omit<TripStop, "invoice"> & { invoice: DetailStopInvoice }>;
};

export interface TripStopView extends Omit<TripStop, "invoice"> {
  invoiceNumber: string;
  items: TripStopItemView[];
  deliveryOtp?: string;
}

export interface TripDetailView extends Omit<Trip, "stops"> {
  stops: TripStopView[];
}

/** Shape a trip+stops payload into the shared stop view (items, otp?). */
export function shapeTripDetail(trip: DetailTripInput, includeOtp: boolean): TripDetailView {
  return {
    ...trip,
    stops: trip.stops.map((stop) => {
      const { invoice, ...rest } = stop;
      const items: TripStopItemView[] = invoice.lineItems.map((line) => {
        const agg = computeLineAgg(line);
        return {
          sku: line.sku,
          productName: line.productName,
          quantity: line.quantity,
          boxes: agg.boxes,
          loosePieces: agg.loosePieces,
          weightKg: agg.weightKg,
        };
      });
      return {
        ...rest,
        invoiceNumber: invoice.invoiceNumber,
        items,
        ...(includeOtp ? { deliveryOtp: invoice.deliveryOtp ?? "" } : {}),
      };
    }),
  };
}

/** Firm-scoped trip or 404. */
export async function getTripForFirm(tripId: string, firmId: string) {
  const trip = await db.trip.findFirst({ where: { id: tripId, firmId } });
  if (!trip) throw new BusinessError("ERR_TRIP_NOT_FOUND", "Trip not found for this firm", 404);
  return trip;
}

/** Active VerificationStaff by id (driver endpoints) or ERR_NOT_FOUND. */
export async function getActiveStaff(staffId: string) {
  if (!staffId) {
    throw new BusinessError("ERR_VALIDATION", "staffId is required", 400);
  }
  const staff = await db.verificationStaff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.isActive) {
    throw new BusinessError("ERR_NOT_FOUND", "Team member not found or inactive", 404);
  }
  return staff;
}

// ─── Delivery guards + stop delivery (OTP / signature shared) ────

export interface DeliveryGuardInput {
  tripId: string;
  stopId: string;
  /** Owner portal passes firmId; staff portal passes staffId. */
  firmId?: string;
  staffId?: string;
}

/**
 * Resolve the actor (firm or staff), load trip + stop and enforce every
 * guard shared by verify-otp and signature:
 *   • trip belongs to the caller (firm match, or staff's own dispatched trip)
 *   • trip status ∈ DISPATCHED | IN_PROGRESS
 *   • stop belongs to the trip and is still PENDING
 */
export async function loadStopForDelivery(input: DeliveryGuardInput) {
  const firmId = (input.firmId ?? "").trim();
  const staffId = (input.staffId ?? "").trim();
  if (!firmId && !staffId) {
    throw new BusinessError("ERR_VALIDATION", "firmId or staffId is required", 400);
  }

  let tripFirmId = firmId;
  if (!firmId) {
    const staff = await getActiveStaff(staffId);
    tripFirmId = staff.firmId;
  }

  const trip = await db.trip.findFirst({ where: { id: input.tripId, firmId: tripFirmId } });
  if (!trip) throw new BusinessError("ERR_TRIP_NOT_FOUND", "Trip not found", 404);

  // Staff portal: a driver can only act on their own trip.
  if (staffId && trip.driverId !== staffId) {
    throw new BusinessError("ERR_FORBIDDEN", "This trip is not assigned to you", 403);
  }

  if (!TRIP_ACTIVE_STATUSES.includes(trip.status as (typeof TRIP_ACTIVE_STATUSES)[number])) {
    throw new BusinessError(
      "ERR_INVALID_STATE",
      "Trip is not out for delivery (must be DISPATCHED or IN_PROGRESS)",
      409
    );
  }

  const stop = await db.tripStop.findUnique({ where: { id: input.stopId } });
  if (!stop || stop.tripId !== trip.id) {
    throw new BusinessError("ERR_STOP_NOT_FOUND", "Stop not found on this trip", 404);
  }
  if (stop.status !== "PENDING") {
    throw new BusinessError("ERR_INVALID_STATE", "This stop is already delivered", 409);
  }

  return { trip, stop, tripFirmId };
}

export interface DeliverStopInput {
  trip: { id: string; status: string };
  stopId: string;
  proof: "OTP" | "SIGNATURE";
  collectedMode: string;
  collectedAmount: number;
  deliveredBy: string;
}

/**
 * Mark a stop DELIVERED and advance the trip lifecycle in one tx:
 * all stops delivered → COMPLETED (completedAt=now); first delivery on a
 * DISPATCHED trip → IN_PROGRESS. Returns the updated stop + trip progress.
 */
export async function markStopDelivered(input: DeliverStopInput) {
  const now = new Date();
  return dbTx(async (tx) => {
    const stop = await tx.tripStop.update({
      where: { id: input.stopId },
      data: {
        status: "DELIVERED",
        deliveryProof: input.proof,
        collectedMode: input.collectedMode,
        collectedAmount: round2(input.collectedAmount),
        deliveredAt: now,
        deliveredBy: input.deliveredBy,
      },
    });

    const [pending, delivered] = await Promise.all([
      tx.tripStop.count({ where: { tripId: input.trip.id, status: "PENDING" } }),
      tx.tripStop.count({ where: { tripId: input.trip.id, status: "DELIVERED" } }),
    ]);

    let tripStatus = input.trip.status;
    const tripData: { status?: string; completedAt?: Date } = {};
    if (pending === 0) {
      tripStatus = "COMPLETED";
      tripData.status = "COMPLETED";
      tripData.completedAt = now;
    } else if (input.trip.status === "DISPATCHED") {
      tripStatus = "IN_PROGRESS";
      tripData.status = "IN_PROGRESS";
    }
    if (Object.keys(tripData).length > 0) {
      await tx.trip.update({ where: { id: input.trip.id }, data: tripData });
    }

    const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.trip.id } });
    return {
      stop,
      trip: { id: trip.id, status: tripStatus, totalStops: trip.totalStops, deliveredStops: delivered },
    };
  });
}
