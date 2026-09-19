import type { Metadata } from "next";
import { InvApp } from "@/components/inventory/inv-app";

// ═══════════════════════════════════════════════════════════════
// /inventory — UNIVERSAL INVENTORY MANAGEMENT PORTAL
// A separate DMK product: one shared product catalog + warehouse
// stocking for every platform (ERP · B2B store · Franchise/B2C).
// Own login (ID: Kunal · pbkdf2-hashed password), own shell — the
// ERP portal never renders here.
// ═══════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "DMK Universal Inventory",
  robots: { index: false, follow: false },
};

export default function InventoryPortalPage() {
  return <InvApp />;
}
