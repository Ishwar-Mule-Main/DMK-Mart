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

    // ── Stock Valuation (Weighted Average Cost) ──────────────
    // WAC = Σ(receipt qty × unit cost) / Σ(receipt qty) per product
    // from CONFIRMED purchase receipts; falls back to last purchase
    // cost for products never received. Phase 3 task 3.7.
    if (type === "valuation") {
      const products = await db.product.findMany({ where: { firmId }, orderBy: { name: "asc" } });
      const poItems = await db.purchaseOrderItem.findMany({
        where: { po: { firmId, status: "CONFIRMED" } },
        select: { productId: true, receivedQty: true, unitCost: true },
      });
      const agg = new Map<string, { qty: number; value: number }>();
      for (const it of poItems) {
        const cur = agg.get(it.productId) ?? { qty: 0, value: 0 };
        cur.qty += it.receivedQty;
        cur.value += it.receivedQty * it.unitCost;
        agg.set(it.productId, cur);
      }
      const rows = products
        .map((p) => {
          const a = agg.get(p.id);
          const receiptsQty = round2(a?.qty ?? 0);
          const wac = receiptsQty > 0 ? round2((a?.value ?? 0) / receiptsQty) : round2(p.purchaseCost);
          const stockValue = round2(wac * p.stockQuantity);
          const damagedValue = round2(wac * p.damagedStock);
          return {
            sku: p.sku,
            name: p.name,
            category: p.category,
            unit: p.unit,
            wac,
            purchaseCost: round2(p.purchaseCost),
            stockQuantity: round2(p.stockQuantity),
            damagedStock: round2(p.damagedStock),
            stockValue,
            damagedValue,
            totalValue: round2(stockValue + damagedValue),
            receiptsQty,
            method: receiptsQty > 0 ? "WAC (receipt history)" : "Last purchase cost",
          };
        })
        .filter((r) => r.stockQuantity > 0 || r.damagedStock > 0);
      const totals = {
        stockValue: round2(rows.reduce((s, r) => s + r.stockValue, 0)),
        damagedValue: round2(rows.reduce((s, r) => s + r.damagedValue, 0)),
        totalValue: round2(rows.reduce((s, r) => s + r.totalValue, 0)),
      };
      return ok({
        type: "valuation",
        rows,
        totals,
        count: rows.length,
        method: "Weighted Average Cost from confirmed goods receipts",
        generatedAt: new Date().toISOString(),
      });
    }

    // ── GSTR-1 (sales-side outward supplies summary) ─────────
    // B2B (registered buyer GSTIN) vs B2C split, rate-wise tax
    // buckets, and HSN-wise summary — the filing-side mirror of
    // the GSTR-2B purchase recon (cycle 17).
    if (type === "gstr1") {
      const invoices = await db.invoice.findMany({
        where: { firmId, status: "POSTED", ...range("invoiceDate") },
        include: {
          customer: { select: { partyName: true, gstin: true, stateCode: true } },
          lineItems: true,
        },
        orderBy: { invoiceDate: "desc" },
        take: 2000,
      });

      interface RateAgg { taxable: number; cgst: number; sgst: number; igst: number; qty: number }
      interface HsnAgg { hsn: string; description: string; uqc: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number }
      const rateAgg = new Map<number, RateAgg>();
      const hsnAgg = new Map<string, HsnAgg>();

      let b2bTaxable = 0, b2bCgst = 0, b2bSgst = 0, b2bIgst = 0, b2bCount = 0;
      let b2cTaxable = 0, b2cCgst = 0, b2cSgst = 0, b2cIgst = 0, b2cCount = 0;
      let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;

      const docRows = invoices.map((inv) => {
        const gstin = inv.customer?.gstin?.trim() || "";
        const isB2b = !inv.isCounterSale && gstin.length > 0;
        const cg = round2(inv.totalCgst);
        const sg = round2(inv.totalSgst);
        const ig = round2(inv.totalIgst);
        const tx = round2(inv.subtotal);

        totalTaxable = round2(totalTaxable + tx);
        totalCgst = round2(totalCgst + cg);
        totalSgst = round2(totalSgst + sg);
        totalIgst = round2(totalIgst + ig);
        if (isB2b) {
          b2bTaxable = round2(b2bTaxable + tx);
          b2bCgst = round2(b2bCgst + cg);
          b2bSgst = round2(b2bSgst + sg);
          b2bIgst = round2(b2bIgst + ig);
          b2bCount += 1;
        } else {
          b2cTaxable = round2(b2cTaxable + tx);
          b2cCgst = round2(b2cCgst + cg);
          b2cSgst = round2(b2cSgst + sg);
          b2cIgst = round2(b2cIgst + ig);
          b2cCount += 1;
        }

        for (const l of inv.lineItems) {
          const rate = Number(l.gstRate) || 0;
          const r = rateAgg.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0, qty: 0 };
          r.taxable = round2(r.taxable + Number(l.taxableAmount));
          r.cgst = round2(r.cgst + Number(l.cgstAmount));
          r.sgst = round2(r.sgst + Number(l.sgstAmount));
          r.igst = round2(r.igst + Number(l.igstAmount));
          r.qty = round2(r.qty + Number(l.quantity));
          rateAgg.set(rate, r);

          const hsnKey = l.hsnCode || "—";
          const h = hsnAgg.get(hsnKey) ?? { hsn: hsnKey, description: l.productName, uqc: "", qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
          h.qty = round2(h.qty + Number(l.quantity));
          h.taxable = round2(h.taxable + Number(l.taxableAmount));
          h.cgst = round2(h.cgst + Number(l.cgstAmount));
          h.sgst = round2(h.sgst + Number(l.sgstAmount));
          h.igst = round2(h.igst + Number(l.igstAmount));
          hsnAgg.set(hsnKey, h);
        }

        return {
          docNo: inv.invoiceNumber,
          date: inv.invoiceDate.toISOString().slice(0, 10),
          party: (inv.customer?.partyName ?? inv.walkInName) || "Counter Sale",
          gstin: gstin || null,
          supplyType: isB2b ? "B2B" : "B2C",
          placeOfSupply: inv.customer?.stateCode ?? firm.stateCode,
          taxable: tx,
          cgst: cg,
          sgst: sg,
          igst: ig,
          total: round2(inv.grandTotal),
        };
      });

      const rateWise = [...rateAgg.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([rate, v]) => ({ rate, ...v }));

      const hsnWise = [...hsnAgg.values()].sort((a, b) => b.taxable - a.taxable);

      return ok({
        type,
        totals: {
          totalTaxable,
          totalCgst,
          totalSgst,
          totalIgst,
          totalTax: round2(totalCgst + totalSgst + totalIgst),
          invoiceCount: invoices.length,
          b2bCount,
          b2cCount,
        },
        b2b: { count: b2bCount, taxable: b2bTaxable, cgst: b2bCgst, sgst: b2bSgst, igst: b2bIgst },
        b2c: { count: b2cCount, taxable: b2cTaxable, cgst: b2cCgst, sgst: b2cSgst, igst: b2cIgst },
        rateWise,
        hsnWise,
        rows: docRows,
      });
    }

    throw new BusinessError("ERR_VALIDATION", "type must be one of sales | purchases | stock | gst | valuation | gstr1", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
