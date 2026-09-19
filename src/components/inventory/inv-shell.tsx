"use client";

// ═══════════════════════════════════════════════════════════════
// INVSHELL — Universal Inventory layout.
// Fixed top bar · dark rail sidebar (desktop) / drawer (mobile) ·
// content router · sticky footer (min-h-screen flex, mt-auto).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvSessionInfo } from "@/components/inventory/inv-api";
import { InvOverview } from "@/components/inventory/inv-overview";
import { InvProducts } from "@/components/inventory/inv-products";
import { InvWarehouses } from "@/components/inventory/inv-warehouses";
import { InvUpload } from "@/components/inventory/inv-upload";
import { InvIntegrations } from "@/components/inventory/inv-integrations";
import { InvGuide } from "@/components/inventory/inv-guide";
import { InvSync } from "@/components/inventory/inv-sync";
import {
  LayoutDashboard, Package, Warehouse, UploadCloud, Plug, BookOpenText, RefreshCw,
  Boxes, LogOut, Menu, X, ExternalLink,
} from "lucide-react";

type InvView =
  | "overview"
  | "products"
  | "warehouses"
  | "upload"
  | "integrations"
  | "guide"
  | "sync";

const NAV: Array<{ id: InvView; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; hint: string }> = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard, hint: "Catalog & stock health" },
  { id: "products", label: "Products", icon: Package, hint: "Shared catalog + image audit" },
  { id: "warehouses", label: "Warehouses", icon: Warehouse, hint: "Placement (portal-private)" },
  { id: "upload", label: "Add / Upload", icon: UploadCloud, hint: "Single + bulk product adds" },
  { id: "integrations", label: "Integrations", icon: Plug, hint: "Connected platforms & keys" },
  { id: "guide", label: "Setup Guide", icon: BookOpenText, hint: "Link a new platform step-by-step" },
  { id: "sync", label: "Sync Center", icon: RefreshCw, hint: "30/60-min re-check engine" },
];

export function InvShell({ session, onSignOut }: { session: InvSessionInfo; onSignOut: () => void }) {
  const [view, setView] = React.useState<InvView>("overview");
  const [drawer, setDrawer] = React.useState(false);

  const go = (v: InvView) => {
    setView(v);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };

  async function signOut() {
    await fetch("/api/v1/inventory/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignOut();
  }

  const activeNav = NAV.find((n) => n.id === view) ?? NAV[0];

  const navList = (
    <nav aria-label="Inventory navigation" className="px-2 space-y-0.5">
      {NAV.map((n) => {
        const active = view === n.id;
        const Icon = n.icon;
        return (
          <button
            key={n.id}
            onClick={() => go(n.id)}
            title={n.hint}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group w-full flex items-center gap-2.5 h-10 px-2.5 rounded-lg text-[13px] font-medium transition-colors",
              active ? "dmk-nav-active text-dmk-text-primary" : "text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-dmk-yellow" : "text-dmk-text-muted group-hover:text-dmk-text-secondary")} strokeWidth={1.75} />
            <span className="truncate">{n.label}</span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-50 h-14 bg-[#0D1527]/90 backdrop-blur-md border-b border-dmk-border-subtle flex items-center gap-3 px-3 sm:px-4">
        <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9 text-dmk-text-secondary" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center shrink-0">
            <Boxes className="h-4.5 w-4.5 text-dmk-yellow" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-black tracking-tight text-dmk-text-primary leading-none truncate">DMK Universal Inventory</p>
            <p className="text-[10px] text-dmk-text-muted mt-0.5 truncate">{session.firm.firmName} · one catalog for every platform</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline-flex dmk-badge h-7 px-2.5 gap-1.5 bg-dmk-yellow/15 text-dmk-yellow">
            <span className="h-1.5 w-1.5 rounded-full bg-dmk-yellow animate-pulse" aria-hidden />
            ID {session.username}
          </span>
          <a href="/" target="_blank" rel="noopener" className="hidden md:inline-flex dmk-badge h-7 px-2.5 gap-1 text-dmk-text-muted hover:text-dmk-text-secondary transition-colors">
            <ExternalLink className="h-3 w-3" /> ERP
          </a>
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline text-[12px]">Sign out</span>
          </Button>
        </div>
      </header>

      {/* Desktop rail */}
      <aside
        className="hidden lg:flex fixed z-40 top-14 bottom-0 left-0 w-16 bg-[#090E1A] border-r border-dmk-border-subtle flex-col"
        aria-label="Inventory sidebar"
      >
        <div className="flex-1 overflow-y-auto py-3">{navList}</div>
        <div className="border-t border-dmk-border-subtle p-2.5">
          <p className="text-[9px] font-bold uppercase tracking-wider text-dmk-gold text-center">Universal</p>
          <p className="text-[9px] text-dmk-text-muted text-center mt-0.5">Inventory v1</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Navigation drawer">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute top-0 bottom-0 left-0 w-[260px] bg-[#090E1A] border-r border-dmk-border-subtle flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-dmk-border-subtle">
              <p className="text-[13px] font-bold text-dmk-text-primary">Inventory Menu</p>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-dmk-text-muted" onClick={() => setDrawer(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto py-3">{navList}</div>
            <div className="border-t border-dmk-border-subtle p-3">
              <p className="text-[10px] text-dmk-text-muted">Signed in as {session.username}</p>
            </div>
          </aside>
        </div>
      )}

      {/* Content column — sticky footer via mt-auto */}
      <div className="lg:pl-16 flex flex-col min-h-screen pt-14">
        <main className="flex-1 px-3 sm:px-5 lg:px-7 py-5 w-full max-w-[1440px] mx-auto" aria-label={activeNav.label}>
          {view === "overview" && <InvOverview onGo={(v) => go(v as InvView)} />}
          {view === "products" && <InvProducts />}
          {view === "warehouses" && <InvWarehouses />}
          {view === "upload" && <InvUpload />}
          {view === "integrations" && <InvIntegrations />}
          {view === "guide" && <InvGuide />}
          {view === "sync" && <InvSync session={session} />}
        </main>
        <footer className="mt-auto border-t border-dmk-border-subtle px-4 sm:px-6 py-4">
          <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-1.5">
            <p className="text-[10.5px] text-dmk-text-muted">DMK Universal Inventory · warehouse placement is portal-private</p>
            <p className="text-[10.5px] text-dmk-text-muted">Other platforms read totals via /api/universal/v1</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
