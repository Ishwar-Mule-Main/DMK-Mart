// ═══════════════════════════════════════════════════════════════
// /api/v1/recurring — standing-order billing templates
// GET    ?firmId=            list (+ est value / due flags)
// POST                       create template
// PATCH                      update (lines replace, pause/resume)
// DELETE ?firmId=&id=        delete template (items cascade)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  endOfDay,
  getDate,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";
import { calculateGST, round2 } from "@/lib/gst";
import { calculateBulkPricing, TIERS } from "@/lib/pricing";
import { moveToTrash } from "@/app/api/v1/_lib/trash";

const FREQUENCIES = ["WEEKLY", "MONTHLY", "BIMONTHLY", "QUARTERLY"];
const PAYMENT_MODES = ["CREDIT", "CASH", "UPI", "CARD", "NEFT"];

const tierKeys = TIERS.map((t) => t.key);

// ─── shared: resolve template line inputs (sku/productName snapshotted) ──
interface ResolvedLine {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  manualDiscountPct: number | null;
}

async function resolveLines(firmId: string, raw: Record<string, unknown>[]): Promise<ResolvedLine[]> {
  const parsed = raw.map((l) => {
    const productId = getStr(l.productId);
    const quantity = getNum(l.quantity);
    let manual: number | null = null;
    if (l.manualDiscountPct !== undefined && l.manualDiscountPct !== null && getStr(l.manualDiscountPct) !== "") {
      manual = getNum(l.manualDiscountPct);
      if (manual < 0 || manual > 100) {
        throw new BusinessError("ERR_VALIDATION", "Manual discount must be between 0 and 100", 422);
      }
    }
    return { productId, quantity, manualDiscountPct: manual };
  });
  if (parsed.length === 0) {
    throw new BusinessError("ERR_EMPTY_ITEMS", "Template requires at least one line", 400);
  }
  for (const l of parsed) {
    if (!l.productId) throw new BusinessError("ERR_VALIDATION", "Every line needs a product", 400);
    if (!(l.quantity > 0)) throw new BusinessError("ERR_VALIDATION", "Line quantity must be positive", 400);
  }

  const productIds = [...new Set(parsed.map((l) => l.productId))];
  const products = await db.product.findMany({
    where: { firmId, id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const map = new Map(products.map((p) => [p.id, p]));
  for (const l of parsed) {
    if (!map.has(l.productId)) {
      throw new BusinessError("ERR_PRODUCT_NOT_FOUND", `Product ${l.productId} not found for this firm`, 404);
    }
  }
  return parsed.map((l) => ({
    productId: l.productId,
    sku: map.get(l.productId)!.sku,
    productName: map.get(l.productId)!.name,
    quantity: l.quantity,
    manualDiscountPct: l.manualDiscountPct,
  }));
}

async function assertCustomer(firmId: string, customerId: string, paymentMode: string) {
  const customer = await db.customer.findFirst({ where: { id: customerId, firmId } });
  if (!customer) {
    throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found for this firm", 404);
  }
  // R14: B2C counter accounts are cash-and-carry — no standing credit billing
  if (customer.customerType === "B2C_COUNTER" && paymentMode === "CREDIT") {
    throw new BusinessError(
      "ERR_INVALID_PAYMENT_MODE",
      "Counter customers are cash-and-carry — recurring billing accepts CASH, UPI or CARD only",
      422
    );
  }
  return customer;
}

function validateFrequency(frequency: string) {
  if (!FREQUENCIES.includes(frequency)) {
    throw new BusinessError("ERR_VALIDATION", `frequency must be one of ${FREQUENCIES.join(" | ")}`, 422);
  }
}

function validatePaymentMode(paymentMode: string) {
  if (!PAYMENT_MODES.includes(paymentMode)) {
    throw new BusinessError("ERR_VALIDATION", `paymentMode must be one of ${PAYMENT_MODES.join(" | ")}`, 422);
  }
}

// ─── GET: list templates with estimate + due flags ───────────────
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const templates = await db.recurringTemplate.findMany({
      where: { firmId },
      include: {
        customer: { select: { id: true, partyName: true, city: true, stateCode: true, assignedTier: true, customerType: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                gstRate: true,
                tier1Distributor: true,
                tier2Wholesale: true,
                tier3SemiWholesale: true,
                tier4Retailer: true,
                tier5Mrp: true,
              },
            },
          },
        },
      },
    });

    const todayStart = startOfDay(new Date()).getTime();
    const todayEnd = endOfDay(new Date()).getTime();

    // ── Subscription ledger aggregates (one light query for all templates)
    const stamped = await db.invoice.findMany({
      where: { firmId, templateId: { not: null } },
      select: { templateId: true, invoiceNumber: true, grandTotal: true, invoiceDate: true },
      orderBy: { invoiceDate: "desc" },
    });
    const runsByTemplate = new Map<string, { count: number; billed: number; lastInvoiceNo: string; month: number }>();
    const nowMonth = new Date();
    for (const inv of stamped) {
      if (!inv.templateId) continue;
      const cur = runsByTemplate.get(inv.templateId) ?? { count: 0, billed: 0, lastInvoiceNo: "", month: 0 };
      cur.count += 1;
      cur.billed = round2(cur.billed + inv.grandTotal);
      const d = new Date(inv.invoiceDate);
      if (d.getFullYear() === nowMonth.getFullYear() && d.getMonth() === nowMonth.getMonth()) cur.month += 1;
      if (!cur.lastInvoiceNo) cur.lastInvoiceNo = inv.invoiceNumber;
      runsByTemplate.set(inv.templateId, cur);
    }

    const rows = templates.map((t) => {
      const tierKey = tierKeys.includes(t.customer.assignedTier as (typeof tierKeys)[number])
        ? t.customer.assignedTier
        : "tier4Retailer";

      let estTaxable = 0;
      let estTax = 0;
      let totalUnits = 0;
      for (const item of t.items) {
        const tierPrice = item.product[tierKey as keyof typeof item.product] as number;
        const base = tierPrice > 0 ? tierPrice : item.product.tier4Retailer;
        const bulk = calculateBulkPricing(base, item.quantity, item.manualDiscountPct ?? 0);
        const gst = calculateGST(bulk.taxable, item.product.gstRate, firm.stateCode, t.customer.stateCode);
        estTaxable = round2(estTaxable + bulk.taxable);
        estTax = round2(estTax + gst.cgst + gst.sgst + gst.igst);
        totalUnits += item.quantity;
      }
      const estTotal = round2(estTaxable + estTax);

      const nextRunTime = t.nextRunDate.getTime();
      const dueToday = nextRunTime <= todayEnd;
      const overdueBy = nextRunTime < todayStart ? Math.floor((todayStart - nextRunTime) / 86400000) : 0;
      const units = Number.isInteger(totalUnits) ? String(totalUnits) : totalUnits.toFixed(1);

      const runs = runsByTemplate.get(t.id) ?? { count: 0, billed: 0, lastInvoiceNo: "", month: 0 };
      const onHold = !!t.skipUntil && t.skipUntil.getTime() >= todayStart;

      return {
        ...t,
        itemSummary: `${t.items.length} line${t.items.length === 1 ? "" : "s"} · ${units} units`,
        estValue: { estTaxable, estTax, estTotal },
        dueToday: dueToday && !onHold,
        overdueBy: onHold ? 0 : overdueBy,
        onHold,
        holdUntilLabel: t.skipUntil
          ? t.skipUntil.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
          : null,
        runsCount: runs.count,
        runsBilled: runs.billed,
        runsThisMonth: runs.month,
        lastRunInvoiceNo: runs.lastInvoiceNo,
        nextRunLabel: t.nextRunDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      };
    });

    // Due first (nextRunDate asc), then name
    rows.sort((a, b) => {
      const da = a.dueToday ? 0 : 1;
      const dbb = b.dueToday ? 0 : 1;
      if (da !== dbb) return da - dbb;
      const ta = a.nextRunDate.getTime();
      const tb = b.nextRunDate.getTime();
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name);
    });

    return ok(rows);
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── POST: create template ───────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const name = getStr(body.name);
    if (!name) throw new BusinessError("ERR_VALIDATION", "Template name is required", 400);

    const customerId = getStr(body.customerId);
    if (!customerId) throw new BusinessError("ERR_VALIDATION", "customerId is required", 400);

    const frequency = getStr(body.frequency, "MONTHLY") || "MONTHLY";
    validateFrequency(frequency);

    const paymentMode = getStr(body.paymentMode, "CREDIT") || "CREDIT";
    validatePaymentMode(paymentMode);

    const customer = await assertCustomer(firm.id, customerId, paymentMode);

    const startDate = getDate(body.startDate);
    const endDate = getDateOrNull(body.endDate);
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BusinessError("ERR_VALIDATION", "End date cannot be before the start date", 422);
    }
    // Optional initial hold (skip cycles until date)
    const skipUntil = getDateOrNull(body.skipUntil);
    if (skipUntil && skipUntil.getTime() < startDate.getTime()) {
      throw new BusinessError("ERR_VALIDATION", "Skip-until date cannot be before the start date", 422);
    }

    const lines = await resolveLines(firm.id, asRecordArray(body.lines));

    const created = await db.recurringTemplate.create({
      data: {
        firmId: firm.id,
        name,
        customerId,
        frequency,
        paymentMode,
        startDate,
        endDate,
        nextRunDate: startDate,
        skipUntil,
        notes: getStr(body.notes),
        autoPost: body.autoPost === undefined ? true : !!body.autoPost,
        isActive: true,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            sku: l.sku,
            productName: l.productName,
            quantity: l.quantity,
            manualDiscountPct: l.manualDiscountPct,
          })),
        },
      },
      include: {
        customer: { select: { id: true, partyName: true, city: true, stateCode: true, assignedTier: true, customerType: true } },
        items: true,
      },
    });

    return ok({ ...created, customerName: customer.partyName }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── PATCH: update template (lines replace · pause/resume) ───────
export async function PATCH(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const id = getStr(body.id);
    if (!id) throw new BusinessError("ERR_VALIDATION", "id is required", 400);

    const existing = await db.recurringTemplate.findFirst({ where: { id, firmId: firm.id } });
    if (!existing) throw new BusinessError("ERR_TEMPLATE_NOT_FOUND", "Recurring template not found", 404);

    const data: {
      name?: string;
      customerId?: string;
      frequency?: string;
      paymentMode?: string;
      startDate?: Date;
      endDate?: Date | null;
      skipUntil?: Date | null;
      notes?: string;
      isActive?: boolean;
      autoPost?: boolean;
      nextRunDate?: Date;
    } = {};

    let startDateChanged = false;
    let pendingCustomerId = existing.customerId;
    let pendingPaymentMode = existing.paymentMode;

    if (body.name !== undefined) {
      const name = getStr(body.name);
      if (!name) throw new BusinessError("ERR_VALIDATION", "Template name is required", 400);
      data.name = name;
    }
    if (body.customerId !== undefined) {
      const customerId = getStr(body.customerId);
      if (!customerId) throw new BusinessError("ERR_VALIDATION", "customerId is required", 400);
      data.customerId = customerId;
      pendingCustomerId = customerId;
    }
    if (body.frequency !== undefined) {
      const frequency = getStr(body.frequency);
      validateFrequency(frequency);
      data.frequency = frequency;
    }
    if (body.paymentMode !== undefined) {
      const paymentMode = getStr(body.paymentMode);
      validatePaymentMode(paymentMode);
      data.paymentMode = paymentMode;
      pendingPaymentMode = paymentMode;
    }
    // R14 guard whenever the effective customer/mode pair changes
    await assertCustomer(firm.id, pendingCustomerId, pendingPaymentMode);

    if (body.startDate !== undefined) {
      const startDate = getDate(body.startDate);
      if (startDate.getTime() !== existing.startDate.getTime()) {
        startDateChanged = true;
      }
      data.startDate = startDate;
    }
    if (body.endDate !== undefined) {
      const endDate = getDateOrNull(body.endDate);
      const effStart = data.startDate ?? existing.startDate;
      if (endDate && endDate.getTime() < effStart.getTime()) {
        throw new BusinessError("ERR_VALIDATION", "End date cannot be before the start date", 422);
      }
      data.endDate = endDate;
    }
    if (body.notes !== undefined) data.notes = getStr(body.notes);
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (body.autoPost !== undefined) data.autoPost = !!body.autoPost;

    // Hold window — a date pushes generation past it (cycles inside are
    // skipped); null clears the hold.
    if (body.skipUntil !== undefined) {
      const skipUntil = getDateOrNull(body.skipUntil);
      const effStart = data.startDate ?? existing.startDate;
      if (skipUntil && skipUntil.getTime() < effStart.getTime()) {
        throw new BusinessError("ERR_VALIDATION", "Skip-until date cannot be before the template start date", 422);
      }
      data.skipUntil = skipUntil;
    }

    // Editing resets nextRunDate only if startDate changed
    if (startDateChanged) {
      data.nextRunDate = data.startDate!;
    }

    // Line replacement
    if (body.lines !== undefined) {
      const lines = await resolveLines(firm.id, asRecordArray(body.lines));
      await db.recurringTemplateItem.deleteMany({ where: { templateId: id } });
      await db.recurringTemplateItem.createMany({
        data: lines.map((l) => ({
          templateId: id,
          productId: l.productId,
          sku: l.sku,
          productName: l.productName,
          quantity: l.quantity,
          manualDiscountPct: l.manualDiscountPct,
        })),
      });
    }

    const updated = await db.recurringTemplate.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, partyName: true, city: true, stateCode: true, assignedTier: true, customerType: true } },
        items: true,
      },
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── DELETE: snapshot to Deleted Data bin, then remove (items cascade) ──
export async function DELETE(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const id = getStr(sp.get("id"));
    await resolveFirm(firmId);
    if (!id) throw new BusinessError("ERR_VALIDATION", "id is required", 400);

    const existing = await db.recurringTemplate.findFirst({
      where: { id, firmId },
      include: { items: true },
    });
    if (!existing) throw new BusinessError("ERR_TEMPLATE_NOT_FOUND", "Recurring template not found", 404);

    // Templates are hard-deleted (no transaction FKs), so the full
    // snapshot — template + line items — is what makes restore possible.
    await moveToTrash({
      firmId,
      entityType: "RECURRING_TEMPLATE",
      entityId: existing.id,
      label: existing.name,
      meta: `${existing.frequency} · ${existing.nextRunDate.toISOString().slice(0, 10)}`,
      snapshot: { template: existing, items: existing.items },
    });
    await db.recurringTemplate.delete({ where: { id } });
    return ok({ deleted: true, id });
  } catch (e) {
    return handleApiError(e);
  }
}
