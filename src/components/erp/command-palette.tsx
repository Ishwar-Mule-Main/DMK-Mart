"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — COMMAND PALETTE (⌘K)
// Navigation · quick actions · deep search (products / parties /
// invoices) · firm switching. Grounded in active firm context.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  LayoutDashboard, Zap, ScanBarcode, FileStack, Undo2, Users, Receipt,
  ClipboardList, UndoIcon, Banknote, Truck, Package, Boxes, ArrowLeftRight,
  MapPinned, Route as RouteIcon, IdCard,
  FileText, AlertTriangle, BookOpen, ListTree, Landmark, BookUser, PieChart,
  CalendarDays, CalendarClock, Timer, FileCheck2, FileWarning, BarChart3, Bot, Settings,
  Plus, Building2, Search, CornerDownLeft, RefreshCw, GitCompareArrows, Trash2,
  UsersRound,
} from "lucide-react";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { useErpStore, type ViewId } from "@/store/erp-store";
import { apiGet } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { rankSearch } from "@/lib/search-rank";
import type { Product, Customer, Invoice } from "@/types/erp";

interface NavItem { id: ViewId; label: string; icon: React.ElementType; shortcut?: string }

const NAV_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Go to",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
      { id: "sales/billing", label: "Fast Billing (B2B)", icon: Zap, shortcut: "G B" },
      { id: "sales/b2c", label: "B2C Counter", icon: ScanBarcode, shortcut: "G C" },
      { id: "sales/invoices", label: "Invoice Register", icon: FileStack },
      { id: "sales/returns", label: "Sales Returns", icon: Undo2 },
      { id: "sales/customers", label: "Customers & Buyers", icon: Users },
      { id: "sales/receipts", label: "Receipts", icon: Receipt },
      { id: "sales/recurring", label: "Recurring Billing", icon: CalendarClock },
      { id: "logistics/unassigned", label: "Unassigned Orders", icon: MapPinned },
      { id: "logistics/planner", label: "Trip Planner", icon: RouteIcon },
      { id: "logistics/trips", label: "Trips & Settlement", icon: Truck },
      { id: "logistics/drivers", label: "Drivers", icon: IdCard },
      { id: "purchase/orders", label: "Purchase Orders", icon: ClipboardList, shortcut: "G P" },
      { id: "purchase/returns", label: "Purchase Returns", icon: UndoIcon },
      { id: "purchase/payments", label: "Vendor Payments", icon: Banknote },
      { id: "purchase/vendors", label: "Vendors", icon: Truck },
      { id: "inventory/products", label: "Products", icon: Package },
      { id: "inventory/stock", label: "Stock Levels", icon: Boxes },
      { id: "inventory/movements", label: "Stock Movements", icon: ArrowLeftRight },
      { id: "inventory/bulk-upload", label: "Bulk Upload", icon: FileText },
      { id: "inventory/low-stock", label: "Low Stock Alerts", icon: AlertTriangle },
      { id: "finance/journals", label: "Journals", icon: BookOpen },
      { id: "finance/coa", label: "Chart of Accounts", icon: ListTree },
      { id: "finance/ledgers", label: "Party Ledgers", icon: Landmark },
      { id: "finance/sundry", label: "Sundry Debtors / Creditors", icon: BookUser },
      { id: "finance/statements", label: "Statements (TB · P&L · BS)", icon: PieChart },
      { id: "finance/daybook", label: "Day Book", icon: CalendarDays },
      { id: "finance/aging", label: "AR / AP Aging", icon: Timer },
      { id: "finance/gstr2b", label: "GSTR-2B Recon", icon: GitCompareArrows },
      { id: "docs/invoices", label: "Tax Invoices (A4)", icon: FileCheck2 },
      { id: "docs/notes", label: "Credit / Debit Notes", icon: FileWarning },
      { id: "reports", label: "Reports & Exports", icon: BarChart3 },
      { id: "ai", label: "AI Copilot", icon: Bot, shortcut: "G A" },
      { id: "data/deleted", label: "Deleted Data (Recycle Bin)", icon: Trash2 },
      { id: "sales/team", label: "Sales Team Management", icon: UsersRound },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const ACTIONS: Array<{ id: string; label: string; icon: React.ElementType; view: ViewId; hint: string }> = [
  { id: "act-sale", label: "New B2B Sale", icon: Plus, view: "sales/billing", hint: "Fast billing with tier pricing" },
  { id: "act-counter", label: "New Counter Sale", icon: ScanBarcode, view: "sales/b2c", hint: "B2C walk-in POS" },
  { id: "act-po", label: "New Purchase Order", icon: ClipboardList, view: "purchase/new-order", hint: "Billing-style PO draft — vendor-scoped products" },
  { id: "act-receipt", label: "Record Customer Receipt", icon: Receipt, view: "sales/receipts", hint: "Collect receivable" },
  { id: "act-recurring", label: "New Recurring Template", icon: Plus, view: "sales/recurring", hint: "Standing-order auto billing" },
  { id: "act-payment", label: "Record Vendor Payment", icon: Banknote, view: "purchase/payments", hint: "Pay payable" },
  { id: "act-product", label: "Add Product", icon: Package, view: "inventory/products", hint: "5-tier pricing master" },
  { id: "act-firm", label: "Create / Switch Firm", icon: Building2, view: "settings", hint: "Owner workspace" },
];

type SearchHits = {
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
};

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHits>({ products: [], customers: [], invoices: [] });
  const [searching, setSearching] = React.useState(false);

  const { setView, firms, activeFirmId, setActiveFirm } = useErpStore();

  // Global hotkey: ⌘K / Ctrl+K (also "/" when not typing)
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openEvent = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("dmk:open-palette", openEvent);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("dmk:open-palette", openEvent);
    };
  }, []);

  // Deep search (debounced) when a firm is active and query ≥ 2 chars
  React.useEffect(() => {
    const q = query.trim();
    if (!activeFirmId || q.length < 2) {
      setHits({ products: [], customers: [], invoices: [] });
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const [p, c, i] = await Promise.allSettled([
        apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, search: q, activeOnly: "true" }),
        apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, search: q }),
        apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, search: q }),
      ]);
      const arr = <T,>(v: PromiseSettledResult<T>, fallback: T): T => (v.status === "fulfilled" ? v.value : fallback);
      const rawProducts = Array.isArray(arr(p, { products: [] } as Product[] | { products: Product[] }))
        ? (arr(p, { products: [] }) as Product[])
        : ((arr(p, { products: [] }) as { products: Product[] }).products ?? []);
      const rawCustomers = Array.isArray(arr(c, [] as Customer[])) ? (arr(c, [] as Customer[]) as Customer[]) : [];
      const rawInvoices = Array.isArray(arr(i, [] as Invoice[])) ? (arr(i, [] as Invoice[]) as Invoice[]) : [];
      // The APIs return ranked/filtered rows already — re-rank client-side so
      // the palette shows the best 5 word-wise hits (not just the first 5).
      setHits({
        products: rankSearch(rawProducts, q, (p) => [p.sku, p.name, p.brand ?? ""]).slice(0, 5),
        customers: rankSearch(rawCustomers, q, (c) => [c.partyName, c.phone, c.city]).slice(0, 5),
        invoices: rankSearch(rawInvoices, q, (v) => [v.invoiceNumber, v.customer?.partyName ?? "", v.walkInName ?? ""]).slice(0, 5),
      });
      setSearching(false);
    }, 220);
    return () => clearTimeout(t);
  }, [query, activeFirmId]);

  const go = React.useCallback((view: ViewId) => { setView(view); setOpen(false); setQuery(""); }, [setView]);

  const q = query.trim();
  // Word-wise ranked matching (best-first; empty query keeps original order).
  const filteredNav = React.useMemo(
    () => rankSearch(NAV_GROUPS[0].items, q, (i) => [i.label, i.id]),
    [q]
  );
  const filteredActions = React.useMemo(
    () => rankSearch(ACTIONS, q, (a) => [a.label, a.hint, a.id]),
    [q]
  );
  const firmHits = React.useMemo(
    () => rankSearch(firms, q, (f) => [f.firmName, f.firmCode]),
    [firms, q]
  );
  const hasResults =
    filteredNav.length > 0 || filteredActions.length > 0 || firmHits.length > 0 ||
    hits.products.length > 0 || hits.customers.length > 0 || hits.invoices.length > 0 || searching;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}
      className="border-dmk-border-medium"
      title="DMK Mart Command Palette"
      description="Navigate, act, or search — everything is one shortcut away."
    >
      <CommandInput
        placeholder="Search views, actions, products, parties, invoices…"
        value={query}
        onValueChange={setQuery}
        className="h-11 text-[13.5px]"
      />
      <CommandList className="max-h-[420px]">
        {!hasResults && <CommandEmpty>No matches. Try a SKU, party name, or invoice number.</CommandEmpty>}

        {filteredActions.length > 0 && (
          <CommandGroup heading="Quick Actions">
            {filteredActions.map((a) => {
              const Icon = a.icon;
              return (
                <CommandItem key={a.id} value={`action-${a.label} ${a.hint} ${a.id}`} onSelect={() => go(a.view)} className="gap-2.5">
                  <Icon className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
                  <span className="text-[13px] font-medium">{a.label}</span>
                  <span className="ml-auto text-[10.5px] text-dmk-text-muted">{a.hint}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {hits.products.length > 0 && (
          <CommandGroup heading="Products">
            {hits.products.map((p) => (
              <CommandItem key={p.id} value={`product-${p.sku}-${p.name}`} onSelect={() => go("inventory/products")} className="gap-2.5">
                <Package className="h-4 w-4 text-dmk-info" strokeWidth={1.75} />
                <span className="font-mono text-[11px] text-dmk-text-muted">{p.sku}</span>
                <span className="text-[13px] truncate">{p.name}</span>
                <span className="ml-auto font-money text-[11.5px] text-dmk-text-secondary">stock {p.stockQuantity}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hits.customers.length > 0 && (
          <CommandGroup heading="Parties">
            {hits.customers.map((c) => (
              <CommandItem key={c.id} value={`customer-${c.partyName}-${c.phone}`} onSelect={() => go("sales/customers")} className="gap-2.5">
                <Users className="h-4 w-4 text-dmk-success" strokeWidth={1.75} />
                <span className="text-[13px] truncate">{c.partyName}</span>
                {c.phone && <span className="font-mono text-[11px] text-dmk-text-muted">{c.phone}</span>}
                <span className="ml-auto font-money text-[11.5px] text-dmk-text-secondary">
                  {c.customerType === "B2B" ? `Dr ${formatINR(c.closingBalance)}` : `${c.visitCount} visits`}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hits.invoices.length > 0 && (
          <CommandGroup heading="Invoices">
            {hits.invoices.map((inv) => (
              <CommandItem key={inv.id} value={`invoice-${inv.invoiceNumber}`} onSelect={() => go("docs/invoices")} className="gap-2.5">
                <FileCheck2 className="h-4 w-4 text-dmk-gold" strokeWidth={1.75} />
                <span className="font-mono text-[11.5px]">{inv.invoiceNumber}</span>
                <span className="text-[12.5px] truncate text-dmk-text-secondary">
                  {inv.isCounterSale ? inv.walkInName || "Counter" : inv.customer?.partyName || "—"}
                </span>
                <span className="ml-auto font-money text-[11.5px] text-dmk-yellow">{formatINR(inv.grandTotal)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {firmHits.length > 0 && (
          <CommandGroup heading="Switch Firm">
            {firmHits.map((f) => (
              <CommandItem
                key={f.id}
                value={`firm-${f.firmName} ${f.firmCode}`}
                onSelect={() => { setActiveFirm(f.id); setOpen(false); setQuery(""); }}
                className="gap-2.5"
              >
                <Building2 className="h-4 w-4 text-dmk-blue" strokeWidth={1.75} />
                <span className="text-[13px]">{f.firmName}</span>
                <span className="font-mono text-[10.5px] text-dmk-text-muted">{f.firmCode}</span>
                {f.id === activeFirmId && <span className="ml-auto text-[10px] font-bold text-dmk-gold">● ACTIVE</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {filteredNav.length > 0 && (
          <CommandGroup heading="Go to">
            {filteredNav.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.id} value={`nav-${item.label} ${item.id}`} onSelect={() => go(item.id)} className="gap-2.5">
                  <Icon className="h-4 w-4 text-dmk-text-secondary" strokeWidth={1.75} />
                  <span className="text-[13px]">{item.label}</span>
                  {item.shortcut && <CommandShortcut className="font-mono text-[10px] text-dmk-text-muted">{item.shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        <CommandSeparator className="bg-dmk-border-subtle" />
        <div className="px-3 py-2 flex items-center justify-between text-[10px] text-dmk-text-muted">
          <span className="flex items-center gap-1.5"><Search className="h-3 w-3" /> Deep search hits open in their module</span>
          <span className="flex items-center gap-1.5"><CornerDownLeft className="h-3 w-3" /> select · <RefreshCw className="h-3 w-3" /> live data</span>
        </div>
      </CommandList>
    </CommandDialog>
  );
}

/** Header button that opens the palette (rendered by Header). */
export function CommandPaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="hidden md:flex h-9 items-center gap-2 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 text-[12px] text-dmk-text-muted hover:bg-dmk-hover hover:text-dmk-text-secondary transition-colors"
      aria-label="Open command palette"
    >
      <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span>Search everything…</span>
      <kbd className="pointer-events-none ml-2 rounded border border-dmk-border-subtle bg-dmk-bg-primary px-1.5 py-0.5 font-mono text-[9.5px] text-dmk-text-muted">⌘K</kbd>
    </button>
  );
}
