// ═══════════════════════════════════════════════════════════════
// /api/v1/seed — idempotent demo-data seeder
// If ANY firm exists the seed is skipped (single-owner platform).
// Creates: DMK Mart firm + COA + opening journal, 24 plastic products,
// 8 B2B + 4 B2C counter customers, 4 vendors, 2 confirmed POs,
// 5 invoices (B2B credit + B2C counter + inter-state), 1 sales return,
// 1 vendor payment, 1 customer receipt — all through the same engines
// the API routes use, so every journal balances (R6).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, currentFyLabel, postJournal, seedChartOfAccounts } from "@/lib/journal";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { recordMovement } from "@/app/api/v1/_lib/party";
import { confirmPurchaseOrder, createPurchaseOrder } from "@/app/api/v1/_lib/po";
import { createInvoice } from "@/app/api/v1/_lib/invoice";
import { createSalesReturn } from "@/app/api/v1/_lib/salesReturn";
import { createCustomerReceipt, createVendorPayment } from "@/app/api/v1/_lib/payments";

function daysAgo(n: number, hour = 11): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// ─── Demo catalog (plastic goods) ────────────────────────────────
interface SeedProduct {
  sku: string;
  name: string;
  category: string;
  brand: string;
  cost: number;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  t5: number;
  stock: number;
  threshold: number;
  weight: number;
  unit?: string;
}

const PRODUCTS: SeedProduct[] = [
  // Costs are set so even the deepest bulk discount (20% on Tier 1)
  // never sells below purchase cost — demo books stay profitable.
  // Chairs
  { sku: "DMK-CH-001", name: "Premium Arm Chair (Natural)", category: "Chairs", brand: "DMK Polymers", cost: 160, t1: 210, t2: 235, t3: 260, t4: 295, t5: 399, stock: 180, threshold: 40, weight: 2400 },
  { sku: "DMK-CH-002", name: "Cafe Stack Chair (Black)", category: "Chairs", brand: "DMK Polymers", cost: 140, t1: 180, t2: 205, t3: 230, t4: 265, t5: 349, stock: 220, threshold: 40, weight: 2100 },
  { sku: "DMK-CH-003", name: "Executive High-Back Chair", category: "Chairs", brand: "Supreme Plastics", cost: 1150, t1: 1450, t2: 1580, t3: 1720, t4: 1999, t5: 2799, stock: 60, threshold: 20, weight: 5200 },
  { sku: "DMK-CH-004", name: "Kids Study Chair", category: "Chairs", brand: "Supreme Plastics", cost: 80, t1: 105, t2: 120, t3: 135, t4: 155, t5: 219, stock: 300, threshold: 50, weight: 950 },
  // Stools
  { sku: "DMK-ST-010", name: "Dining Stool 18 inch", category: "Stools", brand: "DMK Polymers", cost: 105, t1: 140, t2: 158, t3: 175, t4: 199, t5: 279, stock: 240, threshold: 40, weight: 1400 },
  { sku: "DMK-ST-011", name: "Bar Stool 24 inch", category: "Stools", brand: "DMK Polymers", cost: 200, t1: 260, t2: 290, t3: 320, t4: 365, t5: 499, stock: 120, threshold: 25, weight: 1900 },
  { sku: "DMK-ST-012", name: "Bathroom Stool Small", category: "Stools", brand: "Supreme Plastics", cost: 80, t1: 105, t2: 118, t3: 132, t4: 152, t5: 209, stock: 320, threshold: 50, weight: 700 },
  // Buckets
  { sku: "DMK-BK-101", name: "Bucket 20L Heavy Duty", category: "Buckets", brand: "Supreme Plastics", cost: 85, t1: 110, t2: 125, t3: 140, t4: 165, t5: 239, stock: 400, threshold: 50, weight: 850 },
  { sku: "DMK-BK-102", name: "Bucket 25L Industrial", category: "Buckets", brand: "Supreme Plastics", cost: 120, t1: 155, t2: 175, t3: 195, t4: 225, t5: 319, stock: 250, threshold: 40, weight: 1150 },
  { sku: "DMK-BK-103", name: "Bucket 15L Standard", category: "Buckets", brand: "DMK Polymers", cost: 80, t1: 105, t2: 120, t3: 138, t4: 165, t5: 249, stock: 400, threshold: 50, weight: 640 },
  { sku: "DMK-BK-104", name: "Bucket 10L Mini", category: "Buckets", brand: "DMK Polymers", cost: 80, t1: 102, t2: 115, t3: 129, t4: 152, t5: 219, stock: 400, threshold: 50, weight: 450 },
  // Dustbins
  { sku: "DMK-DB-201", name: "Dustbin 10L Pedal", category: "Dustbins", brand: "Supreme Plastics", cost: 120, t1: 155, t2: 172, t3: 190, t4: 219, t5: 299, stock: 180, threshold: 40, weight: 1100 },
  { sku: "DMK-DB-202", name: "Dustbin 20L Swing", category: "Dustbins", brand: "Supreme Plastics", cost: 150, t1: 195, t2: 215, t3: 238, t4: 272, t5: 379, stock: 150, threshold: 30, weight: 1400 },
  { sku: "DMK-DB-203", name: "Dustbin 50L Community", category: "Dustbins", brand: "DMK Polymers", cost: 380, t1: 480, t2: 525, t3: 575, t4: 650, t5: 899, stock: 90, threshold: 20, weight: 3600 },
  // Crates
  { sku: "DMK-CR-301", name: "Milk Crate 20L", category: "Crates", brand: "DMK Polymers", cost: 190, t1: 240, t2: 265, t3: 292, t4: 335, t5: 469, stock: 200, threshold: 40, weight: 1800 },
  { sku: "DMK-CR-302", name: "Vegetable Crate Small", category: "Crates", brand: "DMK Polymers", cost: 130, t1: 165, t2: 182, t3: 200, t4: 230, t5: 325, stock: 260, threshold: 40, weight: 1200 },
  { sku: "DMK-CR-303", name: "Industrial Jumbo Crate", category: "Crates", brand: "DMK Polymers", cost: 1500, t1: 1900, t2: 2080, t3: 2250, t4: 2599, t5: 3599, stock: 70, threshold: 20, weight: 5400 },
  { sku: "DMK-CR-304", name: "Bakery Tray Stackable", category: "Crates", brand: "Supreme Plastics", cost: 245, t1: 310, t2: 338, t3: 370, t4: 425, t5: 599, stock: 110, threshold: 25, weight: 2300 },
  // Storage boxes
  { sku: "DMK-SB-401", name: "Storage Box 30L", category: "Storage", brand: "Supreme Plastics", cost: 175, t1: 220, t2: 242, t3: 265, t4: 305, t5: 429, stock: 190, threshold: 35, weight: 1700 },
  { sku: "DMK-SB-402", name: "Storage Box 55L Wheeled", category: "Storage", brand: "Supreme Plastics", cost: 330, t1: 420, t2: 455, t3: 495, t4: 565, t5: 799, stock: 130, threshold: 25, weight: 3100 },
  { sku: "DMK-SB-403", name: "Storage Box 12L Mini", category: "Storage", brand: "DMK Polymers", cost: 85, t1: 110, t2: 122, t3: 135, t4: 155, t5: 219, stock: 320, threshold: 50, weight: 800 },
  // Kitchenware & water cans
  { sku: "DMK-KW-501", name: "Container Set 3-pc Airtight", category: "Kitchenware", brand: "Supreme Plastics", cost: 135, t1: 175, t2: 192, t3: 210, t4: 242, t5: 349, stock: 210, threshold: 40, weight: 900, unit: "Set" },
  { sku: "DMK-KW-502", name: "Water Can 10L", category: "Kitchenware", brand: "DMK Polymers", cost: 150, t1: 190, t2: 208, t3: 228, t4: 262, t5: 375, stock: 200, threshold: 40, weight: 500 },
  { sku: "DMK-KW-503", name: "Water Can 20L Heavy", category: "Kitchenware", brand: "DMK Polymers", cost: 255, t1: 330, t2: 355, t3: 385, t4: 440, t5: 629, stock: 140, threshold: 30, weight: 900 },
];

export async function POST(_request: NextRequest) {
  try {
    // Idempotency guard — seed only into an empty universe
    const existingFirms = await db.firm.findMany({ orderBy: { createdAt: "asc" } });
    if (existingFirms.length > 0) {
      return ok({ skipped: true, firms: existingFirms });
    }

    // ── 1. Firm + COA + opening capital journal ───────────────────
    const firm = await db.firm.create({
      data: {
        firmName: "DMK Mart",
        firmCode: "DMK",
        gstin: "27ABCDE1234F1Z5",
        state: "Maharashtra",
        stateCode: "27",
        address: "Plot 14, MIDC Industrial Area, Solapur Road, Pune 411019",
        phone: "+91 98220 12345",
        email: "books@dmkmart.in",
        bankName: "HDFC Bank",
        bankAccount: "50200045678901",
        ifsc: "HDFC0001234",
        financialYear: currentFyLabel(),
        invoicePrefix: "DMK",
        logoUrl: "/dmk-logo.png",
        openingCash: 150000,
        openingBank: 850000,
      },
    });

    // Verification team — one demo account so the team portal is
    // reachable immediately (owner manages/creates the rest from the
    // owner portal → Purchase → PO Verification → Team).
    await db.verificationStaff.create({
      data: {
        firmId: firm.id,
        name: "Ravi Kulkarni",
        username: "ravi",
        passwordHash: "1234", // plain seed credential — verified by legacy path
        phone: "+91 98220 55501",
        role: "VERIFIER",
      },
    });

    await seedChartOfAccounts(firm.id);
    await postJournal({
      firmId: firm.id,
      voucherType: "OPENING",
      postingDate: daysAgo(30, 9),
      narration: "Opening capital contribution — DMK Mart",
      lines: [
        { accountCode: ACC.CASH, entrySide: "DEBIT", amount: 150000, narration: "Opening cash balance" },
        { accountCode: ACC.BANK, entrySide: "DEBIT", amount: 850000, narration: "Opening bank balance" },
        { accountCode: ACC.CAPITAL, entrySide: "CREDIT", amount: 1000000, narration: "Owner's capital introduced" },
      ],
    });

    // ── 2. Products + opening stock movements ─────────────────────
    // Product names are vendor-prefixed ("DMK Polymers Bucket 20L…") so
    // every surface shows whose product it is (vendor naming rule).
    const productMap = new Map<string, { id: string; sku: string }>();
    for (const p of PRODUCTS) {
      const created = await db.product.create({
        data: {
          firmId: firm.id,
          sku: p.sku,
          name: p.brand ? `${p.brand} ${p.name}` : p.name,
          category: p.category,
          brand: p.brand,
          unit: p.unit ?? "Pcs",
          hsnCode: "3924",
          gstRate: 18,
          purchaseCost: p.cost,
          tier1Distributor: p.t1,
          tier2Wholesale: p.t2,
          tier3SemiWholesale: p.t3,
          tier4Retailer: p.t4,
          tier5Mrp: p.t5,
          stockQuantity: p.stock,
          damagedStock: 0,
          lowStockThreshold: p.threshold,
          weightGrams: p.weight,
          isActive: true,
        },
      });
      productMap.set(p.sku, { id: created.id, sku: created.sku });
      await recordMovement(db, {
        firmId: firm.id,
        productId: created.id,
        movementType: "OPENING",
        quantity: p.stock,
        targetPool: "SELLABLE",
        direction: "IN",
        referenceNo: "OPENING",
        notes: `Opening sellable stock — ${p.sku}`,
      });
    }

    const P = (sku: string) => productMap.get(sku)!.id;

    // ── 3. Customers — 8 B2B (location-first, R8) + 4 B2C counter ─
    const b2bSeed: Array<{
      city: string;
      firm: string;
      person: string;
      tier: string;
      limit: number;
      days: number;
      stateCode: string;
      gstin: string;
      phone: string;
    }> = [
      { city: "Latur", firm: "Ishwar Mule Traders", person: "Ishwar Mule", tier: "tier2Wholesale", limit: 500000, days: 30, stateCode: "27", gstin: "27AABCI1234M1Z8", phone: "9822011111" },
      { city: "Solapur", firm: "Balaji Plastics", person: "Ramesh Sagar", tier: "tier1Distributor", limit: 800000, days: 45, stateCode: "27", gstin: "27AACCB5678K1Z2", phone: "9822022222" },
      { city: "Nanded", firm: "Mahadev Enterprises", person: "Mahadev Rathod", tier: "tier3SemiWholesale", limit: 300000, days: 15, stateCode: "27", gstin: "27AAECM9012P1ZL", phone: "9822033333" },
      { city: "Pune", firm: "Kirti Traders", person: "Kirti Shah", tier: "tier4Retailer", limit: 200000, days: 15, stateCode: "27", gstin: "27AAGCK3456Q1Z9", phone: "9822044444" },
      { city: "Mumbai", firm: "Samarth Distributors", person: "Samarth Joshi", tier: "tier2Wholesale", limit: 600000, days: 30, stateCode: "27", gstin: "27AAFCS7890R1Z5", phone: "9822055555" },
      { city: "Nashik", firm: "Gokul Agencies", person: "Gokul Pawar", tier: "tier3SemiWholesale", limit: 250000, days: 30, stateCode: "27", gstin: "27AAHCG2345S1Z3", phone: "9822066666" },
      { city: "Hyderabad", firm: "Vinayak Enterprises", person: "Vinayak Reddy", tier: "tier1Distributor", limit: 700000, days: 45, stateCode: "36", gstin: "36AAJCV6789T1Z1", phone: "9822077777" },
      { city: "Hubli", firm: "Sri Ganesh Stores", person: "Ganesh Bhat", tier: "tier2Wholesale", limit: 400000, days: 30, stateCode: "29", gstin: "29AAKCS4567U1ZX", phone: "9822088888" },
    ];

    const customerMap = new Map<string, string>(); // key → id
    for (const c of b2bSeed) {
      const created = await db.customer.create({
        data: {
          firmId: firm.id,
          partyName: `${c.city} ${c.firm}`,
          firmName: c.firm,
          city: c.city,
          stateCode: c.stateCode,
          gstin: c.gstin,
          phone: c.phone,
          email: "",
          address: `${c.city}, ${c.stateCode === "27" ? "Maharashtra" : c.stateCode === "36" ? "Telangana" : "Karnataka"}`,
          customerType: "B2B",
          assignedTier: c.tier,
          creditLimit: c.limit,
          creditDays: c.days,
        },
      });
      customerMap.set(c.city, created.id);
    }

    const b2cSeed = [
      { name: "Anjali Patil", phone: "9876012345" },
      { name: "Rahul Deshmukh", phone: "9876023456" },
      { name: "Sunita Kale", phone: "9876034567" },
      { name: "Ganesh More", phone: "9876045678" },
    ];
    for (const c of b2cSeed) {
      const created = await db.customer.create({
        data: {
          firmId: firm.id,
          partyName: c.name,
          firmName: c.name,
          stateCode: "27",
          phone: c.phone,
          customerType: "B2C_COUNTER",
          assignedTier: "tier4Retailer",
          creditLimit: 0,
        },
      });
      customerMap.set(c.name, created.id);
    }

    // ── 4. Vendors (R10 manufacturer brand scope) ─────────────────
    const vendorSeed = [
      { name: "DMK Polymers Pvt Ltd", type: "MANUFACTURER", brand: "DMK Polymers", stateCode: "27", gstin: "27AAECD1111H1ZP", phone: "9922011111" },
      { name: "Supreme Polymers Industries", type: "MANUFACTURER", brand: "Supreme Plastics", stateCode: "27", gstin: "27AAFCS2222J1Z6", phone: "9922022222" },
      { name: "Shree Ganesh Distributors", type: "DISTRIBUTOR", brand: "", stateCode: "27", gstin: "27AAGCG3333K1ZQ", phone: "9922033333" },
      { name: "Sri Balaji Plastic Traders", type: "DISTRIBUTOR", brand: "", stateCode: "29", gstin: "29AAHCB4444L1Z7", phone: "9922044444" },
    ];
    const vendorMap = new Map<string, string>();
    for (const v of vendorSeed) {
      const created = await db.vendor.create({
        data: {
          firmId: firm.id,
          vendorName: v.name,
          vendorType: v.type,
          brand: v.brand,
          gstin: v.gstin,
          stateCode: v.stateCode,
          phone: v.phone,
          paymentTerms: "NET_30",
        },
      });
      vendorMap.set(v.name, created.id);
    }

    // ── 4b. Link products to their MANUFACTURER vendor (R10) ─────
    for (const v of vendorSeed) {
      if (v.type !== "MANUFACTURER" || !v.brand) continue;
      await db.product.updateMany({
        where: { firmId: firm.id, brand: v.brand },
        data: { manufacturerVendorId: vendorMap.get(v.name) },
      });
    }

    // ── 5. Sample transactions (last 7 days) ──────────────────────

    // PO 1 — DMK Polymers (intra-state), received 6 days ago with damage
    const po1 = await createPurchaseOrder({
      firmId: firm.id,
      firmStateCode: firm.stateCode,
      vendorId: vendorMap.get("DMK Polymers Pvt Ltd")!,
      poDate: daysAgo(8),
      notes: "Monthly replenishment — chairs, buckets, crates",
      invoicePrefix: firm.invoicePrefix,
      financialYear: firm.financialYear,
      items: [
        { productId: P("DMK-CH-001"), quantity: 60, unitCost: 160 },
        { productId: P("DMK-BK-101"), quantity: 100, unitCost: 85 },
        { productId: P("DMK-CR-301"), quantity: 40, unitCost: 190 },
      ],
    });
    const po1Full = po1 as unknown as { id: string; items: Array<{ id: string; sku: string; quantity: number }> };
    await confirmPurchaseOrder(po1Full.id, {
      receivedDate: daysAgo(6, 14),
      note: "Goods received in good condition; 2 crates torn packaging — quarantined",
      received: po1Full.items.map((it) => ({
        itemId: it.id,
        acceptedQty: it.sku === "DMK-CR-301" ? it.quantity - 2 : it.quantity,
        damagedQty: it.sku === "DMK-CR-301" ? 2 : 0,
      })),
    });

    // PO 2 — Sri Balaji (inter-state Karnataka), received 5 days ago
    const po2 = await createPurchaseOrder({
      firmId: firm.id,
      firmStateCode: firm.stateCode,
      vendorId: vendorMap.get("Sri Balaji Plastic Traders")!,
      poDate: daysAgo(7),
      notes: "Storage boxes + water cans, inter-state from Hubballi",
      invoicePrefix: firm.invoicePrefix,
      financialYear: firm.financialYear,
      items: [
        { productId: P("DMK-SB-402"), quantity: 30, unitCost: 420 },
        { productId: P("DMK-KW-503"), quantity: 50, unitCost: 330 },
      ],
    });
    const po2Full = po2 as unknown as { id: string; items: Array<{ id: string; quantity: number }> };
    await confirmPurchaseOrder(po2Full.id, {
      receivedDate: daysAgo(5, 15),
      note: "Full receipt accepted",
      received: po2Full.items.map((it) => ({ itemId: it.id, acceptedQty: it.quantity, damagedQty: 0 })),
    });

    // INV 1 — Latur Ishwar Mule (B2B credit, tier2, intra-state), bulk qty
    const inv1 = await createInvoice(firm, {
      firmId: firm.id,
      customerId: customerMap.get("Latur")!,
      invoiceDate: daysAgo(6, 12),
      paymentMode: "CREDIT",
      lines: [
        { productId: P("DMK-CH-001"), quantity: 24 }, // CRATE_24 → 15%
        { productId: P("DMK-BK-101"), quantity: 50 }, // MASTER_LOT_50 → 20%
      ],
    });

    // INV 2 — Hyderabad Vinayak (B2B credit, tier1, inter-state IGST)
    const inv2 = await createInvoice(firm, {
      firmId: firm.id,
      customerId: customerMap.get("Hyderabad")!,
      invoiceDate: daysAgo(5, 13),
      paymentMode: "CREDIT",
      lines: [{ productId: P("DMK-CR-301"), quantity: 50 }],
    });

    // INV 3 — Solapur Balaji (B2B credit, tier1, intra-state, mixed)
    await createInvoice(firm, {
      firmId: firm.id,
      customerId: customerMap.get("Solapur")!,
      invoiceDate: daysAgo(4, 10),
      paymentMode: "CREDIT",
      lines: [
        { productId: P("DMK-CH-003"), quantity: 6 },
        { productId: P("DMK-BK-102"), quantity: 24 },
      ],
    });

    // INV 4 — B2C counter, CASH (Anjali Patil)
    await createInvoice(firm, {
      firmId: firm.id,
      customerId: customerMap.get("Anjali Patil")!,
      isCounterSale: true,
      invoiceDate: daysAgo(3, 17),
      paymentMode: "CASH",
      lines: [
        { productId: P("DMK-BK-103"), quantity: 2 },
        { productId: P("DMK-CH-004"), quantity: 1 },
        { productId: P("DMK-SB-403"), quantity: 1 },
      ],
    });

    // INV 5 — B2C counter, UPI walk-in (Rahul Deshmukh via phone lookup) — booked TODAY
    await createInvoice(firm, {
      firmId: firm.id,
      customerId: customerMap.get("Rahul Deshmukh")!,
      isCounterSale: true,
      invoiceDate: daysAgo(0, 10),
      paymentMode: "UPI",
      lines: [
        { productId: P("DMK-KW-501"), quantity: 5 },
        { productId: P("DMK-KW-502"), quantity: 3 },
      ],
    });

    // Sales return — 2 broken arm chairs back from INV 1 → DAMAGED pool
    await createSalesReturn(firm, {
      customerId: customerMap.get("Latur")!,
      invoiceId: inv1.invoice?.id ?? null,
      returnDate: daysAgo(2, 12),
      notes: "Chairs arrived with cracked backs — replaced via credit note",
      items: [{ productId: P("DMK-CH-001"), damagedQty: 2, defectType: "Broken" }],
    });

    // Vendor payment — NEFT to DMK Polymers
    await createVendorPayment(firm, {
      vendorId: vendorMap.get("DMK Polymers Pvt Ltd")!,
      paymentDate: daysAgo(2, 16),
      amount: 25000,
      mode: "NEFT",
      utrRef: "HDFCN5202411",
      notes: "Part payment against PO 1",
    });

    // Customer receipt — NEFT from Latur Ishwar Mule
    await createCustomerReceipt(firm, {
      customerId: customerMap.get("Latur")!,
      receiptDate: daysAgo(1, 11),
      amount: 5000,
      mode: "NEFT",
      utrRef: "ICICR8834210",
      notes: "On account",
    });

    // Stock correction sample — transfer 1 cracked bucket sellable → damaged
    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: P("DMK-BK-101") },
        data: { stockQuantity: { decrement: 1 }, damagedStock: { increment: 1 } },
      });
      await recordMovement(tx, {
        firmId: firm.id,
        productId: P("DMK-BK-101"),
        movementType: "DAMAGE_QUARANTINE",
        quantity: 1,
        targetPool: "SELLABLE",
        direction: "OUT",
        referenceNo: "ADJUST",
        notes: "Transferred to damaged quarantine — hairline crack found during shelf check",
      });
      await recordMovement(tx, {
        firmId: firm.id,
        productId: P("DMK-BK-101"),
        movementType: "DAMAGE_QUARANTINE",
        quantity: 1,
        targetPool: "DAMAGED",
        direction: "IN",
        referenceNo: "ADJUST",
        notes: "Received from sellable pool — hairline crack found during shelf check",
      });
      await tx.stockAdjustment.create({
        data: {
          firmId: firm.id,
          adjustDate: daysAgo(1, 15),
          productId: P("DMK-BK-101"),
          productName: "Bucket 20L Heavy Duty",
          adjustType: "TRANSFER_DAMAGED",
          quantity: 1,
          reason: "Hairline crack found during shelf check",
        },
      });
    });

    return ok({
      firmId: firm.id,
      products: PRODUCTS.length,
      customers: b2bSeed.length + b2cSeed.length,
      vendors: vendorSeed.length,
      invoices: 5,
      purchaseOrders: 2,
      verificationStaff: 1,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
