"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Low Stock Alerts (R19) — threshold breaches, reorder helper
// Coded against actual GET /api/v1/inventory/low-stock response
// (rows carry `id` + shortfall/urgency/stockValue computed server-side)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShoppingCart } from "lucide-react";

import { PageHeader, Badge, Money, EmptyState, LoadingRows, DataTable, ErrorText } from "../shared";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import { formatINR } from "@/lib/format";

interface LowStockRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  stockQuantity: number;
  damagedStock: number;
  purchaseCost: number;
  lowStockThreshold: number;
  tier4Retailer: number;
  shortfall: number;
  urgency: number;
  stockValue: number;
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default function LowStockView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);

  const [items, setItems] = React.useState<LowStockRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiGet<LowStockRow[]>("/api/v1/inventory/low-stock", { firmId: activeFirmId });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load low-stock alerts");
    } finally {
      setLoading(false);
    }
  }, [activeFirmId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const draftPo = (item: LowStockRow) => {
    setView("purchase/orders");
    toast({
      title: "Drafting purchase order",
      description: `Select vendor and add ${item.name}`,
    });
  };

  const estimatedTotal = items.reduce((s, i) => s + Math.max(i.shortfall, 0) * i.purchaseCost, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Low Stock Alerts"
        subtitle="Products at or below their reorder threshold · most urgent first (R19)"
        actions={
          <>
            {items.length > 0 && <Badge tone="danger">{items.length} ALERTS</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={7} />
        </div>
      ) : items.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={CheckCircle2}
            title="All stock levels healthy"
            hint="Every active product is above its configured reorder threshold. Thresholds can be tuned per product in the product master."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setView("inventory/products")}
                className="h-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              >
                Open Product Master
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="dmk-well px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="text-[11.5px] text-dmk-text-muted">
              Alerts <span className="font-money text-dmk-danger font-semibold">{items.length}</span>
            </span>
            <span className="text-[11.5px] text-dmk-text-muted">
              Estimated reorder cost{" "}
              <span className="font-money text-dmk-text-primary font-semibold">{formatINR(estimatedTotal)}</span>
            </span>
            <span className="text-[11px] text-dmk-text-disabled ml-auto hidden sm:inline">
              Est. cost = deficit × purchase cost
            </span>
          </div>

          <DataTable>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Unit</th>
                <th className="num">Current</th>
                <th className="num">Threshold</th>
                <th className="num">Deficit</th>
                <th className="num">Est. Cost</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="font-money text-[12.5px] text-dmk-text-secondary">{item.sku}</td>
                  <td>
                    <p className="font-medium max-w-[260px] truncate" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-[10.5px] text-dmk-text-muted">
                      {item.category}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </p>
                  </td>
                  <td className="text-dmk-text-secondary">{item.unit}</td>
                  <td className="num">
                    <span className="inline-flex items-center gap-1.5 text-dmk-danger font-money text-[12.5px]">
                      <AlertTriangle className="h-3 w-3" />
                      {fmtQty(item.stockQuantity)}
                    </span>
                  </td>
                  <td className="num text-dmk-text-muted">{fmtQty(item.lowStockThreshold)}</td>
                  <td className="num">
                    <Badge tone="warning">−{fmtQty(Math.max(item.shortfall, 0))}</Badge>
                  </td>
                  <td className="num">
                    <Money value={Math.max(item.shortfall, 0) * item.purchaseCost} />
                  </td>
                  <td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => draftPo(item)}
                      className="h-8 px-2.5 gap-1.5 text-[11.5px] border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
                    >
                      <ShoppingCart className="h-3 w-3" />
                      Draft PO
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
