"use client";

// ═══════════════════════════════════════════════════════════════
// INV-OVERVIEW — Universal Inventory dashboard: catalog size,
// stock health, image-verification status, platform connections,
// sync heartbeat, recent movements.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { invGet, formatMoney, timeAgo, type InvOverview } from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Package, Boxes, Warehouse, AlertTriangle, BadgeCheck, FileWarning, Plug,
  RefreshCw, ArrowRight, ArrowLeftRight, ShieldCheck, CircleHelp, ImageIcon, BookOpenText,
} from "lucide-react";

function Stat({ label, value, sub, icon: Icon, tone = "default", onClick }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: "default" | "warn" | "danger" | "good";
  onClick?: () => void;
}) {
  const toneCls = tone === "warn" ? "text-amber-400" : tone === "danger" ? "text-red-400" : tone === "good" ? "text-emerald-400" : "text-dmk-yellow";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "dmk-card p-4 text-left w-full transition-colors",
        onClick && "hover:bg-dmk-hover cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">{label}</p>
        <Icon className={cn("h-4 w-4 shrink-0", toneCls)} strokeWidth={1.75} />
      </div>
      <p className="mt-2 text-[22px] font-black tracking-tight text-dmk-text-primary leading-none font-money">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-dmk-text-muted">{sub}</p>}
    </button>
  );
}

export function InvOverview({ onGo }: { onGo: (view: string) => void }) {
  const [data, setData] = React.useState<InvOverview | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    invGet<InvOverview>("/api/v1/inventory/overview")
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Failed to load"); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div className="dmk-card p-6 border-red-500/30">
        <p className="text-[13px] text-red-400">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-label="Loading dashboard">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  const v = data.imageVerification;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Inventory Dashboard</h1>
          <p className="text-[12px] text-dmk-text-muted mt-0.5">
            {data.firm.firmName} · every platform shares this catalog — ERP, B2B store, Franchise &amp; B2C
          </p>
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={() => onGo("upload")}>
          <Package className="h-4 w-4" /> Add products
        </Button>
      </div>

      {/* Catalog + stock */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Active SKUs" value={data.catalog.activeSkus} sub={`${data.catalog.inactiveSkus} inactive · ${data.catalog.brands} brands · ${data.catalog.categories} categories`} icon={Package} onClick={() => onGo("products")} />
        <Stat label="Sellable stock" value={data.stock.totalSellable.toLocaleString("en-IN")} sub={`${data.stock.totalReserved.toLocaleString("en-IN")} reserved · ${data.stock.totalDamaged.toLocaleString("en-IN")} damaged`} icon={Boxes} onClick={() => onGo("products")} />
        <Stat label="Stock value @ cost" value={formatMoney(data.stock.stockValueAtCost)} sub="Σ sellable × purchase cost" icon={ShieldCheck} />
        <Stat label="Warehouses" value={data.warehouses} sub="placement is portal-private" icon={Warehouse} onClick={() => onGo("warehouses")} />
        <Stat label="Low stock" value={data.stock.lowStock} sub="at/below threshold" icon={AlertTriangle} tone={data.stock.lowStock > 0 ? "warn" : "good"} onClick={() => onGo("products")} />
        <Stat label="Out of stock" value={data.stock.outOfStock} sub="0 sellable units" icon={CircleHelp} tone={data.stock.outOfStock > 0 ? "danger" : "good"} onClick={() => onGo("products")} />
        <Stat label="Image verified" value={`${v.matched}`} sub={`${v.pending} pending · ${v.noImage} no image`} icon={BadgeCheck} tone={v.matched > 0 ? "good" : "default"} onClick={() => onGo("products")} />
        <Stat label="Image mismatches" value={`${v.mismatch}`} sub={v.mismatch > 0 ? "name on image ≠ catalog" : "all clean"} icon={FileWarning} tone={v.mismatch > 0 ? "danger" : "good"} onClick={() => onGo("products")} />
      </div>

      {/* Sync + integrations row */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
              <p className="text-[13px] font-bold text-dmk-text-primary">Auto-sync re-check</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onGo("sync")}>
              Sync Center <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="dmk-well rounded-lg py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">Cadence</p>
              <p className="text-[15px] font-black text-dmk-text-primary mt-0.5">{data.sync.intervalMin} min</p>
            </div>
            <div className="dmk-well rounded-lg py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">Mode</p>
              <p className={cn("text-[15px] font-black mt-0.5", data.sync.autoSync ? "text-emerald-400" : "text-amber-400")}>{data.sync.autoSync ? "AUTO" : "PAUSED"}</p>
            </div>
            <div className="dmk-well rounded-lg py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">Last pass</p>
              <p className="text-[12.5px] font-bold text-dmk-text-primary mt-1">{timeAgo(data.sync.lastRunAt)}</p>
            </div>
          </div>
          {data.sync.recentLogs.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {data.sync.recentLogs.slice(0, 4).map((l) => (
                <div key={l.id} className="flex items-center gap-2 text-[11px] text-dmk-text-muted">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", l.status === "OK" ? "bg-emerald-400" : l.status === "ERROR" ? "bg-red-400" : l.status === "PARTIAL" ? "bg-amber-400" : "bg-dmk-blue")} aria-hidden />
                  <span className="font-mono text-[10px] uppercase">{l.action}</span>
                  <span className="truncate">{l.message || l.status}</span>
                  <span className="ml-auto shrink-0">{timeAgo(l.startedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dmk-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
              <p className="text-[13px] font-bold text-dmk-text-primary">Connected platforms</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => onGo("integrations")}>
              Manage <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          {data.integrations.portals.length === 0 ? (
            <div className="mt-3 dmk-well rounded-lg p-4 text-center">
              <p className="text-[12px] text-dmk-text-secondary">No platforms linked yet</p>
              <p className="text-[11px] text-dmk-text-muted mt-1">Register the ERP, B2B store and Franchise/B2C software in the Setup Guide — step-by-step.</p>
              <Button variant="outline" size="sm" className="mt-3 h-8 text-[11.5px]" onClick={() => onGo("guide")}>
                <BookOpenText className="h-3.5 w-3.5" /> Open Setup Guide
              </Button>
            </div>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {data.integrations.portals.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-[12px]">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", p.status === "ACTIVE" ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
                  <span className="text-dmk-text-primary font-medium truncate">{p.name}</span>
                  <span className="dmk-badge h-5 px-1.5 text-[9.5px]">{p.kind}</span>
                  <span className="ml-auto text-dmk-text-muted shrink-0">{p.lastSyncStatus === "OK" ? "✓" : p.lastSyncStatus === "ERROR" ? "✗" : "·"} {timeAgo(p.lastSyncAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent movements */}
      <div className="dmk-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ArrowLeftRight className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
          <p className="text-[13px] font-bold text-dmk-text-primary">Recent stock movements</p>
        </div>
        {data.recentMovements.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted">No movements yet — they appear as soon as any platform moves stock.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-dmk-text-muted">
                  <th className="py-1.5 px-1 font-bold">When</th>
                  <th className="py-1.5 px-1 font-bold">SKU</th>
                  <th className="py-1.5 px-1 font-bold">Product</th>
                  <th className="py-1.5 px-1 font-bold">Type</th>
                  <th className="py-1.5 px-1 font-bold text-right">Qty</th>
                  <th className="py-1.5 px-1 font-bold">Note</th>
                </tr>
              </thead>
              <tbody>
                {data.recentMovements.map((m) => (
                  <tr key={m.id} className="border-t border-dmk-border-subtle/60">
                    <td className="py-1.5 px-1 text-dmk-text-muted whitespace-nowrap">{timeAgo(m.at)}</td>
                    <td className="py-1.5 px-1 font-mono text-[11px] text-dmk-text-muted">{m.sku}</td>
                    <td className="py-1.5 px-1 text-dmk-text-primary truncate max-w-[220px]">{m.name}</td>
                    <td className="py-1.5 px-1"><span className="dmk-badge h-5 px-1.5 text-[9.5px]">{m.type}</span></td>
                    <td className={cn("py-1.5 px-1 text-right font-money font-bold", m.direction === "IN" ? "text-emerald-400" : "text-red-400")}>
                      {m.direction === "IN" ? "+" : "−"}{m.quantity}
                    </td>
                    <td className="py-1.5 px-1 text-dmk-text-muted truncate max-w-[240px]">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Naming standard banner */}
      <div className="dmk-card p-4 border-dmk-yellow/25 bg-dmk-yellow/[0.04]">
        <div className="flex items-start gap-3">
          <ImageIcon className="h-5 w-5 text-dmk-yellow shrink-0 mt-0.5" strokeWidth={1.75} />
          <div>
            <p className="text-[12.5px] font-bold text-dmk-text-primary">Image naming standard — “Brand Name + Product Name”</p>
            <p className="text-[11.5px] text-dmk-text-muted mt-1 leading-relaxed">
              Every product image carries the canonical file name <span className="font-mono text-dmk-yellow">brand-product-name.webp</span> —
              stamped automatically on add/import and applied to every download. The AI verifier reads the name printed on
              each image and flags mismatches, so catalog names and artwork stay in lockstep.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
