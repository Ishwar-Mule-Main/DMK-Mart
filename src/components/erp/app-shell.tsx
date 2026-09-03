"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — APP SHELL + VIEW ROUTER (SPA at /)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { useErpStore, type ViewId } from "@/store/erp-store";
import { apiGet, apiPost } from "@/lib/api-client";
import type { Firm } from "@/types/erp";
import { cn } from "@/lib/utils";

import DashboardView from "./views/dashboard";
import ProductsView from "./views/products";
import StockLevelsView from "./views/stock-levels";
import StockMovementsView from "./views/stock-movements";
import BulkUploadView from "./views/bulk-upload";
import LowStockView from "./views/low-stock";
import BillingView from "./views/billing";
import B2CCounterView from "./views/b2c-counter";
import InvoiceRegisterView from "./views/invoice-register";
import SalesReturnsView from "./views/sales-returns";
import CustomersView from "./views/customers";
import ReceiptsView from "./views/receipts";
import RecurringView from "./views/recurring";
import InvoiceDocsView from "./views/invoice-docs";
import CreditDebitNotesView from "./views/credit-debit-notes";
import VendorsView from "./views/vendors";
import PurchaseOrdersView from "./views/purchase-orders";
import PurchaseReturnsView from "./views/purchase-returns";
import VendorPaymentsView from "./views/vendor-payments";
import JournalsView from "./views/journals";
import ChartOfAccountsView from "./views/chart-of-accounts";
import PartyLedgersView from "./views/party-ledgers";
import StatementsView from "./views/statements";
import DaybookView from "./views/daybook";
import AgingView from "./views/aging";
import Gstr2bView from "./views/gstr2b";
import ReportsView from "./views/reports";
import AiCopilotView from "./views/ai-copilot";
import SettingsView from "./views/settings";

const VIEW_MAP: Record<ViewId, React.ComponentType> = {
  dashboard: DashboardView,
  "inventory/products": ProductsView,
  "inventory/stock": StockLevelsView,
  "inventory/movements": StockMovementsView,
  "inventory/bulk-upload": BulkUploadView,
  "inventory/low-stock": LowStockView,
  "sales/billing": BillingView,
  "sales/b2c": B2CCounterView,
  "sales/invoices": InvoiceRegisterView,
  "sales/returns": SalesReturnsView,
  "sales/customers": CustomersView,
  "sales/receipts": ReceiptsView,
  "sales/recurring": RecurringView,
  "docs/invoices": InvoiceDocsView,
  "docs/notes": CreditDebitNotesView,
  "purchase/vendors": VendorsView,
  "purchase/orders": PurchaseOrdersView,
  "purchase/returns": PurchaseReturnsView,
  "purchase/payments": VendorPaymentsView,
  "finance/journals": JournalsView,
  "finance/coa": ChartOfAccountsView,
  "finance/ledgers": PartyLedgersView,
  "finance/statements": StatementsView,
  "finance/daybook": DaybookView,
  "finance/aging": AgingView,
  "finance/gstr2b": Gstr2bView,
  reports: ReportsView,
  ai: AiCopilotView,
  settings: SettingsView,
};

export function AppShell() {
  const { view, firms, activeFirmId, setFirms } = useErpStore();
  const [booting, setBooting] = React.useState(true);
  const [bootError, setBootError] = React.useState<string | null>(null);

  // Boot sequence: ensure seed exists → load firms
  React.useEffect(() => {
    (async () => {
      try {
        let firmList = await apiGet<Firm[]>("/api/v1/firms");
        if (!firmList || firmList.length === 0) {
          await apiPost("/api/v1/seed");
          firmList = await apiGet<Firm[]>("/api/v1/firms");
        }
        setFirms(firmList ?? []);
      } catch (e) {
        setBootError(e instanceof Error ? e.message : "Failed to initialize platform");
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const ActiveView = VIEW_MAP[view] ?? DashboardView;
  const sidebarOpen = useErpStore((s) => s.sidebarOpen);

  if (booting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-dmk-bg-primary">
        <div className="h-14 w-14 rounded-2xl bg-dmk-gold flex items-center justify-center animate-pulse">
          <span className="text-2xl font-black text-[#0A0F1D]">D</span>
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-dmk-text-primary">DMK Mart ERP</p>
          <p className="text-[12px] text-dmk-text-muted mt-1">Initializing workspace…</p>
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-dmk-bg-primary px-4">
        <div className="dmk-card p-6 max-w-md text-center">
          <p className="text-[15px] font-bold text-dmk-danger">Startup Error</p>
          <p className="text-[12.5px] text-dmk-text-secondary mt-2">{bootError}</p>
        </div>
      </div>
    );
  }

  if (!activeFirmId) {
    return (
      <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
        <Header />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="dmk-card p-8 max-w-md text-center">
            <p className="text-[16px] font-bold text-dmk-text-primary">No firms yet</p>
            <p className="text-[12.5px] text-dmk-text-secondary mt-2">
              Create your first firm to start keeping books.
            </p>
            <button
              onClick={() => useErpStore.getState().setView("settings")}
              className="mt-4 h-9 px-4 rounded-lg bg-dmk-blue text-white text-[13px] font-semibold hover:brightness-110"
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      <Header />
      <Sidebar />
      <CommandPalette />
      <div className={cn("flex-1 flex flex-col transition-all duration-200 mt-14", sidebarOpen ? "lg:ml-[240px]" : "lg:ml-[64px]")}>
        <main key={view} className="dmk-enter flex-1 px-3 sm:px-5 py-4 sm:py-5 max-w-[1600px] w-full mx-auto">
          <ActiveView />
        </main>
        <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60">
          <div className="max-w-[1600px] mx-auto px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5">
            <p className="text-[11px] text-dmk-text-muted">
              DMK Mart ERP · AI-Native Trading, Distribution &amp; Bookkeeping Platform
            </p>
            <p className="text-[11px] text-dmk-text-muted font-money">
              Σ Debits ≡ Σ Credits · Indian Rupees (₹) · FY {useErpStore.getState().financialYear}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
