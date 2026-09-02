// ═══════════════════════════════════════════════════════════════
// /api/v1/reports — tabular exports for the frontend
// type=sales | purchases | stock | gst (+ dateFrom / dateTo window)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  endOfDay,
  getDateOrNull,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  startOfDay,
} from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const type = getStr(sp.get("type")) || "sales";
    const dateFrom = getDateOrNull(sp.get("dateFrom"));
    const dateTo = getDateOrNull(sp.get("dateTo"));

    const range = (field: "invoiceDate" | "poDate") => ({
      ...(dateFrom ? { [field]: { gte: startOfDay(dateFrom) } } : {}),
      ...(dateTo ? { [field]: { lte: endOfDay(dateTo) } } : {}),
    });

    if (type === "sales") {
      const invoices = await db.invoice.findMany({
        where: { firmId, status: "POSTED", ...range("invoiceDate") },
        include: {
          customer: { select: { partyName: true } },
          lineItems: true,
        },
        orderBy: { invoiceDate: "desc" },
        take: 2000,
      });
      const rows = invoices.flatMap((inv) =>
        inv.lineItems.map((l) => ({
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          customer: (inv.customer?.partyName ?? inv.walkInName) || "Counter Sale",
          paymentMode: inv.paymentMode,
          sku: l.sku,
          productName: l.productName,
          hsnCode: l.hsnCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          bulkDiscountPct: l.bulkDiscountPct,
          taxableAmount: l.taxableAmount,
          gstRate: l.gstRate,
          cgstAmount: l.cgstAmount,
          sgstAmount: l.sgstAmount,
          igstAmount: l.igstAmount,
          totalAmount: l.totalAmount,
        }))
      );
      return ok({ type, rows });
    }

    if (type === "purchases") {
      const orders = await db.purchaseOrder.findMany({
        where: { firmId, status: "CONFIRMED", ...range("poDate") },
        include: {
          vendor: { select: { vendorName: true } },
          items: true,
        },
        orderBy: { poDate: "desc" },
        take: 2000,
      });
      const rows = orders.flatMap((po) =>
        po.items.map((i) => ({
          poNumber: po.poNumber,
          poDate: po.poDate.toISOString().slice(0, 10),
          vendor: po.vendor.vendorName,
          sku: i.sku,
          productName: i.productName,
          hsnCode: i.hsnCode,
          quantity: i.quantity,
          receivedQty: i.receivedQty,
          unitCost: i.unitCost,
          taxableAmount: i.taxableAmount,
          gstRate: i.gstRate,
          cgstAmount: i.cgstAmount,
          sgstAmount: i.sgstAmount,
          igstAmount: i.igstAmount,
          totalAmount: i.totalAmount,
        }))
      );
      return ok({ type, rows });
    }

    if (type === "stock") {
      const products = await db.product.findMany({
        where: { firmId },
        orderBy: { name: "asc" },
      });
      const rows = products.map((p) => ({
        sku: p.sku,
        name: p.name,
        category: p.category,
        brand: p.brand,
        unit: p.unit,
        isActive: p.isActive,
        stockQuantity: p.stockQuantity,
        damagedStock: p.damagedStock,
        lowStockThreshold: p.lowStockThreshold,
        purchaseCost: p.purchaseCost,
        stockValue: round2(p.stockQuantity * p.purchaseCost),
        damagedValue: round2(p.damagedStock * p.purchaseCost),
      }));
      return ok({ type, rows, totals: {
        stockValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
        damagedValue: round2(rows.reduce((s, r) => s + r.damagedValue, 0)),
      } });
    }

    if (type === "gst") {
      const [invoices, orders] = await Promise.all([
        db.invoice.findMany({
          where: { firmId, status: "POSTED", ...range("invoiceDate") },
          select: {
            invoiceNumber: true,
            invoiceDate: true,
            subtotal: true,
            totalCgst: true,
            totalSgst: true,
            totalIgst: true,
            grandTotal: true,
            customer: { select: { partyName: true, stateCode: true, gstin: true } },
          },
          orderBy: { invoiceDate: "desc" },
          take: 2000,
        }),
        db.purchaseOrder.findMany({
          where: { firmId, status: "CONFIRMED", ...range("poDate") },
          select: {
            poNumber: true,
            poDate: true,
            subtotal: true,
            totalCgst: true,
            totalSgst: true,
            totalIgst: true,
            grandTotal: true,
            vendor: { select: { vendorName: true, stateCode: true, gstin: true } },
          },
          orderBy: { poDate: "desc" },
          take: 2000,
        }),
      ]);

      const sum = (list: Array<{ totalCgst: number; totalSgst: number; totalIgst: number }>) => ({
        cgst: round2(list.reduce((s, d) => s + d.totalCgst, 0)),
        sgst: round2(list.reduce((s, d) => s + d.totalSgst, 0)),
        igst: round2(list.reduce((s, d) => s + d.totalIgst, 0)),
      });

      const output = sum(invoices);
      const input = sum(orders);
      const net = {
        cgst: round2(output.cgst - input.cgst),
        sgst: round2(output.sgst - input.sgst),
        igst: round2(output.igst - input.igst),
      };

      return ok({
        type,
        output: {
          ...output,
          taxable: round2(invoices.reduce((s, d) => s + d.subtotal, 0)),
          total: round2(invoices.reduce((s, d) => s + d.grandTotal, 0)),
          rows: invoices.map((d) => ({
            docNo: d.invoiceNumber,
            date: d.invoiceDate.toISOString().slice(0, 10),
            party: d.customer?.partyName ?? "Counter Sale",
            partyStateCode: d.customer?.stateCode ?? firm.stateCode,
            taxable: d.subtotal,
            cgst: d.totalCgst,
            sgst: d.totalSgst,
            igst: d.totalIgst,
            total: d.grandTotal,
          })),
        },
        input: {
          ...input,
          taxable: round2(orders.reduce((s, d) => s + d.subtotal, 0)),
          total: round2(orders.reduce((s, d) => s + d.grandTotal, 0)),
          rows: orders.map((d) => ({
            docNo: d.poNumber,
            date: d.poDate.toISOString().slice(0, 10),
            party: d.vendor.vendorName,
            partyStateCode: d.vendor.stateCode,
            taxable: d.subtotal,
            cgst: d.totalCgst,
            sgst: d.totalSgst,
            igst: d.totalIgst,
            total: d.grandTotal,
          })),
        },
        net,
      });
    }

    throw new BusinessError("ERR_VALIDATION", "type must be one of sales | purchases | stock | gst", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
