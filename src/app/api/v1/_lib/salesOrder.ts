// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SALES ORDER CORE (booking, reservation, conversion)
// Shared by the staged-upload confirm API, the SO register actions
// and the trip-planner auto-billing:
//   • bookOrder        — persist an SO (DRAFT keeps BOOKED, CONFIRMED
//                        reserves sellable stock + stamps the 4-digit
//                        Delivery OTP that later rides onto the invoice)
//   • confirmSalesOrder— a BOOKED order becomes CONFIRMED later
//   • cancel release   — CONFIRMED cancellations give the reserved
//                        stock back to the sellable pool
//   • convertToInvoice — the trip planner bills a confirmed order at
//                        dispatch through the standard invoice engine
// Reservation semantics: available = stockQuantity − reservedQty.
// Reserving never promises more than physically exists — shortfalls
// come back as warnings, the order still books (pre-orders allowed).
// ═══════════════════════════════════════════════════════════════

import { Prisma } from "@prisma/client";
import { db, dbTx } from "@/lib/db";
import { BusinessError } from "./api";
import { round2 } from "@/lib/gst";
import { fyLabelForDate, nextDocNumber } from "@/lib/journal";
import { createInvoice, type CreateInvoiceInput } from "./invoice";

type FirmRow = {
  id: string;
  stateCode: string;
  invoicePrefix: string;
  financialYear: string;
};

export interface BookItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number; // default: the product's tier4Retailer
  notes?: string;
}

export interface BookOrderInput {
  firm: FirmRow;
  customerId: string;
  items: BookItemInput[];
  notes?: string;
  salesMemberId?: string | null;
  stagedUploadId?: string | null;
  mode: "DRAFT" | "CONFIRMED";
  orderDate?: Date;
  /** Set when re-booking a staged upload that already used a number. */
  orderNumber?: string;
}

export interface BookOrderResult {
  orderId: string;
  orderNumber: string;
  status: "BOOKED" | "CONFIRMED";
  deliveryOtp: string;
  estimatedTotal: number;
  reservations: Array<{ productId: string; reserved: number; shortfall: number }>;
  warnings: string[];
}

/** 4-digit Delivery Verification OTP (same shape as invoice OTPs). */
function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Reserve sellable stock for a set of lines inside a tx; shortfall is reported, never thrown. */
async function reserveLines(
  tx: Prisma.TransactionClient,
  firmId: string,
  items: Array<{ productId: string; quantity: number }>
): Promise<BookOrderResult["reservations"]> {
  const reservations: BookOrderResult["reservations"] = [];
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, firmId },
    select: { id: true, stockQuantity: true, reservedQty: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Aggregate demand per product (same product on several lines).
  const demand = new Map<string, number>();
  for (const it of items) demand.set(it.productId, (demand.get(it.productId) ?? 0) + Math.max(0, it.quantity));

  for (const [productId, qty] of demand) {
    const p = byId.get(productId);
    const available = p ? Math.max(0, p.stockQuantity - p.reservedQty) : 0;
    const reserve = Math.min(qty, available);
    if (reserve > 0) {
      await tx.product.update({
        where: { id: productId },
        data: { reservedQty: { increment: reserve } },
      });
    }
    reservations.push({
      productId,
      reserved: round2(reserve),
      shortfall: round2(Math.max(0, qty - reserve)),
    });
  }
  return reservations;
}

/** Give a CONFIRMED order's reservation back to the sellable pool. */
async function releaseReservation(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.salesOrder.findUnique({
    where: { id: orderId },
    include: { items: { select: { productId: true, quantity: true } } },
  });
  if (!order || !order.stockReserved) return;
  for (const item of order.items) {
    await tx.product.update({
      where: { id: item.productId },
      data: { reservedQty: { decrement: item.quantity } },
    });
  }
  // Never let a data hiccup drag reservedQty negative.
  await tx.product.updateMany({
    where: { reservedQty: { lt: 0 } },
    data: { reservedQty: 0 },
  });
  await tx.salesOrder.update({ where: { id: orderId }, data: { stockReserved: false } });
}

/** Persist a sales order; CONFIRMED mode also reserves stock + stamps the OTP. */
export async function bookOrder(input: BookOrderInput): Promise<BookOrderResult & { order: unknown }> {
  const { firm } = input;
  const customerId = input.customerId;
  const customer = await db.customer.findFirst({
    where: { id: customerId, firmId: firm.id },
    select: { id: true },
  });
  if (!customer) throw new BusinessError("ERR_VALIDATION", "Customer not found in this firm", 422);

  const items = input.items.filter((i) => i.productId && i.quantity > 0);
  if (items.length === 0) {
    throw new BusinessError("ERR_VALIDATION", "Add at least one item with a quantity", 400);
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await db.product.findMany({ where: { id: { in: productIds }, firmId: firm.id } });
  if (products.length !== productIds.length) {
    throw new BusinessError("ERR_VALIDATION", "One or more products do not exist in this firm", 422);
  }
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines = items.map((i) => {
    const product = productMap.get(i.productId)!;
    const unitPrice = round2(i.unitPrice !== undefined && i.unitPrice > 0 ? i.unitPrice : product.tier4Retailer);
    return {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unit: product.unit,
      quantity: i.quantity,
      unitPrice,
      totalAmount: round2(i.quantity * unitPrice),
      notes: i.notes ?? "",
    };
  });
  const estimatedTotal = round2(lines.reduce((s, l) => s + l.totalAmount, 0));

  const confirmed = input.mode === "CONFIRMED";
  const orderDate = input.orderDate ?? new Date();
  const safeDate = Number.isNaN(orderDate.getTime()) ? new Date() : orderDate;
  const orderNumber =
    input.orderNumber ?? (await nextDocNumber("SO", firm.id, firm.invoicePrefix, fyLabelForDate(safeDate)));
  const deliveryOtp = confirmed ? generateOtp() : "";

  const warnings: string[] = [];
  let reservations: BookOrderResult["reservations"] = [];

  const orderId = await dbTx(async (tx) => {
    const order = await tx.salesOrder.create({
      data: {
        firmId: firm.id,
        orderNumber,
        orderDate: safeDate,
        customerId,
        status: confirmed ? "CONFIRMED" : "BOOKED",
        estimatedTotal,
        notes: input.notes ?? "",
        deliveryOtp,
        stockReserved: confirmed,
        stagedUploadId: input.stagedUploadId ?? null,
        salesMemberId: input.salesMemberId || null,
        items: { create: lines },
      },
      select: { id: true },
    });
    if (confirmed) {
      reservations = await reserveLines(
        tx,
        firm.id,
        lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))
      );
    }
    return order.id;
  });

  for (const r of reservations) {
    const p = productMap.get(r.productId)!;
    if (r.shortfall > 0) {
      warnings.push(
        `Reserved ${r.reserved} of ${r.reserved + r.shortfall} ${p.unit.toLowerCase()} for "${p.name}" — short ${r.shortfall} (order still books as a pre-order).`
      );
    }
  }

  const order = await db.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true, partyName: true, phone: true, city: true } },
      items: true,
    },
  });

  return {
    order,
    orderId,
    orderNumber,
    status: confirmed ? "CONFIRMED" : "BOOKED",
    deliveryOtp,
    estimatedTotal,
    reservations,
    warnings,
  };
}

/** Move a BOOKED order to CONFIRMED (reserve + OTP + logistics pool). */
export async function confirmSalesOrder(firmId: string, orderId: string): Promise<{
  orderNumber: string;
  deliveryOtp: string;
  reservations: BookOrderResult["reservations"];
  warnings: string[];
}> {
  const order = await db.salesOrder.findFirst({
    where: { id: orderId, firmId },
    include: { items: true },
  });
  if (!order) throw new BusinessError("ERR_NOT_FOUND", "Sales order not found", 404);
  if (order.status === "CONFIRMED") {
    throw new BusinessError("ERR_INVALID_STATUS", "This order is already confirmed", 409);
  }
  if (order.status !== "BOOKED") {
    throw new BusinessError(
      "ERR_INVALID_STATUS",
      order.status === "CONVERTED"
        ? "This order is already converted to a tax invoice"
        : "Cancelled orders cannot be confirmed",
      409
    );
  }
  if (order.items.length === 0) {
    throw new BusinessError("ERR_VALIDATION", "This order has no items to confirm", 400);
  }

  const deliveryOtp = generateOtp();
  const warnings: string[] = [];
  let reservations: BookOrderResult["reservations"] = [];

  await dbTx(async (tx) => {
    reservations = await reserveLines(
      tx,
      firmId,
      order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CONFIRMED", deliveryOtp, stockReserved: true },
    });
  });

  for (const r of reservations) {
    if (r.shortfall > 0) warnings.push(`"${r.productId}" short ${r.shortfall} — booked as pre-order.`);
  }

  return { orderNumber: order.orderNumber, deliveryOtp, reservations, warnings };
}

/** Cancel-side hook: release reservations when a CONFIRMED order dies. */
export async function releaseOrderReservationOnCancel(orderId: string): Promise<void> {
  await dbTx(async (tx) => releaseReservation(tx, orderId));
}

/**
 * Trip-planner auto-billing: convert a BOOKED/CONFIRMED sales order
 * into a real tax invoice through the standard engine (tier pricing,
 * stock decrement, ledger, journals), carry the SO's Delivery OTP,
 * release the reservation and mark the order CONVERTED.
 */
export async function convertSalesOrderToInvoice(
  firm: FirmRow,
  salesOrderId: string,
  options?: { paymentMode?: string; invoiceDate?: Date }
): Promise<{ invoiceId: string; invoiceNumber: string; orderId: string; orderNumber: string }> {
  const order = await db.salesOrder.findFirst({
    where: { id: salesOrderId, firmId: firm.id },
    include: { items: true },
  });
  if (!order) throw new BusinessError("ERR_VALIDATION", "Sales order not found in this firm", 404);
  if (order.status === "CONVERTED" && order.convertedInvoiceId) {
    return {
      invoiceId: order.convertedInvoiceId,
      invoiceNumber: "",
      orderId: order.id,
      orderNumber: order.orderNumber,
    };
  }
  if (order.status === "CANCELLED") {
    throw new BusinessError("ERR_VALIDATION", `Order ${order.orderNumber} is cancelled`, 409);
  }
  if (order.items.length === 0) {
    throw new BusinessError("ERR_VALIDATION", `Order ${order.orderNumber} has no items`, 400);
  }

  const invoiceInput: CreateInvoiceInput = {
    firmId: firm.id,
    customerId: order.customerId,
    paymentMode: options?.paymentMode ?? "CREDIT",
    invoiceDate: options?.invoiceDate ?? new Date(),
    lines: order.items
      .filter((i) => i.quantity > 0)
      .map((i) => ({ productId: i.productId, quantity: i.quantity })),
  };
  const { invoice } = await createInvoice(firm, invoiceInput);

  // Carry the booking-time OTP onto the bill (the invoice engine made
  // its own — overwrite so the printed bill matches what sales quoted).
  const otp = order.deliveryOtp || invoice?.deliveryOtp || "";
  if (otp && otp !== invoice?.deliveryOtp) {
    await db.invoice.update({ where: { id: invoice!.id }, data: { deliveryOtp: otp } });
  }

  await dbTx(async (tx) => {
    await releaseReservation(tx, order.id);
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: "CONVERTED", convertedInvoiceId: invoice!.id, stockReserved: false },
    });
  });

  return {
    invoiceId: invoice!.id,
    invoiceNumber: invoice!.invoiceNumber,
    orderId: order.id,
    orderNumber: order.orderNumber,
  };
}
