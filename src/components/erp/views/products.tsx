"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Products — product master (R2/R12)
// List + search + category filter + add/edit dialog + deactivate
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Package, Pencil, Plus, Scale, Trash2, Upload } from "lucide-react";

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
  StatusBadge,
  ErrorText,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import type { Product, Vendor } from "@/types/erp";
import { StockAdjustDialog } from "../stock-adjust-dialog";
import { cn } from "@/lib/utils";

const UNITS = ["Pcs", "Set", "Packet", "Box", "Crate"];
const GST_RATES = [0, 5, 12, 18, 28];

interface ProductFormState {
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  hsnCode: string;
  gstRate: string;
  purchaseCost: string;
  tier1: string;
  tier2: string;
  tier3: string;
  tier4: string;
  tier5: string;
  openingStock: string;
  openingDamagedStock: string;
  lowStockThreshold: string;
  weightGrams: string;
  barcode: string;
  manufacturerVendorId: string;
}

const EMPTY_FORM: ProductFormState = {
  sku: "",
  name: "",
  category: "General",
  brand: "",
  unit: "Pcs",
  hsnCode: "3924",
  gstRate: "18",
  purchaseCost: "",
  tier1: "",
  tier2: "",
  tier3: "",
  tier4: "",
  tier5: "",
  openingStock: "0",
  openingDamagedStock: "0",
  lowStockThreshold: "5",
  weightGrams: "",
  barcode: "",
  manufacturerVendorId: "",
};

function formFromProduct(p: Product): ProductFormState {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    brand: p.brand,
    unit: p.unit,
    hsnCode: p.hsnCode,
    gstRate: String(p.gstRate),
    purchaseCost: String(p.purchaseCost),
    tier1: String(p.tier1Distributor),
    tier2: String(p.tier2Wholesale),
    tier3: String(p.tier3SemiWholesale),
    tier4: String(p.tier4Retailer),
    tier5: String(p.tier5Mrp),
    openingStock: "0",
    openingDamagedStock: "0",
    lowStockThreshold: String(p.lowStockThreshold),
    weightGrams: p.weightGrams != null ? String(p.weightGrams) : "",
    barcode: p.barcode ?? "",
    manufacturerVendorId: p.manufacturerVendorId ?? "",
  };
}

function numOr(s: string, fallback = 0): number {
  if (s.trim() === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function tierErrorOf(f: ProductFormState): string | null {
  const vals = [f.tier1, f.tier2, f.tier3, f.tier4, f.tier5].map((s) => s.trim());
  if (vals.some((v) => v === "")) return "All five tier prices are required (R12).";
  const nums = vals.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return "Tier prices must be valid numbers.";
  if (nums.some((n) => n < 0)) return "Tier prices cannot be negative.";
  const ordered =
    nums[0] <= nums[1] && nums[1] <= nums[2] && nums[2] <= nums[3] && nums[3] <= nums[4];
  if (!ordered) return "Tier order violated: Distributor ≤ Wholesale ≤ Semi-Wholesale ≤ Retailer ≤ MRP (R12).";
  return null;
}

export default function ProductsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);

  const [products, setProducts] = React.useState<Product[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const seqRef = React.useRef(0);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [form, setForm] = React.useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [mfrVendors, setMfrVendors] = React.useState<Vendor[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Per-product stock adjustment dialog
  const [adjusting, setAdjusting] = React.useState<Product | null>(null);

  const set = (patch: Partial<ProductFormState>) => setForm((f) => ({ ...f, ...patch }));
  const tierError = React.useMemo(() => tierErrorOf(form), [form]);
  const canSave =
    form.sku.trim() !== "" && form.name.trim() !== "" && tierError === null && !saving;

  // Debounce search 250ms
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
          activeOnly: activeOnly ? "true" : undefined,
        }
      );
      if (seq !== seqRef.current) return; // stale response guard
      setProducts(res.products ?? []);
      setCategories(res.categories ?? []);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load products");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [activeFirmId, debouncedSearch, category, activeOnly]);

  React.useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Manufacturer vendors — power the "Manufactured by" picker in the form
  React.useEffect(() => {
    if (!activeFirmId) return;
    apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId })
      .then((list) => setMfrVendors(list.filter((v) => v.vendorType === "MANUFACTURER")))
      .catch(() => setMfrVendors([]));
  }, [activeFirmId]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm(formFromProduct(p));
    setFormError(null);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!activeFirmId || !canSave) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      firmId: activeFirmId,
      sku: form.sku.trim().toUpperCase(),
      name: form.name.trim(),
      category: form.category.trim() || "General",
      brand: form.brand.trim(),
      unit: form.unit,
      hsnCode: form.hsnCode.trim() || "3924",
      gstRate: numOr(form.gstRate, 18),
      purchaseCost: numOr(form.purchaseCost),
      tier1Distributor: numOr(form.tier1),
      tier2Wholesale: numOr(form.tier2),
      tier3SemiWholesale: numOr(form.tier3),
      tier4Retailer: numOr(form.tier4),
      tier5Mrp: numOr(form.tier5),
      lowStockThreshold: numOr(form.lowStockThreshold),
      weightGrams: form.weightGrams.trim() === "" ? undefined : numOr(form.weightGrams),
      barcode: form.barcode.trim() || undefined,
      // Manufacturer ownership — server validates vendor + auto-prefixes name
      manufacturerVendorId: form.manufacturerVendorId || (editing ? null : undefined),
      ...(editing
        ? {}
        : {
            openingStock: numOr(form.openingStock),
            openingDamagedStock: numOr(form.openingDamagedStock),
          }),
    };
    try {
      if (editing) {
        await apiPatch<Product>(`/api/v1/products/${editing.id}`, payload);
        toast({ title: "Product updated", description: `${payload.sku} — ${payload.name}` });
      } else {
        await apiPost<Product>("/api/v1/products", payload);
        toast({ title: "Product created", description: `${payload.sku} — ${payload.name}` });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : "Save failed";
      setFormError(msg);
      toast({ title: "Could not save product", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (p: Product) => {
    try {
      await apiDelete(`/api/v1/products/${p.id}`);
      toast({ title: "Product deactivated", description: `${p.sku} — ${p.name}` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({
        title: "Deactivate failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const unitOptions = React.useMemo(() => {
    if (editing && !UNITS.includes(editing.unit)) return [editing.unit, ...UNITS];
    return UNITS;
  }, [editing]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        subtitle="Product master · 5-tier pricing · dual-stock pools (R2/R12)"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView("inventory/bulk-upload")}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <Upload className="h-3.5 w-3.5" />
              Bulk Upload
            </Button>
            <Button size="sm" onClick={openAdd} className="h-9 gap-2 text-[12.5px]">
              <Plus className="h-3.5 w-3.5" />
              Add Product
            </Button>
          </>
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
          <Switch id="active-only" checked={activeOnly} onCheckedChange={setActiveOnly} />
          <Label htmlFor="active-only" className="text-[12.5px] text-dmk-text-secondary cursor-pointer">
            Active only
          </Label>
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <div className="dmk-card overflow-hidden">
          <LoadingRows rows={8} />
        </div>
      ) : products.length === 0 ? (
        <div className="dmk-card">
          <EmptyState
            icon={Package}
            title="No products found"
            hint="Adjust the filters, or add products manually / via bulk CSV upload."
            action={
              <Button variant="outline" size="sm" onClick={() => setView("inventory/bulk-upload")} className="h-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover">
                Import via CSV
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Unit</th>
              <th className="num">GST%</th>
              <th className="num">Cost</th>
              <th className="num">MRP</th>
              <th className="num">Sellable</th>
              <th className="num">Damaged</th>
              <th className="num">Threshold</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const isLow = p.stockQuantity <= p.lowStockThreshold;
              return (
                <tr key={p.id}>
                  <td className="font-money text-[12.5px] text-dmk-text-secondary">{p.sku}</td>
                  <td className="font-medium max-w-[220px] truncate" title={p.name}>
                    {p.name}
                  </td>
                  <td className="text-dmk-text-secondary">{p.category}</td>
                  <td className="text-dmk-text-secondary max-w-[140px] truncate" title={p.brand}>
                    {p.brand || "—"}
                  </td>
                  <td className="text-dmk-text-secondary">{p.unit}</td>
                  <td className="num text-dmk-text-secondary">{p.gstRate}%</td>
                  <td className="num">
                    <Money value={p.purchaseCost} className="text-dmk-text-secondary" />
                  </td>
                  <td className="num">
                    <Money value={p.tier5Mrp} />
                  </td>
                  <td className="num">
                    {isLow ? <Badge tone="warning">{p.stockQuantity}</Badge> : p.stockQuantity}
                  </td>
                  <td className={cn("num", p.damagedStock > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
                    {p.damagedStock}
                  </td>
                  <td className="num text-dmk-text-muted">{p.lowStockThreshold}</td>
                  <td>
                    <StatusBadge status={p.isActive ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-dmk-text-secondary hover:text-dmk-gold hover:bg-dmk-hover"
                      onClick={() => setAdjusting(p)}
                      aria-label={`Adjust stock for ${p.name}`}
                      title="Adjust stock (add / remove / transfer / write-off)"
                    >
                      <Scale className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-dmk-text-secondary hover:text-dmk-text-primary hover:bg-dmk-hover"
                      onClick={() => openEdit(p)}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {p.isActive && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                            aria-label={`Deactivate ${p.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="dmk-card border-dmk-border-medium">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-dmk-text-primary">
                              Move “{p.name}” to Deleted Data?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-dmk-text-secondary">
                              The product is snapshotted into the Deleted Data folder first, so it can be
                              restored anytime from Intelligence → Deleted Data. It will be hidden from active
                              lists and billing; historical documents and stock are preserved.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                              onClick={() => void deactivate(p)}
                            >
                              Move to Deleted Data
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}

      {/* ── Per-product stock adjustment ──────────────── */}
      <StockAdjustDialog
        product={adjusting}
        onOpenChange={(open) => !open && setAdjusting(null)}
        onAdjusted={() => setReloadKey((k) => k + 1)}
      />

      {/* ── Add / Edit dialog ─────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="dmk-card border-dmk-border-medium max-h-[88vh] overflow-y-auto sm:w-[760px]">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary text-[16px]">
              {editing ? `Edit ${editing.sku}` : "Add Product"}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {editing
                ? "Stock pools are mutated only through transactions — not editable here."
                : "Opening stock posts OPENING movements and starts the audit trail."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="SKU *">
              <Input
                className={inputCls}
                value={form.sku}
                onChange={(e) => set({ sku: e.target.value })}
                placeholder="DMK-XXXX"
              />
            </Field>
            <Field label="Product Name *">
              <Input
                className={inputCls}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Cello Magnum Storage Box"
              />
            </Field>
            <Field label="Category">
              <Input
                className={inputCls}
                value={form.category}
                onChange={(e) => set({ category: e.target.value })}
                placeholder="General"
              />
            </Field>
            <Field label="Brand / Manufacturer">
              <Input
                className={inputCls}
                value={form.brand}
                onChange={(e) => set({ brand: e.target.value })}
              />
            </Field>
            <Field label="Manufactured by" hint="Vendor-specific products for PO scoping">
              <Select
                value={form.manufacturerVendorId || "none"}
                onValueChange={(v) => set({ manufacturerVendorId: v === "none" ? "" : v })}
              >
                <SelectTrigger className="w-full h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
                  <SelectValue placeholder="No manufacturer link" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manufacturer link</SelectItem>
                  {mfrVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onValueChange={(v) => set({ unit: v })}>
                <SelectTrigger className="w-full h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="GST Rate">
              <Select value={form.gstRate} onValueChange={(v) => set({ gstRate: v })}>
                <SelectTrigger className="w-full h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="HSN Code">
              <Input
                className={inputCls}
                value={form.hsnCode}
                onChange={(e) => set({ hsnCode: e.target.value })}
                placeholder="3924"
              />
            </Field>
            <Field label="Purchase Cost (₹)">
              <Input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                value={form.purchaseCost}
                onChange={(e) => set({ purchaseCost: e.target.value })}
              />
            </Field>
          </div>

          {/* Tier pricing */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                5-Tier Pricing (R12)
              </label>
              <span className="text-[10.5px] text-dmk-text-muted">must ascend T1 → T5</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  ["tier1", "T1 Distributor"],
                  ["tier2", "T2 Wholesale"],
                  ["tier3", "T3 Semi-Wsl"],
                  ["tier4", "T4 Retailer"],
                  ["tier5", "T5 MRP"],
                ] as Array<[keyof ProductFormState, string]>
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className={cn(inputCls, tierError && "border-dmk-danger/50")}
                    value={form[key]}
                    onChange={(e) => set({ [key]: e.target.value } as Partial<ProductFormState>)}
                  />
                </Field>
              ))}
            </div>
            {tierError && <p className="text-[11.5px] text-dmk-danger">{tierError}</p>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {!editing && (
              <Field label="Opening Stock">
                <Input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={form.openingStock}
                  onChange={(e) => set({ openingStock: e.target.value })}
                />
              </Field>
            )}
            {!editing && (
              <Field label="Opening Damaged">
                <Input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={form.openingDamagedStock}
                  onChange={(e) => set({ openingDamagedStock: e.target.value })}
                />
              </Field>
            )}
            <Field label="Low Stock Threshold">
              <Input
                type="number"
                min="0"
                className={inputCls}
                value={form.lowStockThreshold}
                onChange={(e) => set({ lowStockThreshold: e.target.value })}
              />
            </Field>
            <Field label="Weight (g)">
              <Input
                type="number"
                min="0"
                className={inputCls}
                value={form.weightGrams}
                onChange={(e) => set({ weightGrams: e.target.value })}
              />
            </Field>
            <Field label="Barcode">
              <Input
                className={inputCls}
                value={form.barcode}
                onChange={(e) => set({ barcode: e.target.value })}
              />
            </Field>
          </div>

          {formError && <ErrorText>{formError}</ErrorText>}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
            >
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave} className="h-9">
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
