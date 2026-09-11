"use client";

import * as React from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  Store,
  Package,
  Landmark,
  BookUser,
  FileText,
  BarChart3,
  Bot,
  Settings,
  ChevronDown,
  ChevronsRight,
  Zap,
  ScanBarcode,
  FileStack,
  Undo2,
  Users,
  Receipt,
  ClipboardList,
  Banknote,
  Truck,
  UndoIcon,
  Boxes,
  MapPinned,
  Route as RouteIcon,
  IdCard,
  ArrowLeftRight,
  AlertTriangle,
  BookOpen,
  ListTree,
  PieChart,
  CalendarDays,
  CalendarClock,
  Timer,
  FileCheck2,
  FileWarning,
  ClipboardCheck,
  PackagePlus,
  Trash2,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useErpStore, type ViewId } from "@/store/erp-store";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NavItem {
  id: ViewId;
  label: string;
  key: string; // i18n key
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface NavSection {
  label: string;
  labelKey: string; // i18n key
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Overview",
    labelKey: "nav.overview",
    items: [{ id: "dashboard", label: "Dashboard", key: "nav.dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    labelKey: "nav.sales",
    items: [
      { id: "sales/billing", label: "Fast Billing (B2B)", key: "nav.billing", icon: Zap },
      { id: "sales/b2c", label: "B2C Counter", key: "nav.b2c", icon: ScanBarcode },
      { id: "sales/orders", label: "Sales Orders (SO)", key: "nav.salesOrders", icon: ShoppingCart },
      { id: "sales/invoices", label: "Invoice Register", key: "nav.invoices", icon: FileStack },
      { id: "sales/returns", label: "Sales Returns", key: "nav.salesReturns", icon: Undo2 },
      { id: "sales/customers", label: "Customers & Buyers", key: "nav.customers", icon: Users },
      { id: "sales/receipts", label: "Receipts", key: "nav.receipts", icon: Receipt },
      { id: "sales/recurring", label: "Recurring Billing", key: "nav.recurring", icon: CalendarClock },
    ],
  },
  {
    label: "Logistics",
    labelKey: "nav.logistics",
    items: [
      { id: "logistics/unassigned", label: "Unassigned Orders", key: "nav.unassignedOrders", icon: MapPinned },
      { id: "logistics/planner", label: "Trip Planner", key: "nav.tripPlanner", icon: RouteIcon },
      { id: "logistics/trips", label: "Trips & Settlement", key: "nav.tripsRegister", icon: Truck },
      { id: "logistics/drivers", label: "Drivers", key: "nav.drivers", icon: IdCard },
    ],
  },
  {
    label: "Purchase",
    labelKey: "nav.purchase",
    items: [
      { id: "purchase/orders", label: "Purchase Orders", key: "nav.po", icon: ClipboardList },
      { id: "purchase/new-order", label: "New Purchase Order", key: "nav.newPo", icon: PackagePlus },
      { id: "purchase/verification", label: "PO Verification", key: "nav.poVerify", icon: ClipboardCheck },
      { id: "purchase/returns", label: "Purchase Returns", key: "nav.poReturns", icon: UndoIcon },
      { id: "purchase/payments", label: "Vendor Payments", key: "nav.vendorPayments", icon: Banknote },
      { id: "purchase/vendors", label: "Vendors", key: "nav.vendors", icon: Truck },
    ],
  },
  {
    label: "Inventory",
    labelKey: "nav.inventory",
    items: [
      { id: "inventory/products", label: "Products", key: "nav.products", icon: Package },
      { id: "inventory/stock", label: "Stock Levels", key: "nav.stock", icon: Boxes },
      { id: "inventory/movements", label: "Stock Movements", key: "nav.movements", icon: ArrowLeftRight },
      { id: "inventory/bulk-upload", label: "Bulk Upload", key: "nav.bulkUpload", icon: FileText },
      { id: "inventory/low-stock", label: "Low Stock Alerts", key: "nav.lowStock", icon: AlertTriangle },
    ],
  },
  {
    label: "Expenses",
    labelKey: "nav.expenses",
    items: [
      { id: "finance/expense-record", label: "Record Expense", key: "nav.expenseRecord", icon: Wallet },
      { id: "finance/expense-reports", label: "Expense Reports", key: "nav.expenseReports", icon: BarChart3 },
    ],
  },
  {
    label: "Finance & Accounting",
    labelKey: "nav.finance",
    items: [
      { id: "finance/journals", label: "Journals", key: "nav.journals", icon: BookOpen },
      { id: "finance/coa", label: "Chart of Accounts", key: "nav.coa", icon: ListTree },
      { id: "finance/ledgers", label: "Party Ledgers", key: "nav.ledgers", icon: Landmark },
      { id: "finance/sundry", label: "Sundry Debtors / Creditors", key: "nav.sundry", icon: BookUser },
      { id: "finance/statements", label: "Statements (TB · P&L · BS)", key: "nav.statements", icon: PieChart },
      { id: "finance/daybook", label: "Day Book", key: "nav.daybook", icon: CalendarDays },
      { id: "finance/aging", label: "AR / AP Aging", key: "nav.aging", icon: Timer },
      { id: "finance/gstr2b", label: "GSTR-2B Recon", key: "nav.gstr2b", icon: FileCheck2 },
    ],
  },
  {
    label: "Documents",
    labelKey: "nav.documents",
    items: [
      { id: "docs/invoices", label: "Tax Invoices (A4)", key: "nav.taxInvoices", icon: FileCheck2 },
      { id: "docs/notes", label: "Credit / Debit Notes", key: "nav.notes", icon: FileWarning },
    ],
  },
  {
    label: "Intelligence",
    labelKey: "nav.intelligence",
    items: [
      { id: "reports", label: "Reports & Exports", key: "nav.reports", icon: BarChart3 },
      { id: "ai", label: "AI Copilot", key: "nav.ai", icon: Bot },
      { id: "data/deleted", label: "Deleted Data", key: "nav.deleted", icon: Trash2 },
      { id: "sales/team", label: "Sales Team", key: "nav.salesTeam", icon: UsersRound },
      { id: "settings", label: "Settings", key: "nav.settings", icon: Settings },
    ],
  },
];

/** Tracks the lg breakpoint (1024px) — the boundary between drawer and hover rail. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function Sidebar() {
  const view = useErpStore((s) => s.view);
  const setView = useErpStore((s) => s.setView);
  const sidebarOpen = useErpStore((s) => s.sidebarOpen);
  const setSidebarOpen = useErpStore((s) => s.setSidebarOpen);
  const isDesktop = useIsDesktop();
  const { t } = useT();

  // Desktop: the rail is ALWAYS minimized and only expands on hover
  // (or keyboard focus). Mobile: the drawer opens via the header button.
  const [hovered, setHovered] = React.useState(false);
  const expanded = isDesktop ? hovered : sidebarOpen;

  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of SECTIONS) initial[s.label] = true;
    return initial;
  });

  const toggle = (label: string) => setOpenSections((p) => ({ ...p, [label]: !p[label] }));

  // The panel always starts minimized: reset any stale drawer state on mount.
  React.useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
        }}
        className={cn(
          "fixed z-50 top-14 bottom-0 left-0 bg-[#090E1A] border-r border-dmk-border-subtle flex flex-col",
          "transition-[width,transform,box-shadow] duration-200 ease-in-out overflow-x-hidden",
          expanded ? "w-[240px] translate-x-0" : "w-[240px] -translate-x-full lg:w-16 lg:translate-x-0",
          isDesktop && hovered && "shadow-[10px_0_32px_rgba(0,0,0,0.5)]"
        )}
        aria-label="ERP navigation panel"
      >
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-1" aria-label="ERP navigation">
          {SECTIONS.map((section, sIdx) => {
            const single = section.items.length === 1;
            const isOpen = openSections[section.label];
            return (
              <div key={section.label}>
                {/* Collapsed rail: section headers become hairline dividers */}
                {!expanded && (
                  <div
                    className={cn("hidden lg:block mx-2 h-px bg-dmk-border-subtle/70", sIdx === 0 ? "my-1" : "my-2")}
                    aria-hidden="true"
                  />
                )}
                {!single && (
                  <button
                    onClick={() => toggle(section.label)}
                    className={cn(
                      "w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-dmk-text-muted hover:text-dmk-text-secondary",
                      !expanded && "lg:hidden"
                    )}
                    tabIndex={expanded ? 0 : -1}
                  >
                    <span>{t(section.labelKey)}</span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform", !isOpen && "-rotate-90")} />
                  </button>
                )}
                {single && (
                  <div
                    className={cn(
                      "px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-dmk-text-muted",
                      !expanded && "lg:hidden"
                    )}
                  >
                    <span>{t(section.labelKey)}</span>
                  </div>
                )}
                {(single || isOpen) && (
                  <ul className={cn("space-y-0.5", !single && "pb-1")}>
                    {section.items.map((item) => {
                      const active = view === item.id;
                      const Icon = item.icon;
                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => {
                              setView(item.id);
                              if (window.innerWidth < 1024) setSidebarOpen(false);
                            }}
                            title={t(item.key)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "group w-full flex items-center gap-2.5 h-10 px-2.5 rounded-lg text-[13px] font-medium transition-colors",
                              active
                                ? "dmk-nav-active text-dmk-text-primary"
                                : "text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary",
                              !expanded && "lg:justify-center lg:px-0"
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-[18px] w-[18px] shrink-0",
                                active ? "text-dmk-yellow" : "text-dmk-text-muted group-hover:text-dmk-text-secondary"
                              )}
                              strokeWidth={1.75}
                            />
                            <span className={cn("truncate", !expanded && "lg:hidden")}>{t(item.key)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-dmk-border-subtle p-3">
          <div className={cn("dmk-well px-3 py-2.5", !expanded && "lg:hidden")}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-dmk-gold">DMK Mart ERP</p>
            <p className="text-[10.5px] text-dmk-text-muted mt-0.5">{t("hdr.owner")} Workspace · v1.0</p>
          </div>
          {/* Collapsed rail affordance: hover hint */}
          <div
            className={cn("hidden lg:flex items-center justify-center py-1", expanded && "lg:hidden")}
            title="Hover to expand the menu"
          >
            <ChevronsRight className="h-4 w-4 text-dmk-text-muted animate-pulse" aria-hidden="true" />
            <span className="sr-only">Hover to expand the navigation menu</span>
          </div>
        </div>
      </aside>
    </>
  );
}
