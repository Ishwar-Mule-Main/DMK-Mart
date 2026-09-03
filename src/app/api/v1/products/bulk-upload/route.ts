// ═══════════════════════════════════════════════════════════════
// /api/v1/products/bulk-upload — CSV import (R2)
// commit=false → dry-run validation report
// commit=true  → upsert valid rows by (firmId, sku); opening stock is
//                only applied on CREATE (updates never touch stock)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import {
  asRecord,
  asRecordArray,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { recordMovement } from "@/app/api/v1/_lib/party";

interface ParsedRow {
  rowNumber: number;
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
  openingStock: number;
  openingDamagedStock: number;
  lowStockThreshold: number;
  weightGrams: number | null;
  barcode: string;
}

interface InvalidRow {
  rowNumber: number;
  sku: string;
  errors: string[];
}

function parseNumeric(raw: unknown): number | null {
  if (raw === undefined || raw === null || getStr(raw) === "") return 0;
  const n = Number(getStr(raw));
  return Number.isFinite(n) ? n : null;
}

function validateRow(row: Record<string, unknown>, rowNumber: number, seenSkus: Set<string>): { parsed?: ParsedRow; errors: string[] } {
  const errors: string[] = [];
  const sku = getStr(row["SKU"]).toUpperCase();
  const name = getStr(row["Product Name"]);

  if (!sku) errors.push("SKU is required");
  if (!name) errors.push("Product Name is required");
  if (sku && seenSkus.has(sku)) errors.push(`Duplicate SKU "${sku}" within the uploaded file`);
  if (sku) seenSkus.add(sku);

  const num = (field: string, required = false): number => {
    const v = parseNumeric(row[field]);
    if (v === null) {
      errors.push(`${field} is not a valid number`);
      return 0;
    }
    if (required && v === 0 && field.startsWith("Price_")) {
      // zero prices are allowed at upload time (edited later) — no error
    }
    return v;
  };

  const gstRateRaw = row["GST Rate (%)"];
  const gstRate = parseNumeric(gstRateRaw);
  if (gstRate === null) {
    errors.push("GST Rate (%) is not a valid number");
  } else if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
    errors.push(`GST Rate (%) must be one of ${ALLOWED_GST_RATES.join(", ")}`);
  }

  const purchaseCost = num("Purchase Cost");
  const tier1 = num("Price_Tier1_Distributor");
  const tier2 = num("Price_Tier2_Wholesale");
  const tier3 = num("Price_Tier3_SemiWholesale");
  const tier4 = num("Price_Tier4_Retailer");
  const tier5 = num("Price_Tier5_MRP");

  const tierError = validateTierOrder({
    tier1Distributor: tier1,
    tier2Wholesale: tier2,
    tier3SemiWholesale: tier3,
    tier4Retailer: tier4,
    tier5Mrp: tier5,
  });
  if (tierError) errors.push(tierError);

  const openingStock = num("Opening Stock");
  const openingDamagedStock = num("Opening Damaged Stock");
  const lowStockThreshold = num("Low Stock Threshold");
  if (openingStock < 0) errors.push("Opening Stock cannot be negative");
  if (openingDamagedStock < 0) errors.push("Opening Damaged Stock cannot be negative");
  if (lowStockThreshold < 0) errors.push("Low Stock Threshold cannot be negative");
  if (purchaseCost < 0) errors.push("Purchase Cost cannot be negative");
  if (tier1 < 0 || tier2 < 0 || tier3 < 0 || tier4 < 0 || tier5 < 0) {
    errors.push("Tier prices cannot be negative");
  }

  const weightRaw = parseNumeric(row["Weight (g)"]);
  if (weightRaw !== null && weightRaw < 0) errors.push("Weight (g) cannot be negative");

  if (errors.length > 0) return { errors };

  return {
    errors,
    parsed: {
      rowNumber,
      sku,
      name,
      category: getStr(row["Category"]) || "General",
      brand: getStr(row["Brand/Manufacturer"]),
      unit: getStr(row["Unit"]) || "Pcs",
      hsnCode: getStr(row["HSN Code"]) || "3924",
      gstRate: gstRate ?? 18,
      purchaseCost: round2(purchaseCost),
      tier1Distributor: round2(tier1),
      tier2Wholesale: round2(tier2),
      tier3SemiWholesale: round2(tier3),
      tier4Retailer: round2(tier4),
      tier5Mrp: round2(tier5),
      openingStock: round2(openingStock),
      openingDamagedStock: round2(openingDamagedStock),
      lowStockThreshold: round2(lowStockThreshold),
      weightGrams: weightRaw,
      barcode: getStr(row["Barcode"]),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const commit = body.commit === true;

    const rawRows = asRecordArray(body.rows);
    if (rawRows.length === 0) {
      return ok({ totalRows: 0, validRows: [], invalidRows: [], created: 0, updated: 0, failed: 0, errors: [] });
    }

    const seenSkus = new Set<string>();
    const validRows: ParsedRow[] = [];
    const invalidRows: InvalidRow[] = [];

    rawRows.forEach((row, idx) => {
      const { parsed, errors } = validateRow(row, idx + 1, seenSkus);
      if (parsed) validRows.push(parsed);
      else invalidRows.push({ rowNumber: idx + 1, sku: getStr(row["SKU"]), errors });
    });

    if (!commit) {
      return ok({
        totalRows: rawRows.length,
        validRows: validRows.map((r) => ({ ...r, status: "VALID" as const })),
        invalidRows,
      });
    }

    // Commit: upsert valid rows by (firmId, sku)
    const existing = await db.product.findMany({
      where: { firmId: firm.id, sku: { in: validRows.map((r) => r.sku) } },
      select: { id: true, sku: true },
    });
    const existingBySku = new Map(existing.map((p) => [p.sku, p.id]));

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      try {
        const existingId = existingBySku.get(row.sku);
        if (existingId) {
          // Update — prices/threshold/cost/descriptive fields ONLY (never stock)
          await db.product.update({
            where: { id: existingId },
            data: {
              name: row.name,
              category: row.category,
              brand: row.brand,
              unit: row.unit,
              hsnCode: row.hsnCode,
              gstRate: row.gstRate,
              purchaseCost: row.purchaseCost,
              tier1Distributor: row.tier1Distributor,
              tier2Wholesale: row.tier2Wholesale,
              tier3SemiWholesale: row.tier3SemiWholesale,
              tier4Retailer: row.tier4Retailer,
              tier5Mrp: row.tier5Mrp,
              lowStockThreshold: row.lowStockThreshold,
              weightGrams: row.weightGrams,
              barcode: row.barcode || null,
              isActive: true,
            },
          });
          updated++;
        } else {
          const product = await db.product.create({
            data: {
              firmId: firm.id,
              sku: row.sku,
              name: row.name,
              category: row.category,
              brand: row.brand,
              unit: row.unit,
              hsnCode: row.hsnCode,
              gstRate: row.gstRate,
              purchaseCost: row.purchaseCost,
              tier1Distributor: row.tier1Distributor,
              tier2Wholesale: row.tier2Wholesale,
              tier3SemiWholesale: row.tier3SemiWholesale,
              tier4Retailer: row.tier4Retailer,
              tier5Mrp: row.tier5Mrp,
              stockQuantity: row.openingStock,
              damagedStock: row.openingDamagedStock,
              lowStockThreshold: row.lowStockThreshold,
              weightGrams: row.weightGrams,
              barcode: row.barcode || null,
              isActive: true,
            },
          });
          created++;
          if (row.openingStock > 0) {
            await recordMovement(db, {
              firmId: firm.id,
              productId: product.id,
              movementType: "OPENING",
              quantity: row.openingStock,
              targetPool: "SELLABLE",
              direction: "IN",
              referenceNo: "BULK-UPLOAD",
              notes: `Opening sellable stock from CSV import (${row.sku})`,
            });
          }
          if (row.openingDamagedStock > 0) {
            await recordMovement(db, {
              firmId: firm.id,
              productId: product.id,
              movementType: "OPENING",
              quantity: row.openingDamagedStock,
              targetPool: "DAMAGED",
              direction: "IN",
              referenceNo: "BULK-UPLOAD",
              notes: `Opening damaged stock from CSV import (${row.sku})`,
            });
          }
        }
      } catch (rowError) {
        errors.push(
          `Row ${row.rowNumber} (${row.sku}): ${rowError instanceof Error ? rowError.message : "unknown error"}`
        );
      }
    }

    return ok({
      created,
      updated,
      failed: invalidRows.length + errors.length,
      invalidRows,
      errors,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
