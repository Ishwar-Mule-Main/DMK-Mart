// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — STAGED ORDER SHAPING (deep-scan pipeline helpers)
// Shared by every /api/v1/sales-orders/staged route: matching on
// upload, detail shaping (matched masters + live availability) and
// the tier-price lock used when the order books.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { BusinessError } from "./api";
import { round2 } from "@/lib/gst";
import {
  CUSTOMER_AUTO_THRESHOLD,
  matchCustomer,
  matchProduct,
  type CustomerMatchCandidate,
} from "./orderMatching";
import type { ExtractedOrder } from "./orderScan";

// ─── Matching on upload ──────────────────────────────────────────

export async function matchAndLinkCustomer(firmId: string, extraction: ExtractedOrder) {
  const customers = await db.customer.findMany({
    where: { firmId, isActive: true },
    select: {
      id: true,
      partyName: true,
      firmName: true,
      phone: true,
      gstin: true,
      city: true,
      assignedTier: true,
      creditLimit: true,
      closingBalance: true,
      customerType: true,
    },
  });
  const match = matchCustomer(
    { businessName: extraction.businessName, phone: extraction.phone, gstin: extraction.gstin },
    customers as CustomerMatchCandidate[]
  );
  return {
    matchedCustomerId: match.confidence >= CUSTOMER_AUTO_THRESHOLD ? match.customer?.id ?? null : null,
    method: match.confidence >= CUSTOMER_AUTO_THRESHOLD ? match.method : "",
    score: match.confidence,
    matchedCustomer: match.confidence >= CUSTOMER_AUTO_THRESHOLD ? match.customer : null,
  };
}

/** Run every extracted line through the product matcher against the live catalog. */
export async function matchExtractedItems(firmId: string, extraction: ExtractedOrder) {
  const products = await db.product.findMany({
    where: { firmId, isActive: true },
    select: { id: true, sku: true, name: true, category: true, unit: true, isActive: true },
  });
  return extraction.items.map((item, idx) => {
    const match = matchProduct(item.rawName, products);
    const auto = match.confidence >= 0.62;
    return {
      rawName: item.rawName,
      quantity: item.quantity,
      uom: item.uom,
      statedPrice: item.statedPrice,
      discountPercent: item.discountPercent,
      matchedSkuId: auto ? match.product?.id ?? null : null,
      isUnlisted: !auto,
      matchConfidence: match.confidence,
      matchMethod: auto ? match.method : "",
      linePosition: idx,
    };
  });
}

// ─── Detail shaping ──────────────────────────────────────────────

const TIER_PRICE_KEYS = [
  "tier1Distributor",
  "tier2Wholesale",
  "tier3SemiWholesale",
  "tier4Retailer",
  "tier5Mrp",
] as const;

export type TierKey = (typeof TIER_PRICE_KEYS)[number];

export function tierKeyOr(assignedTier: string | null | undefined): TierKey {
  return TIER_PRICE_KEYS.includes((assignedTier ?? "") as TierKey)
    ? (assignedTier as TierKey)
    : "tier4Retailer";
}

/** Price DMK Mart locks for a line: customer tier → stated (if lower) is the owner's call in staging. */
export function tierPriceFor(product: Record<string, unknown>, tier: TierKey): number {
  const p = product[tier];
  return typeof p === "number" && p > 0 ? p : ((product.tier4Retailer as number) ?? 0);
}

/** Shape one staged item with its matched product + live availability. */
function shapeItem(
  item: {
    id: string;
    rawName: string;
    quantity: number;
    uom: string;
    statedPrice: number;
    appliedPrice: number;
    discountPercent: number;
    isUnlisted: boolean;
    matchConfidence: number;
    matchMethod: string;
    linePosition: number;
    matchedSkuId: string | null;
  },
  productById: Map<
    string,
    {
      id: string;
      sku: string;
      name: string;
      unit: string;
      category: string;
      hsnCode: string;
      gstRate: number;
      stockQuantity: number;
      reservedQty: number;
      tier1Distributor: number;
      tier2Wholesale: number;
      tier3SemiWholesale: number;
      tier4Retailer: number;
      tier5Mrp: number;
      piecesPerBox: number;
    }
  >
) {
  const product = item.matchedSkuId ? productById.get(item.matchedSkuId) ?? null : null;
  const available = product ? round2(Math.max(0, product.stockQuantity - product.reservedQty)) : 0;
  return {
    id: item.id,
    rawName: item.rawName,
    quantity: item.quantity,
    uom: item.uom,
    statedPrice: item.statedPrice,
    appliedPrice: item.appliedPrice,
    discountPercent: item.discountPercent,
    isUnlisted: item.isUnlisted,
    matchConfidence: item.matchConfidence,
    matchMethod: item.matchMethod,
    linePosition: item.linePosition,
    matchedSkuId: item.matchedSkuId,
    product: product
      ? {
          id: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          category: product.category,
          hsnCode: product.hsnCode,
          gstRate: product.gstRate,
          // Stock is public inside the owner portal staging terminal;
          // purchase cost never leaves the server (sales-portal rule).
          stockQuantity: round2(product.stockQuantity),
          reservedQty: round2(product.reservedQty),
          available,
          tiers: {
            tier1Distributor: product.tier1Distributor,
            tier2Wholesale: product.tier2Wholesale,
            tier3SemiWholesale: product.tier3SemiWholesale,
            tier4Retailer: product.tier4Retailer,
            tier5Mrp: product.tier5Mrp,
          },
        }
      : null,
    available,
  };
}

export async function shapeStagedOrder(orderId: string) {
  const order = await db.stagedOrderUpload.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { linePosition: "asc" } },
      customer: {
        select: {
          id: true,
          partyName: true,
          firmName: true,
          phone: true,
          city: true,
          address: true,
          gstin: true,
          assignedTier: true,
          creditLimit: true,
          closingBalance: true,
          customerType: true,
        },
      },
    },
  });
  if (!order) throw new BusinessError("ERR_NOT_FOUND", "Staged order not found", 404);

  const productIds = order.items.map((i) => i.matchedSkuId).filter((x): x is string => Boolean(x));
  const products = productIds.length
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          category: true,
          hsnCode: true,
          gstRate: true,
          stockQuantity: true,
          reservedQty: true,
          tier1Distributor: true,
          tier2Wholesale: true,
          tier3SemiWholesale: true,
          tier4Retailer: true,
          tier5Mrp: true,
          piecesPerBox: true,
        },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const items = order.items.map((i) => shapeItem(i, productById));
  const subtotal = round2(items.reduce((s, i) => s + i.quantity * (i.appliedPrice > 0 ? i.appliedPrice : i.statedPrice), 0));

  return {
    id: order.id,
    source: order.source,
    status: order.status,
    originalFileName: order.originalFileName,
    originalFileType: order.originalFileType,
    hasFile: order.originalFileData.length > 0,
    scanModel: order.scanModel,
    scanNote: order.scanNote,
    extracted: {
      businessName: order.extractedBusinessName,
      contactPerson: order.extractedContactPerson,
      phone: order.extractedPhone,
      address: order.extractedAddress,
      city: order.extractedCity,
      gstin: order.extractedGstin,
    },
    customer: order.customer,
    customerMatchMethod: order.customerMatchMethod,
    customerMatchScore: order.customerMatchScore,
    confirmedSalesOrderId: order.confirmedSalesOrderId,
    confirmedAt: order.confirmedAt,
    createdAt: order.createdAt,
    items,
    subtotal,
    billDiscountPct: order.billDiscountPct,
    billDiscountAmt: order.billDiscountAmt,
    itemCount: items.length,
    unlistedCount: items.filter((i) => i.isUnlisted).length,
  };
}

/** Auto-generate a unique SKU for a quick-added catalog product. */
export async function generateUniqueSku(firmId: string, name: string): Promise<string> {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const base =
    (words[0]?.slice(0, 3) || "PRD") + (words[1]?.slice(0, 2) || "XX");
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}-${String(Math.floor(100 + Math.random() * 900))}`;
    const clash = await db.product.findFirst({ where: { firmId, sku: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString().slice(-6)}`;
}
