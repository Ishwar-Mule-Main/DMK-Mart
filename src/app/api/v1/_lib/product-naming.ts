// ═══════════════════════════════════════════════════════════════
// PRODUCT NAMING + MANUFACTURER SCOPING HELPERS (R10)
// · Products made by a MANUFACTURER vendor are named
//   "<Vendor name> <Product>" so vendor stock is obvious everywhere.
// · PO product scoping: a MANUFACTURER vendor only sees its own
//   products (manufacturerVendorId link); a DISTRIBUTOR sees all.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";

/**
 * Prefix a product name with the vendor's name unless it already
 * starts with it (idempotent). "Bucket 20L" + "DMK Polymers Pvt Ltd"
 * → "DMK Polymers Bucket 20L" (legal suffixes are trimmed for the
 * display prefix so names stay readable).
 */
export function ensureVendorPrefixedName(productName: string, vendorName: string): string {
  const cleanVendor = vendorName.trim();
  if (!cleanVendor) return productName.trim();

  // Short display form: strip trailing legal suffixes —
  // "DMK Polymers Pvt Ltd" → "DMK Polymers"
  const shortVendor = cleanVendor
    .replace(/\s+(pvt\.?|private|ltd\.?|limited|llp|industries|traders|distributors|co\.?|company)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || cleanVendor;

  const name = productName.trim();
  if (
    name.toLowerCase().startsWith(shortVendor.toLowerCase()) ||
    name.toLowerCase().startsWith(cleanVendor.toLowerCase())
  ) {
    return name; // already vendor-prefixed
  }
  return `${shortVendor} ${name}`;
}

export interface VendorScopeResult {
  vendor: {
    id: string;
    vendorName: string;
    vendorType: string;
    brand: string;
  } | null;
}

/**
 * Resolve + validate a manufacturerVendorId for product create/update.
 * The vendor must exist in the same firm and be a MANUFACTURER.
 * Returns null when no id given (vendor-managed via distributors).
 */
export async function resolveManufacturerVendor(
  firmId: string,
  manufacturerVendorId: unknown
): Promise<VendorScopeResult["vendor"]> {
  const id = typeof manufacturerVendorId === "string" ? manufacturerVendorId.trim() : "";
  if (!id) return null;
  const vendor = await db.vendor.findFirst({ where: { id, firmId } });
  if (!vendor) {
    throw Object.assign(new Error("Vendor not found for this firm"), { status: 404 });
  }
  if (vendor.vendorType !== "MANUFACTURER") {
    throw Object.assign(new Error("Only MANUFACTURER vendors can own products"), { status: 422 });
  }
  return { id: vendor.id, vendorName: vendor.vendorName, vendorType: vendor.vendorType, brand: vendor.brand };
}

/**
 * PO picker rule (R10 + vendor-specific scoping):
 * · MANUFACTURER vendor → ONLY products it manufactures (direct link,
 *   falling back to the legacy brand match).
 * · DISTRIBUTOR vendor → ALL active products.
 */
export function vendorProductFilter<T extends { manufacturerVendorId?: string | null; brand?: string }>(
  products: T[],
  vendor: { vendorType: string; brand: string; id: string } | null | undefined
): T[] {
  if (!vendor || vendor.vendorType !== "MANUFACTURER") return products;
  const brand = (vendor.brand ?? "").toLowerCase();
  return products.filter(
    (p) =>
      p.manufacturerVendorId === vendor.id ||
      (!!brand && (p.brand ?? "").toLowerCase() === brand)
  );
}
