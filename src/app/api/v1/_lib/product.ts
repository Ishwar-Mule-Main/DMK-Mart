// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PRODUCT VALIDATION HELPERS (R12 tier invariant, GST)
// ═══════════════════════════════════════════════════════════════

import { ALLOWED_GST_RATES, round2 } from "@/lib/gst";
import { validateTierOrder } from "@/lib/pricing";
import { BusinessError } from "./api";

export interface ProductNumericInput {
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
}

/**
 * Shared validation for product create / update / bulk rows.
 * Throws BusinessError with the canonical error codes.
 */
export function validateProductBusinessRules(input: ProductNumericInput): void {
  if (!ALLOWED_GST_RATES.includes(input.gstRate as (typeof ALLOWED_GST_RATES)[number])) {
    throw new BusinessError(
      "ERR_INVALID_GST_RATE",
      `GST rate must be one of ${ALLOWED_GST_RATES.join(", ")} (got ${input.gstRate})`,
      422
    );
  }
  const tierError = validateTierOrder({
    tier1Distributor: input.tier1Distributor,
    tier2Wholesale: input.tier2Wholesale,
    tier3SemiWholesale: input.tier3SemiWholesale,
    tier4Retailer: input.tier4Retailer,
    tier5Mrp: input.tier5Mrp,
  });
  if (tierError) {
    throw new BusinessError("ERR_INVALID_TIER_HIERARCHY", tierError, 422);
  }
  const negatives: Array<[string, number]> = [
    ["purchaseCost", input.purchaseCost],
    ["tier1Distributor", input.tier1Distributor],
    ["tier2Wholesale", input.tier2Wholesale],
    ["tier3SemiWholesale", input.tier3SemiWholesale],
    ["tier4Retailer", input.tier4Retailer],
    ["tier5Mrp", input.tier5Mrp],
    ["openingStock", input.openingStock],
    ["openingDamagedStock", input.openingDamagedStock],
    ["lowStockThreshold", input.lowStockThreshold],
  ];
  for (const [field, value] of negatives) {
    if (value < 0) {
      throw new BusinessError("ERR_NEGATIVE_STOCK", `${field} cannot be negative`, 422);
    }
  }
}

export function roundProductNumerics(input: ProductNumericInput): ProductNumericInput {
  return {
    gstRate: input.gstRate,
    purchaseCost: round2(input.purchaseCost),
    tier1Distributor: round2(input.tier1Distributor),
    tier2Wholesale: round2(input.tier2Wholesale),
    tier3SemiWholesale: round2(input.tier3SemiWholesale),
    tier4Retailer: round2(input.tier4Retailer),
    tier5Mrp: round2(input.tier5Mrp),
    openingStock: round2(input.openingStock),
    openingDamagedStock: round2(input.openingDamagedStock),
    lowStockThreshold: round2(input.lowStockThreshold),
  };
}
