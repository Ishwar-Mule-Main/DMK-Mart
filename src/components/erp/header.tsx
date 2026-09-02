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
import { Menu, Building2, CalendarRange, Bell, ChevronDown, Plus, CircleUser, ShieldCheck, Search } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost } from "@/lib/api-client";
import type { Firm, LowStockItem } from "@/types/erp";
import { cn } from "@/lib/utils";

const FYS = ["2025-26", "2026-27", "2027-28"];

export function Header() {
  const { firms, activeFirmId, setActiveFirm, financialYear, setFinancialYear, setSidebarOpen, sidebarOpen } =
    useErpStore();
  const firm = firms.find((f) => f.id === activeFirmId);
  const [alerts, setAlerts] = React.useState<LowStockItem[]>([]);

  const refreshAlerts = React.useCallback(async () => {
    if (!activeFirmId) return;
    try {
      const data = await apiGet<LowStockItem[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId });
      setAlerts(data ?? []);
    } catch {
      /* silent */
    }
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

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-dmk-hover text-dmk-text-secondary"
              aria-label="Notifications"
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {alerts.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-dmk-orange text-[9.5px] font-bold text-white flex items-center justify-center">
                  {alerts.length > 9 ? "9+" : alerts.length}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 bg-dmk-bg-tertiary border-dmk-border-medium">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-dmk-text-muted flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-dmk-warning" /> Low Stock Alerts
            </DropdownMenuLabel>
            {alerts.length === 0 && (
              <p className="px-3 py-4 text-[12.5px] text-dmk-text-muted">All stock levels healthy ✓</p>
            )}
            {alerts.slice(0, 6).map((a) => (
              <DropdownMenuItem key={a.productId} className="flex-col items-start gap-0.5 cursor-pointer">
                <p className="text-[12.5px] font-medium truncate w-full">{a.name}</p>
                <p className="text-[10.5px] text-dmk-text-muted font-money">
                  {a.sku} · stock {a.stockQuantity} ≤ threshold {a.lowStockThreshold}
                </p>
              </DropdownMenuItem>
            ))}
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
