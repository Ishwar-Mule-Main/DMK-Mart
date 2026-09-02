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
  | "sales/invoices"
  | "sales/returns"
  | "sales/customers"
  | "sales/receipts"
  | "purchase/orders"
  | "purchase/returns"
  | "purchase/vendors"
  | "purchase/payments"
  | "inventory/products"
  | "inventory/stock"
  | "inventory/movements"
  | "inventory/bulk-upload"
  | "inventory/low-stock"
  | "finance/journals"
  | "finance/coa"
  | "finance/ledgers"
  | "finance/statements"
  | "finance/daybook"
  | "finance/aging"
  | "finance/gstr2b"
  | "docs/invoices"
  | "docs/notes"
  | "reports"
  | "ai"
  | "settings";

interface ErpState {
  firms: Firm[];
  activeFirmId: string | null;
  financialYear: string;
  view: ViewId;
  sidebarOpen: boolean;
  notifications: number;
  setFirms: (firms: Firm[]) => void;
  setActiveFirm: (id: string) => void;
  setFinancialYear: (fy: string) => void;
  setView: (v: ViewId) => void;
  setSidebarOpen: (open: boolean) => void;
  setNotifications: (n: number) => void;
}

export const useErpStore = create<ErpState>()(
  persist(
    (set, get) => ({
      firms: [],
      activeFirmId: null,
      financialYear: "",
      view: "dashboard",
      sidebarOpen: true,
      notifications: 0,
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
    }),
    {
      name: "dmk-erp-store",
      partialize: (s) => ({
        activeFirmId: s.activeFirmId,
        financialYear: s.financialYear,
        view: s.view,
        sidebarOpen: s.sidebarOpen,
      }),
    }
  )
);

export function useActiveFirm(): Firm | undefined {
  return useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
}
