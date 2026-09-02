"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Stock Movements — append-only audit ledger (R3/R4)
// Newest first · pool badges · signed quantities · CSV export
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Download, History } from "lucide-react";

import {
  PageHeader,
  Badge,
  DateText,
  EmptyState,
  LoadingRows,
  DataTable,
  ErrorText,
} from "../shared";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import type { Product, InventoryMovement } from "@/types/erp";
import { downloadCSV } from "@/lib/format";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

const MOVEMENT_TYPES = [
  "PURCHASE_INWARD",
  "SALES_OUTWARD",
  "DAMAGE_QUARANTINE",
  "SALES_RETURN_DAMAGE",
  "PURCHASE_RETURN_DAMAGE",
  "WRITE_OFF",
  "OPENING",
  "STOCK_ADJUSTMENT",
] as const;

const TYPE_LABEL: Record<string, string> = {
  PURCHASE_INWARD: "PURCHASE IN",
  SALES_OUTWARD: "SALES OUT",
  DAMAGE_QUARANTINE: "QUARANTINE",
  SALES_RETURN_DAMAGE: "RETURN → DAMAGED",
  PURCHASE_RETURN_DAMAGE: "RETURN → VENDOR",
  WRITE_OFF: "WRITE-OFF",
  OPENING: "OPENING",
  STOCK_ADJUSTMENT: "ADJUSTMENT",
};

/** IN flows → success/info; OUT flows → warning/danger. */
function typeTone(m: InventoryMovement): BadgeTone {
  switch (m.movementType) {
    case "PURCHASE_INWARD":
      return "success";
    case "OPENING":
      return "success";
    case "SALES_OUTWARD":
      return "info";
    case "DAMAGE_QUARANTINE":
    case "SALES_RETURN_DAMAGE":
    case "STOCK_ADJUSTMENT":
      return "warning";
    case "PURCHASE_RETURN_DAMAGE":
    case "WRITE_OFF":
      return "danger";
    default:
      return m.direction === "IN" ? "success" : "warning";
  }
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default function StockMovementsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [movements, setMovements] = React.useState<InventoryMovement[]>([]);
  const [productOptions, setProductOptions] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [productId, setProductId] = React.useState("all");
  const [movementType, setMovementType] = React.useState("all");
  const [limit, setLimit] = React.useState("100");

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await apiGet<InventoryMovement[]>("/api/v1/inventory/movements", {
        firmId: activeFirmId,
        productId: productId === "all" ? undefined : productId,
        movementType: movementType === "all" ? undefined : movementType,
        limit: Number(limit),
      });
      setMovements(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [activeFirmId, productId, movementType, limit]);

  // Ledger + product directory
  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let cancelled = false;
    apiGet<{ products: Product[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" })
      .then((res) => {
        if (!cancelled) setProductOptions(res.products ?? []);
      })
      .catch(() => {
        /* filter dropdown is optional — silent fallback to ALL */
      });
    return () => {
      cancelled = true;
    };
  }, [activeFirmId]);

  const exportCsv = () => {
    downloadCSV("stock-movements.csv", [
      ["Date", "SKU", "Product", "Type", "Direction", "Quantity", "Pool", "Reference", "Notes"],
      ...movements.map((m) => [
        new Date(m.createdAt).toISOString().slice(0, 10),
        m.product?.sku ?? "—",
        m.product?.name ?? "",
        m.movementType,
        m.direction,
        m.direction === "IN" ? m.quantity : -m.quantity,
        m.targetPool,
        m.referenceNo,
        m.notes,
      ]),
    ]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Movements"
        subtitle="Append-only audit ledger · every pool change is recorded (R3/R4)"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={movements.length === 0}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger className="w-full sm:w-[260px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            {productOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={movementType} onValueChange={setMovementType}>
          <SelectTrigger className="w-full sm:w-[210px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
            <SelectValue placeholder="Movement type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All movement types</SelectItem>
            {MOVEMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={limit} onValueChange={setLimit}>
          <SelectTrigger className="w-full sm:w-[130px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] sm:ml-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[50, 100, 200, 300].map((n) => (
              <SelectItem key={n} value={String(n)}>
                Last {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={9} />
        </div>
      ) : movements.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={History}
            title="No movements recorded"
            hint="Movements appear when stock enters or leaves a pool — purchases, sales, returns, quarantine transfers and write-offs."
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Date</th>
              <th>SKU</th>
              <th>Product</th>
              <th>Type</th>
              <th className="num">Qty</th>
              <th>Pool</th>
              <th>Reference</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>
                  <DateText d={m.createdAt} />
                </td>
                <td className="font-money text-[12.5px] text-dmk-text-secondary">
                  {m.product?.sku ?? "—"}
                </td>
                <td className="font-medium max-w-[220px] truncate" title={m.product?.name ?? ""}>
                  {m.product?.name ?? "—"}
                </td>
                <td>
                  <Badge tone={typeTone(m)}>{TYPE_LABEL[m.movementType] ?? m.movementType}</Badge>
                </td>
                <td className="num whitespace-nowrap">
                  <span
                    className={
                      m.direction === "IN"
                        ? "text-dmk-success font-money text-[12.5px]"
                        : "text-dmk-danger font-money text-[12.5px]"
                    }
                  >
                    {m.direction === "IN" ? (
                      <ArrowUpRight className="h-3 w-3 inline mr-0.5 -mt-0.5" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 inline mr-0.5 -mt-0.5" />
                    )}
                    {m.direction === "IN" ? "+" : "−"}
                    {fmtQty(m.quantity)}
                  </span>
                </td>
                <td>
                  <Badge tone={m.targetPool === "SELLABLE" ? "info" : "danger"}>{m.targetPool}</Badge>
                </td>
                <td className="font-money text-[11.5px] text-dmk-text-secondary">{m.referenceNo || "—"}</td>
                <td
                  className="text-dmk-text-muted text-[12px] max-w-[240px] truncate"
                  title={m.notes}
                >
                  {m.notes || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
