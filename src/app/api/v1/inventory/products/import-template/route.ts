// GET /api/v1/inventory/products/import-template — CSV template for
// bulk adds (all 20 columns documented, one example row).

import { NextRequest } from "next/server";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const HEADER = "sku,name,brand,category,unit,hsnCode,gstRate,purchaseCost,tier1Distributor,tier2Wholesale,tier3SemiWholesale,tier4Retailer,tier5Mrp,openingStock,openingDamagedStock,lowStockThreshold,piecesPerBox,barcode,photoUrl,warehouseCode";

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const csv = [
      HEADER,
      `DMK-PL-9001,DMK Polymers Palace Planter 12 inch,DMK Polymers,Planters,Pcs,3924,18,180,260,220,200,240,320,120,0,20,6,,"https://res.cloudinary.com/dmkmart/image/upload/f_auto,q_auto/v1/dmk-mart/products/palace-planter.webp",WH-MAIN`,
      `# Columns: sku+name required · brand defaults to ${firm.firmName} · openingStock lands on warehouseCode (or the default warehouse) · photoUrl is the public image URL`,
    ].join("\n");
    return ok({ csv, columns: HEADER.split(",") });
  } catch (e) {
    return handleApiError(e);
  }
}
