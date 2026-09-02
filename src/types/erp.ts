// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SHARED TYPES (API-facing, JSON-serialized)
// ═══════════════════════════════════════════════════════════════

export interface Firm {
  id: string;
  firmName: string;
  firmCode: string;
  gstin: string;
  state: string;
  stateCode: string;
  address: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
  financialYear: string;
  invoicePrefix: string;
  logoUrl?: string | null;
  openingCash: number;
  openingBank: number;
  createdAt: string;
}

export interface Product {
  id: string;
  firmId: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  hsnCode: string;
  gstRate: number;
  purchaseCost: number;
  tier1Distributor: number;
  tier2Wholesale: number;
  tier3SemiWholesale: number;
  tier4Retailer: number;
  tier5Mrp: number;
  stockQuantity: number;
  damagedStock: number;
  lowStockThreshold: number;
  weightGrams?: number | null;
  barcode?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  firmId: string;
  partyName: string;
  firmName: string;
  city: string;
  stateCode: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  customerType: "B2B" | "B2C_COUNTER";
  assignedTier: string;
  creditLimit: number;
  creditDays: number;
  openingBalance: number;
  closingBalance: number;
  visitCount: number;
  lifetimeSpend: number;
  isActive: boolean;
  createdAt: string;
}

export interface Vendor {
  id: string;
  firmId: string;
  vendorName: string;
  vendorType: "MANUFACTURER" | "DISTRIBUTOR";
  brand: string;
  gstin: string;
  stateCode: string;
  phone: string;
  email: string;
  address: string;
  paymentTerms: string;
  openingBalance: number;
  closingBalance: number;
  isActive: boolean;
  createdAt: string;
}

export interface PurchaseOrderItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  receivedQty: number;
  unitCost: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface PurchaseOrder {
  id: string;
  firmId: string;
  vendorId: string;
  vendor?: Vendor;
  poNumber: string;
  poDate: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
  receivedNote: string;
  notes: string;
  items: PurchaseOrderItem[];
  createdAt: string;
  /** AP subledger badges (CONFIRMED only — from purchase-orders GET). */
  paid?: number;
  credited?: number;
  outstanding?: number;
}

export interface InvoiceLineItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  hsnCode: string;
  selectedTier: string;
  packagingFormat: string;
  baseTierPrice: number;
  bulkDiscountPct: number;
  unitPrice: number;
  quantity: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface Invoice {
  id: string;
  firmId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId?: string | null;
  customer?: Customer | null;
  isCounterSale: boolean;
  walkInName: string;
  walkInPhone: string;
  subtotal: number;
  discountTotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
  paymentMode: string;
  status: string;
  lineItems: InvoiceLineItem[];
  createdAt: string;
  /** Settlement tracking (credit invoices only — from invoices GET). */
  settled?: number;
  credited?: number;
  outstanding?: number;
}

export interface SalesReturnItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  damagedQty: number;
  unitPrice: number;
  gstRate: number;
  totalAmount: number;
  defectType: string;
}

export interface SalesReturnDoc {
  id: string;
  creditNoteNo: string;
  invoiceRef: string;
  customerId?: string | null;
  customer?: Customer | null;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  items: SalesReturnItem[];
}

export interface PurchaseReturnItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  damagedQty: number;
  unitCost: number;
  gstRate: number;
  totalAmount: number;
  reason: string;
}

export interface PurchaseReturnDoc {
  id: string;
  debitNoteNo: string;
  poRef: string;
  vendorId?: string | null;
  vendor?: Vendor | null;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  items: PurchaseReturnItem[];
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  vendor?: Vendor;
  paymentDate: string;
  amount: number;
  mode: string;
  utrRef: string;
  notes: string;
}

export interface CustomerReceipt {
  id: string;
  customerId: string;
  customer?: Customer;
  receiptDate: string;
  amount: number;
  mode: string;
  utrRef: string;
  notes: string;
  allocations?: ReceiptAllocationInfo[];
  allocatedTotal?: number;
}

export interface ReceiptAllocationInfo {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
}

export interface OpenInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string | null;
  partyName: string;
  invoiceDate: string;
  grandTotal: number;
  settled: number;
  credited: number;
  outstanding: number;
  ageDays: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  creditDays: number;
  dueDate: string;
  overdueDays: number;
  isOverdue: boolean;
}

export interface InvoiceAgingResponse {
  type: "AR_INVOICE";
  firmName: string;
  asOf: string;
  rows: OpenInvoiceRow[];
  totals: {
    outstanding: number;
    overdue: number;
    buckets: { d0_30: number; d31_60: number; d61_90: number; d90plus: number };
    openInvoices: number;
    overdueInvoices: number;
  };
  parties: Array<{
    customerId: string;
    partyName: string;
    outstanding: number;
    invoiceCount: number;
    oldestInvoiceDate: string | null;
    oldestInvoiceNo: string;
    unapplied?: number;
  }>;
  reconciliation: {
    openInvoices: number;
    unappliedReceipts: number;
    openingBalances: number;
    glReceivables: number;
    difference: number;
  };
}

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  accountGroup: string;
  accountClass: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  openingBalance: number;
}

export interface JournalLine {
  id: string;
  accountCode?: string;
  accountId: string;
  accountName: string;
  entrySide: "DEBIT" | "CREDIT";
  debitAmount: number;
  creditAmount: number;
  narration: string;
}

export interface JournalEntry {
  id: string;
  voucherNumber: string;
  voucherType: string;
  postingDate: string;
  narration: string;
  referenceDocId: string;
  totalDebit: number;
  totalCredit: number;
  lines: JournalLine[];
}

export interface InventoryMovement {
  id: string;
  productId: string;
  product?: { sku: string; name: string };
  movementType: string;
  quantity: number;
  targetPool: "SELLABLE" | "DAMAGED";
  direction: "IN" | "OUT";
  referenceNo: string;
  notes: string;
  createdAt: string;
}

export interface LedgerRow {
  id: string;
  entryDate: string;
  voucherType: string;
  voucherNo: string;
  particulars: string;
  debitAmount: number;
  creditAmount: number;
  balanceAfter: number;
}

export interface TbRow {
  accountCode: string;
  accountName: string;
  accountClass: string;
  debit: number;
  credit: number;
}

export interface AgingBucket {
  partyId: string;
  partyName: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
  total: number;
}

export interface DashboardData {
  todaySales: number;
  monthSales: number;
  receivables: number;
  payables: number;
  cash: number;
  bank: number;
  inventoryValue: number;
  damagedValue: number;
  lowStockCount: number;
  salesTrend: Array<{ date: string; amount: number }>;
  topProducts: Array<{ name: string; qty: number; value: number }>;
  arAging: Array<{ bucket: string; amount: number }>;
  recentTransactions: Array<{
    type: string;
    number: string;
    date: string;
    amount: number;
    party: string;
  }>;
}

export interface LowStockItem {
  productId: string;
  sku: string;
  name: string;
  stockQuantity: number;
  damagedStock: number;
  lowStockThreshold: number;
  purchaseCost: number;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ═══════════════════════════════════════════════════════════════
// AP SETTLEMENT (per-PO tracking — mirror of AR invoice aging)
// ═══════════════════════════════════════════════════════════════

export interface OpenPurchaseOrderRow {
  poId: string;
  poNumber: string;
  vendorBillNo?: string;
  vendorId: string;
  vendorName: string;
  poDate: string;
  grandTotal: number;
  settled: number;
  credited: number;
  outstanding: number;
  ageDays: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  paymentDays: number;
  dueDate: string;
  overdueDays: number;
  isOverdue: boolean;
}

export interface PoAgingResponse {
  type: "AP_PO";
  firmName: string;
  asOf: string;
  rows: OpenPurchaseOrderRow[];
  totals: {
    outstanding: number;
    overdue: number;
    buckets: { d0_30: number; d31_60: number; d61_90: number; d90plus: number };
    openPOs: number;
    overduePOs: number;
  };
  vendors: Array<{
    vendorId: string;
    vendorName: string;
    outstanding: number;
    poCount: number;
    oldestPoDate: string | null;
    oldestPoNo: string;
    unapplied?: number;
    standaloneDebits?: number;
  }>;
  reconciliation: {
    openPOs: number;
    unappliedPayments: number;
    openingBalances: number;
    standaloneDebitNotes: number;
    glPayables: number;
    difference: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// GSTR-2B RECONCILIATION
// ═══════════════════════════════════════════════════════════════

export interface Gstr2bRecordRow {
  id: string;
  gstin: string;
  tradeName: string;
  invoiceNo: string;
  invoiceDate: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  itcAvailable: boolean;
  placeOfSupply: string;
  grand: number;
  status: "MATCHED" | "AMOUNT_MISMATCH" | "MISSING_IN_BOOKS";
  matchedPoNumber: string | null;
  matchBasis: "BILL_NO" | "AMOUNT" | null;
}

export interface Gstr2bBooksRow {
  poId: string;
  poNumber: string;
  vendorName: string;
  gstin: string;
  vendorBillNo?: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  grand: number;
  status: "MISSING_IN_2B";
}

export interface Gstr2bResponse {
  period: string;
  firmName: string;
  firmGstin: string;
  records: Gstr2bRecordRow[];
  books: Gstr2bBooksRow[];
  booksTotal: number;
  summary: {
    period: string;
    records2b: number;
    matched: number;
    billMatched: number;
    mismatches: number;
    missingInBooks: number;
    missingIn2b: number;
    itc2b: number;
    itcBooks: number;
    matchedItc: number;
    missingItc: number;
    extraTax: number;
    netItcRisk: number;
  };
}
