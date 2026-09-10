"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Stock Levels — dual-stock matrix (R3)
// Sellable vs damaged pools, valuation, adjustment dialog
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, Loader2, Scale } from "lucide-react";

import {
  PageHeader,
  Badge,
  Money,
  EmptyState,
  LoadingRows,
  SearchInput,
  DataTable,
  ErrorText,
} from "../shared";
import { StockAdjustDialog } from "../stock-adjust-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiPost } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import { useT } from "@/lib/i18n";
import type { Product } from "@/types/erp";
import { formatINR, toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default function StockLevelsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { t } = useT();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [lowOnly, setLowOnly] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const seqRef = React.useRef(0);

  // Adjustment dialog (shared 5-type component)
  const [adjusting, setAdjusting] = React.useState<Product | null>(null);

  // Reorder assist dialog
  const [reorderOpen, setReorderOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ products: Product[]; categories: string[] }>(
        "/api/v1/products",
        {
          firmId: activeFirmId,
          search: debouncedSearch || undefined,
          category: category === "all" ? undefined : category,
          activeOnly: "true",
        }
      );
      if (seq !== seqRef.current) return;
      setProducts(res.products ?? []);
      setCategories(res.categories ?? []);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : t("stl.loadFailed"));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [activeFirmId, debouncedSearch, category]);

  React.useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const rows = React.useMemo(
    () => (lowOnly ? products.filter((p) => p.stockQuantity <= p.lowStockThreshold) : products),
    [products, lowOnly]
  );

  // Reorder assist only counts products with a meaningful threshold (> 0),
  // mirroring the reorder-suggestions backend filter.
  const lowCount = React.useMemo(
    () => products.filter((p) => p.lowStockThreshold > 0 && p.stockQuantity <= p.lowStockThreshold).length,
    [products]
  );

  const totals = React.useMemo(
    () => ({
      sellable: rows.reduce((s, p) => s + p.stockQuantity, 0),
      reserved: rows.reduce((s, p) => s + (p.reservedQty ?? 0), 0),
      damaged: rows.reduce((s, p) => s + p.damagedStock, 0),
      valuation: rows.reduce((s, p) => s + p.stockQuantity * p.purchaseCost, 0),
      damagedValue: rows.reduce((s, p) => s + p.damagedStock * p.purchaseCost, 0),
    }),
    [rows]
  );

  const openAdjust = (p: Product) => {
    setAdjusting(p);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("stl.title")}
        subtitle={t("stl.subtitle")}
        actions={
          <div className="dmk-well px-3 py-1.5 flex items-center gap-4">
            <span className="text-[11px] text-dmk-text-muted">
              {t("stl.sellable")} <span className="font-money text-dmk-success">{fmtQty(totals.sellable)}</span>
            </span>
            <span className="text-[11px] text-dmk-text-muted">
              {t("stl.damaged")} <span className="font-money text-dmk-danger">{fmtQty(totals.damaged)}</span>
            </span>
            <span className="text-[11px] text-dmk-text-muted">
              {t("stl.value")} <span className="font-money text-dmk-text-primary">{formatINR(totals.valuation)}</span>
            </span>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t("prod.searchPh")}
          className="sm:max-w-xs"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-[190px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
            <SelectValue placeholder={t("cmn.category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("cmn.allCategories")}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Switch id="low-only" checked={lowOnly} onCheckedChange={setLowOnly} />
          <Label htmlFor="low-only" className="text-[12.5px] text-dmk-text-secondary cursor-pointer">
            {t("stl.lowOnly")}
          </Label>
          {lowCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-dmk-gold/50 bg-dmk-gold/10 text-[12px] font-semibold text-dmk-gold hover:bg-dmk-gold/20 hover:text-dmk-gold"
              onClick={() => setReorderOpen(true)}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              {t("stl.reorderBtn", { n: lowCount })}
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={8} />
        </div>
      ) : rows.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={Boxes}
            title={lowOnly ? t("stl.emptyLow") : t("stl.emptyNone")}
            hint={
              lowOnly
                ? t("stl.emptyLowHint")
                : t("stl.emptyNoneHint")
            }
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{t("cmn.sku")}</th>
              <th>{t("cmn.name")}</th>
              <th>{t("cmn.unit")}</th>
              <th className="num">{t("stl.colSellable")}</th>
              <th className="num">{t("stl.colReserved")}</th>
              <th className="num">{t("stl.colDamaged")}</th>
              <th className="num">{t("cmn.total")}</th>
              <th className="num">{t("stl.colValuation")}</th>
              <th>{t("cmn.status")}</th>
              <th className="text-right">{t("stl.colAction")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isLow = p.stockQuantity <= p.lowStockThreshold;
              return (
                <tr key={p.id}>
                  <td className="font-money text-[12.5px] text-dmk-text-secondary">{p.sku}</td>
                  <td className="font-medium max-w-[240px] truncate" title={p.name}>
                    {p.name}
                  </td>
                  <td className="text-dmk-text-secondary">{p.unit}</td>
                  <td className="num text-dmk-success">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-dmk-success mr-1.5 align-middle" />
                    {fmtQty(p.stockQuantity)}
                  </td>
                  <td className={cn("num", (p.reservedQty ?? 0) > 0 ? "text-dmk-blue" : "text-dmk-text-muted")}>
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle", (p.reservedQty ?? 0) > 0 ? "bg-dmk-blue" : "bg-dmk-text-muted/40")} />
                    {fmtQty(p.reservedQty ?? 0)}
                  </td>
                  <td className={cn("num", p.damagedStock > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-dmk-danger mr-1.5 align-middle" />
                    {fmtQty(p.damagedStock)}
                  </td>
                  <td className="num text-dmk-text-secondary">{fmtQty(p.stockQuantity + p.damagedStock)}</td>
                  <td className="num">
                    <Money value={p.stockQuantity * p.purchaseCost} />
                  </td>
                  <td>{isLow ? <Badge tone="warning">{t("stl.badgeLow")}</Badge> : <Badge tone="success">{t("stl.badgeOk")}</Badge>}</td>
                  <td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-[11.5px] border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
                      onClick={() => openAdjust(p)}
                    >
                      <Scale className="h-3 w-3 mr-1" />
                      {t("stl.adjust")}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-dmk-input-well">
              <td colSpan={3} className="px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                {t("stl.totalsProducts", { n: rows.length })}
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-success">
                {fmtQty(totals.sellable)}
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-blue">
                {fmtQty(totals.reserved)}
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-danger">
                {fmtQty(totals.damaged)}
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-text-secondary">
                {fmtQty(totals.sellable + totals.damaged)}
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-text-primary">
                {formatINR(totals.valuation)}
              </td>
              <td colSpan={2} className="px-3 py-2.5 text-[10.5px] text-dmk-text-muted">
                {t("stl.damagedValue", { amt: formatINR(totals.damagedValue) })}
              </td>
            </tr>
          </tfoot>
        </DataTable>
      )}

      {/* ── Reorder assist dialog ─────────────────────── */}
      <ReorderAssistDialog open={reorderOpen} onOpenChange={setReorderOpen} />

      {/* ── Adjustment dialog (shared 5-type component) ── */}
      <StockAdjustDialog
        product={adjusting}
        onOpenChange={(open) => !open && setAdjusting(null)}
        onAdjusted={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REORDER ASSIST — low-stock reorder suggestions → draft POs by vendor
// GET /api/v1/inventory/reorder-suggestions?firmId=
// POST /api/v1/purchase-orders (PENDING drafts, one per vendor)
// ═══════════════════════════════════════════════════════════════

interface ReorderVendor {
  id: string;
  vendorName: string;
}

interface ReorderSuggestion {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  stockQuantity: number;
  lowStockThreshold: number;
  avgDailySales: number;
  daysCover: number | null;
  suggestedQty: number;
  vendor: ReorderVendor | null;
  lastCost: number;
  estCost: number;
}

interface ReorderResponse {
  suggestions: ReorderSuggestion[];
  totals: { items: number; estTotal: number; vendors: number };
  basis: string;
}

interface CreatedPoEntry {
  vendorName: string;
  poNumber: string;
  itemCount: number;
  estCost: number;
}

interface FailedPoEntry {
  vendorName: string;
  message: string;
}

type ReorderPhase = "loading" | "ready" | "creating" | "done";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function CoverBadge({ dc }: { dc: number | null }) {
  const { t } = useT();
  if (dc === null) {
    return <span className="dmk-badge bg-dmk-input-well text-dmk-text-muted">{t("stl.noSales")}</span>;
  }
  const cls =
    dc <= 7
      ? "bg-dmk-danger/15 text-dmk-danger"
      : dc <= 15
        ? "bg-dmk-gold/15 text-dmk-gold"
        : "bg-dmk-input-well text-dmk-text-muted";
  return <span className={cn("dmk-badge font-money", cls)}>{dc}d</span>;
}

function ReorderAssistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { t } = useT();

  const [phase, setPhase] = React.useState<ReorderPhase>("loading");
  const [rows, setRows] = React.useState<ReorderSuggestion[]>([]);
  const [basis, setBasis] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Per-row editable suggested qty (string for smooth typing)
  const [qtyEdits, setQtyEdits] = React.useState<Record<string, string>>({});

  // Create-draft-POs progress + results
  const [progressText, setProgressText] = React.useState("");
  const [created, setCreated] = React.useState<CreatedPoEntry[]>([]);
  const [failed, setFailed] = React.useState<FailedPoEntry[]>([]);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    setPhase("loading");
    setRows([]);
    setBasis("");
    setError(null);
    setQtyEdits({});
    setCreated([]);
    setFailed([]);
    setProgressText("");
    apiGet<ReorderResponse>("/api/v1/inventory/reorder-suggestions", { firmId: activeFirmId })
      .then((res) => {
        if (!alive) return;
        setRows(res.suggestions ?? []);
        setBasis(res.basis ?? "");
        setPhase("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : t("stl.reorderLoadFailed"));
        setPhase("ready");
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId]);

  const effQty = (r: ReorderSuggestion): number => {
    const raw = qtyEdits[r.productId];
    if (raw === undefined || raw.trim() === "") return r.suggestedQty;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : r.suggestedQty;
  };

  const estCostOf = (r: ReorderSuggestion): number => roundMoney(effQty(r) * r.lastCost);
  const estTotal = roundMoney(rows.reduce((s, r) => s + estCostOf(r), 0));
  const vendorCount = new Set(rows.map((r) => r.vendor?.id).filter(Boolean)).size;
  const noVendorRows = rows.filter((r) => !r.vendor);
  const vendoredRows = rows.filter((r) => r.vendor);

  const createDraftPos = async () => {
    if (!activeFirmId || rows.length === 0) return;

    // Group by preferred vendor — rows without a vendor are skipped
    const groups = new Map<
      string,
      { vendorName: string; items: Array<{ productId: string; quantity: number; unitCost: number }> }
    >();
    for (const r of vendoredRows) {
      const q = effQty(r);
      if (!(q >= 1)) continue;
      const g = groups.get(r.vendor!.id) ?? { vendorName: r.vendor!.vendorName, items: [] };
      g.items.push({ productId: r.productId, quantity: Math.round(q), unitCost: r.lastCost });
      groups.set(r.vendor!.id, g);
    }
    if (groups.size === 0) return;

    setPhase("creating");
    const createdList: CreatedPoEntry[] = [];
    const failedList: FailedPoEntry[] = [];
    let idx = 0;
    for (const [vendorId, g] of groups) {
      idx += 1;
      setProgressText(t("stl.creatingPoN", { idx, total: groups.size, vendor: g.vendorName }));
      const est = roundMoney(g.items.reduce((s, it) => s + it.quantity * it.unitCost, 0));
      try {
        const po = await apiPost<{ poNumber: string }>("/api/v1/purchase-orders", {
          firmId: activeFirmId,
          vendorId,
          poDate: toISODate(new Date()),
          notes: t("stl.reorderNote"),
          items: g.items,
        });
        createdList.push({ vendorName: g.vendorName, poNumber: po.poNumber, itemCount: g.items.length, estCost: est });
      } catch (e) {
        failedList.push({
          vendorName: g.vendorName,
          message: e instanceof Error ? e.message : t("cmn.unknown"),
        });
      }
    }
    setCreated(createdList);
    setFailed(failedList);
    setPhase("done");
    if (createdList.length > 0) {
      toast({
        title: t("stl.toastCreated", { n: createdList.length }),
        description: t("stl.toastCreatedDesc", { list: createdList.map((c) => `${c.poNumber} (${c.vendorName})`).join(" · ") }),
      });
    }
    if (failedList.length > 0) {
      toast({
        variant: "destructive",
        title: t("stl.toastFailed", { n: failedList.length }),
        description: failedList.map((f) => `${f.vendorName}: ${f.message}`).join(" · "),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-card border-dmk-border-medium max-h-[92vh] overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px] text-dmk-text-primary">
            <ClipboardList className="h-4 w-4 text-dmk-gold" />
            {t("stl.reorderTitle")}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {rows.length > 0
              ? t("stl.reorderSummary", { n: rows.length, total: formatINR(estTotal), vendors: vendorCount })
              : t("stl.reorderSummaryEmpty")}
          </DialogDescription>
        </DialogHeader>

        {phase === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-dmk-text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-dmk-gold" />
            {t("stl.computing")}
          </div>
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : rows.length === 0 ? (
          <div className="dmk-well px-4 py-8 text-center">
            <CheckCircle2 className="h-5 w-5 text-dmk-success mx-auto" />
            <p className="text-[13px] font-medium text-dmk-text-primary mt-2">{t("stl.nothingToReorder")}</p>
            <p className="text-[11.5px] text-dmk-text-muted mt-1">
              {t("stl.allHealthy")}
            </p>
          </div>
        ) : phase === "done" ? (
          /* ── Success panel ── */
          <div className="space-y-3">
            <div className="dmk-well p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-dmk-success" />
                <p className="text-[13px] font-semibold text-dmk-text-primary">
                  {t("stl.draftsCreated", { n: created.length })}
                </p>
              </div>
              {created.map((c) => (
                <div
                  key={c.poNumber}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary px-3 py-2"
                >
                  <span className="font-money text-[12.5px] font-semibold text-dmk-gold">{c.poNumber}</span>
                  <span className="text-[12px] text-dmk-text-secondary">{c.vendorName}</span>
                  <span className="text-[11px] text-dmk-text-muted">
                    {t("stl.itemEst", { n: c.itemCount, amt: formatINR(c.estCost) })}
                  </span>
                </div>
              ))}
              {failed.map((f) => (
                <div key={f.vendorName} className="flex items-center gap-2 text-[12px] text-dmk-danger">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {f.vendorName} — {f.message}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-dmk-text-muted">
                {t("stl.pendingNote")}
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
              >
                {t("cmn.close")}
              </Button>
              <Button
                onClick={() => {
                  useErpStore.getState().setView("purchase/orders");
                  onOpenChange(false);
                }}
                className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85"
              >
                {t("stl.viewPos")}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Suggestions table (ready / creating) ── */
          <div className="space-y-3">
            <div className="max-h-[46vh] overflow-y-auto overflow-x-auto rounded-md border border-dmk-border-subtle">
              <table className="dmk-table min-w-[820px]">
                <thead>
                  <tr>
                    <th>{t("cmn.sku")}</th>
                    <th>{t("cmn.name")}</th>
                    <th className="num text-right">{t("stl.colSellable")}</th>
                    <th className="num text-right">{t("stl.colThreshold")}</th>
                    <th className="num text-right">{t("stl.colAvgDay")}</th>
                    <th className="num text-right">{t("stl.colCover")}</th>
                    <th className="num text-right">{t("stl.colOrderQty")}</th>
                    <th>{t("stl.colVendor")}</th>
                    <th className="num text-right">{t("stl.colLastCost")}</th>
                    <th className="num text-right">{t("stl.colEstCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const q = effQty(r);
                    return (
                      <tr key={r.productId}>
                        <td className="font-money text-[12px] text-dmk-text-secondary whitespace-nowrap">{r.sku}</td>
                        <td className="max-w-[180px]">
                          <span className="block truncate text-[12.5px] font-medium" title={r.name}>{r.name}</span>
                        </td>
                        <td className="num text-right font-semibold text-dmk-danger bg-dmk-danger/5">{fmtQty(r.stockQuantity)}</td>
                        <td className="num text-right text-dmk-text-muted">{fmtQty(r.lowStockThreshold)}</td>
                        <td className="num text-right text-dmk-text-secondary font-money">{r.avgDailySales.toFixed(2)}</td>
                        <td className="num text-right">
                          <CoverBadge dc={r.daysCover} />
                        </td>
                        <td className="num text-right">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            aria-label={t("stl.orderQtyAria", { sku: r.sku })}
                            value={qtyEdits[r.productId] ?? String(r.suggestedQty)}
                            onChange={(e) =>
                              setQtyEdits((m) => ({ ...m, [r.productId]: e.target.value }))
                            }
                            className="h-8 w-[74px] px-2 text-right font-money text-[12.5px] font-bold bg-dmk-input-well border-dmk-border-subtle text-dmk-text-primary"
                          />
                        </td>
                        <td className="max-w-[150px]">
                          {r.vendor ? (
                            <span className="block truncate text-[12px] text-dmk-text-primary" title={r.vendor.vendorName}>
                              {r.vendor.vendorName}
                            </span>
                          ) : (
                            <span className="text-[12px] text-dmk-text-muted">—</span>
                          )}
                        </td>
                        <td className="num text-right text-dmk-text-secondary font-money">{formatINR(r.lastCost)}</td>
                        <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(estCostOf(r))}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-dmk-input-well">
                    <td colSpan={8} className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                      {t("stl.totalsItems", { n: rows.length, vendors: vendorCount })}
                    </td>
                    <td className="num text-right text-dmk-text-muted" />
                    <td className="num text-right font-money font-bold text-dmk-text-primary">{formatINR(estTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {noVendorRows.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-dmk-warning shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-dmk-text-muted">
                  <span className="font-semibold text-dmk-text-secondary">{t("stl.noVendorItems", { n: noVendorRows.length })}</span>{" "}
                  {t("stl.noVendorHint", { skus: noVendorRows.map((r) => r.sku).join(", ") })}
                </p>
              </div>
            )}

            <div className="dmk-well px-3 py-2">
              <p className="text-[10.5px] leading-relaxed text-dmk-text-muted">
                <span className="font-semibold text-dmk-text-secondary">{t("stl.basis")}</span> {basis}
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={phase === "creating"}
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
              >
                {t("cmn.cancel")}
              </Button>
              {phase === "creating" ? (
                <Button disabled className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {progressText || t("stl.creatingDrafts")}
                </Button>
              ) : (
                <Button
                  onClick={() => void createDraftPos()}
                  disabled={vendoredRows.length === 0}
                  className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  {t("stl.createDrafts")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
