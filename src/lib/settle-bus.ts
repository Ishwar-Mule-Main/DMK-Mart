"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SETTLE BUS (cycle 15)
// Cross-view handoff for "Settle/Pay" deep links from Party Ledgers
// into the receipt/payment dialogs. Combines a live window event
// (works when the target view is already mounted) with a one-shot
// pending slot consumed on mount (works right after setView).
// ═══════════════════════════════════════════════════════════════

let pendingCustomer: string | null = null;
let pendingVendor: string | null = null;

/** Fire a settle request for a customer (receipts dialog). */
export function requestSettleCustomer(partyId: string): void {
  pendingCustomer = partyId;
  window.dispatchEvent(
    new CustomEvent("dmk:settle-party", { detail: { partyId } })
  );
}

/** Fire a settle request for a vendor (payments dialog). */
export function requestSettleVendor(partyId: string): void {
  pendingVendor = partyId;
  window.dispatchEvent(
    new CustomEvent("dmk:settle-vendor", { detail: { partyId } })
  );
}

/** One-shot consume — called on mount of the target view. */
export function consumePendingCustomer(): string | null {
  const v = pendingCustomer;
  pendingCustomer = null;
  return v;
}

/** One-shot consume — called on mount of the target view. */
export function consumePendingVendor(): string | null {
  const v = pendingVendor;
  pendingVendor = null;
  return v;
}
