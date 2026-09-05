// ═══════════════════════════════════════════════════════════════
// Product catalog import — "0 stock for now"
//
// Sources:
//   1. upload/dmk-product-template (1).csv  (user's Excel export)
//   2. Demo fill-in products for everything the sheet is missing
//
// Behaviour:
//   • CSV rows are UPSERTED by SKU (prices/tiers/barcode applied,
//     stock forced to 0 as the user requested).
//   • 16 demo-fill products complete the catalog (40 SKUs total).
//   • EVERY product in the firm is reset to 0 sellable + 0 damaged
//     stock. Products that actually had stock get WRITE_OFF movement
//     rows so the audit trail stays truthful, plus ONE balanced
//     journal (Dr Damaged Stock Write-Off / Cr Inventory Asset) that
//     clears the Inventory GL account to ₹0 — books agree with the
//     empty shelves.
//
// Idempotent: re-runs upsert the same rows and skip already-zero
// stock. Run: bunx tsx scripts/import-products.ts
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { round2 } from "../src/lib/gst";

const db = new PrismaClient();

// ─── Minimal CSV parser (handles quoted fields) ───────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

interface CsvProduct {
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  hsn: string;
  gst: number;
  cost: number;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  t5: number;
  stock: number;
  damaged: number;
  threshold: number;
  weight: number;
  barcode: string;
}

function num(v: string | undefined): number {
  const n = parseFloat((v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function csvToProducts(file: string): CsvProduct[] {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = head.findIndex((h) => h === n || h.startsWith(n) || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    sku: idx("sku"),
    name: idx("product name", "name"),
    category: idx("category"),
    brand: idx("brand"),
    unit: idx("unit"),
    hsn: idx("hsn"),
    gst: idx("gst rate"),
    cost: idx("purchase cost"),
    t1: idx("tier1"),
    t2: idx("tier2"),
    t3: idx("tier3"),
    t4: idx("tier4"),
    t5: idx("tier5"),
    stock: idx("opening stock"),
    damaged: idx("opening damaged"),
    threshold: idx("low stock threshold", "threshold"),
    weight: idx("weight"),
    barcode: idx("barcode"),
  };
  return rows.slice(1).map((r) => ({
    sku: c.sku >= 0 ? r[c.sku] : "",
    name: c.name >= 0 ? r[c.name] : "",
    category: c.category >= 0 ? r[c.category] : "General",
    brand: c.brand >= 0 ? r[c.brand] : "",
    unit: c.unit >= 0 ? r[c.unit] || "Pcs" : "Pcs",
    hsn: c.hsn >= 0 ? r[c.hsn] : "3924",
    gst: c.gst >= 0 ? num(r[c.gst]) : 18,
    cost: c.cost >= 0 ? num(r[c.cost]) : 0,
    t1: c.t1 >= 0 ? num(r[c.t1]) : 0,
    t2: c.t2 >= 0 ? num(r[c.t2]) : 0,
    t3: c.t3 >= 0 ? num(r[c.t3]) : 0,
    t4: c.t4 >= 0 ? num(r[c.t4]) : 0,
    t5: c.t5 >= 0 ? num(r[c.t5]) : 0,
    stock: 0, // user: "0 stock for now" — the sheet's opening-stock column is ignored
    damaged: 0,
    threshold: c.threshold >= 0 ? num(r[c.threshold]) : 20,
    weight: c.weight >= 0 ? num(r[c.weight]) : 0,
    barcode: c.barcode >= 0 ? r[c.barcode] : "",
  })).filter((p) => p.sku && p.name);
}

// ─── Demo fill-in catalog (the "missing things") ───────────────────
// Same shape as the user's sheet. Costs keep the house rule: even the
// deepest 20% Tier-1 bulk discount never sells below purchase cost.
const DEMO_FILL: CsvProduct[] = [
  { sku: "DMK-TB-601", name: "Dining Table 4-Seater", category: "Tables", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 1850, t1: 2300, t2: 2490, t3: 2680, t4: 2999, t5: 3999, stock: 0, damaged: 0, threshold: 15, weight: 14000, barcode: "8901234560601" },
  { sku: "DMK-TB-602", name: "Center Table (Small)", category: "Tables", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 950, t1: 1180, t2: 1290, t3: 1395, t4: 1599, t5: 2199, stock: 0, damaged: 0, threshold: 20, weight: 8500, barcode: "8901234560602" },
  { sku: "DMK-TB-603", name: "Kids Study Table", category: "Tables", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 420, t1: 540, t2: 585, t3: 635, t4: 725, t5: 999, stock: 0, damaged: 0, threshold: 25, weight: 5200, barcode: "8901234560603" },
  { sku: "DMK-BW-701", name: "Bathroom Mug 1L", category: "Bathware", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 32, t1: 42, t2: 48, t3: 54, t4: 62, t5: 89, stock: 0, damaged: 0, threshold: 100, weight: 180, barcode: "8901234560701" },
  { sku: "DMK-BW-702", name: "Wash Basin 16 inch", category: "Bathware", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 145, t1: 185, t2: 205, t3: 225, t4: 259, t5: 369, stock: 0, damaged: 0, threshold: 40, weight: 900, barcode: "8901234560702" },
  { sku: "DMK-BW-703", name: "Bath Stool Anti-Skid", category: "Bathware", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 95, t1: 125, t2: 138, t3: 152, t4: 175, t5: 249, stock: 0, damaged: 0, threshold: 50, weight: 750, barcode: "8901234560703" },
  { sku: "DMK-TU-801", name: "Tub 25L Oval", category: "Tubs & Troughs", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 165, t1: 210, t2: 230, t3: 250, t4: 289, t5: 399, stock: 0, damaged: 0, threshold: 35, weight: 1300, barcode: "8901234560801" },
  { sku: "DMK-TU-802", name: "Trough 40L Heavy", category: "Tubs & Troughs", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 290, t1: 365, t2: 398, t3: 432, t4: 495, t5: 699, stock: 0, damaged: 0, threshold: 25, weight: 2300, barcode: "8901234560802" },
  { sku: "DMK-TU-803", name: "Planter Tray Set 3-pc", category: "Tubs & Troughs", brand: "Supreme Plastics", unit: "Set", hsn: "3924", gst: 18, cost: 110, t1: 145, t2: 158, t3: 172, t4: 199, t5: 289, stock: 0, damaged: 0, threshold: 40, weight: 1100, barcode: "8901234560803" },
  { sku: "DMK-KW-504", name: "Water Jug 5L", category: "Kitchenware", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 120, t1: 155, t2: 168, t3: 185, t4: 215, t5: 299, stock: 0, damaged: 0, threshold: 45, weight: 600, barcode: "8901234560504" },
  { sku: "DMK-KW-505", name: "Chopping Board Large", category: "Kitchenware", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 88, t1: 115, t2: 126, t3: 138, t4: 159, t5: 229, stock: 0, damaged: 0, threshold: 50, weight: 700, barcode: "8901234560505" },
  { sku: "DMK-KW-506", name: "Drainer Basket", category: "Kitchenware", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 75, t1: 98, t2: 108, t3: 118, t4: 138, t5: 199, stock: 0, damaged: 0, threshold: 50, weight: 550, barcode: "8901234560506" },
  { sku: "DMK-SB-404", name: "Storage Box 80L Jumbo", category: "Storage", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 450, t1: 565, t2: 615, t3: 665, t4: 759, t5: 1049, stock: 0, damaged: 0, threshold: 20, weight: 3900, barcode: "8901234560404" },
  { sku: "DMK-DB-204", name: "Dustbin 80L Wheeled", category: "Dustbins", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 520, t1: 650, t2: 705, t3: 760, t4: 869, t5: 1199, stock: 0, damaged: 0, threshold: 18, weight: 4800, barcode: "8901234560204" },
  { sku: "DMK-ST-013", name: "Folding Stool Compact", category: "Stools", brand: "Supreme Plastics", unit: "Pcs", hsn: "3924", gst: 18, cost: 130, t1: 170, t2: 185, t3: 202, t4: 235, t5: 329, stock: 0, damaged: 0, threshold: 40, weight: 1250, barcode: "8901234560013" },
  { sku: "DMK-CR-305", name: "Fruit Crate Ventilated", category: "Crates", brand: "DMK Polymers", unit: "Pcs", hsn: "3924", gst: 18, cost: 155, t1: 198, t2: 215, t3: 235, t4: 272, t5: 389, stock: 0, damaged: 0, threshold: 40, weight: 1450, barcode: "8901234560305" },
];

async function main() {
  const firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!firm) throw new Error("No firm found — run the platform seed first");

  // ── 1. Import the user's CSV ────────────────────────────────────
  const csvPath = path.join(__dirname, "..", "upload", "dmk-product-template (1).csv");
  let csvProducts: CsvProduct[] = [];
  if (fs.existsSync(csvPath)) {
    csvProducts = csvToProducts(csvPath);
    console.log(`CSV: ${csvProducts.length} product row(s) found in ${path.basename(csvPath)}`);
  } else {
    console.log(`CSV not found at ${csvPath} — importing demo-fill only`);
  }

  const all = [...csvProducts, ...DEMO_FILL];
  let updated = 0;
  let created = 0;
  for (const p of all) {
    const existing = await db.product.findUnique({
      where: { firmId_sku: { firmId: firm.id, sku: p.sku } },
    });
    const name = p.brand ? `${p.brand} ${p.name}` : p.name;
    const data = {
      name,
      category: p.category,
      brand: p.brand,
      unit: p.unit,
      hsnCode: p.hsn,
      gstRate: p.gst,
      // Keep an existing product's established purchase cost (it backs the
      // historic COGS journals); the sheet's cost seeds only NEW SKUs.
      purchaseCost: existing && existing.purchaseCost > 0 ? existing.purchaseCost : p.cost,
      tier1Distributor: p.t1,
      tier2Wholesale: p.t2,
      tier3SemiWholesale: p.t3,
      tier4Retailer: p.t4,
      tier5Mrp: p.t5,
      lowStockThreshold: existing?.lowStockThreshold || p.threshold,
      weightGrams: p.weight || (existing?.weightGrams ?? null),
      barcode: p.barcode || (existing?.barcode ?? null),
      isActive: true,
      stockQuantity: 0, // "0 stock for now"
      damagedStock: 0,
    };
    if (existing) {
      await db.product.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await db.product.create({ data: { firmId: firm.id, sku: p.sku, ...data } });
      created++;
    }
  }
  console.log(`Catalog: ${created} created, ${updated} updated from sheet + demo fill`);

  // ── 2. Reset ALL stock to zero (truthful WRITE_OFF trail) ───────
  const products = await db.product.findMany({ where: { firmId: firm.id } });
  let cleared = 0;
  for (const p of products) {
    if (p.stockQuantity === 0 && p.damagedStock === 0) continue;
    if (p.stockQuantity > 0) {
      await db.inventoryMovement.create({
        data: {
          firmId: firm.id,
          productId: p.id,
          movementType: "WRITE_OFF",
          quantity: p.stockQuantity,
          targetPool: "SELLABLE",
          direction: "OUT",
          referenceNo: "DEMO-RESET",
          notes: "Demo reset — sellable stock cleared to zero for the fresh FY-2025-26 start",
        },
      });
    }
    if (p.damagedStock > 0) {
      await db.inventoryMovement.create({
        data: {
          firmId: firm.id,
          productId: p.id,
          movementType: "WRITE_OFF",
          quantity: p.damagedStock,
          targetPool: "DAMAGED",
          direction: "OUT",
          referenceNo: "DEMO-RESET",
          notes: "Demo reset — damaged quarantine cleared to zero for the fresh FY-2025-26 start",
        },
      });
    }
    await db.product.update({
      where: { id: p.id },
      data: { stockQuantity: 0, damagedStock: 0 },
    });
    cleared++;
  }
  console.log(`Stock reset: ${cleared} product(s) cleared to 0 sellable / 0 damaged`);

  // ── 3. Clear the Inventory GL account to match the empty shelves ─
  const invAccount = await db.chartOfAccount.findFirst({
    where: { firmId: firm.id, accountCode: "1200" },
  });
  const lines = await db.journalLine.findMany({
    where: { journal: { firmId: firm.id }, accountName: { contains: "Inventory" } },
  });
  const invBalance = round2(lines.reduce((s, l) => s + l.debitAmount - l.creditAmount, 0));
  if (invAccount && Math.abs(invBalance) > 0.009) {
    // Number the reset journal within FY 2026-27 (today)
    const now = new Date();
    const fy = `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, "0")}`;
    const existing = await db.journalEntry.findMany({
      where: { firmId: firm.id, voucherNumber: { startsWith: `${firm.invoicePrefix}/${fy}/JOU/` } },
      select: { voucherNumber: true },
    });
    const maxSeq = existing.reduce((m, v) => {
      const n = parseInt(v.voucherNumber.split("/")[3] ?? "0", 10);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const voucherNumber = `${firm.invoicePrefix}/${fy}/JOU/${String(maxSeq + 1).padStart(4, "0")}`;
    await db.journalEntry.create({
      data: {
        firmId: firm.id,
        voucherNumber,
        voucherType: "JOURNAL",
        postingDate: now,
        narration: "Demo reset — inventory asset cleared to match zero physical stock",
        totalDebit: Math.abs(invBalance),
        totalCredit: Math.abs(invBalance),
        lines: {
          create:
            invBalance > 0
              ? [
                  { accountId: (await acc(firm.id, "5500")).id, accountName: "Damaged Stock Write-Off", entrySide: "DEBIT", debitAmount: invBalance, creditAmount: 0, narration: "Stock cleared for demo restart" },
                  { accountId: invAccount.id, accountName: invAccount.accountName, entrySide: "CREDIT", debitAmount: 0, creditAmount: invBalance, narration: "Inventory asset released" },
                ]
              : [
                  { accountId: invAccount.id, accountName: invAccount.accountName, entrySide: "DEBIT", debitAmount: -invBalance, creditAmount: 0, narration: "Inventory asset corrected" },
                  { accountId: (await acc(firm.id, "3100")).id, accountName: "Retained Earnings", entrySide: "CREDIT", debitAmount: 0, creditAmount: -invBalance, narration: "Negative inventory corrected" },
                ],
        },
      },
    });
    console.log(`Inventory GL cleared: ₹${invBalance.toFixed(2)} → ₹0.00 (journal ${voucherNumber})`);
  } else {
    console.log("Inventory GL already at ₹0.00 — no reset journal needed");
  }

  const total = await db.product.count({ where: { firmId: firm.id } });
  const withStock = await db.product.count({ where: { firmId: firm.id, stockQuantity: { gt: 0 } } });
  console.log(`DONE — catalog ${total} products, ${withStock} with stock (expected 0)`);
}

async function acc(firmId: string, code: string) {
  const a = await db.chartOfAccount.findFirst({ where: { firmId, accountCode: code } });
  if (!a) throw new Error(`Account ${code} missing in COA`);
  return a;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
