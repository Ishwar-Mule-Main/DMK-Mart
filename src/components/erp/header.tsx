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
  ShieldCheck,
  Search,
  AlertTriangle,
  Timer,
  FileWarning,
  CheckCircle2,
  Check,
  KeyRound,
  Pencil,
  PackageX,
  ClipboardCheck,
  LogOut,
} from "lucide-react";
import { CompanyDetailsDialog, ChangePasswordDialog } from "@/components/erp/company-dialogs";
import { useErpStore, type ViewId } from "@/store/erp-store";
import { useFinancialYears } from "./fy-gate";
import { apiGet, apiPost } from "@/lib/api-client";
import { currentFyLabel, nextFyLabel } from "@/lib/fy";
import { requestAgingTab } from "@/lib/settle-bus";
import { formatINR } from "@/lib/format";
import type { Firm, LowStockItem } from "@/types/erp";
import { OWNER_USERNAME } from "@/components/auth/login-gate";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  kind: "stock" | "receivable" | "gst" | "verification";
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
  // FY options come from the firm's financial-year registry — the list grows
  // when a new year is opened (automatically on 1 Apr, or from this menu).
  const { years: fyYears, createYear: createFyYear } = useFinancialYears(activeFirmId);
  const [fyCreating, setFyCreating] = React.useState(false);
  const nextFy = nextFyLabel(fyYears.at(-1)?.label ?? (financialYear || currentFyLabel()));
  const nextFyMissing = fyYears.length > 0 && !fyYears.some((y) => y.label === nextFy);
  async function handleCreateNextFy() {
    if (fyCreating) return;
    setFyCreating(true);
    try {
      await createFyYear(nextFy, { activate: false });
      setFinancialYear(nextFy);
    } catch {
      /* the gate will surface creation errors */
    } finally {
      setFyCreating(false);
    }
  }
  const [alerts, setAlerts] = React.useState<LowStockItem[]>([]);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = React.useState(false);
  const refreshFirmsList = React.useCallback(async () => {
    try {
      const list = await apiGet<Firm[]>("/api/v1/firms");
      useErpStore.getState().setFirms(list ?? []);
    } catch {
      /* header keeps the cached names until the next refresh */
    }
  }, []);
  const [overdue, setOverdue] = React.useState<{ count: number; amount: number } | null>(null);
  const [gstRisk, setGstRisk] = React.useState<{ missingInBooks: number; netItcRisk: number } | null>(null);
  const [verifyWaiting, setVerifyWaiting] = React.useState(0);
  const [bellOpen, setBellOpen] = React.useState(false);

  const refreshAlerts = React.useCallback(async () => {
    if (!activeFirmId) return;
    // Cycle 23: the bell is a four-way triage feed — stock + overdue
    // receivables + GSTR-2B exceptions + verification submissions.
    const [stockRes, agingRes, gstRes, verifyRes] = await Promise.allSettled([
      apiGet<LowStockItem[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId }),
      apiGet<{ totals?: { overdueInvoices?: number; overdue?: number } }>("/api/v1/ledger/aging-invoices", {
        firmId: activeFirmId,
      }),
      apiGet<{ summary?: { missingInBooks?: number; netItcRisk?: number } }>("/api/v1/gstr2b", {
        firmId: activeFirmId,
        period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      }),
      apiGet<unknown[]>("/api/v1/verification", { firmId: activeFirmId, status: "SUBMITTED" }),
    ]);
    setAlerts(stockRes.status === "fulfilled" ? stockRes.value ?? [] : []);
    const t = agingRes.status === "fulfilled" ? agingRes.value?.totals : undefined;
    setOverdue({ count: t?.overdueInvoices ?? 0, amount: t?.overdue ?? 0 });
    const s = gstRes.status === "fulfilled" ? gstRes.value?.summary : undefined;
    setGstRisk({ missingInBooks: s?.missingInBooks ?? 0, netItcRisk: s?.netItcRisk ?? 0 });
    setVerifyWaiting(verifyRes.status === "fulfilled" ? (verifyRes.value ?? []).length : 0);
  }, [activeFirmId]);

  React.useEffect(() => {
    refreshAlerts();
    const t = setInterval(refreshAlerts, 60000);
    return () => clearInterval(t);
  }, [refreshAlerts]);

  const openPalette = () => window.dispatchEvent(new Event("dmk:open-palette"));

  const gstExceptions = (gstRisk?.missingInBooks ?? 0) + ((gstRisk?.netItcRisk ?? 0) > 0.009 ? 1 : 0);
  const notifCount =
    alerts.length + (overdue && overdue.count > 0 ? 1 : 0) + gstExceptions + (verifyWaiting > 0 ? 1 : 0);
  const urgent = (overdue?.amount ?? 0) > 0.009 || (gstRisk?.netItcRisk ?? 0) > 0.009;

  const notifications = React.useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];
    if (verifyWaiting > 0) {
      items.push({
        id: "verify-submitted",
        kind: "verification",
        title: `${verifyWaiting} PO verification${verifyWaiting !== 1 ? "s" : ""} waiting on you`,
        detail: "Team counted sellable vs damaged — accept to book stock & payable",
        view: "purchase/verification",
        severity: "info",
      });
    }
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
  }, [alerts, overdue, gstRisk, verifyWaiting]);

  function openNotification(n: NotificationItem) {
    if (n.agingTab) requestAgingTab(n.agingTab);
    setView(n.view);
    setBellOpen(false);
  }

  return (
    <header className="fixed top-0 inset-x-0 z-[60] h-14 bg-[#0D1527]/90 backdrop-blur-md border-b border-dmk-border-subtle">
      <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
        {/* Sidebar toggle — mobile drawer only. On desktop the sidebar is an
            always-minimized rail that expands on hover, so this button is hidden. */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary lg:hidden"
          aria-label={sidebarOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={sidebarOpen}
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        {/* Brand */}
        <div className="hidden md:flex items-center gap-2 pr-2">
          <img src="/dmk-logo.png" alt="DMK Mart logo" width={32} height={32} className="rounded-full" />
          <div className="leading-tight">
            <p className="text-[13px] font-bold text-dmk-text-primary">DMK Mart</p>
            <p className="text-[9.5px] uppercase tracking-widest text-dmk-yellow">ERP Platform</p>
          </div>
        </div>

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
            {(fyYears.length > 0 ? fyYears.map((y) => y.label) : financialYear ? [financialYear] : []).map((fy) => (
              <DropdownMenuItem
                key={fy}
                onClick={() => setFinancialYear(fy)}
                className={cn("text-[13px] cursor-pointer", fy === financialYear && "bg-dmk-hover")}
              >
                <span className="flex items-center gap-2">
                  FY {fy}
                  {fy === currentFyLabel() && (
                    <span className="rounded-full bg-dmk-success/10 border border-dmk-success/30 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-dmk-success">
                      current
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
            ))}
            {nextFyMissing && (
              <>
                <DropdownMenuSeparator className="bg-dmk-border-subtle my-1" />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    void handleCreateNextFy();
                  }}
                  disabled={fyCreating}
                  className="text-[12.5px] cursor-pointer text-dmk-gold"
                >
                  {fyCreating ? "Opening…" : `＋ Open FY ${nextFy} account`}
                </DropdownMenuItem>
              </>
            )}
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
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-dmk-yellow text-[9.5px] font-bold text-[#0A0F1D] flex items-center justify-center">
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
                <span className="dmk-badge bg-dmk-yellow/15 text-dmk-yellow text-[9.5px] px-1.5 py-0.5">{notifCount}</span>
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
                  const Icon =
                    n.kind === "stock"
                      ? PackageX
                      : n.kind === "receivable"
                        ? Timer
                        : n.kind === "verification"
                          ? ClipboardCheck
                          : FileWarning;
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

        {/* Company menu — firm section moved to the right end (replaces the profile avatar).
            Switch company · company details · password · sign out. */}
        <DropdownMenu open={companyMenuOpen} onOpenChange={setCompanyMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="h-9 pl-2 pr-2.5 gap-2 inline-flex items-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle hover:bg-dmk-hover transition-colors max-w-[190px] sm:max-w-[240px]"
              aria-label="Company menu"
              aria-expanded={companyMenuOpen}
            >
              <Building2 className="h-4 w-4 text-dmk-blue shrink-0" strokeWidth={1.75} />
              <span className="truncate text-[12.5px] font-semibold text-dmk-text-primary">
                {firm ? firm.firmName : "Company"}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-dmk-text-muted shrink-0 transition-transform",
                  companyMenuOpen && "rotate-180"
                )}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 bg-dmk-bg-tertiary border-dmk-border-medium">
            {/* Active company identity */}
            <div className="px-2 pt-1.5 pb-2">
              <p className="text-[13.5px] font-bold text-dmk-text-primary truncate">{firm?.firmName ?? "Company"}</p>
              <p className="text-[10.5px] text-dmk-text-muted truncate mt-0.5">
                {firm ? `${firm.firmCode}${firm.gstin ? ` · GSTIN ${firm.gstin}` : ""}` : "—"}
              </p>
              <span className="dmk-badge bg-dmk-blue/15 text-dmk-blue text-[9px] px-1.5 py-0.5 mt-1.5 inline-flex items-center gap-1">
                <ShieldCheck className="h-2.5 w-2.5" /> {OWNER_USERNAME} · owner
              </span>
            </div>

            <DropdownMenuSeparator className="bg-dmk-border-subtle" />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-dmk-text-muted">
              Switch company
            </DropdownMenuLabel>
            <div className="max-h-[180px] overflow-y-auto">
              {firms.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => setActiveFirm(f.id)}
                  className={cn("gap-2 text-[13px] cursor-pointer", f.id === activeFirmId && "bg-dmk-hover")}
                >
                  <Building2 className="h-4 w-4 text-dmk-text-muted shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{f.firmName}</span>
                    <span className="block text-[10.5px] text-dmk-text-muted truncate">{f.firmCode}</span>
                  </span>
                  {f.id === activeFirmId && <Check className="h-4 w-4 text-dmk-success shrink-0" />}
                </DropdownMenuItem>
              ))}
            </div>

            <DropdownMenuSeparator className="bg-dmk-border-subtle" />
            <DropdownMenuItem
              onClick={() => {
                setCompanyMenuOpen(false);
                setDetailsOpen(true);
              }}
              className="gap-2 text-[13px] cursor-pointer"
            >
              <Pencil className="h-4 w-4 text-dmk-text-muted" /> Company details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setCompanyMenuOpen(false);
                setPasswordOpen(true);
              }}
              className="gap-2 text-[13px] cursor-pointer"
            >
              <KeyRound className="h-4 w-4 text-dmk-text-muted" /> Change password
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-dmk-border-subtle" />
            <DropdownMenuItem
              onClick={() => {
                // Owners always land back on the OWNER login address.
                useErpStore.getState().logout();
                window.location.assign("/");
              }}
              className="gap-2 text-[13px] cursor-pointer text-dmk-danger"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Company dialogs (opened from the menu above) */}
      <CompanyDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} onSaved={() => void refreshFirmsList()} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </header>
  );
}
