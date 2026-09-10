"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — GLOBAL STORE (Zustand)
// Firm = account. Owner switches firms. Active view = SPA section.
// ═══════════════════════════════════════════════════════════════

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Firm } from "@/types/erp";

export type ViewId =
  | "dashboard"
  | "sales/billing"
  | "sales/b2c"
  | "sales/orders"
  | "sales/invoices"
  | "sales/returns"
  | "sales/customers"
  | "sales/receipts"
  | "sales/recurring"
  | "purchase/orders"
  | "purchase/new-order"
  | "purchase/verification"
  | "purchase/returns"
  | "purchase/vendors"
  | "purchase/payments"
  | "logistics/unassigned"
  | "logistics/planner"
  | "logistics/trips"
  | "logistics/drivers"
  | "sales/team"
  | "inventory/products"
  | "inventory/stock"
  | "inventory/movements"
  | "inventory/bulk-upload"
  | "inventory/low-stock"
  | "finance/journals"
  | "finance/coa"
  | "finance/expense-record"
  | "finance/expense-reports"
  | "finance/ledgers"
  | "finance/statements"
  | "finance/daybook"
  | "finance/aging"
  | "finance/sundry"
  | "finance/gstr2b"
  | "docs/invoices"
  | "docs/notes"
  | "reports"
  | "ai"
  | "data/deleted"
  | "settings";

// Signed-in persona. OWNER → full ERP shell; TEAM → verification portal;
// SALES → dedicated /sales workspace (sections gated by owner permissions).
export interface ErpSession {
  role: "OWNER" | "TEAM" | "SALES";
  firmId: string;
  firmName: string;
  staffId?: string;
  staffName?: string;
  staffUsername?: string;
  /** Portal role of the team member — VERIFIER | SUPERVISOR | DRIVER.
   *  Routes the team screen: DRIVER → delivery trip view, others → checkpoint. */
  staffRole?: string;
  /** /sales portal persona. */
  salesId?: string;
  salesName?: string;
  salesUsername?: string;
  /** Snapshot of the owner's section toggles for this member — the
   *  sidebar builds itself from these and every view re-checks them. */
  salesPerms?: SalesPermissions;
}

/** The 8 owner-controlled section switches for a /sales member. */
export interface SalesPermissions {
  canB2BBilling: boolean;
  canB2CPos: boolean;
  canSalesOrders: boolean;
  canManageCustomers: boolean;
  canViewStock: boolean;
  canViewInvoices: boolean;
  canRecordReceipts: boolean;
  canOverridePrice: boolean;
}

export const DEFAULT_SALES_PERMS: SalesPermissions = {
  canB2BBilling: true,
  canB2CPos: true,
  canSalesOrders: true,
  canManageCustomers: true,
  canViewStock: true,
  canViewInvoices: true,
  canRecordReceipts: false,
  canOverridePrice: false,
};

/** UI language — English, Hindi, Marathi. */
export type UiLanguage = "en" | "hi" | "mr";

interface ErpState {
  firms: Firm[];
  activeFirmId: string | null;
  financialYear: string;
  view: ViewId;
  /** Mobile drawer only — desktop is a hover-to-expand rail and ignores this. */
  sidebarOpen: boolean;
  notifications: number;
  session: ErpSession | null;
  /** Interface language, persisted per browser. */
  language: UiLanguage;
  /** Cross-view handoff: invoice ids ticked in Unassigned Orders, consumed (then cleared) by the Trip Planner. */
  plannerSeedInvoiceIds: string[];
  setFirms: (firms: Firm[]) => void;
  seedPlanner: (invoiceIds: string[]) => void;
  setActiveFirm: (id: string) => void;
  setFinancialYear: (fy: string) => void;
  setView: (v: ViewId) => void;
  setSidebarOpen: (open: boolean) => void;
  setNotifications: (n: number) => void;
  setSession: (s: ErpSession | null) => void;
  setLanguage: (l: UiLanguage) => void;
  logout: () => void;
}

export const useErpStore = create<ErpState>()(
  persist(
    (set, get) => ({
      firms: [],
      activeFirmId: null,
      financialYear: "",
      view: "dashboard",
      sidebarOpen: false,
      notifications: 0,
      session: null,
      language: "en",
      plannerSeedInvoiceIds: [],
      seedPlanner: (plannerSeedInvoiceIds) => set({ plannerSeedInvoiceIds }),
      setSession: (session) => set({ session }),
      logout: () => set({ session: null, view: "dashboard" }),
      setFirms: (firms) => {
        set({ firms });
        const current = get().activeFirmId;
        if (!current || !firms.find((f) => f.id === current)) {
          set({
            activeFirmId: firms[0]?.id ?? null,
            financialYear: firms[0]?.financialYear ?? "",
          });
        }
      },
      setActiveFirm: (id) => {
        const firm = get().firms.find((f) => f.id === id);
        set({ activeFirmId: id, financialYear: firm?.financialYear ?? get().financialYear });
      },
      setFinancialYear: (fy) => set({ financialYear: fy }),
      setView: (view) => set({ view }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setNotifications: (notifications) => set({ notifications }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: "dmk-erp-store",
      partialize: (s) => ({
        activeFirmId: s.activeFirmId,
        financialYear: s.financialYear,
        view: s.view,
        session: s.session,
        language: s.language,
      }),
    }
  )
);

export function useActiveFirm(): Firm | undefined {
  return useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
}
