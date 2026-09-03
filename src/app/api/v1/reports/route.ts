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

    // ── Product Profitability (margin vs WAC) ────────────────
    // Revenue = taxable sales in window; COGS = qty × weighted
    // average cost (confirmed receipts, fallback purchase cost);
    // sales returns in window net out qty + taxable value
    // (inverse-tax approximation from GST-inclusive note totals).
    if (type === "profitability") {
      // Optional drill-through: type=profitability&drillSku=<sku> returns the
      // contributing invoice lines (+ returns) for one SKU instead of the
      // aggregate — same window, same WAC engine, so the totals reconcile
      // exactly with that SKU's row in the per-product table.
      const drillSku = getStr(sp.get("drillSku"));

      const [invoices, salesReturns, products, poItems] = await Promise.all([
        db.invoice.findMany({
          where: { firmId, status: "POSTED", ...range("invoiceDate") },
          include: {
            customer: { select: { partyName: true } },
            lineItems: true,
          },
          orderBy: { invoiceDate: "desc" },
          take: 2000,
        }),
        db.salesReturn.findMany({
          where: { firmId, returnDate: {
            ...(dateFrom ? { gte: startOfDay(dateFrom) } : {}),
            ...(dateTo ? { lte: endOfDay(dateTo) } : {}),
          } },
          include: { items: true, customer: { select: { partyName: true } } },
          take: 2000,
        }),
        db.product.findMany({ where: { firmId }, select: { id: true, sku: true, name: true, purchaseCost: true } }),
        db.purchaseOrderItem.findMany({
          where: { po: { firmId, status: "CONFIRMED" } },
          select: { productId: true, receivedQty: true, unitCost: true },
        }),
      ]);

      // WAC per product (receipt-history weighted average)
      const costAgg = new Map<string, { qty: number; value: number }>();
      for (const it of poItems) {
        const cur = costAgg.get(it.productId) ?? { qty: 0, value: 0 };
        cur.qty += it.receivedQty;
        cur.value += it.receivedQty * it.unitCost;
        costAgg.set(it.productId, cur);
      }
      const wacOf = new Map<string, number>();
      for (const p of products) {
        const a = costAgg.get(p.id);
        wacOf.set(p.id, a && a.qty > 0 ? round2(a.value / a.qty) : round2(p.purchaseCost));
      }

      // ── Drill-through payload (one SKU) ───────────────────────
      // Sale lines only (positive qty) from POSTED invoices in the
      // same window; returns listed separately from SalesReturnItem
      // using the same inverse-tax approximation as the aggregate.
      // Net profit nets returns AND credits back returned COGS, so
      // totals reconcile 1:1 with the per-product aggregate row.
      if (drillSku) {
        const product = products.find((p) => p.sku === drillSku);
        if (!product) {
          throw new BusinessError("ERR_VALIDATION", `SKU ${drillSku} not found for this firm`, 404);
        }
        const wac = wacOf.get(product.id) ?? round2(product.purchaseCost);

        interface DrillLine {
          invoiceId: string; invoiceNumber: string; invoiceDate: string; customerName: string;
          qty: number; unitPrice: number; taxable: number; cogsUnit: number; cogs: number; profit: number; marginPct: number;
        }
        const lines: DrillLine[] = [];
        let qty = 0, revenue = 0, cogs = 0;
        const invoiceNos = new Set<string>();
        for (const inv of invoices) {
          for (const l of inv.lineItems) {
            if (l.sku !== drillSku) continue;
            const q = Number(l.quantity);
            if (!(q > 0)) continue;
            const tx = round2(Number(l.taxableAmount));
            const lineCogs = round2(q * wac);
            const lineProfit = round2(tx - lineCogs);
            lines.push({
              invoiceId: inv.id,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate.toISOString(),
              customerName: (inv.customer?.partyName ?? inv.walkInName) || "Counter Sale",
              qty: q,
              unitPrice: round2(Number(l.unitPrice)),
              taxable: tx,
              cogsUnit: wac,
              cogs: lineCogs,
              profit: lineProfit,
              marginPct: tx > 0 ? round2((lineProfit / tx) * 100) : 0,
            });
            qty = round2(qty + q);
            revenue = round2(revenue + tx);
            cogs = round2(cogs + lineCogs);
            invoiceNos.add(inv.invoiceNumber);
          }
        }

        interface DrillReturn { creditNoteNo: string; returnDate: string; customerName: string; qty: number; amount: number }
        const returns: DrillReturn[] = [];
        let returnsQty = 0, returnsAmount = 0;
        for (const sr of salesReturns) {
          for (const it of sr.items) {
            if (it.productId !== product.id) continue;
            const rate = Number(it.gstRate) || 0;
            const amount = round2(Number(it.totalAmount) / (1 + rate / 100));
            returns.push({
              creditNoteNo: sr.creditNoteNo,
              returnDate: sr.returnDate.toISOString(),
              customerName: sr.customer?.partyName ?? "Counter Sale",
              qty: round2(Number(it.damagedQty)),
              amount,
            });
            returnsQty = round2(returnsQty + Number(it.damagedQty));
            returnsAmount = round2(returnsAmount + amount);
          }
        }

        const profit = round2(revenue - cogs);
        const netRevenue = round2(revenue - returnsAmount);
        const netCogs = round2(cogs - round2(returnsQty * wac));
        const netProfit = round2(netRevenue - netCogs);

        return ok({
          type,
          drill: {
            sku: drillSku,
            productName: product.name || drillSku,
            wac,
            basis: "COGS = qty × WAC (weighted average cost from confirmed receipts, fallback last purchase cost) — same engine as the aggregate table. Net profit = (gross revenue − returns value) − (sold qty − returned qty) × WAC; returns use the inverse-tax approximation, so drill totals reconcile exactly with the per-product row.",
            lines: lines.sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1)),
            returns: returns.sort((a, b) => (a.returnDate < b.returnDate ? 1 : -1)),
            totals: {
              qty,
              revenue,
              cogs,
              profit,
              marginPct: revenue > 0 ? round2((profit / revenue) * 100) : 0,
              invoices: invoiceNos.size,
              returnsQty,
              returnsAmount,
              netRevenue,
              netCogs,
              netProfit,
            },
          },
          generatedAt: new Date().toISOString(),
        });
      }

      // Sales aggregation per product (sku-keyed, carries display meta)
      interface SoldAgg { qty: number; revenue: number; invoices: Set<string>; name: string; category: string }
      const sold = new Map<string, SoldAgg>();
      for (const inv of invoices) {
        for (const l of inv.lineItems) {
          const cur = sold.get(l.sku) ?? { qty: 0, revenue: 0, invoices: new Set<string>(), name: l.productName, category: "" };
          cur.qty += Number(l.quantity);
          cur.revenue = round2(cur.revenue + Number(l.taxableAmount));
          cur.invoices.add(inv.invoiceNumber);
          if (!cur.name) cur.name = l.productName;
          sold.set(l.sku, cur);
        }
      }

      // Net out sales returns per product (inverse-tax approximation)
      interface RetAgg { qty: number; taxable: number }
      const returned = new Map<string, RetAgg>();
      for (const sr of salesReturns) {
        for (const it of sr.items) {
          const rate = Number(it.gstRate) || 0;
          const taxable = round2(Number(it.totalAmount) / (1 + rate / 100));
          const cur = returned.get(it.productId) ?? { qty: 0, taxable: 0 };
          cur.qty += Number(it.damagedQty);
          cur.taxable = round2(cur.taxable + taxable);
          returned.set(it.productId, cur);
        }
      }
      const skuToProduct = new Map(products.map((p) => [p.sku, p]));

      const rows = [...sold.entries()]
        .map(([sku, s]) => {
          const product = skuToProduct.get(sku);
          const pid = product?.id ?? "";
          const ret = returned.get(pid);
          const netQty = round2(s.qty - (ret?.qty ?? 0));
          const netRevenue = round2(s.revenue - (ret?.taxable ?? 0));
          const wac = wacOf.get(pid) ?? 0;
          const cogs = round2(netQty * wac);
          const profit = round2(netRevenue - cogs);
          const marginPct = netRevenue > 0 ? round2((profit / netRevenue) * 100) : 0;
          return {
            sku,
            name: s.name || sku,
            qtySold: s.qty,
            qtyReturned: round2(ret?.qty ?? 0),
            netQty,
            grossRevenue: s.revenue,
            returnedValue: ret?.taxable ?? 0,
            netRevenue,
            wac,
            cogs,
            grossProfit: profit,
            marginPct,
            invoiceCount: s.invoices.size,
            avgLineValue: s.qty > 0 ? round2(s.revenue / s.qty) : 0,
          };
        })
        .sort((a, b) => b.grossProfit - a.grossProfit);

      const tRevenue = round2(rows.reduce((s, r) => s + r.netRevenue, 0));
      const tCogs = round2(rows.reduce((s, r) => s + r.cogs, 0));
      const tProfit = round2(tRevenue - tCogs);
      return ok({
        type,
        rows,
        totals: {
          revenue: tRevenue,
          cogs: tCogs,
          grossProfit: tProfit,
          marginPct: tRevenue > 0 ? round2((tProfit / tRevenue) * 100) : 0,
          products: rows.length,
          lossMakers: rows.filter((r) => r.grossProfit < -0.005).length,
          bestSku: rows[0]?.sku ?? null,
        },
        method: "COGS at weighted average cost from confirmed receipts (fallback: last purchase cost); sales returns netted (inverse-tax approximation)",
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

    throw new BusinessError("ERR_VALIDATION", "type must be one of sales | purchases | stock | gst | valuation | gstr1 | profitability", 400);
  } catch (e) {
    return handleApiError(e);
  }
}
