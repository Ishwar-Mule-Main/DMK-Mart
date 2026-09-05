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
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  Download,
  FileText,
  Landmark,
  Loader2,
  Percent,
  RefreshCw,
  Scale,
  ScrollText,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader, inputCls } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ReportType = "sales" | "purchases" | "stock" | "gst" | "valuation" | "gstr1" | "profitability";

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

// ── GSTR-1 (sales-side outward supplies) ────────────────────────
interface Gstr1DocRow {
  docNo: string;
  date: string;
  party: string;
  gstin: string | null;
  supplyType: "B2B" | "B2C";
  placeOfSupply: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

interface Gstr1RateRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  qty: number;
}

interface Gstr1HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

interface Gstr1Side {
  count: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

interface Gstr1Totals {
  totalTaxable: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  invoiceCount: number;
  b2bCount: number;
  b2cCount: number;
}

interface ReportResponse {
  type: ReportType;
  rows?: SalesRow[] | PurchaseRow[] | StockRow[] | ValuationRow[] | ProfitRow[];
  totals?: { stockValue: number; damagedValue: number; totalValue?: number } | Gstr1Totals | ProfitTotals;
  count?: number;
  method?: string;
  output?: GstSide;
  input?: GstSide;
  net?: { cgst: number; sgst: number; igst: number };
  // gstr1
  b2b?: Gstr1Side;
  b2c?: Gstr1Side;
  rateWise?: Gstr1RateRow[];
  hsnWise?: Gstr1HsnRow[];
}

// ── Product profitability (margin vs WAC) ──────────────────────
interface ProfitRow {
  sku: string;
  name: string;
  qtySold: number;
  qtyReturned: number;
  netQty: number;
  grossRevenue: number;
  returnedValue: number;
  netRevenue: number;
  wac: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  invoiceCount: number;
  avgLineValue: number;
}

interface ProfitTotals {
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
  products: number;
  lossMakers: number;
  bestSku: string | null;
}

const REPORTS: Array<{ type: ReportType; label: string; icon: LucideIcon; desc: string }> = [
  { type: "sales", label: "Sales Report", icon: FileText, desc: "Posted invoice line items" },
  { type: "purchases", label: "Purchase Report", icon: ShoppingCart, desc: "Confirmed PO line items" },
  { type: "profitability", label: "Profitability", icon: TrendingUp, desc: "Margin vs WAC per product" },
  { type: "stock", label: "Stock Report", icon: Boxes, desc: "Dual-stock position & valuation" },
  { type: "valuation", label: "Valuation (WAC)", icon: Scale, desc: "Weighted average cost valuation" },
  { type: "gst", label: "GST Summary", icon: Percent, desc: "Output tax vs ITC vs net payable" },
  { type: "gstr1", label: "GSTR-1 (Sales)", icon: ScrollText, desc: "Outward supplies — B2B/B2C · rate · HSN" },
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
  const financialYear = useErpStore((s) => s.financialYear);
  const { toast } = useToast();

  const [type, setType] = React.useState<ReportType>("sales");
  // Report window follows the FY selected in the header and re-anchors to its
  // Apr 1 → today span whenever the selection changes (hand-edited dates win
  // until the next FY switch).
  const [dateFrom, setDateFrom] = React.useState(() => {
    const fy = financialYear || "2025-26";
    const y = parseInt(fy.slice(0, 4), 10);
    return `${Number.isFinite(y) ? y : new Date().getFullYear()}-04-01`;
  });
  const [dateTo, setDateTo] = React.useState(() => toISODate(new Date()));

  React.useEffect(() => {
    if (!financialYear) return;
    const y = parseInt(financialYear.slice(0, 4), 10);
    if (Number.isFinite(y)) setDateFrom(`${y}-04-01`);
  }, [financialYear]);
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
    } else if (data.type === "profitability" && data.totals) {
      const rows = (data.rows ?? []) as ProfitRow[];
      const t = data.totals as ProfitTotals;
      const out: (string | number)[][] = [
        ["Product Profitability — margin vs WAC", `${dateFrom} → ${dateTo}`],
        ["Net Revenue", "COGS", "Gross Profit", "Margin %", "Products", "Loss Makers"],
        [t.revenue, t.cogs, t.grossProfit, t.marginPct, t.products, t.lossMakers],
        [],
        ["SKU", "Product", "Qty Sold", "Qty Returned", "Net Qty", "Gross Revenue", "Returned Value", "Net Revenue", "WAC", "COGS", "Gross Profit", "Margin %", "Invoices", "Avg Line Value"],
      ];
      rows.forEach((r) =>
        out.push([r.sku, r.name, r.qtySold, r.qtyReturned, r.netQty, r.grossRevenue, r.returnedValue, r.netRevenue, r.wac, r.cogs, r.grossProfit, r.marginPct, r.invoiceCount, r.avgLineValue])
      );
      downloadCSV(`profitability-${dateFrom}-to-${dateTo}.csv`, out);
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
        const vt = data.totals as { stockValue: number; damagedValue: number; totalValue?: number };
        out.push([], ["TOTALS", "", "", "", "", "", "", "", vt.stockValue, vt.damagedValue, vt.totalValue ?? vt.stockValue + vt.damagedValue]);
      }
      downloadCSV(`stock-valuation-wac-${toISODate(new Date())}.csv`, out);
    } else if (data.type === "gstr1" && data.totals) {
      const t = data.totals as Gstr1Totals;
      const docs = (data.rows ?? []) as unknown as Gstr1DocRow[];
      const out: (string | number)[][] = [
        ["GSTR-1 — Outward Supplies", `${dateFrom} → ${dateTo}`],
        ["Taxable", "CGST", "SGST", "IGST", "Total Tax", "Invoices", "B2B", "B2C"],
        [t.totalTaxable, t.totalCgst, t.totalSgst, t.totalIgst, t.totalTax, t.invoiceCount, t.b2bCount, t.b2cCount],
        [],
        ["RATE-WISE"],
        ["GST %", "Qty", "Taxable", "CGST", "SGST", "IGST"],
      ];
      (data.rateWise ?? []).forEach((r) => out.push([`${r.rate}%`, r.qty, r.taxable, r.cgst, r.sgst, r.igst]));
      out.push([], ["HSN-WISE"], ["HSN", "Description", "Qty", "Taxable", "CGST", "SGST", "IGST"]);
      (data.hsnWise ?? []).forEach((r) => out.push([r.hsn, r.description, r.qty, r.taxable, r.cgst, r.sgst, r.igst]));
      out.push([], ["INVOICE DOCS"], ["Doc #", "Date", "Party", "GSTIN", "Type", "Place of Supply", "Taxable", "CGST", "SGST", "IGST", "Total"]);
      docs.forEach((r) => out.push([r.docNo, r.date, r.party, r.gstin ?? "", r.supplyType, r.placeOfSupply, r.taxable, r.cgst, r.sgst, r.igst, r.total]));
      downloadCSV(`gstr1-outward-${dateFrom}-to-${dateTo}.csv`, out);
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
              className="h-9 gap-2 bg-dmk-yellow text-[12.5px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/85"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </>
        }
      />

      {/* ── Report type cards ───────────────────────────── */}
      <div className="dmk-enter-stagger grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
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
                  ? "border-dmk-yellow/60 bg-dmk-hover shadow-[0_0_0_1px_rgba(255,107,0,0.35)]"
                  : "border-dmk-border-subtle bg-dmk-bg-secondary hover:bg-dmk-hover/60"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg border",
                    selected ? "border-dmk-yellow/40 bg-dmk-input-well" : "border-dmk-border-subtle bg-dmk-input-well"
                  )}
                >
                  <Icon className={cn("h-4 w-4", selected ? "text-dmk-yellow" : "text-dmk-text-muted")} />
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
      ) : data.type === "profitability" && data.totals ? (
        <ProfitabilityReport
          rows={(data.rows ?? []) as ProfitRow[]}
          totals={data.totals as ProfitTotals}
          method={data.method}
          firmId={activeFirmId}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      ) : data.type === "stock" ? (
        <StockReport rows={(data.rows ?? []) as StockRow[]} totals={data.totals as { stockValue: number; damagedValue: number } | undefined} />
      ) : data.type === "valuation" ? (
        <ValuationReport
          rows={(data.rows ?? []) as ValuationRow[]}
          totals={data.totals as { stockValue: number; damagedValue: number; totalValue?: number } | undefined}
          method={data.method}
        />
      ) : data.type === "gstr1" && data.totals ? (
        <Gstr1Report
          totals={data.totals as Gstr1Totals}
          b2b={data.b2b}
          b2c={data.b2c}
          rateWise={data.rateWise ?? []}
          hsnWise={data.hsnWise ?? []}
          docs={(data.rows ?? []) as unknown as Gstr1DocRow[]}
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
        <div className="overflow-x-auto max-h-[max(420px,calc(100vh-560px))] overflow-y-auto">
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
          <div className="overflow-x-auto max-h-[max(420px,calc(100vh-480px))] overflow-y-auto">
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
        <div className="overflow-x-auto max-h-[max(420px,calc(100vh-480px))] overflow-y-auto">
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
        <div className="overflow-x-auto max-h-[max(420px,calc(100vh-500px))] overflow-y-auto">
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
            <Percent className="h-4 w-4 text-dmk-yellow" />
          </div>
          <span className={cn("font-money text-[20px] font-semibold block mt-2", netTotal >= 0 ? "text-dmk-yellow" : "text-dmk-success")}>
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
                  <td className={cn("num text-right font-money font-semibold", c.net >= 0 ? "text-dmk-yellow" : "text-dmk-success")}>
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
                <td className={cn("num text-right font-money font-bold", netTotal >= 0 ? "text-dmk-yellow" : "text-dmk-success")}>
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

// ═══════════════════════════════════════════════════════════════
// GSTR-1 — OUTWARD SUPPLIES (sales-side filing summary, cycle 17)
// B2B/B2C split · rate-wise buckets · HSN summary · invoice docs
// ═══════════════════════════════════════════════════════════════

function Gstr1Report({
  totals,
  b2b,
  b2c,
  rateWise,
  hsnWise,
  docs,
}: {
  totals: Gstr1Totals;
  b2b?: Gstr1Side;
  b2c?: Gstr1Side;
  rateWise: Gstr1RateRow[];
  hsnWise: Gstr1HsnRow[];
  docs: Gstr1DocRow[];
}) {
  const rateTaxTotal = rateWise.reduce((s, r) => s + r.taxable, 0);
  const hsnTaxTotal = hsnWise.reduce((s, r) => s + r.taxable, 0);
  // Cross-foot: rate-wise + hsn-wise taxable must equal the doc totals.
  const rateDelta = Math.round((rateTaxTotal - totals.totalTaxable) * 100) / 100;
  const hsnDelta = Math.round((hsnTaxTotal - totals.totalTaxable) * 100) / 100;
  const reconciled = Math.abs(rateDelta) <= 0.01 && Math.abs(hsnDelta) <= 0.01;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Total Output Tax</span>
            <Percent className="h-4 w-4 text-dmk-yellow" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-yellow block mt-2">{formatINR(totals.totalTax)}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block font-money">
            CGST {formatINR(totals.totalCgst)} · SGST {formatINR(totals.totalSgst)} · IGST {formatINR(totals.totalIgst)}
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">B2B Taxable</span>
            <Badge tone="info">B2B</Badge>
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-text-primary block mt-2">{formatINR(b2b?.taxable ?? 0)}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">
            {b2b?.count ?? 0} doc{(b2b?.count ?? 0) === 1 ? "" : "s"} · registered buyers
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">B2C Taxable</span>
            <Badge tone="dr">B2C</Badge>
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-text-primary block mt-2">{formatINR(b2c?.taxable ?? 0)}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">
            {b2c?.count ?? 0} doc{(b2c?.count ?? 0) === 1 ? "" : "s"} · counter / unregistered
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Invoices</span>
            <ScrollText className="h-4 w-4 text-dmk-gold" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-text-primary block mt-2">{totals.invoiceCount}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block font-money">
            Taxable {formatINR(totals.totalTaxable)} total
          </span>
        </div>
      </div>

      {/* Reconciliation strip */}
      <div className="dmk-card px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide",
            reconciled
              ? "border-dmk-success/40 bg-dmk-success/10 text-dmk-success"
              : "border-dmk-warning/40 bg-dmk-warning/10 text-dmk-warning"
          )}
        >
          {reconciled ? "CROSS-FOOTED ✓" : `Δ ${formatINR(Math.abs(rateDelta || hsnDelta))}`}
        </span>
        <span className="text-dmk-text-muted">
          Rate-wise <span className="font-money text-dmk-text-secondary">{formatINR(rateTaxTotal)}</span>
          {" · "}HSN-wise <span className="font-money text-dmk-text-secondary">{formatINR(hsnTaxTotal)}</span>
          {" · "}both reconcile to invoice totals <span className="font-money text-dmk-text-secondary">{formatINR(totals.totalTaxable)}</span>
        </span>
      </div>

      {/* Rate-wise */}
      <div className="dmk-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
          <h2 className="text-[13px] font-semibold text-dmk-text-primary">Rate-wise Tax Buckets</h2>
          <Badge tone="gold">{rateWise.length} rate{rateWise.length === 1 ? "" : "s"}</Badge>
        </div>
        {rateWise.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted px-4 py-6 text-center">No supplies in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>GST Rate</th>
                  <th className="num text-right">Qty</th>
                  <th className="num text-right">Taxable (₹)</th>
                  <th className="num text-right">CGST (₹)</th>
                  <th className="num text-right">SGST (₹)</th>
                  <th className="num text-right">IGST (₹)</th>
                  <th className="num text-right">Tax (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rateWise.map((r) => (
                  <tr key={r.rate}>
                    <td>
                      <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold font-money">{r.rate}%</span>
                    </td>
                    <td className="num text-right text-dmk-text-secondary">{r.qty}</td>
                    <td className="num text-right text-dmk-text-primary">{formatINR(r.taxable)}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.cgst ? formatINR(r.cgst) : "—"}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.sgst ? formatINR(r.sgst) : "—"}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.igst ? formatINR(r.igst) : "—"}</td>
                    <td className="num text-right font-money font-semibold text-dmk-yellow">
                      {formatINR(r.cgst + r.sgst + r.igst)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                  <td className="font-bold text-dmk-text-primary">TOTAL</td>
                  <td className="num text-right text-dmk-text-secondary">{rateWise.reduce((s, r) => s + r.qty, 0)}</td>
                  <td className="num text-right font-money font-bold">{formatINR(rateTaxTotal)}</td>
                  <td className="num text-right font-money font-bold">{formatINR(totals.totalCgst)}</td>
                  <td className="num text-right font-money font-bold">{formatINR(totals.totalSgst)}</td>
                  <td className="num text-right font-money font-bold">{formatINR(totals.totalIgst)}</td>
                  <td className="num text-right font-money font-bold text-dmk-yellow">{formatINR(totals.totalTax)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* HSN-wise */}
      <div className="dmk-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
          <h2 className="text-[13px] font-semibold text-dmk-text-primary">HSN-wise Summary</h2>
          <Badge tone="neutral">{hsnWise.length} HSN{hsnWise.length === 1 ? "" : "s"}</Badge>
        </div>
        {hsnWise.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted px-4 py-6 text-center">No supplies in this window.</p>
        ) : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>HSN</th>
                  <th>Description</th>
                  <th className="num text-right">Qty</th>
                  <th className="num text-right">Taxable (₹)</th>
                  <th className="num text-right">CGST (₹)</th>
                  <th className="num text-right">SGST (₹)</th>
                  <th className="num text-right">IGST (₹)</th>
                </tr>
              </thead>
              <tbody>
                {hsnWise.map((r) => (
                  <tr key={r.hsn}>
                    <td className="font-money text-[12px] text-dmk-text-primary">{r.hsn}</td>
                    <td className="max-w-[240px]"><span className="block truncate text-[12.5px]" title={r.description}>{r.description}</span></td>
                    <td className="num text-right text-dmk-text-secondary">{r.qty}</td>
                    <td className="num text-right text-dmk-text-primary">{formatINR(r.taxable)}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.cgst ? formatINR(r.cgst) : "—"}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.sgst ? formatINR(r.sgst) : "—"}</td>
                    <td className="num text-right text-dmk-text-secondary">{r.igst ? formatINR(r.igst) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoice docs */}
      <div className="dmk-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
          <h2 className="text-[13px] font-semibold text-dmk-text-primary">Outward Invoice Documents</h2>
          <Badge tone="neutral">{docs.length} docs</Badge>
        </div>
        {docs.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted px-4 py-6 text-center">No invoices in this window.</p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="dmk-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Doc #</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th>GSTIN</th>
                  <th>Type</th>
                  <th>POS</th>
                  <th className="num text-right">Taxable (₹)</th>
                  <th className="num text-right">CGST (₹)</th>
                  <th className="num text-right">SGST (₹)</th>
                  <th className="num text-right">IGST (₹)</th>
                  <th className="num text-right">Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((r) => (
                  <tr key={r.docNo}>
                    <td className="font-money text-[12px] whitespace-nowrap text-dmk-text-primary">{r.docNo}</td>
                    <td className="text-[12px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="max-w-[200px]"><span className="block truncate text-[12.5px]" title={r.party}>{r.party}</span></td>
                    <td className="font-money text-[11px] text-dmk-text-muted whitespace-nowrap">{r.gstin ?? "—"}</td>
                    <td>{r.supplyType === "B2B" ? <Badge tone="info">B2B</Badge> : <Badge tone="dr">B2C</Badge>}</td>
                    <td className="text-[12px] text-dmk-text-muted">{r.placeOfSupply}</td>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRODUCT PROFITABILITY — margin vs WAC (cycle 18)
// Revenue (taxable, returns netted) − COGS (qty × WAC) per SKU.
// ═══════════════════════════════════════════════════════════════

const CHART_GOLD = "#F59E0B";
const CHART_GREEN = "#10B981";
const CHART_RED = "#EF4444";

function ProfitabilityReport({
  rows,
  totals,
  method,
  firmId,
  dateFrom,
  dateTo,
}: {
  rows: ProfitRow[];
  totals: ProfitTotals;
  method?: string;
  firmId: string | null;
  dateFrom: string;
  dateTo: string;
}) {
  const [sortBy, setSortBy] = React.useState<"profit" | "margin" | "revenue" | "qty">("profit");
  const [drillRow, setDrillRow] = React.useState<ProfitRow | null>(null);

  const openDrill = (r: ProfitRow) => setDrillRow(r);

  const sorted = React.useMemo(() => {
    const copy = [...rows];
    if (sortBy === "margin") copy.sort((a, b) => b.marginPct - a.marginPct);
    else if (sortBy === "revenue") copy.sort((a, b) => b.netRevenue - a.netRevenue);
    else if (sortBy === "qty") copy.sort((a, b) => b.netQty - a.netQty);
    else copy.sort((a, b) => b.grossProfit - a.grossProfit);
    return copy;
  }, [rows, sortBy]);

  const chartData = React.useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.grossProfit - a.grossProfit)
        .slice(0, 8)
        .map((r) => ({
          name: r.name.length > 18 ? `${r.name.slice(0, 17)}…` : r.name,
          profit: r.grossProfit,
          negative: r.grossProfit < 0,
        })),
    [rows]
  );

  const best = totals.bestSku ? rows.find((r) => r.sku === totals.bestSku) : undefined;

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="dmk-enter-stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Net Revenue</span>
            <ArrowUpRight className="h-4 w-4 text-dmk-success" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-success block mt-2">{formatINR(totals.revenue)}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">{totals.products} SKUs sold · returns netted</span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">COGS @ WAC</span>
            <Scale className="h-4 w-4 text-dmk-info" />
          </div>
          <span className="font-money text-[20px] font-semibold text-dmk-info block mt-2">{formatINR(totals.cogs)}</span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">Weighted average cost basis</span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Gross Profit</span>
            <TrendingUp className="h-4 w-4 text-dmk-gold" />
          </div>
          <span className={cn("font-money text-[20px] font-semibold block mt-2", totals.grossProfit >= 0 ? "text-dmk-gold" : "text-dmk-danger")}>
            {formatINR(totals.grossProfit)}
          </span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block font-money">
            Margin {totals.marginPct.toFixed(1)}%{best ? ` · best ${best.name.split(" ").slice(0, 2).join(" ")}` : ""}
          </span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Loss Makers</span>
            <ArrowDownRight className={cn("h-4 w-4", totals.lossMakers > 0 ? "text-dmk-danger" : "text-dmk-text-muted")} />
          </div>
          <span className={cn("font-money text-[20px] font-semibold block mt-2", totals.lossMakers > 0 ? "text-dmk-danger" : "text-dmk-success")}>
            {totals.lossMakers}
          </span>
          <span className="text-[11px] text-dmk-text-muted mt-1.5 block">
            {totals.lossMakers > 0 ? "Review pricing / cost on these" : "Every SKU is profitable"}
          </span>
        </div>
      </div>

      {/* Method strip */}
      <div className="dmk-well px-3.5 py-2.5 flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-dmk-info shrink-0" />
        <p className="text-[11.5px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Basis:</span> {method ?? "COGS at weighted average cost from confirmed receipts; sales returns netted."}
        </p>
      </div>

      {/* Top products chart */}
      {chartData.length > 0 && (
        <div className="dmk-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-dmk-text-primary">Top Products by Gross Profit</h2>
              <p className="text-[11px] text-dmk-text-muted">Top {chartData.length} SKUs · taxable revenue minus WAC cost of net quantity</p>
            </div>
            <Badge tone="gold">PROFIT</Badge>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1E2D4A" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={{ stroke: "#1E2D4A" }}
                  tickLine={false}
                  tickFormatter={(v) => compactINR(Number(v))}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={130}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
                  itemStyle={{ color: "var(--text-primary)", fontFamily: "var(--font-jetbrains)" }}
                  formatter={(value) => formatINR(Number(value))}
                  cursor={{ fill: "rgba(245,158,11,0.06)" }}
                />
                <Bar dataKey="profit" name="Gross profit" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={d.negative ? CHART_RED : CHART_GREEN} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-product table */}
      <div className="dmk-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-dmk-border-subtle">
          <h2 className="text-[13px] font-semibold text-dmk-text-primary">Per-product profitability</h2>
          <div className="flex items-center gap-1">
            {(["profit", "margin", "revenue", "qty"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setSortBy(k)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide transition-colors",
                  sortBy === k
                    ? "border-dmk-gold/40 bg-dmk-gold/10 text-dmk-gold"
                    : "border-dmk-border-subtle bg-dmk-input-well text-dmk-text-muted hover:bg-dmk-hover hover:text-dmk-text-secondary"
                )}
              >
                {k === "qty" ? "Quantity" : k}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-[12px] text-dmk-text-muted px-4 py-6 text-center">No sales in this window.</p>
        ) : (
          <div className="overflow-x-auto max-h-[max(420px,calc(100vh-560px))] overflow-y-auto">
            <table className="dmk-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="num text-right">Sold</th>
                  <th className="num text-right hidden md:table-cell">Returned</th>
                  <th className="num text-right">Net Qty</th>
                  <th className="num text-right">Net Revenue (₹)</th>
                  <th className="num text-right hidden lg:table-cell">WAC (₹)</th>
                  <th className="num text-right">COGS (₹)</th>
                  <th className="num text-right">Profit (₹)</th>
                  <th className="num text-right">Margin</th>
                  <th className="num text-right hidden lg:table-cell">Invoices</th>
                  <th className="w-8"><span className="sr-only">Drill through</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.sku}
                    tabIndex={0}
                    role="button"
                    aria-label={`Drill into ${r.sku} — view contributing invoice lines`}
                    title="Click to view the invoice lines behind this row"
                    onClick={() => openDrill(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDrill(r);
                      }
                    }}
                    className="cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-dmk-gold/60"
                  >
                    <td className="font-money text-[12px] text-dmk-text-secondary whitespace-nowrap">{r.sku}</td>
                    <td className="max-w-[220px]">
                      <span className="block truncate text-[12.5px] font-medium" title={r.name}>{r.name}</span>
                    </td>
                    <td className="num text-right text-dmk-text-primary">{r.qtySold}</td>
                    <td className={cn("num text-right hidden md:table-cell", r.qtyReturned > 0 ? "text-dmk-warning font-semibold" : "text-dmk-text-muted")}>
                      {r.qtyReturned || "—"}
                    </td>
                    <td className="num text-right text-dmk-text-secondary">{r.netQty}</td>
                    <td className="num text-right text-dmk-text-primary">{formatINR(r.netRevenue)}</td>
                    <td className="num text-right hidden lg:table-cell text-dmk-text-muted">{formatINR(r.wac)}</td>
                    <td className="num text-right text-dmk-info">{formatINR(r.cogs)}</td>
                    <td className={cn("num text-right font-money font-semibold", r.grossProfit >= 0 ? "text-dmk-success" : "text-dmk-danger")}>
                      {r.grossProfit >= 0 ? "" : "−"}{formatINR(Math.abs(r.grossProfit))}
                    </td>
                    <td className="num text-right">
                      <span
                        className={cn(
                          "dmk-badge font-money",
                          r.marginPct >= 20
                            ? "bg-dmk-success/15 text-dmk-success"
                            : r.marginPct >= 10
                              ? "bg-dmk-gold/15 text-dmk-gold"
                              : r.marginPct >= 0
                                ? "bg-dmk-warning/15 text-dmk-warning"
                                : "bg-dmk-danger/15 text-dmk-danger"
                        )}
                      >
                        {r.marginPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="num text-right hidden lg:table-cell text-dmk-text-muted">{r.invoiceCount}</td>
                    <td className="w-8 pr-2">
                      <ChevronRight className="h-3.5 w-3.5 text-dmk-gold" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                  <td colSpan={5} className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                    Totals — {totals.products} SKUs
                  </td>
                  <td className="num text-right font-money font-bold text-dmk-text-primary">{formatINR(totals.revenue)}</td>
                  <td className="hidden lg:table-cell" />
                  <td className="num text-right font-money font-bold text-dmk-info">{formatINR(totals.cogs)}</td>
                  <td className={cn("num text-right font-money font-bold", totals.grossProfit >= 0 ? "text-dmk-success" : "text-dmk-danger")}>
                    {formatINR(totals.grossProfit)}
                  </td>
                  <td className="num text-right font-money font-bold text-dmk-gold">{totals.marginPct.toFixed(1)}%</td>
                  <td className="hidden lg:table-cell" />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="px-4 py-2 text-[10.5px] text-dmk-text-muted border-t border-dmk-border-subtle">
            Click a row to drill into the invoice lines and returns behind its profit number.
          </p>
        )}
      </div>

      {/* ── SKU drill-through dialog ──────────────────── */}
      <SkuDrillDialog
        row={drillRow}
        firmId={firmId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onOpenChange={(open) => !open && setDrillRow(null)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SKU DRILL-THROUGH — invoice lines + returns behind one SKU row
// GET /api/v1/reports?type=profitability&drillSku=<sku>&dateFrom&dateTo
// ═══════════════════════════════════════════════════════════════

interface DrillLine {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  qty: number;
  unitPrice: number;
  taxable: number;
  cogsUnit: number;
  cogs: number;
  profit: number;
  marginPct: number;
}

interface DrillReturn {
  creditNoteNo: string;
  returnDate: string;
  customerName: string;
  qty: number;
  amount: number;
}

interface DrillTotals {
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
  invoices: number;
  returnsQty: number;
  returnsAmount: number;
  netRevenue: number;
  netCogs: number;
  netProfit: number;
}

interface DrillPayload {
  sku: string;
  productName: string;
  wac: number;
  basis: string;
  lines: DrillLine[];
  returns: DrillReturn[];
  totals: DrillTotals;
}

function marginBadgeCls(m: number): string {
  if (m >= 20) return "bg-dmk-success/15 text-dmk-success";
  if (m >= 10) return "bg-dmk-gold/15 text-dmk-gold";
  if (m >= 0) return "bg-dmk-warning/15 text-dmk-warning";
  return "bg-dmk-danger/15 text-dmk-danger";
}

function SkuDrillDialog({
  row,
  firmId,
  dateFrom,
  dateTo,
  onOpenChange,
}: {
  row: ProfitRow | null;
  firmId: string | null;
  dateFrom: string;
  dateTo: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [drill, setDrill] = React.useState<DrillPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const sku = row?.sku ?? null;

  React.useEffect(() => {
    if (!sku || !firmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setDrill(null);
    apiGet<{ drill: DrillPayload }>("/api/v1/reports", {
      firmId,
      type: "profitability",
      drillSku: sku,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then((res) => {
        if (alive) setDrill(res.drill);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Drill-through failed");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sku, firmId, dateFrom, dateTo]);

  const t = drill?.totals ?? null;

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-card border-dmk-border-medium max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-[16px] text-dmk-text-primary">
            <span className="font-money text-dmk-gold">{row?.sku}</span>
            <span className="text-[13px] font-normal text-dmk-text-secondary truncate max-w-[240px] sm:max-w-none">
              {drill?.productName ?? row?.name}
            </span>
            <span className="dmk-badge font-money bg-dmk-info/15 text-dmk-info">
              WAC {formatINR(drill?.wac ?? row?.wac ?? 0)}
            </span>
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            Contributing invoice lines · {dateFrom} → {dateTo}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-dmk-text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-dmk-gold" />
            Fetching invoice lines…
          </div>
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : drill && t ? (
          <div className="space-y-3.5">
            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="dmk-well p-3">
                <span className="block text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">Sold qty</span>
                <span className="font-money text-[17px] font-semibold text-dmk-text-primary">{t.qty}</span>
                <span className="block text-[10.5px] text-dmk-text-muted mt-0.5">
                  {t.invoices} invoice{t.invoices === 1 ? "" : "s"} · {t.returnsQty} returned
                </span>
              </div>
              <div className="dmk-well p-3">
                <span className="block text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">Net revenue</span>
                <span className="font-money text-[17px] font-semibold text-dmk-text-primary">{formatINR(t.netRevenue)}</span>
                <span className="block text-[10.5px] text-dmk-text-muted mt-0.5 font-money">
                  gross {formatINR(t.revenue)}
                  {t.returnsAmount > 0 ? ` − ${formatINR(t.returnsAmount)} ret` : ""}
                </span>
              </div>
              <div className="dmk-well p-3">
                <span className="block text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">COGS @ WAC</span>
                <span className="font-money text-[17px] font-semibold text-dmk-info">{formatINR(t.netCogs)}</span>
                <span className="block text-[10.5px] text-dmk-text-muted mt-0.5">Net of returned qty</span>
              </div>
              <div className="dmk-well p-3">
                <span className="block text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">Net profit</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn("font-money text-[17px] font-semibold", t.netProfit >= 0 ? "text-dmk-success" : "text-dmk-danger")}>
                    {t.netProfit >= 0 ? "" : "−"}{formatINR(Math.abs(t.netProfit))}
                  </span>
                  <span className={cn("dmk-badge font-money", marginBadgeCls(t.marginPct))}>
                    {t.marginPct.toFixed(1)}%
                  </span>
                </div>
                <span className="block text-[10.5px] text-dmk-text-muted mt-0.5">Reconciles with the row above</span>
              </div>
            </div>

            {/* Sales lines */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-dmk-text-secondary">Sales lines</h3>
                <span className="text-[10.5px] text-dmk-text-muted">{drill.lines.length} line{drill.lines.length === 1 ? "" : "s"}</span>
              </div>
              {drill.lines.length === 0 ? (
                <p className="dmk-well px-3 py-4 text-[12px] text-dmk-text-muted text-center">
                  No sale lines for this SKU in the window.
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-md border border-dmk-border-subtle">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th className="num text-right">Qty</th>
                        <th className="num text-right">Unit ₹</th>
                        <th className="num text-right">Taxable ₹</th>
                        <th className="num text-right hidden sm:table-cell">COGS ₹</th>
                        <th className="num text-right">Profit ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drill.lines.map((l) => (
                        <tr key={l.invoiceId}>
                          <td className="font-money text-[11.5px] text-dmk-gold whitespace-nowrap">{l.invoiceNumber}</td>
                          <td className="whitespace-nowrap text-dmk-text-secondary text-[12px]">{formatDate(l.invoiceDate)}</td>
                          <td className="max-w-[160px]">
                            <span className="block truncate text-[12px]" title={l.customerName}>{l.customerName}</span>
                          </td>
                          <td className="num text-right text-dmk-text-primary">{l.qty}</td>
                          <td className="num text-right text-dmk-text-secondary font-money">{formatINR(l.unitPrice)}</td>
                          <td className="num text-right text-dmk-text-primary font-money">{formatINR(l.taxable)}</td>
                          <td className="num text-right text-dmk-info font-money hidden sm:table-cell">{formatINR(l.cogs)}</td>
                          <td className={cn("num text-right font-money font-semibold", l.profit >= 0 ? "text-dmk-success" : "text-dmk-danger")}>
                            {l.profit >= 0 ? "" : "−"}{formatINR(Math.abs(l.profit))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                        <td colSpan={3} className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">
                          Totals
                        </td>
                        <td className="num text-right font-money font-bold text-dmk-text-primary">{t.qty}</td>
                        <td className="num text-right text-dmk-text-muted" />
                        <td className="num text-right font-money font-bold text-dmk-text-primary">{formatINR(t.revenue)}</td>
                        <td className="num text-right font-money font-bold text-dmk-info hidden sm:table-cell">{formatINR(t.cogs)}</td>
                        <td className={cn("num text-right font-money font-bold", t.profit >= 0 ? "text-dmk-success" : "text-dmk-danger")}>
                          {formatINR(t.profit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {/* Returns in window */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-[11.5px] font-semibold uppercase tracking-wide text-dmk-text-secondary">Returns in window</h3>
                <span className="text-[10.5px] text-dmk-text-muted font-money">
                  {drill.returns.length > 0 ? `− ${formatINR(t.returnsAmount)}` : "—"}
                </span>
              </div>
              {drill.returns.length === 0 ? (
                <p className="dmk-well px-3 py-3 text-[12px] text-dmk-text-muted text-center">
                  No returns in this window — clean margin story for this SKU.
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-md border border-dmk-border-subtle">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>Credit note</th>
                        <th>Date</th>
                        <th>Customer</th>
                        <th className="num text-right">Qty</th>
                        <th className="num text-right">Amount ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drill.returns.map((r) => (
                        <tr key={`${r.creditNoteNo}-${r.returnDate}`}>
                          <td className="font-money text-[11.5px] text-dmk-warning whitespace-nowrap">{r.creditNoteNo}</td>
                          <td className="whitespace-nowrap text-dmk-text-secondary text-[12px]">{formatDate(r.returnDate)}</td>
                          <td className="max-w-[200px]">
                            <span className="block truncate text-[12px]" title={r.customerName}>{r.customerName}</span>
                          </td>
                          <td className="num text-right text-dmk-warning font-semibold">{r.qty}</td>
                          <td className="num text-right font-money font-semibold text-dmk-danger">− {formatINR(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="dmk-well px-3 py-2">
              <p className="text-[10.5px] leading-relaxed text-dmk-text-muted">
                <span className="font-semibold text-dmk-text-secondary">Basis:</span> {drill.basis}
              </p>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
