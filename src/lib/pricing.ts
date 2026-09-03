// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PRICING ENGINE
// 5-tier pricing + quantity-based bulk/packaging discounts (SALES only)
// Tier order invariant: T1 ≤ T2 ≤ T3 ≤ T4 ≤ T5
// ═══════════════════════════════════════════════════════════════

import { round2 } from "./gst";

export const TIERS = [
  { key: "tier1Distributor", label: "Distributor" },
  { key: "tier2Wholesale", label: "Wholesale" },
  { key: "tier3SemiWholesale", label: "Semi-Wholesale" },
  { key: "tier4Retailer", label: "Retailer" },
  { key: "tier5Mrp", label: "MRP" },
] as const;

export type TierKey = (typeof TIERS)[number]["key"];

export const PACKAGING_RULES: Array<{ format: string; minQty: number; discountPct: number; multiplier: number }> = [
  { format: "MASTER_LOT_50", minQty: 50, discountPct: 20, multiplier: 50 },
  { format: "CRATE_24", minQty: 24, discountPct: 15, multiplier: 24 },
  { format: "BOX_12", minQty: 12, discountPct: 12, multiplier: 12 },
  { format: "SET_10", minQty: 10, discountPct: 8, multiplier: 10 },
  { format: "PACKET_5", minQty: 5, discountPct: 5, multiplier: 5 },
  { format: "PIECE", minQty: 1, discountPct: 0, multiplier: 1 },
];

export function formatLabel(format: string): string {
  switch (format) {
    case "MASTER_LOT_50": return "Master Lot (50+)";
    case "CRATE_24": return "Crate (24)";
    case "BOX_12": return "Box (12)";
    case "SET_10": return "Set (10)";
    case "PACKET_5": return "Packet (5)";
    default: return "Piece";
  }
}

export interface BulkPricingResult {
  format: string;
  discountPct: number;
  unitPrice: number;
  taxable: number;
  savings: number;
}

/**
 * Effective price = tierPrice × (1 − pkg%) × (1 − manual%)
 * taxable = round2(unitPrice × qty)
 */
export function calculateBulkPricing(
  tierPrice: number,
  quantity: number,
  manualDiscountPct: number = 0
): BulkPricingResult {
  let format = "PIECE";
  let discountPct = 0;
  for (const rule of PACKAGING_RULES) {
    if (quantity >= rule.minQty) {
      format = rule.format;
      discountPct = rule.discountPct;
      break;
    }
  }
  const unitPrice = round2(
    tierPrice * (1 - discountPct / 100) * (1 - manualDiscountPct / 100)
  );
  const taxable = round2(unitPrice * quantity);
  const savings = round2(tierPrice * quantity - taxable);
  return { format, discountPct, unitPrice, taxable, savings };
}

/** Validate ascending tier pricing invariant. Returns error message or null. */
export function validateTierOrder(t: {
  tier1Distributor: number;
  tier2Wholesale: number;
  tier3SemiWholesale: number;
  tier4Retailer: number;
  tier5Mrp: number;
}): string | null {
  if (t.tier1Distributor > t.tier2Wholesale)
    return "Tier 1 (Distributor) cannot be greater than Tier 2 (Wholesale)";
  if (t.tier2Wholesale > t.tier3SemiWholesale)
    return "Tier 2 (Wholesale) cannot be greater than Tier 3 (Semi-Wholesale)";
  if (t.tier3SemiWholesale > t.tier4Retailer)
    return "Tier 3 (Semi-Wholesale) cannot be greater than Tier 4 (Retailer)";
  if (t.tier4Retailer > t.tier5Mrp)
    return "Tier 4 (Retailer) cannot be greater than Tier 5 (MRP)";
  return null;
}
