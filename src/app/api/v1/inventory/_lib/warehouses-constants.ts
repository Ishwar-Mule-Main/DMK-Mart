// Shared warehouse constants (kept out of route files so Next.js
// route exports stay clean).

export const WAREHOUSE_TYPES = ["MAIN", "SATELLITE", "TRANSIT", "QC_DAMAGED", "FRANCHISE"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];
