// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY API — key auth + shared response shaping
// External platforms (DMK Mart ERP · B2B store · Franchise/B2C)
// call /api/universal/v1/* with their X-API-Key header.
//
// GOLDEN RULE enforced here: the universal API NEVER exposes
// warehouse placement. Stock answers are TOTALS ONLY. Warehouse
// targeting from external platforms is refused — deltas land on
// the firm's default warehouse.
// ═══════════════════════════════════════════════════════════════

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { round2 } from "@/lib/gst";
import { BusinessError } from "@/app/api/v1/_lib/api";

export const UNIVERSAL_API_VERSION = "1.0.0";

export function generateApiKey(): string {
  return `dmk_inv_${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Resolve the calling portal from the X-API-Key header. Throws 401/403 on failure. */
export async function requirePortal(req: Request) {
  const key = req.headers.get("x-api-key") ?? "";
  if (!key) {
    throw new BusinessError("ERR_UNAUTHORIZED", "Missing X-API-Key header — see the /inventory Setup Guide", 401);
  }
  const portal = await db.integrationPortal.findUnique({ where: { apiKey: hashApiKey(key) } });
  if (!portal) {
    throw new BusinessError("ERR_UNAUTHORIZED", "Unknown API key — check it in the inventory portal Integrations tab", 401);
  }
  if (portal.status !== "ACTIVE") {
    throw new BusinessError("ERR_PORTAL_SUSPENDED", `Portal "${portal.name}" is ${portal.status.toLowerCase()}`, 403);
  }
  const firm = await db.firm.findUnique({ where: { id: portal.firmId } });
  if (!firm) throw new BusinessError("ERR_FIRM_NOT_FOUND", "Firm not found", 404);
  return { portal, firm };
}

/** Touch the portal's sync heartbeat after a successful API interaction. */
export async function touchPortalSync(portalId: string, status: "OK" | "ERROR" | "PARTIAL", message = "") {
  try {
    await db.integrationPortal.update({
      where: { id: portalId },
      data: { lastSyncAt: new Date(), lastSyncStatus: status, lastSyncMessage: message.slice(0, 400) },
    });
  } catch {
    // heartbeat must never break the API response
  }
}

/** The ONLY stock shape the outside world may see — totals, never placement. */
export function publicStockView(p: {
  stockQuantity: number; reservedQty: number; damagedStock: number; lowStockThreshold: number;
}) {
  const totalSellable = round2(p.stockQuantity);
  return {
    totalStock: totalSellable,
    availableStock: round2(totalSellable - p.reservedQty),
    reservedStock: round2(p.reservedQty),
    damagedStock: round2(p.damagedStock),
    lowStock: p.lowStockThreshold > 0 && totalSellable <= p.lowStockThreshold,
    note: "Totals only — warehouse placement is private to the Universal Inventory portal",
  };
}

/** Public product shape for external platforms. */
export function publicProductView(p: {
  sku: string; name: string; brand: string; category: string; unit: string;
  hsnCode: string; gstRate: number;
  tier1Distributor: number; tier2Wholesale: number; tier3SemiWholesale: number; tier4Retailer: number; tier5Mrp: number;
  piecesPerBox: number; barcode: string | null; photoUrl: string | null;
  imageFileName: string; imageVerified: string; sourcePortal: string; isActive: boolean;
  updatedAt: Date;
  stockQuantity: number; reservedQty: number; damagedStock: number; lowStockThreshold: number;
}) {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    category: p.category,
    unit: p.unit,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate,
    pricing: {
      tier1Distributor: p.tier1Distributor,
      tier2Wholesale: p.tier2Wholesale,
      tier3SemiWholesale: p.tier3SemiWholesale,
      tier4Retailer: p.tier4Retailer,
      mrp: p.tier5Mrp,
    },
    piecesPerBox: p.piecesPerBox,
    barcode: p.barcode,
    image: {
      url: p.photoUrl,
      fileName: p.imageFileName, // canonical "Brand Name + Product Name" file name
      verified: p.imageVerified,
    },
    sourcePortal: p.sourcePortal,
    isActive: p.isActive,
    updatedAt: p.updatedAt.toISOString(),
    stock: publicStockView(p),
  };
}
