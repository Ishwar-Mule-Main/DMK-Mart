// ═══════════════════════════════════════════════════════════════
// /api/v1/backup — firm-level full data export (JSON)
// R1/R20: firm = account, so a backup is one firm's isolated
// universe: profile, masters, documents, subledgers, journals.
// Read-only; returns a versioned envelope the client downloads
// as dmk-backup-<firmCode>-<date>.json.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);

    const [
      products,
      customers,
      vendors,
      purchaseOrders,
      invoices,
      salesReturns,
      purchaseReturns,
      vendorPayments,
      customerReceipts,
      chartOfAccounts,
      journalEntries,
      inventoryMovements,
      stockAdjustments,
      ledgerEntries,
      gstr2bRecords,
    ] = await Promise.all([
      db.product.findMany({ where: { firmId }, orderBy: { sku: "asc" } }),
      db.customer.findMany({ where: { firmId }, orderBy: { partyName: "asc" } }),
      db.vendor.findMany({ where: { firmId }, orderBy: { vendorName: "asc" } }),
      db.purchaseOrder.findMany({
        where: { firmId },
        orderBy: { poDate: "asc" },
        include: { items: true },
      }),
      db.invoice.findMany({
        where: { firmId },
        orderBy: { invoiceDate: "asc" },
        include: { lineItems: true },
      }),
      db.salesReturn.findMany({
        where: { firmId },
        orderBy: { returnDate: "asc" },
        include: { items: true },
      }),
      db.purchaseReturn.findMany({
        where: { firmId },
        orderBy: { returnDate: "asc" },
        include: { items: true },
      }),
      db.vendorPayment.findMany({
        where: { firmId },
        orderBy: { paymentDate: "asc" },
        include: { allocations: true },
      }),
      db.customerReceipt.findMany({
        where: { firmId },
        orderBy: { receiptDate: "asc" },
        include: { allocations: true },
      }),
      db.chartOfAccount.findMany({ where: { firmId }, orderBy: { accountCode: "asc" } }),
      db.journalEntry.findMany({
        where: { firmId },
        orderBy: { postingDate: "asc" },
        include: { lines: true },
      }),
      db.inventoryMovement.findMany({ where: { firmId }, orderBy: { createdAt: "asc" } }),
      db.stockAdjustment.findMany({ where: { firmId }, orderBy: { adjustDate: "asc" } }),
      db.ledgerEntry.findMany({ where: { firmId }, orderBy: { entryDate: "asc" } }),
      db.gstr2bRecord.findMany({ where: { firmId }, orderBy: [{ period: "asc" }, { invoiceNo: "asc" }] }),
    ]);

    const counts = {
      products: products.length,
      customers: customers.length,
      vendors: vendors.length,
      purchaseOrders: purchaseOrders.length,
      invoices: invoices.length,
      salesReturns: salesReturns.length,
      purchaseReturns: purchaseReturns.length,
      vendorPayments: vendorPayments.length,
      customerReceipts: customerReceipts.length,
      chartOfAccounts: chartOfAccounts.length,
      journalEntries: journalEntries.length,
      inventoryMovements: inventoryMovements.length,
      stockAdjustments: stockAdjustments.length,
      ledgerEntries: ledgerEntries.length,
      gstr2bRecords: gstr2bRecords.length,
    };

    return ok({
      format: "dmk-mart-erp-backup",
      version: 1,
      generatedAt: new Date().toISOString(),
      firm,
      counts,
      data: {
        products,
        customers,
        vendors,
        purchaseOrders,
        invoices,
        salesReturns,
        purchaseReturns,
        vendorPayments,
        customerReceipts,
        chartOfAccounts,
        journalEntries,
        inventoryMovements,
        stockAdjustments,
        ledgerEntries,
        gstr2bRecords,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
