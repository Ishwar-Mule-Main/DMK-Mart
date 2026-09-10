"use client";

// ═══════════════════════════════════════════════════════════════
// DMK SALES PORTAL — the sales team's own workspace at /sales.
// A completely separate shell from the owner ERP: the sidebar builds
// itself from the owner-granted permission snapshot (session.salesPerms),
// every register is scoped to the signed-in member (salesMemberId=me),
// and purchase costs NEVER reach this portal (stripped server-side).
// Sections: Dashboard · B2B Fast Billing · B2C Counter POS · Sales
// Orders · Customers · Stock Check · My Invoices · Receipts.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  LayoutDashboard,
  Zap,
  ScanBarcode,
  ClipboardList,
  Users,
  Boxes,
  FileStack,
  Receipt,
  LogOut,
  Menu,
  Lock,
  ChevronsRight,
  Loader2,
  RefreshCw,
  ReceiptText,
  Plus,
  X,
  ShieldCheck,
  FileText,
} from "lucide-react";
import { useErpStore, type SalesPermissions } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import { round2 } from "@/lib/gst";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, KpiCard, Badge, EmptyState, LoadingRows, ErrorText, SearchInput } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BillingView from "@/components/erp/views/billing";
import B2CCounterView from "@/components/erp/views/b2c-counter";
import CustomersView from "@/components/erp/views/customers";
import ReceiptsView from "@/components/erp/views/receipts";
import { cn } from "@/lib/utils";

// ─── View ids & permission map ────────────────────────────────────

type SalesViewId =
  | "home"
  | "billing"
  | "b2c"
  | "orders"
  | "customers"
  | "stock"
  | "invoices"
  | "receipts";

/** The owner-granted section toggle each view requires (null = always). */
const PERM_FOR_VIEW: Record<SalesViewId, keyof SalesPermissions | null> = {
  home: null,
  billing: "canB2BBilling",
  b2c: "canB2CPos",
  orders: "canSalesOrders",
  customers: "canManageCustomers",
  stock: "canViewStock",
  invoices: "canViewInvoices",
  receipts: "canRecordReceipts",
};

interface SalesNavItem {
  id: SalesViewId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  perm?: keyof SalesPermissions;
}

const SALES_NAV: Array<{ label: string; items: SalesNavItem[] }> = [
  {
    label: "Selling",
    items: [
      { id: "home", label: "Dashboard", icon: LayoutDashboard },
      { id: "billing", label: "B2B Fast Billing", icon: Zap, perm: "canB2BBilling" },
      { id: "b2c", label: "B2C Counter POS", icon: ScanBarcode, perm: "canB2CPos" },
      { id: "orders", label: "Sales Orders", icon: ClipboardList, perm: "canSalesOrders" },
    ],
  },
  {
    label: "Books & Records",
    items: [
      { id: "customers", label: "Customers & Buyers", icon: Users, perm: "canManageCustomers" },
      { id: "stock", label: "Stock Check", icon: Boxes, perm: "canViewStock" },
      { id: "invoices", label: "My Invoices", icon: FileStack, perm: "canViewInvoices" },
      { id: "receipts", label: "Receipts", icon: Receipt, perm: "canRecordReceipts" },
    ],
  },
];

// ─── API row types (portal-scoped — NO cost fields exist here) ────

interface SalesInvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  isCounterSale: boolean;
  walkInName: string;
  walkInPhone: string;
  paymentMode: string;
  status: string;
  grandTotal: number;
  customer?: { id: string; partyName: string; customerType: string; stateCode: string } | null;
  salesMember?: { id: string; fullName: string; username: string } | null;
}

type SalesInvoiceDetail = Omit<SalesInvoiceRow, "customer"> & {
  subtotal: number;
  discountTotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  roundOff: number;
  lineItems: Array<{
    id?: string;
    productName: string;
    sku: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    taxableAmount: number;
    gstRate: number;
    totalAmount: number;
  }>;
  customer?: { partyName: string; city?: string; gstin?: string; phone?: string } | null;
};

/** Stock-check product — the API strips purchaseCost when salesPortal=1. */
interface StockProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  gstRate: number;
  tier4Retailer: number;
  stockQuantity: number;
  lowStockThreshold: number;
  isActive: boolean;
}

interface SalesOrderItemRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

interface SalesOrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  estimatedTotal: number;
  notes: string;
  items?: SalesOrderItemRow[];
  _count?: { items: number };
  customer?: { id: string; partyName: string; phone?: string; city?: string } | null;
  salesMember?: { id: string; fullName: string; username: string } | null;
}

interface SalesCustomerRow {
  id: string;
  partyName: string;
  city: string;
  customerType: string;
  isActive: boolean;
}

// ─── Portal root — chrome + view router + permission guard ────────

export function SalesPortal() {
  const session = useErpStore((s) => s.session);
  const logout = useErpStore((s) => s.logout);
  const setSession = useErpStore((s) => s.setSession);
  const [view, setView] = React.useState<SalesViewId>("home");
  const [navOpen, setNavOpen] = React.useState(false);

  // ── Live permission sync ────────────────────────────────────────
  // The owner can flip section switches any time (Settings → Sales
  // Team). Instead of waiting for the next login, the portal re-reads
  // the member on mount and every minute: new sections appear / vanish
  // on the next tick, and a mid-session SUSPEND signs the member out.
  const syncSession = React.useCallback(async () => {
    const s = useErpStore.getState().session;
    if (!s || s.role !== "SALES" || !s.salesId) return;
    try {
      const m = await apiGet<{
        isActive: boolean;
        fullName: string;
        username: string;
        canB2BBilling: boolean;
        canB2CPos: boolean;
        canSalesOrders: boolean;
        canManageCustomers: boolean;
        canViewStock: boolean;
        canViewInvoices: boolean;
        canRecordReceipts: boolean;
        canOverridePrice: boolean;
      }>(`/api/v1/sales-team/members/${s.salesId}`);
      if (!m) return;
      const cur = useErpStore.getState().session;
      if (!cur || cur.role !== "SALES") return;
      if (!m.isActive) {
        // Suspended by the owner while signed in — same door, fresh state.
        logout();
        window.location.assign("/sales");
        return;
      }
      const perms: SalesPermissions = {
        canB2BBilling: m.canB2BBilling,
        canB2CPos: m.canB2CPos,
        canSalesOrders: m.canSalesOrders,
        canManageCustomers: m.canManageCustomers,
        canViewStock: m.canViewStock,
        canViewInvoices: m.canViewInvoices,
        canRecordReceipts: m.canRecordReceipts,
        canOverridePrice: m.canOverridePrice,
      };
      const p = cur.salesPerms;
      const changed =
        !p ||
        p.canB2BBilling !== perms.canB2BBilling ||
        p.canB2CPos !== perms.canB2CPos ||
        p.canSalesOrders !== perms.canSalesOrders ||
        p.canManageCustomers !== perms.canManageCustomers ||
        p.canViewStock !== perms.canViewStock ||
        p.canViewInvoices !== perms.canViewInvoices ||
        p.canRecordReceipts !== perms.canRecordReceipts ||
        p.canOverridePrice !== perms.canOverridePrice ||
        cur.salesName !== m.fullName;
      if (changed) setSession({ ...cur, salesName: m.fullName, salesUsername: m.username, salesPerms: perms });
    } catch {
      /* offline / member deleted — keep the last snapshot; next tick retries */
    }
  }, [logout, setSession]);
  React.useEffect(() => {
    syncSession();
    const iv = setInterval(syncSession, 60_000);
    return () => clearInterval(iv);
  }, [syncSession]);

  // AppShell only mounts this portal for SALES sessions — guard anyway.
  if (!session || session.role !== "SALES") return null;

  const firmId = session.firmId;
  const firmName = session.firmName;

  function handleSignOut() {
    // Sales members always land back on the SALES login address.
    logout();
    window.location.assign("/sales");
  }

  function navigate(v: SalesViewId) {
    setView(v);
    setNavOpen(false);
  }

  // ── Permission guard: flips instantly if the snapshot ever changes ──
  const requiredPerm = PERM_FOR_VIEW[view];
  const allowed = !requiredPerm || Boolean(session.salesPerms?.[requiredPerm]);

  function renderView() {
    if (!session) return null;
    if (!allowed) {
      return <UnauthorizedScreen onGoHome={() => navigate("home")} />;
    }
    switch (view) {
      case "home":
        return <HomeView session={session} onNavigate={navigate} />;
      case "billing":
        return <BillingView />;
      case "b2c":
        return <B2CCounterView />;
      case "orders":
        return <SalesOrdersView />;
      case "customers":
        return <CustomersView />;
      case "stock":
        return <StockCheckView />;
      case "invoices":
        return <MyInvoicesView />;
      case "receipts":
        return <ReceiptsView />;
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      <SalesHeader
        firmName={firmName}
        salesName={session.salesName ?? "Sales member"}
        salesUsername={session.salesUsername ?? ""}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen(!navOpen)}
        onSignOut={handleSignOut}
      />
      <SalesSidebar
        view={view}
        onNavigate={navigate}
        navOpen={navOpen}
        onCloseNav={() => setNavOpen(false)}
        perms={session.salesPerms}
        firmName={firmName}
        salesName={session.salesName ?? "Sales member"}
        salesUsername={session.salesUsername ?? ""}
        onSignOut={handleSignOut}
      />

      {/* Desktop: the sidebar is a hover-to-expand rail, so the content
          offset is always the 64px rail width — the expanded panel
          overlays instead of pushing content (same as the owner shell). */}
      <div className="flex-1 flex flex-col mt-14 lg:ml-16">
        <main className="dmk-enter flex-1 px-3 sm:px-5 py-4 sm:py-5 max-w-[1400px] w-full mx-auto" aria-label="Sales portal workspace">
          {renderView()}
        </main>
        <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60">
          <div className="max-w-[1400px] mx-auto px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5">
            <p className="text-[11px] text-dmk-text-muted">DMK Sales Portal · {firmName}</p>
            <p className="text-[11px] text-dmk-text-muted flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> every bill is stamped with your name
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Slim top bar — firm + date + member + sign out. No switchers. ──

function SalesHeader({
  firmName,
  salesName,
  salesUsername,
  navOpen,
  onToggleNav,
  onSignOut,
}: {
  firmName: string;
  salesName: string;
  salesUsername: string;
  navOpen: boolean;
  onToggleNav: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="fixed top-0 inset-x-0 z-[60] h-14 bg-[#0D1527]/95 backdrop-blur border-b-2 border-dmk-yellow/60">
      <div className="h-full px-3 sm:px-4 flex items-center gap-2.5">
        <button
          onClick={onToggleNav}
          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary lg:hidden"
          aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={navOpen}
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <img src="/dmk-logo.png" alt="DMK Mart logo" width={32} height={32} className="rounded-full shrink-0" />
        <div className="leading-tight min-w-0">
          <p className="text-[13.5px] font-black text-dmk-text-primary truncate">DMK Sales Portal</p>
          <p className="text-[9.5px] uppercase tracking-[0.16em] text-dmk-yellow truncate">{firmName}</p>
        </div>

        <div className="flex-1" />

        <span className="hidden md:inline text-[11.5px] text-dmk-text-muted whitespace-nowrap">
          Today · {formatDate(new Date())}
        </span>

        <div className="h-9 px-2.5 rounded-lg bg-dmk-input-well border border-dmk-border-subtle hidden sm:flex items-center gap-2 max-w-[200px]">
          <span className="h-6 w-6 rounded-full bg-dmk-yellow/15 border border-dmk-yellow/50 flex items-center justify-center text-[11px] font-bold text-dmk-yellow shrink-0">
            {initialsOf(salesName)}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-dmk-text-primary truncate leading-tight">{salesName}</span>
            <span className="block text-[9.5px] text-dmk-text-muted truncate leading-tight">@{salesUsername}</span>
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onSignOut}
          className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50"
        >
          <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

// ─── Sidebar — permission-driven, hover rail on desktop, drawer on mobile ──

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

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function SalesSidebar({
  view,
  onNavigate,
  navOpen,
  onCloseNav,
  perms,
  firmName,
  salesName,
  salesUsername,
  onSignOut,
}: {
  view: SalesViewId;
  onNavigate: (v: SalesViewId) => void;
  navOpen: boolean;
  onCloseNav: () => void;
  perms: SalesPermissions | undefined;
  firmName: string;
  salesName: string;
  salesUsername: string;
  onSignOut: () => void;
}) {
  const isDesktop = useIsDesktop();
  const [hovered, setHovered] = React.useState(false);
  // Desktop: the rail is ALWAYS minimized and only expands on hover
  // (or keyboard focus). Mobile: the drawer opens via the header button.
  const expanded = isDesktop ? hovered : navOpen;

  // Sections built ONLY from the owner-granted permission snapshot.
  const sections = React.useMemo(
    () =>
      SALES_NAV.map((s) => ({
        ...s,
        items: s.items.filter((i) => !i.perm || Boolean(perms?.[i.perm])),
      })).filter((s) => s.items.length > 0),
    [perms]
  );

  return (
    <>
      {/* Mobile overlay */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onCloseNav}
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
        aria-label="Sales portal navigation panel"
      >
        {/* Brand block */}
        <div
          className={cn(
            "flex items-center gap-2.5 px-3 py-3 border-b border-dmk-border-subtle shrink-0",
            !expanded && "lg:justify-center lg:px-0"
          )}
        >
          <img src="/dmk-logo.png" alt="" aria-hidden="true" width={32} height={32} className="rounded-full shrink-0" />
          <div className={cn("min-w-0", !expanded && "lg:hidden")}>
            <p className="text-[12.5px] font-black text-dmk-text-primary leading-tight">Sales Portal</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-dmk-yellow truncate leading-tight">{firmName}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-1" aria-label="Sales sections">
          {sections.map((section, sIdx) => (
            <div key={section.label}>
              {/* Collapsed rail: section headers become hairline dividers */}
              {!expanded && (
                <div
                  className={cn("hidden lg:block mx-2 h-px bg-dmk-border-subtle/70", sIdx === 0 ? "my-1" : "my-2")}
                  aria-hidden="true"
                />
              )}
              <div
                className={cn(
                  "px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-dmk-text-muted",
                  !expanded && "lg:hidden"
                )}
              >
                <span>{section.label}</span>
              </div>
              <ul className="space-y-0.5 pb-1">
                {section.items.map((item) => {
                  const active = view === item.id;
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => onNavigate(item.id)}
                        title={item.label}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group w-full flex items-center gap-2.5 h-11 px-2.5 rounded-lg text-[13px] font-medium transition-colors",
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
                        <span className={cn("truncate", !expanded && "lg:hidden")}>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Member chip + sign out */}
        <div className="border-t border-dmk-border-subtle p-3 space-y-2 shrink-0">
          <div className={cn("dmk-well px-3 py-2.5 flex items-center gap-2.5 min-w-0", !expanded && "lg:hidden")}>
            <span className="h-8 w-8 rounded-full bg-dmk-yellow/15 border border-dmk-yellow/50 flex items-center justify-center text-[11px] font-bold text-dmk-yellow shrink-0">
              {initialsOf(salesName)}
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-dmk-text-primary truncate leading-tight">{salesName}</span>
              <span className="block text-[10px] text-dmk-text-muted truncate leading-tight">@{salesUsername}</span>
            </span>
          </div>
          {/* Collapsed rail: initials only */}
          {!expanded && (
            <div className="hidden lg:flex justify-center py-0.5" title={`${salesName} (@${salesUsername})`}>
              <span className="h-8 w-8 rounded-full bg-dmk-yellow/15 border border-dmk-yellow/50 flex items-center justify-center text-[11px] font-bold text-dmk-yellow">
                {initialsOf(salesName)}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            onClick={onSignOut}
            className={cn(
              "w-full h-9 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50",
              !expanded && "lg:px-0"
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={cn(!expanded && "lg:hidden")}>Sign out</span>
          </Button>
          {/* Collapsed rail affordance: hover hint */}
          <div
            className={cn("hidden lg:flex items-center justify-center py-0.5", expanded && "lg:hidden")}
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

// ─── Permission guard screen ──────────────────────────────────────

function UnauthorizedScreen({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-dmk-input-well border border-dmk-border-subtle">
        <Lock className="h-8 w-8 text-dmk-warning" strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-[17px] font-bold text-dmk-text-primary">Unauthorized</p>
      <p className="mt-1.5 text-[12.5px] text-dmk-text-muted max-w-md leading-relaxed">
        This section is not enabled for your account — ask the owner to switch it on in Settings → Sales Team.
      </p>
      <Button
        onClick={onGoHome}
        className="mt-5 h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold"
      >
        <LayoutDashboard className="h-4 w-4" /> Go to Dashboard
      </Button>
    </div>
  );
}

// ─── Shared load-error card ───────────────────────────────────────

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="dmk-card p-4 space-y-3">
      <ErrorText>{message}</ErrorText>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
      >
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </div>
  );
}

function errorOf(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function payTone(mode: string): "success" | "info" | "gold" | "neutral" {
  switch (mode) {
    case "CASH":
      return "success";
    case "UPI":
    case "NEFT":
      return "info";
    case "CREDIT":
      return "gold";
    default:
      return "neutral";
  }
}

// ═══════════════════════════════════════════════════════════════
// HOME — Today's sales booked by me
// ═══════════════════════════════════════════════════════════════

function HomeView({
  session,
  onNavigate,
}: {
  session: { firmId: string; salesId?: string; salesName?: string; salesUsername?: string; salesPerms?: SalesPermissions };
  onNavigate: (v: SalesViewId) => void;
}) {
  const { toast } = useToast();
  const firmId = session.firmId;
  const salesId = session.salesId ?? "";
  const perms = session.salesPerms;

  const [invoices, setInvoices] = React.useState<SalesInvoiceRow[] | null>(null);
  const [orders, setOrders] = React.useState<SalesOrderRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!firmId || !salesId) return;
    setError(null);
    try {
      const [invRes, soRes] = await Promise.all([
        apiGet<SalesInvoiceRow[]>("/api/v1/invoices", { firmId, salesMemberId: salesId }),
        apiGet<{ orders: SalesOrderRow[] }>("/api/v1/sales-orders", { firmId, salesMemberId: salesId }),
      ]);
      setInvoices(invRes ?? []);
      setOrders(soRes?.orders ?? []);
    } catch (e) {
      const msg = errorOf(e, "Could not load your sales numbers.");
      setError(msg);
      toast({ variant: "destructive", title: "Load failed", description: msg });
    }
  }, [firmId, salesId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  const today = toISODate(new Date());
  const invList = invoices ?? [];
  const orderList = orders ?? [];

  const postedToday = invList.filter((i) => (i.invoiceDate ?? "").slice(0, 10) === today && i.status === "POSTED");
  const todaySum = round2(postedToday.reduce((s, i) => s + Number(i.grandTotal), 0));
  const counterToday = postedToday.filter((i) => i.isCounterSale);
  const counterTodaySum = round2(counterToday.reduce((s, i) => s + Number(i.grandTotal), 0));
  const allTimeSum = round2(invList.filter((i) => i.status === "POSTED").reduce((s, i) => s + Number(i.grandTotal), 0));
  const bookedOrders = orderList.filter((o) => o.status === "BOOKED");
  const bookedEstimate = round2(bookedOrders.reduce((s, o) => s + Number(o.estimatedTotal), 0));
  const recent = invList.slice(0, 8);

  const loading = invoices === null || orders === null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good day, ${(session.salesName ?? "there").split(" ")[0]}`}
        subtitle="Today's sales booked by you — every bill below carries your name"
        icon={ReceiptText}
      />

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {loading ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={6} />
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 dmk-enter-stagger">
            <KpiCard
              label="My invoices today"
              value={String(postedToday.length)}
              sub={`${formatINR(todaySum)} posted`}
              icon={ReceiptText}
              tone="gold"
            />
            <KpiCard
              label="My orders booked"
              value={String(bookedOrders.length)}
              sub={`${formatINR(bookedEstimate)} estimated`}
              icon={ClipboardList}
              tone="success"
            />
            <KpiCard
              label="My billings all-time"
              value={formatINR(allTimeSum)}
              sub={`${invList.filter((i) => i.status === "POSTED").length} bills total`}
              icon={FileStack}
              tone="yellow"
            />
            <KpiCard
              label="Counter sales today"
              value={String(counterToday.length)}
              sub={`${formatINR(counterTodaySum)} walk-in/buyer`}
              icon={ScanBarcode}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
            {/* Recent bills by me */}
            <section className="dmk-card overflow-hidden min-w-0">
              <div className="px-4 pt-3.5 pb-3 border-b border-dmk-border-subtle flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ReceiptText className="h-4 w-4 text-dmk-yellow shrink-0" strokeWidth={1.75} />
                  <h2 className="text-[13px] font-bold text-dmk-text-primary truncate">Recent bills by me</h2>
                  <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary shrink-0">{recent.length} shown</span>
                </div>
                {perms?.canB2BBilling && (
                  <Button
                    size="sm"
                    onClick={() => onNavigate("billing")}
                    className="h-8 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold shrink-0"
                  >
                    <Zap className="h-3.5 w-3.5" /> New B2B Bill
                  </Button>
                )}
              </div>
              {recent.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title="No bills yet"
                  hint="Bills you post from B2B Fast Billing or the Counter POS appear here instantly."
                />
              ) : (
                <div className="divide-y divide-dmk-border-subtle">
                  {recent.map((i) => (
                    <div key={i.id} className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-dmk-hover transition-colors min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-money text-[12.5px] font-bold text-dmk-gold">{i.invoiceNumber}</span>
                          {i.isCounterSale && <Badge tone="neutral">COUNTER</Badge>}
                          {!i.isCounterSale && <Badge tone="info">B2B</Badge>}
                        </div>
                        <p className="text-[11.5px] text-dmk-text-muted truncate mt-0.5">
                          {i.customer?.partyName || i.walkInName || "Walk-in"} · {formatDate(i.invoiceDate)}
                        </p>
                      </div>
                      <span className="font-money text-[13.5px] font-semibold text-dmk-text-primary shrink-0">
                        {formatINR(Number(i.grandTotal))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Right rail — quick actions + attribution */}
            <div className="space-y-4 min-w-0">
              <section className="dmk-card p-4">
                <h3 className="text-[11px] uppercase tracking-wider font-bold text-dmk-text-muted mb-3">Quick actions</h3>
                <div className="space-y-2">
                  {perms?.canB2BBilling && (
                    <Button onClick={() => onNavigate("billing")} className="w-full h-10 justify-start bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
                      <Zap className="h-4 w-4" /> B2B Fast Billing
                    </Button>
                  )}
                  {perms?.canB2CPos && (
                    <Button
                      onClick={() => onNavigate("b2c")}
                      variant="outline"
                      className="w-full h-10 justify-start border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                    >
                      <ScanBarcode className="h-4 w-4" /> B2C Counter POS
                    </Button>
                  )}
                  {perms?.canSalesOrders && (
                    <Button
                      onClick={() => onNavigate("orders")}
                      variant="outline"
                      className="w-full h-10 justify-start border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                    >
                      <ClipboardList className="h-4 w-4" /> Book a Sales Order
                    </Button>
                  )}
                </div>
              </section>

              <section className="dmk-card p-4 flex gap-3">
                <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                  <FileText className="h-5 w-5 text-dmk-yellow" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-dmk-text-primary">
                    Billed By: {session.salesName ?? "you"} (@{session.salesUsername ?? "you"})
                  </p>
                  <p className="text-[11.5px] text-dmk-text-muted mt-1 leading-relaxed">
                    Every bill, order and receipt you post is stamped with your name. The owner sees this
                    &ldquo;Billed By&rdquo; tag on each entry in the register — no need to tell anyone, your work speaks for itself.
                  </p>
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK CHECK — sellable quantities only (costs never leave the server)
// ═══════════════════════════════════════════════════════════════

function StockCheckView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [products, setProducts] = React.useState<StockProduct[] | null>(null);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setError(null);
    try {
      // salesPortal=1 → the API strips purchaseCost server-side before sending.
      const res = await apiGet<{ products: StockProduct[]; categories: string[] }>("/api/v1/products", {
        firmId: activeFirmId,
        activeOnly: true,
        salesPortal: 1,
      });
      setProducts(res.products ?? []);
      setCategories(res.categories ?? []);
    } catch (e) {
      const msg = errorOf(e, "Could not load products.");
      setError(msg);
      toast({ variant: "destructive", title: "Load failed", description: msg });
    }
  }, [activeFirmId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const s = query.trim().toLowerCase();
    return (products ?? []).filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
    );
  }, [products, query, category]);

  const outCount = filtered.filter((p) => Number(p.stockQuantity) <= 0).length;
  const lowCount = filtered.filter(
    (p) => Number(p.stockQuantity) > 0 && Number(p.stockQuantity) <= Number(p.lowStockThreshold)
  ).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Check"
        subtitle="Live sellable quantities for every active product — check before you promise the customer"
        icon={Boxes}
        actions={
          <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
            {products === null ? "…" : `${filtered.length} products`}
          </span>
        }
      />

      {/* Confidentiality banner */}
      <div className="dmk-well px-3.5 py-2.5 flex items-start gap-2.5">
        <ShieldCheck className="h-4 w-4 text-dmk-warning shrink-0 mt-0.5" />
        <p className="text-[11.5px] text-dmk-text-secondary leading-relaxed">
          Sellable quantities only — purchase costs are confidential.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search by product name or SKU…"
          className="sm:max-w-xs flex-1"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-full sm:w-[220px] bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-h-60">
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(outCount > 0 || lowCount > 0) && (
          <div className="flex items-center gap-2 sm:ml-auto">
            {outCount > 0 && <Badge tone="danger">{outCount} out of stock</Badge>}
            {lowCount > 0 && <Badge tone="warning">{lowCount} running low</Badge>}
          </div>
        )}
      </div>

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {products === null ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={6} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={Boxes}
            title="No products match"
            hint={products.length === 0 ? "No active products yet — the owner adds them from the Inventory section." : "Try a different search or category."}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
          {filtered.map((p) => {
            const qty = Number(p.stockQuantity);
            const isOut = qty <= 0;
            const isLow = !isOut && qty <= Number(p.lowStockThreshold);
            return (
              <section key={p.id} className="dmk-card p-4 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-dmk-text-primary truncate" title={p.name}>
                      {p.name}
                    </p>
                    <p className="font-money text-[10.5px] text-dmk-text-muted mt-0.5">{p.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "font-money text-[22px] font-bold leading-none",
                        isOut ? "text-dmk-danger" : isLow ? "text-dmk-warning" : "text-dmk-text-primary"
                      )}
                    >
                      {qty}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted mt-1">{p.unit}</p>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {p.category && <Badge tone="neutral">{p.category}</Badge>}
                  {p.brand && <Badge tone="neutral">{p.brand}</Badge>}
                  <Badge tone="warning">{p.gstRate}% GST</Badge>
                  {isOut && <Badge tone="danger">OUT OF STOCK</Badge>}
                  {isLow && <Badge tone="warning">LOW ≤ {p.lowStockThreshold}</Badge>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SALES ORDERS — book phone/counter orders, track + cancel
// ═══════════════════════════════════════════════════════════════

type OrderStatusFilter = "ALL" | "BOOKED" | "CONVERTED" | "CANCELLED";

function orderChipTone(status: string): "warning" | "success" | "danger" | "neutral" {
  if (status === "BOOKED") return "warning";
  if (status === "CONVERTED") return "success";
  if (status === "CANCELLED") return "danger";
  return "neutral";
}

function SalesOrdersView() {
  const { toast } = useToast();
  const session = useErpStore((s) => s.session);
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const salesId = session?.salesId ?? "";

  const [orders, setOrders] = React.useState<SalesOrderRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<OrderStatusFilter>("ALL");
  const [bookOpen, setBookOpen] = React.useState(false);
  const [cancelOf, setCancelOf] = React.useState<SalesOrderRow | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!activeFirmId || !salesId) return;
    setError(null);
    try {
      const res = await apiGet<{ orders: SalesOrderRow[] }>("/api/v1/sales-orders", {
        firmId: activeFirmId,
        salesMemberId: salesId,
      });
      setOrders(res?.orders ?? []);
    } catch (e) {
      const msg = errorOf(e, "Could not load your sales orders.");
      setError(msg);
      toast({ variant: "destructive", title: "Load failed", description: msg });
    }
  }, [activeFirmId, salesId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  const list = (orders ?? []).filter((o) => statusFilter === "ALL" || o.status === statusFilter);
  const bookedCount = (orders ?? []).filter((o) => o.status === "BOOKED").length;
  const bookedValue = round2((orders ?? []).filter((o) => o.status === "BOOKED").reduce((s, o) => s + Number(o.estimatedTotal), 0));

  async function confirmCancel() {
    if (!cancelOf) return;
    setCancelling(true);
    try {
      await apiPatch<SalesOrderRow>(`/api/v1/sales-orders/${cancelOf.id}`, { status: "CANCELLED" });
      toast({ title: `${cancelOf.orderNumber} cancelled`, description: "The order is marked CANCELLED in the order book." });
      setCancelOf(null);
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: "Cancel failed", description: errorOf(e, "Could not cancel the order.") });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Orders"
        subtitle="Orders you booked for customers — the office converts them into tax invoices"
        icon={ClipboardList}
        actions={
          <Button onClick={() => setBookOpen(true)} className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
            <Plus className="h-4 w-4" /> Book New Order
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", "BOOKED", "CONVERTED", "CANCELLED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={cn(
              "h-9 px-3.5 rounded-lg text-[12px] font-semibold border transition-colors",
              statusFilter === s
                ? "bg-dmk-yellow/15 border-dmk-yellow/50 text-dmk-yellow"
                : "bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
            )}
          >
            {s === "ALL" ? "All orders" : s}
          </button>
        ))}
        <span className="ml-auto dmk-badge bg-dmk-input-well text-dmk-text-secondary">
          {bookedCount} booked · {formatINR(bookedValue)} pending conversion
        </span>
      </div>

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {orders === null ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={6} />
        </div>
      ) : list.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={ClipboardList}
            title={statusFilter === "ALL" ? "No orders booked yet" : `No ${statusFilter} orders`}
            hint="Use “Book New Order” when a customer calls or messages — the office picks it up and bills it."
          />
        </div>
      ) : (
        <div className="dmk-card overflow-hidden">
          <div className="divide-y divide-dmk-border-subtle max-h-[calc(100vh-380px)] overflow-y-auto">
            {list.map((o) => {
              const itemCount = o.items?.length ?? o._count?.items ?? 0;
              return (
                <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-dmk-hover transition-colors min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-money text-[13px] font-bold text-dmk-gold">{o.orderNumber}</span>
                      <Badge tone={orderChipTone(o.status)}>{o.status}</Badge>
                      <span className="text-[11px] text-dmk-text-muted">{formatDate(o.orderDate)}</span>
                    </div>
                    <p className="text-[12.5px] text-dmk-text-secondary truncate mt-0.5">
                      {o.customer?.partyName ?? "—"}
                      {o.customer?.city ? ` · ${o.customer.city}` : ""}
                    </p>
                    {o.notes && <p className="text-[11px] text-dmk-text-muted truncate mt-0.5 italic">“{o.notes}”</p>}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                    <p className="font-money text-[14px] font-bold text-dmk-text-primary">{formatINR(Number(o.estimatedTotal))}</p>
                    <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">
                      {itemCount} item{itemCount === 1 ? "" : "s"} · est.
                    </p>
                    {o.status === "BOOKED" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCancelOf(o)}
                        className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancel confirmation */}
      <AlertDialog open={cancelOf !== null} onOpenChange={(o) => !o && setCancelOf(null)}>
        <AlertDialogContent className="dmk-elevated border-dmk-border-medium">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Cancel order {cancelOf?.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              This marks the order as CANCELLED in the register. It cannot be undone — book a fresh order if the customer
              calls back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-10 border-dmk-border-medium text-dmk-text-secondary">Keep order</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCancel();
              }}
              disabled={cancelling}
              className="h-10 bg-dmk-danger text-white hover:bg-dmk-danger/90 font-bold"
            >
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Book dialog — unmounts on close so the form resets every time */}
      {bookOpen && (
        <BookOrderDialog
          onClose={() => setBookOpen(false)}
          onBooked={() => {
            setBookOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ─── Book-order dialog: customer + item rows + estimated total ────

interface OrderDraftLine {
  product: StockProduct | null;
  qty: number;
  unitPrice: number;
}

function BookOrderDialog({ onClose, onBooked }: { onClose: () => void; onBooked: () => void }) {
  const { toast } = useToast();
  const session = useErpStore((s) => s.session);
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const canOverridePrice = Boolean(session?.salesPerms?.canOverridePrice);
  const salesId = session?.salesId ?? "";

  const [customers, setCustomers] = React.useState<SalesCustomerRow[] | null>(null);
  const [products, setProducts] = React.useState<StockProduct[] | null>(null);
  const [customerId, setCustomerId] = React.useState("");
  const [lines, setLines] = React.useState<OrderDraftLine[]>([]);
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load pickers once on open.
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    Promise.all([
      apiGet<SalesCustomerRow[]>("/api/v1/customers", { firmId: activeFirmId }),
      apiGet<{ products: StockProduct[] }>("/api/v1/products", {
        firmId: activeFirmId,
        activeOnly: true,
        salesPortal: 1,
      }),
    ])
      .then(([c, p]) => {
        if (!alive) return;
        // SOs are trade bookings — B2B buyers only.
        setCustomers((c ?? []).filter((x) => x.customerType === "B2B"));
        setProducts(p.products ?? []);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorOf(e, "Could not load customers or products."));
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  const estimatedTotal = round2(lines.reduce((s, l) => s + (l.product ? l.qty * l.unitPrice : 0), 0));
  const canSubmit = Boolean(customerId) && lines.some((l) => l.product && l.qty > 0);

  function addLine() {
    setLines((p) => [...p, { product: null, qty: 1, unitPrice: 0 }]);
  }

  function setLine(idx: number, patch: Partial<OrderDraftLine>) {
    setLines((p) => p.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function pickProduct(idx: number, product: StockProduct) {
    setLine(idx, { product, unitPrice: round2(Number(product.tier4Retailer)) });
  }

  async function submit() {
    if (!activeFirmId || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const order = await apiPost<SalesOrderRow>("/api/v1/sales-orders", {
        firmId: activeFirmId,
        customerId,
        notes: notes.trim(),
        // /sales portal attribution — stamp "Booked By" with the signed-in member.
        salesMemberId: salesId,
        items: lines
          .filter((l) => l.product && l.qty > 0)
          .map((l) => ({ productId: l.product!.id, quantity: l.qty, unitPrice: l.unitPrice })),
      });
      toast({
        title: `${order.orderNumber} booked`,
        description: `${formatINR(Number(order.estimatedTotal))} estimated — the office will convert it to a tax invoice.`,
      });
      onBooked();
    } catch (e) {
      setError(errorOf(e, "Could not book the order."));
    } finally {
      setBusy(false);
    }
  }

  const b2bCustomers = customers ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card sm:max-w-[780px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
            <ClipboardList className="h-5 w-5 text-dmk-yellow" /> Book new sales order
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            Record what the customer wants — quantities and rates are estimates until the office converts the order to a
            tax invoice.
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorText>{error}</ErrorText>}

        {/* Customer */}
        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Customer (trade / B2B)</Label>
          {customers === null ? (
            <div className="h-9 rounded-md bg-dmk-input-well border border-dmk-border-subtle flex items-center px-3">
              <Loader2 className="h-3.5 w-3.5 text-dmk-text-muted animate-spin" />
            </div>
          ) : b2bCustomers.length === 0 ? (
            <p className="text-[12px] text-dmk-text-muted py-1.5">
              No B2B customers yet — add one from Customers &amp; Buyers first.
            </p>
          ) : (
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="h-9 w-full bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary">
                <SelectValue placeholder="Select a trade customer" />
              </SelectTrigger>
              <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-h-60">
                {b2bCustomers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.partyName}
                    {c.city ? ` — ${c.city}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Item rows */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Items</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={addLine}
              disabled={products !== null && products.length === 0}
              className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
            >
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>

          {lines.length === 0 && (
            <p className="text-[12px] text-dmk-text-muted px-1 py-2">
              No items yet — click “Add item” and search for each product the customer asked for.
            </p>
          )}

          {lines.map((l, idx) => (
            <div key={idx} className="dmk-well p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                {l.product ? (
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-dmk-text-primary truncate">{l.product.name}</p>
                    <p className="font-money text-[10.5px] text-dmk-text-muted mt-0.5">
                      {l.product.sku} · {l.product.unit} · stock {Number(l.product.stockQuantity)}
                      {Number(l.product.stockQuantity) <= 0 ? " — out of stock!" : ""}
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    {products === null ? (
                      <p className="text-[12px] text-dmk-text-muted flex items-center gap-2 py-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading products…
                      </p>
                    ) : (
                      <ProductPicker products={products} onPick={(p) => pickProduct(idx, p)} />
                    )}
                  </div>
                )}
                <button
                  onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                  aria-label="Remove this item"
                  className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md border border-dmk-border-subtle text-dmk-text-muted hover:text-dmk-danger hover:border-dmk-danger/40 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {l.product && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => setLine(idx, { qty: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label={`Quantity for ${l.product.name}`}
                      className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] font-money text-right dmk-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Unit price</Label>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        value={l.unitPrice}
                        onChange={(e) => setLine(idx, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                        disabled={!canOverridePrice}
                        title={canOverridePrice ? undefined : "Price changes are not enabled for your account — the standard retailer rate applies"}
                        aria-label={`Unit price for ${l.product.name}`}
                        className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] font-money text-right pr-8 dmk-input disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      {!canOverridePrice && (
                        <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dmk-text-muted pointer-events-none" />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">Line total</Label>
                    <p className="font-money text-[14px] font-bold text-dmk-text-primary h-9 flex items-center justify-end tabular-nums">
                      {formatINR(round2(l.qty * l.unitPrice))}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Notes (optional)</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. deliver via Nagar route tomorrow morning, phone 98…"
            className="bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary"
          />
        </div>

        {/* Estimated total */}
        <div className="dmk-well px-4 py-3 flex items-center justify-between">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-dmk-text-muted">Estimated total</span>
          <span className="font-money text-[17px] font-bold text-dmk-yellow">{formatINR(estimatedTotal)}</span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="h-10 border-dmk-border-medium">
            Discard
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !canSubmit || customers === null || b2bCustomers.length === 0}
            className="h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
            {busy ? "Booking…" : "Book order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product typeahead picker for order lines ─────────────────────

function ProductPicker({ products, onPick }: { products: StockProduct[]; onPick: (p: StockProduct) => void }) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      : products;
    return base.slice(0, 8);
  }, [q, products]);

  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && matches.length > 0) {
            e.preventDefault();
            onPick(matches[0]);
          }
        }}
        placeholder="Search product by name or SKU…"
        aria-label="Search product"
        className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] dmk-input"
      />
      {open && matches.length > 0 && (
        <div
          className="absolute z-30 top-full mt-1 left-0 right-0 max-h-60 overflow-y-auto rounded-lg border border-dmk-border-medium bg-dmk-bg-tertiary shadow-xl"
          role="listbox"
          aria-label="Product matches"
        >
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(p);
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-dmk-hover text-left"
              role="option"
              aria-selected={false}
            >
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-dmk-text-primary truncate">{p.name}</span>
                <span className="block font-money text-[10.5px] text-dmk-text-muted">
                  {p.sku} · {p.unit} · stock {Number(p.stockQuantity)}
                </span>
              </span>
              <span className="font-money text-[12px] text-dmk-text-secondary shrink-0">
                {formatINR(Number(p.tier4Retailer))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MY INVOICES — register + detail dialog (no cost/margin columns)
// ═══════════════════════════════════════════════════════════════

function MyInvoicesView() {
  const { toast } = useToast();
  const session = useErpStore((s) => s.session);
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const salesId = session?.salesId ?? "";

  const [rows, setRows] = React.useState<SalesInvoiceRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!activeFirmId || !salesId) return;
    setError(null);
    try {
      const res = await apiGet<SalesInvoiceRow[]>("/api/v1/invoices", { firmId: activeFirmId, salesMemberId: salesId });
      setRows(res ?? []);
    } catch (e) {
      const msg = errorOf(e, "Could not load your invoices.");
      setError(msg);
      toast({ variant: "destructive", title: "Load failed", description: msg });
    }
  }, [activeFirmId, salesId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  const list = React.useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return rows ?? [];
    return (rows ?? []).filter(
      (i) =>
        i.invoiceNumber.toLowerCase().includes(s) ||
        (i.customer?.partyName ?? "").toLowerCase().includes(s) ||
        (i.walkInName ?? "").toLowerCase().includes(s)
    );
  }, [rows, query]);

  const totalValue = round2((rows ?? []).reduce((s, i) => s + Number(i.grandTotal), 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Invoices"
        subtitle="Every tax bill stamped with your name — B2B and counter sales"
        icon={FileStack}
        actions={
          <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
            {rows === null ? "…" : `${list.length} bills · ${formatINR(totalValue)}`}
          </span>
        }
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Search by bill number or customer…" className="sm:max-w-xs" />

      {error && <LoadError message={error} onRetry={() => void load()} />}

      {rows === null ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={8} />
        </div>
      ) : list.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={FileStack}
            title={rows.length === 0 ? "No bills yet" : "No bills match your search"}
            hint={rows.length === 0 ? "Bills you post appear here with your name stamped on them." : undefined}
          />
        </div>
      ) : (
        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Date</th>
                  <th>Customer / Walk-in</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setDetailId(i.id)}
                    className="cursor-pointer"
                    title="Open bill details"
                  >
                    <td>
                      <span className="font-money text-[12.5px] font-bold text-dmk-gold">{i.invoiceNumber}</span>
                      {i.isCounterSale && <span className="ml-2 dmk-badge dmk-badge-neutral">COUNTER</span>}
                    </td>
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(i.invoiceDate)}</td>
                    <td className="text-[12.5px] max-w-[220px] truncate">
                      {i.customer?.partyName || i.walkInName || "Walk-in"}
                      {i.walkInPhone ? <span className="font-money text-[11px] text-dmk-text-muted"> · {i.walkInPhone}</span> : null}
                    </td>
                    <td>
                      <Badge tone={payTone(i.paymentMode)}>{i.paymentMode}</Badge>
                    </td>
                    <td className="num text-[13px] font-semibold text-dmk-text-primary">{formatINR(Number(i.grandTotal))}</td>
                    <td>
                      <Badge tone={i.status === "POSTED" ? "success" : "neutral"}>{i.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailId && (
        <InvoiceDetailDialog
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const [detail, setDetail] = React.useState<SalesInvoiceDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    apiGet<SalesInvoiceDetail>(`/api/v1/invoices/${invoiceId}`)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(errorOf(e, "Could not load the bill."));
      });
    return () => {
      alive = false;
    };
  }, [invoiceId]);

  const tax = detail ? round2(Number(detail.totalCgst) + Number(detail.totalSgst) + Number(detail.totalIgst)) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap text-[15px] font-bold text-dmk-text-primary">
            <ReceiptText className="h-5 w-5 text-dmk-yellow" />
            <span className="font-money">{detail?.invoiceNumber ?? "Bill"}</span>
            <Badge tone="gold">Billed By: you</Badge>
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {detail
              ? `${formatDate(detail.invoiceDate)} · ${detail.customer?.partyName || detail.walkInName || "Walk-in"} · ${detail.paymentMode}`
              : "Loading bill…"}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorText>{error}</ErrorText>}

        {!detail && !error && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 text-dmk-text-muted animate-spin" />
          </div>
        )}

        {detail && (
          <>
            <div className="dmk-well overflow-x-auto [&>*]:min-w-0">
              <table className="dmk-table min-w-[560px]">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Taxable</th>
                    <th className="text-right">GST</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lineItems.map((li, idx) => (
                    <tr key={li.id ?? idx}>
                      <td>
                        <p className="text-[12.5px] font-medium whitespace-nowrap">{li.productName}</p>
                        <p className="text-[10.5px] text-dmk-text-muted font-money">{li.sku}</p>
                      </td>
                      <td className="num">{li.quantity}</td>
                      <td className="num">{formatINR(Number(li.unitPrice))}</td>
                      <td className="num">{formatINR(Number(li.taxableAmount))}</td>
                      <td className="num text-dmk-text-secondary">{li.gstRate}%</td>
                      <td className="num font-semibold">{formatINR(Number(li.totalAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="dmk-well p-3.5 space-y-1.5">
              <div className="flex justify-between text-[12.5px]">
                <span className="text-dmk-text-secondary">Subtotal</span>
                <span className="font-money text-dmk-text-primary">{formatINR(Number(detail.subtotal))}</span>
              </div>
              {Number(detail.discountTotal) > 0.005 && (
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-dmk-text-secondary">Discounts</span>
                  <span className="font-money text-dmk-gold">−{formatINR(Number(detail.discountTotal))}</span>
                </div>
              )}
              <div className="flex justify-between text-[12.5px]">
                <span className="text-dmk-text-secondary">GST (CGST {formatINR(Number(detail.totalCgst))} · SGST {formatINR(Number(detail.totalSgst))} · IGST {formatINR(Number(detail.totalIgst))})</span>
                <span className="font-money text-dmk-text-primary">{formatINR(tax)}</span>
              </div>
              {Math.abs(Number(detail.roundOff)) > 0.005 && (
                <div className="flex justify-between text-[12.5px]">
                  <span className="text-dmk-text-secondary">Round off</span>
                  <span className="font-money text-dmk-text-secondary">{formatINR(Number(detail.roundOff))}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-dmk-border-subtle pt-2">
                <span className="text-[13px] font-bold text-dmk-text-primary">Grand total</span>
                <span className="font-money text-[16px] font-bold text-dmk-yellow">{formatINR(Number(detail.grandTotal))}</span>
              </div>
            </div>

            <p className="text-[11px] text-dmk-text-muted flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-dmk-success" />
              This bill is stamped <span className="font-semibold text-dmk-text-secondary">&ldquo;Billed By: you&rdquo;</span> in the owner&rsquo;s register.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
