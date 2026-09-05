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
import { LoginGate } from "@/components/auth/login-gate";
import { VerificationPortal } from "@/components/verify/verification-portal";
import { FyGate } from "./fy-gate";

/**
 * Portal addresses — the two logins live at different URLs and are never
 * shown together: owner door at "/", verification team door at "/team".
 * Each page passes its door explicitly (no query parsing), and sessions
 * are bounced to their own address if they land on the wrong one.
 */

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
import NewPurchaseOrderView from "./views/new-purchase-order";
import PurchaseReturnsView from "./views/purchase-returns";
import VendorPaymentsView from "./views/vendor-payments";
import JournalsView from "./views/journals";
import ChartOfAccountsView from "./views/chart-of-accounts";
import PartyLedgersView from "./views/party-ledgers";
import StatementsView from "./views/statements";
import DaybookView from "./views/daybook";
import AgingView from "./views/aging";
import SundryView from "./views/sundry";
import Gstr2bView from "./views/gstr2b";
import ReportsView from "./views/reports";
import AiCopilotView from "./views/ai-copilot";
import SettingsView from "./views/settings";
import DeletedDataView from "./views/deleted-data";
import PurchaseVerificationView from "./views/verification";

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
  "purchase/new-order": NewPurchaseOrderView,
  "purchase/verification": PurchaseVerificationView,
  "purchase/returns": PurchaseReturnsView,
  "purchase/payments": VendorPaymentsView,
  "finance/journals": JournalsView,
  "finance/coa": ChartOfAccountsView,
  "finance/ledgers": PartyLedgersView,
  "finance/statements": StatementsView,
  "finance/daybook": DaybookView,
  "finance/aging": AgingView,
  "finance/sundry": SundryView,
  "finance/gstr2b": Gstr2bView,
  reports: ReportsView,
  ai: AiCopilotView,
  "data/deleted": DeletedDataView,
  settings: SettingsView,
};

export function AppShell({ forcedDoor }: { forcedDoor?: "owner" | "team" }) {
  const { view, firms, activeFirmId, financialYear, setFirms, session } = useErpStore();
  const [mounted, setMounted] = React.useState(false);
  const [booting, setBooting] = React.useState(true);
  const [bootError, setBootError] = React.useState<string | null>(null);
  const door: "owner" | "team" = forcedDoor ?? "owner";

  // Persisted session (zustand) only exists client-side — render nothing
  // brand-specific until mounted to keep SSR hydration exact.
  React.useEffect(() => {
    setMounted(true);
    // Legacy bookmark compat: "/?portal=team" now lives at "/team".
    if (typeof window !== "undefined" && window.location.search.includes("portal=team")) {
      window.location.replace("/team");
      return;
    }
  }, []);

  // URL separation is enforced both ways: a team session opening "/" is
  // bounced to /team, an owner session opening /team is bounced to "/".
  const crossDoorBounce =
    mounted && !!session && ((door === "owner" && session.role === "TEAM") || (door === "team" && session.role === "OWNER"));
  React.useEffect(() => {
    if (!crossDoorBounce) return;
    window.location.replace(door === "owner" ? "/team" : "/");
  }, [crossDoorBounce, door]);

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

  // Portal gate (after all hooks): team members live in the
  // verification portal, unsigned-in visitors see the login doors.
  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-dmk-bg-primary">
        <img src="/dmk-logo.png" alt="DMK Mart logo" width={56} height={56} className="rounded-full animate-pulse" />
        <p className="text-[12px] text-dmk-text-muted">Loading workspace…</p>
      </div>
    );
  }
  if (crossDoorBounce) {
    // Wrong address for this persona — hopping to the correct portal URL.
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-dmk-bg-primary">
        <img src="/dmk-logo.png" alt="DMK Mart logo" width={56} height={56} className="rounded-full animate-pulse" />
        <p className="text-[12px] text-dmk-text-muted">
          {door === "owner" ? "Team session — opening the verification portal…" : "Owner session — opening the workspace…"}
        </p>
      </div>
    );
  }
  if (!session) {
    return <LoginGate door={door} />;
  }
  if (session.role === "TEAM") {
    return <VerificationPortal />;
  }

  const ActiveView = VIEW_MAP[view] ?? DashboardView;

  if (booting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-dmk-bg-primary">
        <img src="/dmk-logo.png" alt="DMK Mart logo" width={56} height={56} className="rounded-full animate-pulse" />
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
    <FyGate>
      <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
        <Header />
        <Sidebar />
        <CommandPalette />
        {/* Desktop: the sidebar is a hover-to-expand rail, so the content offset is always the 64px rail width — the expanded panel overlays instead of pushing content. */}
        <div className="flex-1 flex flex-col transition-none mt-14 lg:ml-16">
          {/* Keyed by view + firm + FY: switching company or financial year remounts the
              active view so every register refetches scoped to the selected year —
              the fy param itself is injected by apiGet from the store. */}
          <main key={`${view}-${activeFirmId}-${financialYear}`} className="dmk-enter flex-1 px-3 sm:px-5 py-4 sm:py-5 max-w-[1600px] w-full mx-auto">
            <ActiveView />
          </main>
          <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60">
            <div className="max-w-[1600px] mx-auto px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5">
              <p className="text-[11px] text-dmk-text-muted">
                DMK Mart ERP · AI-Native Trading, Distribution &amp; Bookkeeping Platform
              </p>
              <p className="text-[11px] text-dmk-text-muted font-money">
                Σ Debits ≡ Σ Credits · Indian Rupees (₹) · FY {financialYear}
              </p>
            </div>
          </footer>
        </div>
      </div>
    </FyGate>
  );
}
