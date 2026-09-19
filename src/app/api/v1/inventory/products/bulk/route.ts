// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/products/bulk — bulk add products (portal
// authority). Accepts CSV text or a rows[] JSON array.
//   { csv: "..." , commit: false } → dry-run validation report
//   { csv: "...", commit: true }   → upsert by SKU, opening stock
//     lands on the named (or default) warehouse via the invariant
//     keeper; every image gets the canonical file name stamp.
// Columns: sku,name,brand,category,unit,hsnCode,gstRate,purchaseCost,
//   tier1Distributor,tier2Wholesale,tier3SemiWholesale,tier4Retailer,
//   tier5Mrp,openingStock,openingDamagedStock,lowStockThreshold,
//   piecesPerBox,barcode,photoUrl,warehouseCode
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import { asRecord, asRecordArray, BusinessError, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { applyWarehouseDelta, canonicalImageFileName, ensureDefaultWarehouse } from "@/app/api/v1/inventory/_lib/inventory";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const COLUMNS = [
  "sku", "name", "brand", "category", "unit", "hsnCode", "gstRate",
  "purchaseCost", "tier1Distributor", "tier2Wholesale", "tier3SemiWholesale", "tier4Retailer", "tier5Mrp",
  "openingStock", "openingDamagedStock", "lowStockThreshold", "piecesPerBox", "barcode", "photoUrl", "warehouseCode",
] as const;

/** RFC-4180-ish CSV parse: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function csvToRows(text: string): Record<string, string>[] {
  const grid = parseCsv(text);
  if (grid.length < 2) return [];
  const header = grid[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
  return grid.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

interface ParsedRow {
  rowNumber: number;
  sku: string; name: string; brand: string; category: string; unit: string; hsnCode: string;
  gstRate: number; purchaseCost: number;
  tier1Distributor: number; tier2Wholesale: number; tier3SemiWholesale: number; tier4Retailer: number; tier5Mrp: number;
  openingStock: number; openingDamagedStock: number; lowStockThreshold: number;
  piecesPerBox: number; barcode: string; photoUrl: string; warehouseCode: string;
}

export async function POST(req: NextRequest) {
  try {
    const { session, firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const commit = body.commit === true;

    let raw: Record<string, unknown>[] = [];
    if (getStr(body.csv)) {
      raw = csvToRows(getStr(body.csv));
    } else if (Array.isArray(body.rows)) {
      raw = asRecordArray(body.rows);
    }
    if (raw.length === 0) throw new BusinessError("ERR_VALIDATION", "No rows found — paste CSV or send rows[]", 422);
    if (raw.length > 2000) throw new BusinessError("ERR_VALIDATION", "Maximum 2000 rows per batch", 422);

    await ensureDefaultWarehouse(firm.id);
    const warehouseList = await db.warehouse.findMany({ where: { firmId: firm.id }, select: { id: true, code: true } });
    const whByCode = new Map(warehouseList.map((w) => [w.code.toUpperCase(), w.id]));
    const existing = await db.product.findMany({
      where: { firmId: firm.id },
      select: { sku: true, id: true, stockQuantity: true, brand: true, name: true, photoUrl: true },
    });
    const bySku = new Map(existing.map((p) => [p.sku, p]));

    const valid: ParsedRow[] = [];
    const invalid: Array<{ rowNumber: number; sku: string; errors: string[] }> = [];

    raw.forEach((r, idx) => {
      const rowNumber = idx + 2; // +1 header, +1 human numbering
      const errors: string[] = [];
      const sku = getStr(r.sku).trim();
      const name = getStr(r.name).trim();
      if (!sku) errors.push("sku is required");
      if (!name) errors.push("name is required");

      const gstRate = r.gstRate === "" || r.gstRate === undefined ? 18 : getNum(r.gstRate, 18);
      if (!ALLOWED_GST_RATES.includes(gstRate as (typeof ALLOWED_GST_RATES)[number])) {
        errors.push(`gstRate must be one of ${ALLOWED_GST_RATES.join(", ")}`);
      }
      const numerics = {
        purchaseCost: round2(getNum(r.purchaseCost, 0)),
        tier1Distributor: round2(getNum(r.tier1Distributor, 0)),
        tier2Wholesale: round2(getNum(r.tier2Wholesale, 0)),
        tier3SemiWholesale: round2(getNum(r.tier3SemiWholesale, 0)),
        tier4Retailer: round2(getNum(r.tier4Retailer, 0)),
        tier5Mrp: round2(getNum(r.tier5Mrp, 0)),
        openingStock: round2(getNum(r.openingStock, 0)),
        openingDamagedStock: round2(getNum(r.openingDamagedStock, 0)),
        lowStockThreshold: round2(getNum(r.lowStockThreshold, 0)),
      };
      if (numerics.openingStock < 0 || numerics.openingDamagedStock < 0) errors.push("opening stock cannot be negative");
      const tierError = validateTierOrder(numerics);
      if (tierError) errors.push(tierError);

      const warehouseCode = getStr(r.warehouseCode).trim().toUpperCase();
      let warehouseId = "";
      if (warehouseCode) {
        warehouseId = whByCode.get(warehouseCode) ?? "";
        if (!warehouseId) errors.push(`warehouseCode ${warehouseCode} not found`);
      }

      if (errors.length === 0 && sku) {
        const dup = bySku.get(sku);
        if (dup) errors.push(`SKU ${sku} already exists`);
        else bySku.set(sku, { sku, id: "pending", stockQuantity: 0, brand: "", name: "", photoUrl: null }); // guard intra-batch dupes
      }
      if (errors.length === 0 && sku && name) {
        valid.push({
          rowNumber, sku, name,
          brand: getStr(r.brand).trim() || firm.firmName,
          category: getStr(r.category).trim() || "General",
          unit: getStr(r.unit).trim() || "Pcs",
          hsnCode: getStr(r.hsnCode).trim() || "3924",
          gstRate, ...numerics,
          piecesPerBox: Math.max(1, Math.round(getNum(r.piecesPerBox, 1))),
          barcode: getStr(r.barcode).trim(),
          photoUrl: getStr(r.photoUrl).trim(),
          warehouseCode,
        });
        void warehouseId;
      } else {
        invalid.push({ rowNumber, sku: sku || "(missing)", errors });
      }
    });

    if (!commit) {
      return ok({ mode: "DRY_RUN", totalRows: raw.length, validCount: valid.length, invalidCount: invalid.length, invalid, validPreview: valid.slice(0, 5) });
    }

    const defaultWh = await ensureDefaultWarehouse(firm.id);
    let created = 0;
    const failed: Array<{ rowNumber: number; sku: string; error: string }> = [];
    for (const row of valid) {
      try {
        await db.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              firmId: firm.id,
              sku: row.sku,
              name: row.name,
              brand: row.brand,
              category: row.category,
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
              piecesPerBox: row.piecesPerBox,
              barcode: row.barcode || null,
              photoUrl: row.photoUrl || null,
              imageFileName: canonicalImageFileName(row.brand, row.name, row.photoUrl || null),
              imageVerified: row.photoUrl ? "PENDING" : "NO_IMAGE",
              // applied via the invariant keeper below — create at 0
              stockQuantity: 0,
              damagedStock: 0,
              sourcePortal: "INVENTORY",
            },
          });
          if (row.openingStock > 0 || row.openingDamagedStock > 0) {
            await applyWarehouseDelta({
              firmId: firm.id,
              productId: product.id,
              warehouseId: (row.warehouseCode && whByCode.get(row.warehouseCode)) || defaultWh.id,
              sellableDelta: row.openingStock,
              damagedDelta: row.openingDamagedStock,
              movementType: "OPENING",
              notes: `Bulk import (by ${session.username})`,
              client: tx,
            });
          }
        });
        created += 1;
      } catch (e) {
        failed.push({ rowNumber: row.rowNumber, sku: row.sku, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return ok({
      mode: "COMMIT",
      totalRows: raw.length,
      created,
      invalidCount: invalid.length,
      failedCount: failed.length,
      invalid: invalid.slice(0, 50),
      failed: failed.slice(0, 50),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
