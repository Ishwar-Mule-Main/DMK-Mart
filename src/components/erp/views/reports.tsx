"use client";

// ═══════════════════════════════════════════════════════════════
// REPORTS — Sales · Purchases · Stock · GST Summary
// Coded against GET /api/v1/reports?firmId=&type=&dateFrom=&dateTo=
// GST view: Output (CGST/SGST/IGST) vs Input ITC vs Net Payable.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Download,
  FileText,
  Landmark,
  Percent,
  RefreshCw,
  Scale,
  ShoppingCart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate, toISODate } from "@/lib/format";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ReportType = "sales" | "purchases" | "stock" | "gst" | "valuation";

// ─── Row shapes (verified against route source) ─────────────────

interface SalesRow {
  invoiceNumber: string;
  invoiceDate: string;
  customer: string;
  paymentMode: string;
  sku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  bulkDiscountPct: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

interface PurchaseRow {
  poNumber: string;
  poDate: string;
  vendor: string;
  sku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  receivedQty: number;
  unitCost: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

interface StockRow {
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  isActive: boolean;
  stockQuantity: number;
  damagedStock: number;
  lowStockThreshold: number;
  purchaseCost: number;
  stockValue: number;
  damagedValue: number;
}

interface ValuationRow {
  sku: string;
  name: string;
  category: string;
  unit: string;
  wac: number;
  purchaseCost: number;
  stockQuantity: number;
  damagedStock: number;
  stockValue: number;
  damagedValue: number;
  totalValue: number;
  receiptsQty: number;
  method: string;
}

interface GstDocRow {
  docNo: string;
  date: string;
  party: string;
  partyStateCode: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

interface GstSide {
  cgst: number;
  sgst: number;
  igst: number;
  taxable: number;
  total: number;
  rows: GstDocRow[];
}

interface GstResponse {
  type: "gst";
  output: GstSide;
  input: GstSide;
  net: { cgst: number; sgst: number; igst: number };
}

interface ReportResponse {
  type: ReportType;
  rows?: SalesRow[] | PurchaseRow[] | StockRow[] | ValuationRow[];
  totals?: { stockValue: number; damagedValue: number; totalValue?: number };
  count?: number;
  method?: string;
  output?: GstSide;
  input?: GstSide;
  net?: { cgst: number; sgst: number; igst: number };
}

const REPORTS: Array<{ type: ReportType; label: string; icon: LucideIcon; desc: string }> = [
  { type: "sales", label: "Sales Report", icon: FileText, desc: "Posted invoice line items" },
  { type: "purchases", label: "Purchase Report", icon: ShoppingCart, desc: "Confirmed PO line items" },
  { type: "stock", label: "Stock Report", icon: Boxes, desc: "Dual-stock position & valuation" },
  { type: "valuation", label: "Valuation (WAC)", icon: Scale, desc: "Weighted average cost valuation" },
  { type: "gst", label: "GST Summary", icon: Percent, desc: "Output tax vs ITC vs net payable" },
];

const CHART_BLUE = "#2563EB";
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-medium)",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 8px 24px rgba(2,6,17,0.6)",
};

function compactINR(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v.toFixed(0)}`;
}

export default function ReportsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useActiveFirm();
  const { toast } = useToast();

  const [type, setType] = React.useState<ReportType>("sales");
  const [dateFrom, setDateFrom] = React.useState(() => {
    const fy = activeFirm?.financialYear ?? "2025-26";
    const y = parseInt(fy.slice(0, 4), 10);
    return `${Number.isFinite(y) ? y : new Date().getFullYear()}-04-01`;
  });
  const [dateTo, setDateTo] = React.useState(() => toISODate(new Date()));
  const [data, setData] = React.useState<ReportResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<ReportResponse>("/api/v1/reports", {
          firmId: activeFirmId,
          type,
          dateFrom: type === "stock" || type === "valuation" ? undefined : dateFrom || undefined,
          dateTo: type === "stock" || type === "valuation" ? undefined : dateTo || undefined,
        });
        if (alive) setData(res);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load report");
          setData(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, type, dateFrom, dateTo, refreshKey]);

  function exportCsv() {
    if (!data) return;
    if (data.type === "sales" && data.rows) {
      const rows = data.rows as SalesRow[];
      const out: (string | number)[][] = [
        ["Invoice #", "Date", "Customer", "Mode", "SKU", "Product", "HSN", "Qty", "Unit Price", "Disc %", "Taxable", "GST %", "CGST", "SGST", "IGST", "Total"],
      ];
      rows.forEach((r) =>
        out.push([r.invoiceNumber, r.invoiceDate, r.customer, r.paymentMode, r.sku, r.productName, r.hsnCode, r.quantity, r.unitPrice, r.bulkDiscountPct, r.taxableAmount, r.gstRate, r.cgstAmount, r.sgstAmount, r.igstAmount, r.totalAmount])
      );
      downloadCSV(`sales-report-${dateFrom}-to-${dateTo}.csv`, out);
    } else if (data.type === "purchases" && data.rows) {
      const rows = data.rows as PurchaseRow[];
      const out: (string | number)[][] = [
        ["PO #", "Date", "Vendor", "SKU", "Product", "HSN", "Qty", "Received", "Unit Cost", "Taxable", "GST %", "CGST", "SGST", "IGST", "Total"],
      ];
      rows.forEach((r) =>
        out.push([r.poNumber, r.poDate, r.vendor, r.sku, r.productName, r.hsnCode, r.quantity, r.receivedQty, r.unitCost, r.taxableAmount, r.gstRate, r.cgstAmount, r.sgstAmount, r.igstAmount, r.totalAmount])
      );
      downloadCSV(`purchase-report-${dateFrom}-to-${dateTo}.csv`, out);
    } else if (data.type === "stock" && data.rows) {
      const rows = data.rows as StockRow[];
      const out: (string | number)[][] = [
        ["SKU", "Name", "Category", "Brand", "Unit", "Status", "Sellable", "Damaged", "Threshold", "Cost", "Stock Value", "Damaged Value"],
      ];
      rows.forEach((r) =>
        out.push([r.sku, r.name, r.category, r.brand, r.unit, r.isActive ? "ACTIVE" : "INACTIVE", r.stockQuantity, r.damagedStock, r.lowStockThreshold, r.purchaseCost, r.stockValue, r.damagedValue])
      );
      downloadCSV(`stock-report-${toISODate(new Date())}.csv`, out);
    } else if (data.type === "valuation" && data.rows) {
      const rows = data.rows as ValuationRow[];
      const out: (string | number)[][] = [
        ["Stock Valuation — Weighted Average Cost", `Generated ${toISODate(new Date())}`],
        ["SKU", "Name", "Category", "Unit", "WAC", "Purchase Cost", "Sellable Qty", "Damaged Qty", "Stock Value", "Damaged Value", "Total Value", "Receipts Qty", "Method"],
      ];
      rows.forEach((r) =>
        out.push([r.sku, r.name, r.category, r.unit, r.wac, r.purchaseCost, r.stockQuantity, r.damagedStock, r.stockValue, r.damagedValue, r.totalValue, r.receiptsQty, r.method])
      );
      if (data.totals) {
        out.push([], ["TOTALS", "", "", "", "", "", "", "", data.totals.stockValue, data.totals.damagedValue, data.totals.totalValue ?? data.totals.stockValue + data.totals.damagedValue]);
      }
      downloadCSV(`stock-valuation-wac-${toISODate(new Date())}.csv`, out);
    } else if (data.type === "gst" && data.output && data.input && data.net) {
      const out: (string | number)[][] = [
        ["GST Summary", `${dateFrom} → ${dateTo}`],
        ["Component", "Output Tax", "Input ITC", "Net Payable"],
        ["CGST", data.output.cgst, data.input.cgst, data.net.cgst],
        ["SGST", data.output.sgst, data.input.sgst, data.net.sgst],
        ["IGST", data.output.igst, data.input.igst, data.net.igst],
        [],
        ["OUTPUT DOCS (Sales)"],
        ["Doc #", "Date", "Party", "State", "Taxable", "CGST", "SGST", "IGST", "Total"],
      ];
      data.output.rows.forEach((r) => out.push([r.docNo, r.date, r.party, r.partyStateCode, r.taxable, r.cgst, r.sgst, r.igst, r.total]));
      out.push([], ["INPUT DOCS (Purchases / ITC)"], ["Doc #", "Date", "Party", "State", "Taxable", "CGST", "SGST", "IGST", "Total"]);
      data.input.rows.forEach((r) => out.push([r.docNo, r.date, r.party, r.partyStateCode, r.taxable, r.cgst, r.sgst, r.igst, r.total]));
      downloadCSV(`gst-summary-${dateFrom}-to-${dateTo}.csv`, out);
    }
    toast({ title: "Exported", description: "Report downloaded as CSV." });
  }

  const activeReport = REPORTS.find((r) => r.type === type)!;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports & Exports"
        subtitle="Tabular business reports with GST component analysis — exportable to CSV"
        icon={Landmark}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={exportCsv}
              disabled={!data || loading}
              className="h-9 gap-2 bg-dmk-orange text-[12.5px] font-semibold text-white hover:bg-dmk-orange/85"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </>
        }
      />

      {/* ── Report type cards ───────────────────────────── */}
      <div className="dmk-enter-stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const selected = type === r.type;
          return (
            <button
              key={r.type}
              type="button"
              onClick={() => setType(r.type)}
              className={cn(
                "text-left rounded-[10px] border px-4 py-3.5 transition-all",
                selected
                  ? "border-dmk-orange/60 bg-dmk-hover shadow-[0_0_0_1px_rgba(255,107,0,0.35)]"
                  : "border-dmk-border-subtle bg-dmk-bg-secondary hover:bg-dmk-hover/60"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg border",
                    selected ? "border-dmk-orange/40 bg-dmk-input-well" : "border-dmk-border-subtle bg-dmk-input-well"
                  )}
                >
                  <Icon className={cn("h-4 w-4", selected ? "text-dmk-orange" : "text-dmk-text-muted")} />
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[13px] font-semibold truncate", selected ? "text-dmk-text-primary" : "text-dmk-text-secondary")}>
                    {r.label}
                  </p>
                  <p className="text-[10.5px] text-dmk-text-muted truncate">{r.desc}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Date range ──────────────────────────────────── */}
      <div className="dmk-card p-3 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            disabled={type === "stock" || type === "valuation"}
            className={cn(inputCls, "[color-scheme:dark] disabled:opacity-50")}
          />
        </div>
        <div className="w-40">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted block mb-1.5">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            disabled={type === "stock" || type === "valuation"}
            className={cn(inputCls, "[color-scheme:dark] disabled:opacity-50")}
          />
        </div>
        {type === "stock" && (
          <p className="text-[11px] text-dmk-text-muted pb-1">Stock &amp; valuation reports are position snapshots — date filters not applicable.</p>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <EmptyState icon={activeReport.icon} title="No report data" hint="Try widening the date range." />
      ) : data.type === "sales" ? (
        <SalesReport rows={(data.rows ?? []) as SalesRow[]} />
      ) : data.type === "purchases" ? (
        <PurchasesReport rows={(data.rows ?? []) as PurchaseRow[]} />
      ) : data.type === "stock" ? (
        <StockReport rows={(data.rows ?? []) as StockRow[]} totals={data.totals} />
      ) : data.type === "valuation" ? (
        <ValuationReport
          rows={(data.rows ?? []) as ValuationRow[]}
          totals={data.totals}
          method={data.method}
        />
      ) : data.output && data.input && data.net ? (
        <GstReport output={data.output} input={data.input} net={data.net} />
      ) : (
        <EmptyState icon={activeReport.icon} title="No report data" hint="Try widening the date range." />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SALES REPORT — daily bar chart + line-item table
// ═══════════════════════════════════════════════════════════════

function SalesReport({ rows }: { rows: SalesRow[] }) {
  const byDate = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.invoiceDate, (map.get(r.invoiceDate) ?? 0) + r.totalAmount);
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({
        label: new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        total: Math.round(total * 100) / 100,
      }));
  }, [rows]);

  const totalValue = rows.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div className="space-y-4">
      <div className="dmk-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-dmk-text-primary">Sales by Invoice Date</h2>
            <p className="text-[11px] text-dmk-text-muted">
              {rows.length} line items · total {formatINR(totalValue)}
            </p>
          </div>
          <Badge tone="success">SALES</Badge>
        </div>
        {byDate.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted py-8 text-center">No sales in this window.</p>
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDate} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1E2D4A" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={{ stroke: "#1E2D4A" }}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v) => compactINR(Number(v))}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
                  itemStyle={{ color: "var(--text-primary)", fontFamily: "var(--font-jetbrains)" }}
                  formatter={(value) => formatINR(Number(value))}
                  cursor={{ fill: "rgba(37,99,235,0.08)" }}
                />
                <Bar dataKey="total" name="Sales" fill={CHART_BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-560px)] overflow-y-auto">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Mode</th>
                <th>SKU</th>
                <th>Product</th>
                <th className="num text-right">Qty</th>
                <th className="num text-right">Rate (₹)</th>
                <th className="num text-right">Disc %</th>
                <th className="num text-right">Taxable (₹)</th>
                <th className="num text-right">GST %</th>
                <th className="num text-right">Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.invoiceNumber}-${r.sku}-${i}`}>
                  <td className="font-money text-[12px] whitespace-nowrap">{r.invoiceNumber}</td>
                  <td className="text-[12px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.invoiceDate)}</td>
                  <td className="max-w-[200px]"><span className="block truncate text-[12.5px]">{r.customer}</span></td>
                  <td><Badge tone={r.paymentMode === "CREDIT" ? "warning" : "info"}>{r.paymentMode}</Badge></td>
                  <td className="font-money text-[12px] text-dmk-text-secondary">{r.sku}</td>
                  <td className="max-w-[200px]"><span className="block truncate text-[12.5px]">{r.productName}</span></td>
                  <td className="num text-right">{r.quantity}</td>
                  <td className="num text-right text-dmk-text-secondary">{formatINR(r.unitPrice)}</td>
                  <td className="num text-right text-dmk-gold">{r.bulkDiscountPct ? `${r.bulkDiscountPct}%` : "—"}</td>
                  <td className="num text-right text-dmk-text-primary">{formatINR(r.taxableAmount)}</td>
                  <td className="num text-right text-dmk-text-muted">{r.gstRate}%</td>
                  <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PURCHASE REPORT
// ═══════════════════════════════════════════════════════════════

function PurchasesReport({ rows }: { rows: PurchaseRow[] }) {
  const totalValue = rows.reduce((s, r) => s + r.totalAmount, 0);
  return (
    <div className="space-y-4">
      <div className="dmk-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-dmk-text-primary">Purchase line items</h2>
          <p className="text-[11px] text-dmk-text-muted">
            {rows.length} items · total {formatINR(totalValue)} · confirmed POs only
          </p>
        </div>
        <Badge tone="info">PURCHASES</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No purchases in this window" hint="Confirmed POs will appear here." />
      ) : (
        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-480px)] overflow-y-auto">
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="num text-right">Qty</th>
                  <th className="num text-right">Recd</th>
                  <th className="num text-right">Cost (₹)</th>
                  <th className="num text-right">Taxable (₹)</th>
                  <th className="num text-right">GST %</th>
                  <th className="num text-right">Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.poNumber}-${r.sku}-${i}`}>
                    <td className="font-money text-[12px] whitespace-nowrap">{r.poNumber}</td>
                    <td className="text-[12px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.poDate)}</td>
                    <td className="max-w-[200px]"><span className="block truncate text-[12.5px]">{r.vendor}</span></td>
                    <td className="font-money text-[12px] text-dmk-text-secondary">{r.sku}</td>
                    <td className="max-w-[200px]"><span className="block truncate text-[12.5px]">{r.productName}</span></td>
                    <td className="num text-right">{r.quantity}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.receivedQty}</td>
                    <td className="num text-right text-dmk-text-secondary">{formatINR(r.unitCost)}</td>
                    <td className="num text-right text-dmk-text-primary">{formatINR(r.taxableAmount)}</td>
                    <td className="num text-right text-dmk-text-muted">{r.gstRate}%</td>
                    <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK REPORT
// ═══════════════════════════════════════════════════════════════

function StockReport({ rows, totals }: { rows: StockRow[]; totals?: { stockValue: number; damagedValue: number } }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Stock Value (Sellable)</span>
          <span className="font-money text-[19px] font-semibold text-dmk-success block mt-2">{formatINR(totals?.stockValue ?? 0)}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Damaged Value</span>
          <span className="font-money text-[19px] font-semibold text-dmk-danger block mt-2">{formatINR(totals?.damagedValue ?? 0)}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Products</span>
          <span className="font-money text-[19px] font-semibold text-dmk-text-primary block mt-2">{rows.length}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Total Units</span>
          <span className="font-money text-[19px] font-semibold text-dmk-text-primary block mt-2">
            {rows.reduce((s, r) => s + r.stockQuantity + r.damagedStock, 0).toFixed(0)}
          </span>
        </div>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-480px)] overflow-y-auto">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th className="hidden md:table-cell">Category</th>
                <th className="hidden lg:table-cell">Brand</th>
                <th className="num text-right">Sellable</th>
                <th className="num text-right">Damaged</th>
                <th className="num text-right hidden md:table-cell">Threshold</th>
                <th className="num text-right">Cost (₹)</th>
                <th className="num text-right">Stock Value (₹)</th>
                <th className="num text-right">Damaged Value (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="font-money text-[12px] text-dmk-text-secondary">{r.sku}</td>
                  <td className="max-w-[220px]">
                    <span className="block truncate text-[12.5px] font-medium">{r.name}</span>
                    <span className="text-[10.5px] text-dmk-text-muted">{r.unit} · {r.isActive ? "Active" : "Inactive"}</span>
                  </td>
                  <td className="hidden md:table-cell text-[12px] text-dmk-text-secondary">{r.category}</td>
                  <td className="hidden lg:table-cell text-[12px] text-dmk-text-muted">{r.brand || "—"}</td>
                  <td className={cn("num text-right", r.stockQuantity <= r.lowStockThreshold ? "text-dmk-warning font-semibold" : "text-dmk-text-primary")}>
                    {r.stockQuantity}
                  </td>
                  <td className={cn("num text-right", r.damagedStock > 0 ? "text-dmk-danger font-semibold" : "text-dmk-text-muted")}>
                    {r.damagedStock}
                  </td>
                  <td className="num text-right hidden md:table-cell text-dmk-text-muted">{r.lowStockThreshold}</td>
                  <td className="num text-right text-dmk-text-secondary">{formatINR(r.purchaseCost)}</td>
                  <td className="num text-right font-money font-semibold text-dmk-success">{formatINR(r.stockValue)}</td>
                  <td className="num text-right font-money text-dmk-danger">{formatINR(r.damagedValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STOCK VALUATION (WAC) — weighted average cost from receipts
// ═══════════════════════════════════════════════════════════════

function ValuationReport({
  rows,
  totals,
  method,
}: {
  rows: ValuationRow[];
  totals?: { stockValue: number; damagedValue: number; totalValue?: number };
  method?: string;
}) {
  const stockValue = totals?.stockValue ?? rows.reduce((s, r) => s + r.stockValue, 0);
  const damagedValue = totals?.damagedValue ?? rows.reduce((s, r) => s + r.damagedValue, 0);
  const totalValue = totals?.totalValue ?? stockValue + damagedValue;
  const costValue = rows.reduce((s, r) => s + r.purchaseCost * r.stockQuantity, 0);
  const variance = Math.round((stockValue - costValue) * 100) / 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Stock Value @ WAC</span>
          <span className="font-money text-[19px] font-semibold text-dmk-success block mt-2">{formatINR(stockValue)}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Quarantine @ WAC</span>
          <span className="font-money text-[19px] font-semibold text-dmk-danger block mt-2">{formatINR(damagedValue)}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Total Valuation</span>
          <span className="font-money text-[19px] font-semibold text-dmk-text-primary block mt-2">{formatINR(totalValue)}</span>
        </div>
        <div className="dmk-kpi p-4">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Variance vs Cost</span>
          <span className={cn("font-money text-[19px] font-semibold block mt-2", variance === 0 ? "text-dmk-text-primary" : variance > 0 ? "text-dmk-info" : "text-dmk-warning")}>
            {variance >= 0 ? "+" : ""}{formatINR(variance)}
          </span>
        </div>
      </div>

      <div className="dmk-well px-3.5 py-2.5 flex items-center gap-2">
        <Scale className="h-3.5 w-3.5 text-dmk-info shrink-0" />
        <p className="text-[11.5px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Method:</span> {method ?? "Weighted Average Cost from confirmed goods receipts"}.
          Products never received fall back to last purchase cost.
        </p>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-500px)] overflow-y-auto">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th className="hidden md:table-cell">Category</th>
                <th className="num text-right">Sellable</th>
                <th className="num text-right">Damaged</th>
                <th className="num text-right">WAC (₹)</th>
                <th className="num text-right hidden lg:table-cell">Last Cost (₹)</th>
                <th className="num text-right">Stock Value (₹)</th>
                <th className="num text-right hidden md:table-cell">Damaged (₹)</th>
                <th className="num text-right">Basis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const delta = Math.round((r.wac - r.purchaseCost) * 100) / 100;
                return (
                  <tr key={r.sku}>
                    <td className="font-money text-[12px] text-dmk-text-secondary">{r.sku}</td>
                    <td className="max-w-[220px]">
                      <span className="block truncate text-[12.5px] font-medium">{r.name}</span>
                      <span className="text-[10.5px] text-dmk-text-muted">{r.unit}</span>
                    </td>
                    <td className="hidden md:table-cell text-[12px] text-dmk-text-secondary">{r.category}</td>
                    <td className="num text-right text-dmk-text-primary">{r.stockQuantity}</td>
                    <td className={cn("num text-right", r.damagedStock > 0 ? "text-dmk-danger font-semibold" : "text-dmk-text-muted")}>
                      {r.damagedStock}
                    </td>
                    <td className="num text-right font-money font-semibold text-dmk-text-primary" title={delta !== 0 ? `Δ ${formatINR(delta)} vs last cost` : undefined}>
                      {formatINR(r.wac)}
                      {delta !== 0 && (
                        <span className={cn("ml-1 text-[9.5px] font-sans", delta > 0 ? "text-dmk-info" : "text-dmk-warning")}>
                          {delta > 0 ? "▲" : "▼"}
                        </span>
                      )}
                    </td>
                    <td className="num text-right hidden lg:table-cell text-dmk-text-muted">{formatINR(r.purchaseCost)}</td>
                    <td className="num text-right font-money font-semibold text-dmk-success">{formatINR(r.stockValue)}</td>
                    <td className="num text-right hidden md:table-cell font-money text-dmk-danger">{formatINR(r.damagedValue)}</td>
                    <td>
                      <Badge tone={r.method.startsWith("WAC") ? "info" : "neutral"}>
                        {r.method.startsWith("WAC") ? `${r.receiptsQty} recd` : "last cost"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-dmk-input-well">
                  <td colSpan={7} className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                    Totals — {rows.length} products valued
                  </td>
                  <td className="num text-right font-money font-bold text-dmk-success">{formatINR(stockValue)}</td>
                  <td className="num text-right hidden md:table-cell font-money font-bold text-dmk-danger">{formatINR(damagedValue)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GST SUMMARY — Output vs ITC vs Net Payable
// ═══════════════════════════════════════════════════════════════

function GstReport({ output, input, net }: { output: GstSide; input: GstSide; net: { cgst: number; sgst: number; igst: number } }) {
  const netTotal = Math.round((net.cgst + net.sgst + net.igst) * 100) / 100;

  const componentRows = [
    { name: "CGST", out: output.cgst, in: input.cgst, net: net.cgst },
    { name: "SGST", out: output.sgst, in: input.sgst, net: net.sgst },
    { name: "IGST", out: output.igst, in: input.igst, net: net.igst },
  ];

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Output Tax (Sales)</span>
            <ArrowUpRight className="h-4 w-4 text-dmk-success" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-success block mt-2">
            {formatINR(output.cgst + output.sgst + output.igst)}
          </span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block font-money">
            Taxable {formatINR(output.taxable)} · Docs {formatINR(output.total)}
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Input ITC (Purchases)</span>
            <ArrowDownRight className="h-4 w-4 text-dmk-info" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-info block mt-2">
            {formatINR(input.cgst + input.sgst + input.igst)}
          </span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block font-money">
            Taxable {formatINR(input.taxable)} · Docs {formatINR(input.total)}
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Net GST Payable</span>
            <Percent className="h-4 w-4 text-dmk-orange" />
          </div>
          <span className={cn("font-money text-[20px] font-semibold block mt-2", netTotal >= 0 ? "text-dmk-orange" : "text-dmk-success")}>
            {formatINR(netTotal)}
          </span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">
            {netTotal >= 0 ? "Payable to government" : "Credit carried forward"}
          </span>
        </div>
      </div>

      {/* Component table */}
      <div className="dmk-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dmk-border-subtle">
          <h2 className="text-[13px] font-semibold text-dmk-text-primary">By Component</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num text-right">Output Tax (₹)</th>
                <th className="num text-right">Input ITC (₹)</th>
                <th className="num text-right">Net Payable (₹)</th>
              </tr>
            </thead>
            <tbody>
              {componentRows.map((c) => (
                <tr key={c.name}>
                  <td><Badge tone="neutral">{c.name}</Badge></td>
                  <td className="num text-right text-dmk-success">{formatINR(c.out)}</td>
                  <td className="num text-right text-dmk-info">{formatINR(c.in)}</td>
                  <td className={cn("num text-right font-money font-semibold", c.net >= 0 ? "text-dmk-orange" : "text-dmk-success")}>
                    {formatINR(c.net)}
                  </td>
                </tr>
              ))}
              <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                <td className="font-bold text-dmk-text-primary">TOTAL</td>
                <td className="num text-right font-money font-bold text-dmk-success">
                  {formatINR(output.cgst + output.sgst + output.igst)}
                </td>
                <td className="num text-right font-money font-bold text-dmk-info">
                  {formatINR(input.cgst + input.sgst + input.igst)}
                </td>
                <td className={cn("num text-right font-money font-bold", netTotal >= 0 ? "text-dmk-orange" : "text-dmk-success")}>
                  {formatINR(netTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Output + Input doc tables */}
      <GstSideTable title="Output Tax Documents (Sales Invoices)" tone="success" rows={output.rows} />
      <GstSideTable title="Input Tax Credit Documents (Confirmed POs)" tone="info" rows={input.rows} />
    </div>
  );
}

function GstSideTable({ title, tone, rows }: { title: string; tone: "success" | "info"; rows: GstDocRow[] }) {
  return (
    <div className="dmk-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
        <h2 className="text-[13px] font-semibold text-dmk-text-primary">{title}</h2>
        <Badge tone={tone}>{rows.length} docs</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-dmk-text-muted px-4 py-6 text-center">No documents in this window.</p>
      ) : (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="dmk-table">
            <thead>
              <tr>
                <th>Doc #</th>
                <th>Date</th>
                <th>Party</th>
                <th className="hidden md:table-cell">State</th>
                <th className="num text-right">Taxable (₹)</th>
                <th className="num text-right">CGST (₹)</th>
                <th className="num text-right">SGST (₹)</th>
                <th className="num text-right">IGST (₹)</th>
                <th className="num text-right">Total (₹)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.docNo}>
                  <td className="font-money text-[12px] whitespace-nowrap">{r.docNo}</td>
                  <td className="text-[12px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="max-w-[200px]"><span className="block truncate text-[12.5px]">{r.party}</span></td>
                  <td className="hidden md:table-cell text-[12px] text-dmk-text-muted">{r.partyStateCode}</td>
                  <td className="num text-right text-dmk-text-primary">{formatINR(r.taxable)}</td>
                  <td className="num text-right text-dmk-text-secondary">{r.cgst ? formatINR(r.cgst) : "—"}</td>
                  <td className="num text-right text-dmk-text-secondary">{r.sgst ? formatINR(r.sgst) : "—"}</td>
                  <td className="num text-right text-dmk-text-secondary">{r.igst ? formatINR(r.igst) : "—"}</td>
                  <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
