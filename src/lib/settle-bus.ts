"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — CROSS-VIEW HANDOFF BUS
// Cycle 15: "Settle/Pay" deep links from Party Ledgers into the
// receipt/payment dialogs. Cycle 16: aging-tab preset (dashboard
// overdue pulse → invoice-wise tab) and ledger-party preset
// (aging rows → preselected party ledger statement).
// Pattern: a live window event (works when the target view is
// already mounted) + a one-shot pending slot consumed on mount
// (works right after setView) — race-free in both orders.
// ═══════════════════════════════════════════════════════════════

let pendingCustomer: string | null = null;
let pendingVendor: string | null = null;
let pendingAgingTab: string | null = null;
let pendingLedgerParty: { partyType: "CUSTOMER" | "VENDOR"; partyId: string } | null = null;

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

/** Ask the aging view to open a specific tab ("ar" | "inv" | "ap" | "po"). */
export function requestAgingTab(tab: string): void {
  pendingAgingTab = tab;
  window.dispatchEvent(new CustomEvent("dmk:aging-tab", { detail: { tab } }));
}

/** Deep-link the party ledger to a specific party's statement. */
export function requestLedgerParty(
  partyType: "CUSTOMER" | "VENDOR",
  partyId: string
): void {
  pendingLedgerParty = { partyType, partyId };
  window.dispatchEvent(
    new CustomEvent("dmk:ledger-party", { detail: { partyType, partyId } })
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

/** One-shot consume — called on mount of the aging view. */
export function consumePendingAgingTab(): string | null {
  const v = pendingAgingTab;
  pendingAgingTab = null;
  return v;
}

/** One-shot consume — called on mount of the party-ledger view. */
export function consumePendingLedgerParty(): {
  partyType: "CUSTOMER" | "VENDOR";
  partyId: string;
} | null {
  const v = pendingLedgerParty;
  pendingLedgerParty = null;
  return v;
}
