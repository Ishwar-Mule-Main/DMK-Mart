"use client";

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Menu,
  Building2,
  CalendarRange,
  Bell,
  ChevronDown,
  Plus,
  CircleUser,
  ShieldCheck,
  Search,
  AlertTriangle,
  Timer,
  FileWarning,
  CheckCircle2,
  PackageX,
} from "lucide-react";
import { useErpStore, type ViewId } from "@/store/erp-store";
import { apiGet, apiPost } from "@/lib/api-client";
import { requestAgingTab } from "@/lib/settle-bus";
import { formatINR } from "@/lib/format";
import type { Firm, LowStockItem } from "@/types/erp";
import { cn } from "@/lib/utils";

const FYS = ["2025-26", "2026-27", "2027-28"];

interface NotificationItem {
  id: string;
  kind: "stock" | "receivable" | "gst";
  title: string;
  detail: string;
  view: ViewId;
  /** presets the aging tab when relevant */
  agingTab?: string;
  severity: "warning" | "danger" | "info";
}

export function Header() {
  const { firms, activeFirmId, setActiveFirm, financialYear, setFinancialYear, setSidebarOpen, sidebarOpen, setView } =
    useErpStore();
  const firm = firms.find((f) => f.id === activeFirmId);
  const [alerts, setAlerts] = React.useState<LowStockItem[]>([]);
  const [overdue, setOverdue] = React.useState<{ count: number; amount: number } | null>(null);
  const [gstRisk, setGstRisk] = React.useState<{ missingInBooks: number; netItcRisk: number } | null>(null);
  const [bellOpen, setBellOpen] = React.useState(false);

  const refreshAlerts = React.useCallback(async () => {
    if (!activeFirmId) return;
    // Cycle 17: the bell is now a real triage feed — stock + overdue
    // receivables + GSTR-2B exceptions, fetched in parallel.
    const [stockRes, agingRes, gstRes] = await Promise.allSettled([
      apiGet<LowStockItem[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId }),
      apiGet<{ totals?: { overdueInvoices?: number; overdue?: number } }>("/api/v1/ledger/aging-invoices", {
        firmId: activeFirmId,
      }),
      apiGet<{ summary?: { missingInBooks?: number; netItcRisk?: number } }>("/api/v1/gstr2b", {
        firmId: activeFirmId,
        period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      }),
    ]);
    setAlerts(stockRes.status === "fulfilled" ? stockRes.value ?? [] : []);
    const t = agingRes.status === "fulfilled" ? agingRes.value?.totals : undefined;
    setOverdue({ count: t?.overdueInvoices ?? 0, amount: t?.overdue ?? 0 });
    const s = gstRes.status === "fulfilled" ? gstRes.value?.summary : undefined;
    setGstRisk({ missingInBooks: s?.missingInBooks ?? 0, netItcRisk: s?.netItcRisk ?? 0 });
  }, [activeFirmId]);

  React.useEffect(() => {
    refreshAlerts();
    const t = setInterval(refreshAlerts, 60000);
    return () => clearInterval(t);
  }, [refreshAlerts]);

  const createFirm = async () => {
    // opens settings view to create firm
    useErpStore.getState().setView("settings");
  };

  const openPalette = () => window.dispatchEvent(new Event("dmk:open-palette"));

  const gstExceptions = (gstRisk?.missingInBooks ?? 0) + ((gstRisk?.netItcRisk ?? 0) > 0.009 ? 1 : 0);
  const notifCount = alerts.length + (overdue && overdue.count > 0 ? 1 : 0) + gstExceptions;
  const urgent = (overdue?.amount ?? 0) > 0.009 || (gstRisk?.netItcRisk ?? 0) > 0.009;

  const notifications = React.useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];
    if (overdue && overdue.count > 0) {
      items.push({
        id: "overdue-ar",
        kind: "receivable",
        title: `${overdue.count} invoice${overdue.count !== 1 ? "s" : ""} overdue`,
        detail: `${formatINR(overdue.amount)} past credit terms — collect now`,
        view: "finance/aging",
        agingTab: "inv",
        severity: "danger",
      });
    }
    if (gstRisk && (gstRisk.missingInBooks > 0 || gstRisk.netItcRisk > 0.009)) {
      items.push({
        id: "gst-risk",
        kind: "gst",
        title: `GSTR-2B: ${gstRisk.missingInBooks} in portal, not in books`,
        detail:
          gstRisk.netItcRisk > 0.009
            ? `${formatINR(gstRisk.netItcRisk)} ITC at risk this period`
            : "Reconcile before filing to protect ITC",
        view: "finance/gstr2b",
        severity: gstRisk.netItcRisk > 0.009 ? "danger" : "warning",
      });
    }
    for (const a of alerts.slice(0, 4)) {
      items.push({
        id: `stock-${a.productId}`,
        kind: "stock",
        title: `${a.name} below threshold`,
        detail: `${a.sku} · sellable ${a.stockQuantity} ≤ threshold ${a.lowStockThreshold}`,
        view: "inventory/low-stock",
        severity: "warning",
      });
    }
    if (alerts.length > 4) {
      items.push({
        id: "stock-more",
        kind: "stock",
        title: `${alerts.length - 4} more products below threshold`,
        detail: "Open Low Stock Alerts to restock",
        view: "inventory/low-stock",
        severity: "warning",
      });
    }
    return items;
  }, [alerts, overdue, gstRisk]);

  function openNotification(n: NotificationItem) {
    if (n.agingTab) requestAgingTab(n.agingTab);
    setView(n.view);
    setBellOpen(false);
  }

  return (
    <header className="fixed top-0 inset-x-0 z-[60] h-14 bg-[#0D1527]/90 backdrop-blur-md border-b border-dmk-border-subtle">
      <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        {/* Brand */}
        <div className="hidden md:flex items-center gap-2 pr-2">
          <div className="h-8 w-8 rounded-lg bg-dmk-gold flex items-center justify-center">
            <span className="text-[13px] font-black text-[#0A0F1D]">D</span>
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-bold text-dmk-text-primary">DMK Mart</p>
            <p className="text-[9.5px] uppercase tracking-widest text-dmk-text-muted">ERP Platform</p>
          </div>
        </div>

        {/* Firm switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 px-2.5 gap-2 bg-dmk-input-well border border-dmk-border-subtle hover:bg-dmk-hover max-w-[220px]"
            >
              <Building2 className="h-4 w-4 text-dmk-blue shrink-0" strokeWidth={1.75} />
              <span className="truncate text-[12.5px] font-semibold text-dmk-text-primary">
                {firm ? firm.firmName : "Select Firm"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-dmk-text-muted shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 bg-dmk-bg-tertiary border-dmk-border-medium">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-dmk-text-muted">
              Firms · Owner Workspace
            </DropdownMenuLabel>
            {firms.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => setActiveFirm(f.id)}
                className={cn(
                  "gap-2 text-[13px] cursor-pointer",
                  f.id === activeFirmId && "bg-dmk-hover"
                )}
              >
                <Building2 className="h-4 w-4 text-dmk-text-muted" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{f.firmName}</p>
                  <p className="text-[10.5px] text-dmk-text-muted">
                    {f.firmCode} · GSTIN {f.gstin || "—"}
                  </p>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-dmk-border-subtle" />
            <DropdownMenuItem onClick={createFirm} className="gap-2 text-[13px] cursor-pointer text-dmk-gold">
              <Plus className="h-4 w-4" /> Create / Manage Firms
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* FY switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-9 px-2.5 gap-2 bg-dmk-input-well border border-dmk-border-subtle hover:bg-dmk-hover hidden sm:inline-flex"
            >
              <CalendarRange className="h-4 w-4 text-dmk-gold" strokeWidth={1.75} />
              <span className="text-[12.5px] font-semibold text-dmk-text-primary">FY {financialYear || "—"}</span>
              <ChevronDown className="h-3.5 w-3.5 text-dmk-text-muted" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-dmk-bg-tertiary border-dmk-border-medium">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-dmk-text-muted">
              Financial Year (Apr–Mar)
            </DropdownMenuLabel>
            {FYS.map((fy) => (
              <DropdownMenuItem
                key={fy}
                onClick={() => setFinancialYear(fy)}
                className={cn("text-[13px] cursor-pointer", fy === financialYear && "bg-dmk-hover")}
              >
                FY {fy}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        {/* Command palette trigger (⌘K) */}
        <button
          onClick={openPalette}
          className="hidden md:flex h-9 items-center gap-2 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 text-[12px] text-dmk-text-muted hover:bg-dmk-hover hover:text-dmk-text-secondary transition-colors"
          aria-label="Open command palette (Cmd+K)"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Search everything…</span>
          <kbd className="pointer-events-none ml-2 rounded border border-dmk-border-subtle bg-dmk-bg-primary px-1.5 py-0.5 font-mono text-[9.5px] text-dmk-text-muted">⌘K</kbd>
        </button>
        <button
          onClick={openPalette}
          className="md:hidden h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary"
          aria-label="Search"
        >
          <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>

        {/* Notifications — triage feed (cycle 17) */}
        <DropdownMenu open={bellOpen} onOpenChange={setBellOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary"
              aria-label={notifCount > 0 ? `${notifCount} notifications` : "Notifications"}
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {notifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-dmk-orange text-[9.5px] font-bold text-white flex items-center justify-center">
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
              {urgent && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-dmk-danger animate-pulse" aria-hidden />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[340px] bg-dmk-bg-tertiary border-dmk-border-medium p-0 overflow-hidden"
          >
            <div className="px-3 py-2.5 border-b border-dmk-border-subtle flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-dmk-warning" /> Action Center
              </p>
              {notifCount > 0 ? (
                <span className="dmk-badge bg-dmk-orange/15 text-dmk-orange text-[9.5px] px-1.5 py-0.5">{notifCount}</span>
              ) : (
                <span className="dmk-badge bg-dmk-success/15 text-dmk-success text-[9.5px] px-1.5 py-0.5">ALL CLEAR</span>
              )}
            </div>
            {notifCount === 0 ? (
              <div className="px-3 py-6 text-center">
                <CheckCircle2 className="h-6 w-6 text-dmk-success mx-auto mb-2" />
                <p className="text-[12.5px] text-dmk-text-secondary font-medium">Nothing needs your attention</p>
                <p className="text-[11px] text-dmk-text-muted mt-1">Stock, collections and GST are all healthy.</p>
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto py-1">
                {notifications.map((n) => {
                  const Icon = n.kind === "stock" ? PackageX : n.kind === "receivable" ? Timer : FileWarning;
                  const tone =
                    n.severity === "danger"
                      ? "text-dmk-danger"
                      : n.severity === "warning"
                        ? "text-dmk-warning"
                        : "text-dmk-info";
                  return (
                    <DropdownMenuItem
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className="flex-col items-start gap-0.5 cursor-pointer px-3 py-2"
                    >
                      <span className="flex items-start gap-2 w-full">
                        <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone)} strokeWidth={1.75} />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-medium truncate w-full">{n.title}</span>
                          <span className="block text-[10.5px] text-dmk-text-muted font-money">{n.detail}</span>
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            )}
            {notifCount > 0 && (
              <DropdownMenuSeparator className="bg-dmk-border-subtle my-1" />
            )}
            {notifCount > 0 && (
              <DropdownMenuItem
                onClick={() => {
                  refreshAlerts();
                  setBellOpen(false);
                }}
                className="gap-2 text-[11.5px] cursor-pointer text-dmk-text-muted justify-center"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Re-check now
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Owner */}
        <div className="h-9 w-9 rounded-full bg-dmk-blue/20 border border-dmk-blue/40 flex items-center justify-center">
          <CircleUser className="h-5 w-5 text-dmk-blue" strokeWidth={1.75} />
        </div>
      </div>
    </header>
  );
}
