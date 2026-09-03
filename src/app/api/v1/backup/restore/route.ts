// ═══════════════════════════════════════════════════════════════
// /api/v1/backup/restore — restore a backup envelope into a NEW firm
// R1 isolation: restores NEVER write to existing firms. A fresh firm
// is always created and every record is re-keyed with brand-new ids
// (oldId → newId maps), so id collisions across firms are impossible.
// Preflight validates the envelope (ERR_VALIDATION 400 on failure);
// child rows whose parents cannot be mapped are skipped with warnings.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  asRecordArray,
  getBool,
  getDate,
  getDateOrNull,
  getNum,
  getStr,
  handleApiError,
  ok,
} from "@/app/api/v1/_lib/api";

// ─── Fresh id generator (cuid-like, collision-safe in-process) ───
let idSeq = 0;
function newId(): string {
  idSeq = (idSeq + 1) % 0xffffff;
  return `c${Date.now().toString(36)}${idSeq.toString(36).padStart(4, "0")}${randomBytes(9).toString("hex")}`;
}

// ─── Chunking (SQLite variable limits: keep params per insert low) ──
function chunkByParams<T>(rows: T[], maxParams = 480): T[][] {
  if (rows.length === 0) return [];
  const fields = Math.max(1, Object.keys(rows[0] as Record<string, unknown>).length);
  const size = Math.max(1, Math.floor(maxParams / fields));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function getStrOrNull(v: unknown): string | null {
  const s = getStr(v);
  return s === "" ? null : s;
}

function getNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Envelope normalization ──────────────────────────────────────
// The Settings export UI writes the raw fetch response to disk, so a
// downloaded file may be wrapped in { ok, data }. Accept both shapes.
function unwrapEnvelope(raw: unknown): Record<string, unknown> {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof obj.format === "string" && obj.format !== "") return obj;
  const inner = asRecord(obj.data);
  if (typeof inner.format === "string" && inner.format !== "") return inner;
  return obj;
}

const REQUIRED_COLLECTIONS = ["products", "customers", "chartOfAccounts", "journalEntries"] as const;

const ALL_COLLECTIONS = [
  "products", "customers", "vendors", "purchaseOrders", "invoices", "salesReturns",
  "purchaseReturns", "vendorPayments", "customerReceipts", "chartOfAccounts",
  "journalEntries", "inventoryMovements", "stockAdjustments", "ledgerEntries", "gstr2bRecords",
];

function firstDupe(
  rows: Record<string, unknown>[],
  keyOf: (r: Record<string, unknown>) => string
): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === "") continue;
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (body.envelope === undefined) {
      throw new BusinessError(
        "ERR_VALIDATION",
        "Request body must include an `envelope` object — post the parsed backup file JSON as { envelope: {...} }",
        400
      );
    }
    const env = unwrapEnvelope(body.envelope);

    // ── PREFLIGHT ────────────────────────────────────────────────
    const format = typeof env.format === "string" ? env.format : "";
    if (format !== "dmk-mart-erp-backup") {
      throw new BusinessError(
        "ERR_VALIDATION",
        `Not a DMK backup envelope — expected format "dmk-mart-erp-backup", got ${format === "" ? "none" : `"${format}"`}`,
        400
      );
    }
    const version = typeof env.version === "number" ? env.version : Number(env.version);
    if (!Number.isFinite(version) || version !== 1) {
      throw new BusinessError(
        "ERR_VALIDATION",
        `Unsupported backup version — expected 1, got ${Number.isFinite(version) ? version : "unknown"}`,
        400
      );
    }
    const srcFirm = asRecord(env.firm);
    const origFirmName = getStr(srcFirm.firmName);
    if (origFirmName === "") {
      throw new BusinessError("ERR_VALIDATION", "Envelope is missing the firm profile — firm.firmName is required", 400);
    }
    const data = asRecord(env.data);
    if (Object.keys(data).length === 0) {
      throw new BusinessError("ERR_VALIDATION", "Envelope is missing the data payload — data.{collections} is required", 400);
    }
    for (const key of REQUIRED_COLLECTIONS) {
      if (!Array.isArray(data[key])) {
        throw new BusinessError("ERR_VALIDATION", `data.${key} is required in the backup envelope (must be an array)`, 400);
      }
    }
    for (const key of ALL_COLLECTIONS) {
      if (data[key] !== undefined && !Array.isArray(data[key])) {
        throw new BusinessError("ERR_VALIDATION", `data.${key} must be an array`, 400);
      }
    }
    // Unique-constraint guards within the envelope itself (our own
    // exports can't contain dupes, but hand-made envelopes could —
    // fail with a clear 400 instead of a broken transaction).
    const dupeChecks: Array<[string, (r: Record<string, unknown>) => string]> = [
      ["products", (r) => getStr(r.sku)],
      ["purchaseOrders", (r) => getStr(r.poNumber)],
      ["invoices", (r) => getStr(r.invoiceNumber)],
      ["salesReturns", (r) => getStr(r.creditNoteNo)],
      ["purchaseReturns", (r) => getStr(r.debitNoteNo)],
      ["chartOfAccounts", (r) => getStr(r.accountCode)],
      ["journalEntries", (r) => getStr(r.voucherNumber)],
      ["gstr2bRecords", (r) => `${getStr(r.period)}|${getStr(r.gstin)}|${getStr(r.invoiceNo)}`],
    ];
    for (const [key, keyOf] of dupeChecks) {
      const d = firstDupe(asRecordArray(data[key]), keyOf);
      if (d) {
        throw new BusinessError("ERR_VALIDATION", `data.${key} contains duplicate key "${d}" — cannot satisfy the firm's unique constraints`, 400);
      }
    }

    // Derived counts vs envelope.counts → warnings, not rejections.
    const warnings: string[] = [];
    const declaredCounts = asRecord(env.counts);
    if (Object.keys(declaredCounts).length > 0) {
      for (const key of ALL_COLLECTIONS) {
        const derived = Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0;
        const declared = typeof declaredCounts[key] === "number" ? (declaredCounts[key] as number) : undefined;
        if (declared !== undefined && declared !== derived) {
          warnings.push(`counts.${key} says ${declared} but the envelope data contains ${derived} — data payload wins`);
        }
      }
    } else {
      warnings.push("Envelope carries no counts block — skipped the count cross-check");
    }
    if (Array.isArray(data.chartOfAccounts) && (data.chartOfAccounts as unknown[]).length === 0 && (data.journalEntries as unknown[]).length > 0) {
      warnings.push("Chart of accounts is empty but journal entries exist — every journal line will be skipped");
    }

    // ── FIRM CREATION (never touches existing firms) ─────────────
    let preferredCode = getStr(srcFirm.firmCode);
    if (!preferredCode) {
      preferredCode = origFirmName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "RESTORED";
    }
    let firmCode = preferredCode;
    for (let n = 1; await db.firm.findUnique({ where: { firmCode }, select: { id: true } }); n++) {
      firmCode = `${preferredCode}-R${n}`;
    }
    const firmName = `${origFirmName} (Restored)`;
    const freshFirmId = newId();
    const firmData: Prisma.FirmUncheckedCreateInput = {
      id: freshFirmId,
      firmName,
      firmCode,
      gstin: getStr(srcFirm.gstin),
      state: getStr(srcFirm.state) || "Maharashtra",
      stateCode: getStr(srcFirm.stateCode) || "27",
      address: getStr(srcFirm.address),
      phone: getStr(srcFirm.phone),
      email: getStr(srcFirm.email),
      bankName: getStr(srcFirm.bankName),
      bankAccount: getStr(srcFirm.bankAccount),
      ifsc: getStr(srcFirm.ifsc),
      financialYear: getStr(srcFirm.financialYear) || "2025-26",
      invoicePrefix: getStr(srcFirm.invoicePrefix) || firmCode,
      logoUrl: getStrOrNull(srcFirm.logoUrl),
      openingCash: getNum(srcFirm.openingCash),
      openingBank: getNum(srcFirm.openingBank),
      isActive: true, // force — a restored firm must be usable
    };
    const newFirmId: string = freshFirmId;

    // Skipped-row tally → concise warnings at the end.
    const skipTally = new Map<string, number>();
    const tallySkip = (reason: string, n = 1) => skipTally.set(reason, (skipTally.get(reason) ?? 0) + n);

    // ── 1. CHART OF ACCOUNTS ─────────────────────────────────────
    const accountRows: Prisma.ChartOfAccountUncheckedCreateInput[] = [];
    const accountMap = new Map<string, string>();
    for (const a of asRecordArray(data.chartOfAccounts)) {
      const oldId = getStr(a.id);
      const nid = newId();
      if (oldId) accountMap.set(oldId, nid);
      accountRows.push({
        id: nid,
        firmId: newFirmId,
        accountCode: getStr(a.accountCode) || `IMP-${nid.slice(-6)}`,
        accountName: getStr(a.accountName) || "Imported account",
        accountGroup: getStr(a.accountGroup),
        accountClass: getStr(a.accountClass) || "ASSET",
        openingBalance: getNum(a.openingBalance),
        isActive: getBool(a.isActive, true),
      });
    }

    // ── 2. PRODUCTS / CUSTOMERS / VENDORS ────────────────────────
    const productRows: Prisma.ProductUncheckedCreateInput[] = [];
    const productMap = new Map<string, string>();
    for (const p of asRecordArray(data.products)) {
      const oldId = getStr(p.id);
      const nid = newId();
      if (oldId) productMap.set(oldId, nid);
      productRows.push({
        id: nid,
        firmId: newFirmId,
        sku: getStr(p.sku) || `SKU-${nid.slice(-8)}`,
        name: getStr(p.name) || "Imported product",
        category: getStr(p.category) || "General",
        brand: getStr(p.brand),
        unit: getStr(p.unit) || "Pcs",
        hsnCode: getStr(p.hsnCode) || "3924",
        gstRate: getNum(p.gstRate, 18),
        purchaseCost: getNum(p.purchaseCost),
        tier1Distributor: getNum(p.tier1Distributor),
        tier2Wholesale: getNum(p.tier2Wholesale),
        tier3SemiWholesale: getNum(p.tier3SemiWholesale),
        tier4Retailer: getNum(p.tier4Retailer),
        tier5Mrp: getNum(p.tier5Mrp),
        stockQuantity: getNum(p.stockQuantity),
        damagedStock: getNum(p.damagedStock),
        lowStockThreshold: getNum(p.lowStockThreshold),
        weightGrams: getNumOrNull(p.weightGrams),
        barcode: getStrOrNull(p.barcode),
        isActive: getBool(p.isActive, true),
        createdAt: getDate(p.createdAt),
      });
    }

    const customerRows: Prisma.CustomerUncheckedCreateInput[] = [];
    const customerMap = new Map<string, string>();
    for (const c of asRecordArray(data.customers)) {
      const oldId = getStr(c.id);
      const nid = newId();
      if (oldId) customerMap.set(oldId, nid);
      customerRows.push({
        id: nid,
        firmId: newFirmId,
        partyName: getStr(c.partyName) || `Customer ${nid.slice(-6)}`,
        firmName: getStr(c.firmName),
        city: getStr(c.city),
        stateCode: getStr(c.stateCode) || "27",
        gstin: getStr(c.gstin),
        phone: getStr(c.phone),
        email: getStr(c.email),
        address: getStr(c.address),
        customerType: getStr(c.customerType) || "B2B",
        assignedTier: getStr(c.assignedTier) || "tier4Retailer",
        creditLimit: getNum(c.creditLimit),
        creditDays: Math.round(getNum(c.creditDays, 30)),
        openingBalance: getNum(c.openingBalance),
        closingBalance: getNum(c.closingBalance),
        visitCount: Math.round(getNum(c.visitCount)),
        lifetimeSpend: getNum(c.lifetimeSpend),
        isActive: getBool(c.isActive, true),
        createdAt: getDate(c.createdAt),
      });
    }

    const vendorRows: Prisma.VendorUncheckedCreateInput[] = [];
    const vendorMap = new Map<string, string>();
    for (const v of asRecordArray(data.vendors)) {
      const oldId = getStr(v.id);
      const nid = newId();
      if (oldId) vendorMap.set(oldId, nid);
      vendorRows.push({
        id: nid,
        firmId: newFirmId,
        vendorName: getStr(v.vendorName) || `Vendor ${nid.slice(-6)}`,
        vendorType: getStr(v.vendorType) || "DISTRIBUTOR",
        brand: getStr(v.brand),
        gstin: getStr(v.gstin),
        stateCode: getStr(v.stateCode) || "27",
        phone: getStr(v.phone),
        email: getStr(v.email),
        address: getStr(v.address),
        paymentTerms: getStr(v.paymentTerms) || "NET_30",
        openingBalance: getNum(v.openingBalance),
        closingBalance: getNum(v.closingBalance),
        isActive: getBool(v.isActive, true),
        createdAt: getDate(v.createdAt),
      });
    }

    // ── 3. PURCHASE ORDERS + ITEMS ───────────────────────────────
    const poRows: Prisma.PurchaseOrderUncheckedCreateInput[] = [];
    const poMap = new Map<string, string>();
    const poItemRows: Prisma.PurchaseOrderItemUncheckedCreateInput[] = [];
    for (const po of asRecordArray(data.purchaseOrders)) {
      const newVendor = vendorMap.get(getStr(po.vendorId));
      if (!newVendor) {
        tallySkip("purchaseOrders (vendor missing from backup)");
        const orphanItems = asRecordArray(po.items).length;
        if (orphanItems > 0) tallySkip("purchaseOrderItems (parent PO skipped)", orphanItems);
        continue;
      }
      const oldId = getStr(po.id);
      const nid = newId();
      if (oldId) poMap.set(oldId, nid);
      poRows.push({
        id: nid,
        firmId: newFirmId,
        vendorId: newVendor,
        poNumber: getStr(po.poNumber) || `PO-RESTORED-${nid.slice(-6)}`,
        poDate: getDate(po.poDate),
        status: getStr(po.status) || "PENDING",
        subtotal: getNum(po.subtotal),
        totalCgst: getNum(po.totalCgst),
        totalSgst: getNum(po.totalSgst),
        totalIgst: getNum(po.totalIgst),
        grandTotal: getNum(po.grandTotal),
        receivedNote: getStr(po.receivedNote),
        vendorBillNo: getStr(po.vendorBillNo),
        vendorBillDate: getDateOrNull(po.vendorBillDate),
        notes: getStr(po.notes),
        createdAt: getDate(po.createdAt),
      });
      for (const it of asRecordArray(po.items)) {
        const newProduct = productMap.get(getStr(it.productId));
        if (!newProduct) {
          tallySkip("purchaseOrderItems (product missing from backup)");
          continue;
        }
        poItemRows.push({
          id: newId(),
          poId: nid,
          productId: newProduct,
          sku: getStr(it.sku),
          productName: getStr(it.productName),
          hsnCode: getStr(it.hsnCode),
          quantity: getNum(it.quantity),
          receivedQty: getNum(it.receivedQty),
          unitCost: getNum(it.unitCost),
          taxableAmount: getNum(it.taxableAmount),
          gstRate: getNum(it.gstRate, 18),
          cgstAmount: getNum(it.cgstAmount),
          sgstAmount: getNum(it.sgstAmount),
          igstAmount: getNum(it.igstAmount),
          totalAmount: getNum(it.totalAmount),
        });
      }
    }

    // ── 4. INVOICES + LINE ITEMS ─────────────────────────────────
    const invoiceRows: Prisma.InvoiceUncheckedCreateInput[] = [];
    const invoiceMap = new Map<string, string>();
    const lineItemRows: Prisma.InvoiceLineItemUncheckedCreateInput[] = [];
    for (const inv of asRecordArray(data.invoices)) {
      const oldId = getStr(inv.id);
      const nid = newId();
      if (oldId) invoiceMap.set(oldId, nid);
      const oldCustomerId = getStr(inv.customerId);
      let invCustomerId: string | null = null;
      if (oldCustomerId) {
        invCustomerId = customerMap.get(oldCustomerId) ?? null;
        if (!invCustomerId) tallySkip("invoice customer links (customer missing → set null)");
      }
      invoiceRows.push({
        id: nid,
        firmId: newFirmId,
        invoiceNumber: getStr(inv.invoiceNumber) || `INV-RESTORED-${nid.slice(-6)}`,
        invoiceDate: getDate(inv.invoiceDate),
        customerId: invCustomerId,
        isCounterSale: getBool(inv.isCounterSale),
        walkInName: getStr(inv.walkInName),
        walkInPhone: getStr(inv.walkInPhone),
        subtotal: getNum(inv.subtotal),
        discountTotal: getNum(inv.discountTotal),
        totalCgst: getNum(inv.totalCgst),
        totalSgst: getNum(inv.totalSgst),
        totalIgst: getNum(inv.totalIgst),
        roundOff: getNum(inv.roundOff),
        grandTotal: getNum(inv.grandTotal),
        amountInWords: getStr(inv.amountInWords),
        paymentMode: getStr(inv.paymentMode) || "CREDIT",
        status: getStr(inv.status) || "POSTED",
        createdAt: getDate(inv.createdAt),
      });
      for (const li of asRecordArray(inv.lineItems)) {
        const newProduct = productMap.get(getStr(li.productId));
        if (!newProduct) {
          tallySkip("invoiceLineItems (product missing from backup)");
          continue;
        }
        lineItemRows.push({
          id: newId(),
          invoiceId: nid,
          productId: newProduct,
          sku: getStr(li.sku),
          productName: getStr(li.productName),
          hsnCode: getStr(li.hsnCode),
          selectedTier: getStr(li.selectedTier) || "tier4Retailer",
          packagingFormat: getStr(li.packagingFormat) || "PIECE",
          baseTierPrice: getNum(li.baseTierPrice),
          bulkDiscountPct: getNum(li.bulkDiscountPct),
          unitPrice: getNum(li.unitPrice),
          quantity: getNum(li.quantity),
          taxableAmount: getNum(li.taxableAmount),
          gstRate: getNum(li.gstRate, 18),
          cgstAmount: getNum(li.cgstAmount),
          sgstAmount: getNum(li.sgstAmount),
          igstAmount: getNum(li.igstAmount),
          totalAmount: getNum(li.totalAmount),
        });
      }
    }

    // ── 5. SALES RETURNS + ITEMS ─────────────────────────────────
    const salesReturnRows: Prisma.SalesReturnUncheckedCreateInput[] = [];
    const salesReturnMap = new Map<string, string>();
    const salesReturnItemRows: Prisma.SalesReturnItemUncheckedCreateInput[] = [];
    for (const sr of asRecordArray(data.salesReturns)) {
      const oldId = getStr(sr.id);
      const nid = newId();
      if (oldId) salesReturnMap.set(oldId, nid);
      const oldInvId = getStr(sr.invoiceId);
      let srInvoiceId: string | null = null;
      if (oldInvId) {
        srInvoiceId = invoiceMap.get(oldInvId) ?? null;
        if (!srInvoiceId) tallySkip("sales return invoice links (invoice missing → set null)");
      }
      const oldCustId = getStr(sr.customerId);
      let srCustomerId: string | null = null;
      if (oldCustId) {
        srCustomerId = customerMap.get(oldCustId) ?? null;
        if (!srCustomerId) tallySkip("sales return customer links (customer missing → set null)");
      }
      salesReturnRows.push({
        id: nid,
        firmId: newFirmId,
        creditNoteNo: getStr(sr.creditNoteNo) || `CN-RESTORED-${nid.slice(-6)}`,
        invoiceRef: getStr(sr.invoiceRef),
        invoiceId: srInvoiceId,
        customerId: srCustomerId,
        returnDate: getDate(sr.returnDate),
        subtotal: getNum(sr.subtotal),
        totalTax: getNum(sr.totalTax),
        grandTotal: getNum(sr.grandTotal),
        notes: getStr(sr.notes),
        createdAt: getDate(sr.createdAt),
      });
      for (const it of asRecordArray(sr.items)) {
        const newProduct = productMap.get(getStr(it.productId));
        if (!newProduct) {
          tallySkip("salesReturnItems (product missing from backup)");
          continue;
        }
        salesReturnItemRows.push({
          id: newId(),
          returnId: nid,
          productId: newProduct,
          damagedQty: getNum(it.damagedQty),
          unitPrice: getNum(it.unitPrice),
          gstRate: getNum(it.gstRate, 18),
          totalAmount: getNum(it.totalAmount),
          defectType: getStr(it.defectType) || "Damaged",
        });
      }
    }

    // ── 6. PURCHASE RETURNS + ITEMS ──────────────────────────────
    const purchaseReturnRows: Prisma.PurchaseReturnUncheckedCreateInput[] = [];
    const purchaseReturnMap = new Map<string, string>();
    const purchaseReturnItemRows: Prisma.PurchaseReturnItemUncheckedCreateInput[] = [];
    for (const pr of asRecordArray(data.purchaseReturns)) {
      const oldId = getStr(pr.id);
      const nid = newId();
      if (oldId) purchaseReturnMap.set(oldId, nid);
      const oldPoId = getStr(pr.poId);
      let prPoId: string | null = null;
      if (oldPoId) {
        prPoId = poMap.get(oldPoId) ?? null;
        if (!prPoId) tallySkip("purchase return PO links (PO missing → set null)");
      }
      const oldVendorId = getStr(pr.vendorId);
      let prVendorId: string | null = null;
      if (oldVendorId) {
        prVendorId = vendorMap.get(oldVendorId) ?? null;
        if (!prVendorId) tallySkip("purchase return vendor links (vendor missing → set null)");
      }
      purchaseReturnRows.push({
        id: nid,
        firmId: newFirmId,
        debitNoteNo: getStr(pr.debitNoteNo) || `DN-RESTORED-${nid.slice(-6)}`,
        poRef: getStr(pr.poRef),
        poId: prPoId,
        vendorId: prVendorId,
        returnDate: getDate(pr.returnDate),
        subtotal: getNum(pr.subtotal),
        totalTax: getNum(pr.totalTax),
        grandTotal: getNum(pr.grandTotal),
        notes: getStr(pr.notes),
        createdAt: getDate(pr.createdAt),
      });
      for (const it of asRecordArray(pr.items)) {
        const newProduct = productMap.get(getStr(it.productId));
        if (!newProduct) {
          tallySkip("purchaseReturnItems (product missing from backup)");
          continue;
        }
        purchaseReturnItemRows.push({
          id: newId(),
          returnId: nid,
          productId: newProduct,
          damagedQty: getNum(it.damagedQty),
          unitCost: getNum(it.unitCost),
          gstRate: getNum(it.gstRate, 18),
          totalAmount: getNum(it.totalAmount),
          reason: getStr(it.reason) || "Transit Damage",
        });
      }
    }

    // ── 7. VENDOR PAYMENTS + ALLOCATIONS ─────────────────────────
    const vendorPaymentRows: Prisma.VendorPaymentUncheckedCreateInput[] = [];
    const paymentMap = new Map<string, string>();
    const paymentAllocationRows: Prisma.PaymentAllocationUncheckedCreateInput[] = [];
    for (const vp of asRecordArray(data.vendorPayments)) {
      const newVendor = vendorMap.get(getStr(vp.vendorId));
      if (!newVendor) {
        tallySkip("vendorPayments (vendor missing from backup)");
        const orphanAllocs = asRecordArray(vp.allocations).length;
        if (orphanAllocs > 0) tallySkip("paymentAllocations (parent payment skipped)", orphanAllocs);
        continue;
      }
      const oldId = getStr(vp.id);
      const nid = newId();
      if (oldId) paymentMap.set(oldId, nid);
      vendorPaymentRows.push({
        id: nid,
        firmId: newFirmId,
        vendorId: newVendor,
        paymentDate: getDate(vp.paymentDate),
        amount: getNum(vp.amount),
        mode: getStr(vp.mode) || "NEFT",
        utrRef: getStr(vp.utrRef),
        notes: getStr(vp.notes),
        createdAt: getDate(vp.createdAt),
      });
      for (const al of asRecordArray(vp.allocations)) {
        const newPo = poMap.get(getStr(al.purchaseOrderId));
        if (!newPo) {
          tallySkip("paymentAllocations (PO missing from backup)");
          continue;
        }
        paymentAllocationRows.push({
          id: newId(),
          firmId: newFirmId,
          paymentId: nid,
          purchaseOrderId: newPo,
          amount: getNum(al.amount),
          createdAt: getDate(al.createdAt),
        });
      }
    }

    // ── 8. CUSTOMER RECEIPTS + ALLOCATIONS ───────────────────────
    const receiptRows: Prisma.CustomerReceiptUncheckedCreateInput[] = [];
    const receiptMap = new Map<string, string>();
    const receiptAllocationRows: Prisma.ReceiptAllocationUncheckedCreateInput[] = [];
    for (const cr of asRecordArray(data.customerReceipts)) {
      const newCustomer = customerMap.get(getStr(cr.customerId));
      if (!newCustomer) {
        tallySkip("customerReceipts (customer missing from backup)");
        const orphanAllocs = asRecordArray(cr.allocations).length;
        if (orphanAllocs > 0) tallySkip("receiptAllocations (parent receipt skipped)", orphanAllocs);
        continue;
      }
      const oldId = getStr(cr.id);
      const nid = newId();
      if (oldId) receiptMap.set(oldId, nid);
      receiptRows.push({
        id: nid,
        firmId: newFirmId,
        customerId: newCustomer,
        receiptDate: getDate(cr.receiptDate),
        amount: getNum(cr.amount),
        mode: getStr(cr.mode) || "NEFT",
        utrRef: getStr(cr.utrRef),
        notes: getStr(cr.notes),
        createdAt: getDate(cr.createdAt),
      });
      for (const al of asRecordArray(cr.allocations)) {
        const newInvoice = invoiceMap.get(getStr(al.invoiceId));
        if (!newInvoice) {
          tallySkip("receiptAllocations (invoice missing from backup)");
          continue;
        }
        receiptAllocationRows.push({
          id: newId(),
          firmId: newFirmId,
          receiptId: nid,
          invoiceId: newInvoice,
          amount: getNum(al.amount),
          createdAt: getDate(al.createdAt),
        });
      }
    }

    // ── 9. JOURNAL ENTRIES + LINES (voucher numbers kept as-is) ──
    const journalRows: Prisma.JournalEntryUncheckedCreateInput[] = [];
    const journalMap = new Map<string, string>();
    const journalLineRows: Prisma.JournalLineUncheckedCreateInput[] = [];
    for (const je of asRecordArray(data.journalEntries)) {
      const oldId = getStr(je.id);
      const nid = newId();
      if (oldId) journalMap.set(oldId, nid);
      journalRows.push({
        id: nid,
        firmId: newFirmId,
        voucherNumber: getStr(je.voucherNumber) || `JV-RESTORED-${nid.slice(-6)}`,
        voucherType: getStr(je.voucherType) || "JOURNAL",
        postingDate: getDate(je.postingDate),
        referenceDocId: getStr(je.referenceDocId),
        narration: getStr(je.narration),
        totalDebit: getNum(je.totalDebit),
        totalCredit: getNum(je.totalCredit),
        createdAt: getDate(je.createdAt),
      });
      for (const ln of asRecordArray(je.lines)) {
        const newAccount = accountMap.get(getStr(ln.accountId));
        if (!newAccount) {
          tallySkip("journalLines (account missing from backup COA)");
          continue;
        }
        journalLineRows.push({
          id: newId(),
          journalId: nid,
          accountId: newAccount,
          accountName: getStr(ln.accountName),
          entrySide: getStr(ln.entrySide) || "DEBIT",
          debitAmount: getNum(ln.debitAmount),
          creditAmount: getNum(ln.creditAmount),
          narration: getStr(ln.narration),
        });
      }
    }

    // ── 10. MOVEMENTS / ADJUSTMENTS / LEDGER / GSTR-2B ───────────
    const movementRows: Prisma.InventoryMovementUncheckedCreateInput[] = [];
    for (const mv of asRecordArray(data.inventoryMovements)) {
      const newProduct = productMap.get(getStr(mv.productId));
      if (!newProduct) {
        tallySkip("inventoryMovements (product missing from backup)");
        continue;
      }
      movementRows.push({
        id: newId(),
        firmId: newFirmId,
        productId: newProduct,
        movementType: getStr(mv.movementType) || "OPENING",
        quantity: getNum(mv.quantity),
        targetPool: getStr(mv.targetPool) || "SELLABLE",
        direction: getStr(mv.direction) || "IN",
        referenceDocId: getStr(mv.referenceDocId),
        referenceNo: getStr(mv.referenceNo),
        notes: getStr(mv.notes),
        createdAt: getDate(mv.createdAt),
      });
    }

    const adjustmentRows: Prisma.StockAdjustmentUncheckedCreateInput[] = [];
    for (const sa of asRecordArray(data.stockAdjustments)) {
      // StockAdjustment.productId is a plain string (no FK relation) —
      // remap when possible so it points into the new firm's products.
      const remappedProduct = productMap.get(getStr(sa.productId));
      adjustmentRows.push({
        id: newId(),
        firmId: newFirmId,
        adjustDate: getDate(sa.adjustDate),
        productId: remappedProduct ?? getStr(sa.productId),
        productName: getStr(sa.productName),
        adjustType: getStr(sa.adjustType) || "OPENING",
        quantity: getNum(sa.quantity),
        reason: getStr(sa.reason),
        createdAt: getDate(sa.createdAt),
      });
    }

    const ledgerRows: Prisma.LedgerEntryUncheckedCreateInput[] = [];
    for (const le of asRecordArray(data.ledgerEntries)) {
      const oldLeCustomerId = getStr(le.customerId);
      let leCustomerId: string | null = null;
      if (oldLeCustomerId) {
        leCustomerId = customerMap.get(oldLeCustomerId) ?? null;
        if (!leCustomerId) tallySkip("ledgerEntries customer links (customer missing → set null)");
      }
      const oldLeVendorId = getStr(le.vendorId);
      let leVendorId: string | null = null;
      if (oldLeVendorId) {
        leVendorId = vendorMap.get(oldLeVendorId) ?? null;
        if (!leVendorId) tallySkip("ledgerEntries vendor links (vendor missing → set null)");
      }
      ledgerRows.push({
        id: newId(),
        firmId: newFirmId,
        partyType: getStr(le.partyType) || "CUSTOMER",
        customerId: leCustomerId,
        vendorId: leVendorId,
        entryDate: getDate(le.entryDate),
        voucherType: getStr(le.voucherType) || "JOURNAL",
        voucherNo: getStr(le.voucherNo),
        particulars: getStr(le.particulars),
        debitAmount: getNum(le.debitAmount),
        creditAmount: getNum(le.creditAmount),
        balanceAfter: getNum(le.balanceAfter),
        createdAt: getDate(le.createdAt),
      });
    }

    const gstr2bRows: Prisma.Gstr2bRecordUncheckedCreateInput[] = [];
    for (const g of asRecordArray(data.gstr2bRecords)) {
      gstr2bRows.push({
        id: newId(),
        firmId: newFirmId,
        period: getStr(g.period) || "1970-01",
        gstin: getStr(g.gstin),
        tradeName: getStr(g.tradeName),
        invoiceNo: getStr(g.invoiceNo) || `2B-${newId().slice(-6)}`,
        invoiceDate: getDate(g.invoiceDate),
        taxableValue: getNum(g.taxableValue),
        igst: getNum(g.igst),
        cgst: getNum(g.cgst),
        sgst: getNum(g.sgst),
        itcAvailable: getBool(g.itcAvailable, true),
        placeOfSupply: getStr(g.placeOfSupply),
        createdAt: getDate(g.createdAt),
      });
    }

    // Flush skip tally into warnings.
    for (const [reason, n] of skipTally) {
      warnings.push(`Skipped ${n} ${reason}`);
    }

    // ── TRANSACTION (chunked createMany; insertion order matters) ─
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    ops.push(db.firm.create({ data: firmData }));
    for (const c of chunkByParams(accountRows)) ops.push(db.chartOfAccount.createMany({ data: c }));
    for (const c of chunkByParams(productRows)) ops.push(db.product.createMany({ data: c }));
    for (const c of chunkByParams(customerRows)) ops.push(db.customer.createMany({ data: c }));
    for (const c of chunkByParams(vendorRows)) ops.push(db.vendor.createMany({ data: c }));
    for (const c of chunkByParams(poRows)) ops.push(db.purchaseOrder.createMany({ data: c }));
    for (const c of chunkByParams(poItemRows)) ops.push(db.purchaseOrderItem.createMany({ data: c }));
    for (const c of chunkByParams(invoiceRows)) ops.push(db.invoice.createMany({ data: c }));
    for (const c of chunkByParams(lineItemRows)) ops.push(db.invoiceLineItem.createMany({ data: c }));
    for (const c of chunkByParams(salesReturnRows)) ops.push(db.salesReturn.createMany({ data: c }));
    for (const c of chunkByParams(salesReturnItemRows)) ops.push(db.salesReturnItem.createMany({ data: c }));
    for (const c of chunkByParams(purchaseReturnRows)) ops.push(db.purchaseReturn.createMany({ data: c }));
    for (const c of chunkByParams(purchaseReturnItemRows)) ops.push(db.purchaseReturnItem.createMany({ data: c }));
    for (const c of chunkByParams(vendorPaymentRows)) ops.push(db.vendorPayment.createMany({ data: c }));
    for (const c of chunkByParams(paymentAllocationRows)) ops.push(db.paymentAllocation.createMany({ data: c }));
    for (const c of chunkByParams(receiptRows)) ops.push(db.customerReceipt.createMany({ data: c }));
    for (const c of chunkByParams(receiptAllocationRows)) ops.push(db.receiptAllocation.createMany({ data: c }));
    for (const c of chunkByParams(journalRows)) ops.push(db.journalEntry.createMany({ data: c }));
    for (const c of chunkByParams(journalLineRows)) ops.push(db.journalLine.createMany({ data: c }));
    for (const c of chunkByParams(movementRows)) ops.push(db.inventoryMovement.createMany({ data: c }));
    for (const c of chunkByParams(adjustmentRows)) ops.push(db.stockAdjustment.createMany({ data: c }));
    for (const c of chunkByParams(ledgerRows)) ops.push(db.ledgerEntry.createMany({ data: c }));
    for (const c of chunkByParams(gstr2bRows)) ops.push(db.gstr2bRecord.createMany({ data: c }));
    await db.$transaction(ops);

    // ── SANITY: re-count what actually landed in the new firm ────
    const [
      nProducts, nCustomers, nVendors, nPurchaseOrders, nPoItems, nInvoices,
      nLineItems, nSalesReturns, nSalesReturnItems, nPurchaseReturns,
      nPurchaseReturnItems, nVendorPayments, nPaymentAllocations, nReceipts,
      nReceiptAllocations, nAccounts, nJournals, nJournalLines,
      nMovements, nAdjustments, nLedgerEntries, nGstr2b,
    ] = await Promise.all([
      db.product.count({ where: { firmId: newFirmId } }),
      db.customer.count({ where: { firmId: newFirmId } }),
      db.vendor.count({ where: { firmId: newFirmId } }),
      db.purchaseOrder.count({ where: { firmId: newFirmId } }),
      db.purchaseOrderItem.count({ where: { po: { firmId: newFirmId } } }),
      db.invoice.count({ where: { firmId: newFirmId } }),
      db.invoiceLineItem.count({ where: { invoice: { firmId: newFirmId } } }),
      db.salesReturn.count({ where: { firmId: newFirmId } }),
      db.salesReturnItem.count({ where: { return: { firmId: newFirmId } } }),
      db.purchaseReturn.count({ where: { firmId: newFirmId } }),
      db.purchaseReturnItem.count({ where: { return: { firmId: newFirmId } } }),
      db.vendorPayment.count({ where: { firmId: newFirmId } }),
      db.paymentAllocation.count({ where: { firmId: newFirmId } }),
      db.customerReceipt.count({ where: { firmId: newFirmId } }),
      db.receiptAllocation.count({ where: { firmId: newFirmId } }),
      db.chartOfAccount.count({ where: { firmId: newFirmId } }),
      db.journalEntry.count({ where: { firmId: newFirmId } }),
      db.journalLine.count({ where: { journal: { firmId: newFirmId } } }),
      db.inventoryMovement.count({ where: { firmId: newFirmId } }),
      db.stockAdjustment.count({ where: { firmId: newFirmId } }),
      db.ledgerEntry.count({ where: { firmId: newFirmId } }),
      db.gstr2bRecord.count({ where: { firmId: newFirmId } }),
    ]);

    return ok({
      firmId: newFirmId,
      firmName,
      firmCode,
      counts: {
        products: nProducts,
        customers: nCustomers,
        vendors: nVendors,
        purchaseOrders: nPurchaseOrders,
        purchaseOrderItems: nPoItems,
        invoices: nInvoices,
        invoiceLineItems: nLineItems,
        salesReturns: nSalesReturns,
        salesReturnItems: nSalesReturnItems,
        purchaseReturns: nPurchaseReturns,
        purchaseReturnItems: nPurchaseReturnItems,
        vendorPayments: nVendorPayments,
        paymentAllocations: nPaymentAllocations,
        customerReceipts: nReceipts,
        receiptAllocations: nReceiptAllocations,
        chartOfAccounts: nAccounts,
        journalEntries: nJournals,
        journalLines: nJournalLines,
        inventoryMovements: nMovements,
        stockAdjustments: nAdjustments,
        ledgerEntries: nLedgerEntries,
        gstr2bRecords: nGstr2b,
      },
      warnings,
      restoredAt: new Date().toISOString(),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
