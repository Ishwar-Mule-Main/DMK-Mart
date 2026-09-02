"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Stock Levels — dual-stock matrix (R3)
// Sellable vs damaged pools, valuation, adjustment dialog
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Boxes, Scale } from "lucide-react";

import {
  PageHeader,
  Badge,
  Money,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  DataTable,
  ErrorText,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import type { Product } from "@/types/erp";
import { formatINR, toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";

type AdjustType = "TRANSFER_DAMAGED" | "WRITE_OFF";

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export default function StockLevelsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);

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

  // Adjustment dialog
  const [adjusting, setAdjusting] = React.useState<Product | null>(null);
  const [adjustType, setAdjustType] = React.useState<AdjustType>("TRANSFER_DAMAGED");
  const [qty, setQty] = React.useState("1");
  const [reason, setReason] = React.useState("");
  const [adjustDate, setAdjustDate] = React.useState(toISODate(new Date()));
  const [adjustError, setAdjustError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
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
      setError(e instanceof Error ? e.message : "Failed to load stock levels");
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

  const totals = React.useMemo(
    () => ({
      sellable: rows.reduce((s, p) => s + p.stockQuantity, 0),
      damaged: rows.reduce((s, p) => s + p.damagedStock, 0),
      valuation: rows.reduce((s, p) => s + p.stockQuantity * p.purchaseCost, 0),
      damagedValue: rows.reduce((s, p) => s + p.damagedStock * p.purchaseCost, 0),
    }),
    [rows]
  );

  const maxQty = adjusting
    ? adjustType === "TRANSFER_DAMAGED"
      ? adjusting.stockQuantity
      : adjusting.damagedStock
    : 0;

  const openAdjust = (p: Product) => {
    setAdjusting(p);
    setAdjustType("TRANSFER_DAMAGED");
    setQty("1");
    setReason("");
    setAdjustDate(toISODate(new Date()));
    setAdjustError(null);
  };

  const submitAdjustment = async () => {
    if (!activeFirmId || !adjusting) return;
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setAdjustError("Quantity must be a positive number.");
      return;
    }
    if (q > maxQty) {
      setAdjustError(
        adjustType === "TRANSFER_DAMAGED"
          ? `Cannot transfer more than sellable stock (${maxQty}).`
          : `Cannot write off more than damaged stock (${maxQty}).`
      );
      return;
    }
    setSubmitting(true);
    setAdjustError(null);
    try {
      await apiPost("/api/v1/stock/adjustment", {
        firmId: activeFirmId,
        productId: adjusting.id,
        adjustType,
        quantity: q,
        reason: reason.trim(),
        adjustDate,
      });
      toast({
        title: adjustType === "TRANSFER_DAMAGED" ? "Transferred to damaged pool" : "Stock written off",
        description: `${adjusting.sku} × ${fmtQty(q)} — movement recorded in the audit trail.`,
      });
      setAdjusting(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.message} (${e.code})`
          : e instanceof Error
            ? e.message
            : "Adjustment failed";
      setAdjustError(msg);
      toast({ title: "Adjustment failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Levels"
        subtitle="Dual-stock matrix · sellable vs damaged quarantine (R3/R4)"
        actions={
          <div className="dmk-well px-3 py-1.5 flex items-center gap-4">
            <span className="text-[11px] text-dmk-text-muted">
              Sellable <span className="font-money text-dmk-success">{fmtQty(totals.sellable)}</span>
            </span>
            <span className="text-[11px] text-dmk-text-muted">
              Damaged <span className="font-money text-dmk-danger">{fmtQty(totals.damaged)}</span>
            </span>
            <span className="text-[11px] text-dmk-text-muted">
              Value <span className="font-money text-dmk-text-primary">{formatINR(totals.valuation)}</span>
            </span>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search SKU, name, brand…"
          className="sm:max-w-xs"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-[190px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Switch id="low-only" checked={lowOnly} onCheckedChange={setLowOnly} />
          <Label htmlFor="low-only" className="text-[12.5px] text-dmk-text-secondary cursor-pointer">
            Low stock only
          </Label>
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
            title={lowOnly ? "No low-stock products" : "No stock records"}
            hint={
              lowOnly
                ? "Every product is above its reorder threshold — all healthy."
                : "Add products or import via bulk CSV to begin tracking stock."
            }
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Unit</th>
              <th className="num">Sellable</th>
              <th className="num">Damaged</th>
              <th className="num">Total</th>
              <th className="num">Valuation</th>
              <th>Status</th>
              <th className="text-right">Action</th>
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
                  <td className={cn("num", p.damagedStock > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-dmk-danger mr-1.5 align-middle" />
                    {fmtQty(p.damagedStock)}
                  </td>
                  <td className="num text-dmk-text-secondary">{fmtQty(p.stockQuantity + p.damagedStock)}</td>
                  <td className="num">
                    <Money value={p.stockQuantity * p.purchaseCost} />
                  </td>
                  <td>{isLow ? <Badge tone="warning">LOW STOCK</Badge> : <Badge tone="success">OK</Badge>}</td>
                  <td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-[11.5px] border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
                      onClick={() => openAdjust(p)}
                      disabled={p.stockQuantity + p.damagedStock <= 0}
                    >
                      <Scale className="h-3 w-3 mr-1" />
                      Adjust
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-dmk-input-well">
              <td colSpan={3} className="px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                Totals · {rows.length} products
              </td>
              <td className="px-3 py-2.5 text-right font-money text-[12.5px] font-semibold text-dmk-success">
                {fmtQty(totals.sellable)}
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
                Damaged value {formatINR(totals.damagedValue)}
              </td>
            </tr>
          </tfoot>
        </DataTable>
      )}

      {/* ── Adjustment dialog ─────────────────────────── */}
      <Dialog open={adjusting !== null} onOpenChange={(open) => !open && setAdjusting(null)}>
        <DialogContent className="dmk-card border-dmk-border-medium max-w-md">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary text-[16px]">Adjust Stock</DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {adjusting ? `${adjusting.sku} — ${adjusting.name}` : ""}
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={adjustType}
            onValueChange={(v) => setAdjustType(v as AdjustType)}
            className="grid grid-cols-1 sm:grid-cols-2 gap-2"
          >
            <div
              className={cn(
                "dmk-well p-3 cursor-pointer transition-colors",
                adjustType === "TRANSFER_DAMAGED" && "border-dmk-border-medium bg-dmk-bg-tertiary"
              )}
              onClick={() => setAdjustType("TRANSFER_DAMAGED")}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="TRANSFER_DAMAGED" id="adj-transfer" />
                <Label htmlFor="adj-transfer" className="text-[12.5px] font-semibold text-dmk-text-primary cursor-pointer">
                  Transfer to Damaged
                </Label>
              </div>
              <p className="text-[10.5px] text-dmk-text-muted mt-1.5">
                Sellable → damaged quarantine. Inventory value unchanged.
              </p>
            </div>
            <div
              className={cn(
                "dmk-well p-3 cursor-pointer transition-colors",
                adjustType === "WRITE_OFF" && "border-dmk-border-medium bg-dmk-bg-tertiary"
              )}
              onClick={() => setAdjustType("WRITE_OFF")}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="WRITE_OFF" id="adj-writeoff" />
                <Label htmlFor="adj-writeoff" className="text-[12.5px] font-semibold text-dmk-text-primary cursor-pointer">
                  Write Off
                </Label>
              </div>
              <p className="text-[10.5px] text-dmk-text-muted mt-1.5">
                Destroy damaged stock — posts a DAMAGE_LOSS journal (R6).
              </p>
            </div>
          </RadioGroup>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Quantity"
              hint={
                adjustType === "TRANSFER_DAMAGED"
                  ? `Sellable available: ${fmtQty(maxQty)}`
                  : `Damaged available: ${fmtQty(maxQty)}`
              }
            >
              <Input
                type="number"
                min="0"
                step="1"
                className={inputCls}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </Field>
            <Field label="Adjustment Date">
              <Input
                type="date"
                className={inputCls}
                value={adjustDate}
                onChange={(e) => setAdjustDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Reason">
            <Textarea
              rows={2}
              className="bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary placeholder:text-dmk-text-disabled resize-none"
              placeholder="e.g. cracked during transit, packaging torn…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {adjustError && <ErrorText>{adjustError}</ErrorText>}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAdjusting(null)}
              className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
            >
              Cancel
            </Button>
            <Button onClick={() => void submitAdjustment()} disabled={submitting} className="h-9">
              {submitting ? "Posting…" : "Post Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
