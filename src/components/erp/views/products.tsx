"use client";

// ═══════════════════════════════════════════════════════════════
// VIEW: Products — product master (R2/R12)
// List + search + category filter + add/edit dialog + deactivate
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { ChevronLeft, ChevronRight, Package, Pencil, Plus, Scale, Trash2, Upload } from "lucide-react";

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
import { useT } from "@/lib/i18n";
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

function tierErrorOf(t: TFn, f: ProductFormState): string | null {
  const vals = [f.tier1, f.tier2, f.tier3, f.tier4, f.tier5].map((s) => s.trim());
  if (vals.some((v) => v === "")) return t("prod.tierErrRequired");
  const nums = vals.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return t("prod.tierErrInvalid");
  if (nums.some((n) => n < 0)) return t("prod.tierErrNegative");
  const ordered =
    nums[0] <= nums[1] && nums[1] <= nums[2] && nums[2] <= nums[3] && nums[3] <= nums[4];
  if (!ordered) return t("prod.tierErrOrder");
  return null;
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export default function ProductsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const { t } = useT();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [brands, setBrands] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [brand, setBrand] = React.useState("all");
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const seqRef = React.useRef(0);

  // Pagination — the real catalog is ~1k SKUs; slicing keeps the DOM light.
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(50);

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [form, setForm] = React.useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [mfrVendors, setMfrVendors] = React.useState<Vendor[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Per-product stock adjustment dialog
  const [adjusting, setAdjusting] = React.useState<Product | null>(null);

  // Type-to-filter inside the brand dropdown
  const [brandSearch, setBrandSearch] = React.useState("");

  const set = (patch: Partial<ProductFormState>) => setForm((f) => ({ ...f, ...patch }));
  const tierError = React.useMemo(() => tierErrorOf(t, form), [form, t]);
  const canSave =
    form.sku.trim() !== "" && form.name.trim() !== "" && tierError === null && !saving;

  // Debounce search 250ms
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change jumps back to the first page
  React.useEffect(() => {
    setPage(0);
  }, [debouncedSearch, category, brand, activeOnly]);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ products: Product[]; categories: string[]; brands: string[] }>(
        "/api/v1/products",
        {
          firmId: activeFirmId,
          search: debouncedSearch || undefined,
          category: category === "all" ? undefined : category,
          brand: brand === "all" ? undefined : brand,
          activeOnly: activeOnly ? "true" : undefined,
        }
      );
      if (seq !== seqRef.current) return; // stale response guard
      setProducts(res.products ?? []);
      setCategories(res.categories ?? []);
      setBrands(res.brands ?? []);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : t("prod.loadFailed"));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [activeFirmId, debouncedSearch, category, brand, activeOnly]);

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
        toast({ title: t("prod.updated"), description: `${payload.sku} — ${payload.name}` });
      } else {
        await apiPost<Product>("/api/v1/products", payload);
        toast({ title: t("prod.created"), description: `${payload.sku} — ${payload.name}` });
      }
      setDialogOpen(false);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : t("prod.saveFailed");
      setFormError(msg);
      toast({ title: t("prod.toastSaveFail"), description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (p: Product) => {
    try {
      await apiDelete(`/api/v1/products/${p.id}`);
      toast({ title: t("prod.deactivated"), description: `${p.sku} — ${p.name}` });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({
        title: t("prod.toastDeactivateFail"),
        description: e instanceof Error ? e.message : t("cmn.unknown"),
        variant: "destructive",
      });
    }
  };

  const unitOptions = React.useMemo(() => {
    if (editing && !UNITS.includes(editing.unit)) return [editing.unit, ...UNITS];
    return UNITS;
  }, [editing]);

  const total = products.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = React.useMemo(
    () => products.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [products, safePage, pageSize]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("prod.title")}
        subtitle={t("prod.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView("inventory/bulk-upload")}
              className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("prod.bulkUpload")}
            </Button>
            <Button size="sm" onClick={openAdd} className="h-9 gap-2 text-[12.5px]">
              <Plus className="h-3.5 w-3.5" />
              {t("prod.addProduct")}
            </Button>
          </>
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
          <SelectTrigger className="w-full sm:w-[170px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
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
        <Select value={brand} onValueChange={setBrand} disabled={brands.length === 0}>
          <SelectTrigger className="w-full sm:w-[170px] h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
            <SelectValue placeholder={t("cmn.brand")} />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <div className="px-2 py-1.5 border-b border-dmk-border-subtle mb-1">
              <input
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
                placeholder={t("cmn.filterBrands")}
                className="w-full h-7 px-2 rounded-md bg-dmk-input-well border border-dmk-border-subtle text-[12px] outline-none focus:border-dmk-blue/60"
              />
            </div>
            <SelectItem value="all">{t("cmn.allBrands")}</SelectItem>
            {brands
              .filter((b) => b.toLowerCase().includes(brandSearch.toLowerCase()))
              .map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Switch id="active-only" checked={activeOnly} onCheckedChange={setActiveOnly} />
          <Label htmlFor="active-only" className="text-[12.5px] text-dmk-text-secondary cursor-pointer">
            {t("cmn.activeOnly")}
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
            title={t("prod.noProducts")}
            hint={t("prod.emptyHint")}
            action={
              <Button variant="outline" size="sm" onClick={() => setView("inventory/bulk-upload")} className="h-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover">
                {t("prod.importCsv")}
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{t("prod.tblPhoto")}</th>
              <th>{t("prod.tblSku")}</th>
              <th>{t("prod.tblName")}</th>
              <th>{t("prod.tblCategory")}</th>
              <th>{t("prod.tblBrand")}</th>
              <th>{t("prod.tblUnit")}</th>
              <th className="num">{t("prod.tblGst")}</th>
              <th className="num">{t("prod.tblCost")}</th>
              <th className="num">{t("prod.tblMrp")}</th>
              <th className="num">{t("prod.tblSellable")}</th>
              <th className="num">{t("prod.tblDamaged")}</th>
              <th className="num">{t("prod.tblThreshold")}</th>
              <th>{t("cmn.status")}</th>
              <th className="text-right">{t("cmn.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => {
              const isLow = p.stockQuantity <= p.lowStockThreshold;
              return (
                <tr key={p.id}>
                  <td>
                    <img
                      src={p.photoUrl || "/dmk-logo.png"}
                      alt={p.name}
                      className="w-10 h-10 object-cover rounded-lg border border-slate-700 bg-slate-900"
                      loading="lazy"
                    />
                  </td>
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
                      aria-label={`${t("prod.adjustStock")} — ${p.name}`}
                      title={t("prod.adjustStock")}
                    >
                      <Scale className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-dmk-text-secondary hover:text-dmk-text-primary hover:bg-dmk-hover"
                      onClick={() => openEdit(p)}
                      aria-label={t("prod.editAria", { n: p.name })}
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
                            aria-label={t("prod.deactivateAria", { n: p.name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="dmk-card border-dmk-border-medium">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-dmk-text-primary">
                              {t("prod.deactivateQ", { n: p.name })}
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-dmk-text-secondary">
                              {t("prod.deactivateDesc")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                              {t("cmn.cancel")}
                            </AlertDialogCancel>
                            <AlertDialogAction
                              className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                              onClick={() => void deactivate(p)}
                            >
                              {t("prod.moveToDeleted")}
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

      {/* Pagination bar — shown only when there is something to page */}
      {!loading && total > 0 && (
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 px-1">
          <span className="text-[11.5px] text-dmk-text-muted">
            {t("prod.showingRange", {
              a: safePage * pageSize + 1,
              b: Math.min(total, (safePage + 1) * pageSize),
              n: total,
            })}
          </span>
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[112px] bg-dmk-input-well border-dmk-border-subtle text-[12px]" aria-label={t("prod.rowsPerPage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">{t("prod.rowsPerPage", { n: 50 })}</SelectItem>
                <SelectItem value="100">{t("prod.rowsPerPage", { n: 100 })}</SelectItem>
                <SelectItem value="200">{t("prod.rowsPerPage", { n: 200 })}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              aria-label={t("prod.prevPage")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-[12px] font-money text-dmk-text-secondary tabular-nums px-1">
              {safePage + 1} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              aria-label={t("prod.nextPage")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
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
              {editing ? t("prod.editTitle", { n: editing.sku }) : t("prod.addTitle")}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {editing ? t("prod.editDesc") : t("prod.addDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("prod.skuField")}>
              <Input
                className={inputCls}
                value={form.sku}
                onChange={(e) => set({ sku: e.target.value })}
                placeholder="DMK-XXXX"
              />
            </Field>
            <Field label={t("prod.nameField")}>
              <Input
                className={inputCls}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={t("prod.namePh")}
              />
            </Field>
            <Field label={t("cmn.category")}>
              <Input
                className={inputCls}
                value={form.category}
                onChange={(e) => set({ category: e.target.value })}
                placeholder="General"
              />
            </Field>
            <Field label={t("prod.brandField")}>
              <Input
                className={inputCls}
                value={form.brand}
                onChange={(e) => set({ brand: e.target.value })}
              />
            </Field>
            <Field label={t("prod.mfrBy")} hint={t("prod.mfrHint")}>
              <Select
                value={form.manufacturerVendorId || "none"}
                onValueChange={(v) => set({ manufacturerVendorId: v === "none" ? "" : v })}
              >
                <SelectTrigger className="w-full h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px]">
                  <SelectValue placeholder={t("prod.noMfr")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("prod.noMfr")}</SelectItem>
                  {mfrVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("cmn.unit")}>
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
            <Field label={t("prod.gstRate")}>
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
            <Field label={t("prod.hsn")}>
              <Input
                className={inputCls}
                value={form.hsnCode}
                onChange={(e) => set({ hsnCode: e.target.value })}
                placeholder="3924"
              />
            </Field>
            <Field label={t("prod.cost")}>
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
                {t("prod.tierPricing")}
              </label>
              <span className="text-[10.5px] text-dmk-text-muted">{t("prod.tierNote")}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(
                [
                  ["tier1", t("prod.tier1")],
                  ["tier2", t("prod.tier2")],
                  ["tier3", t("prod.tier3")],
                  ["tier4", t("prod.tier4")],
                  ["tier5", t("prod.tier5")],
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
              <Field label={t("prod.openingStock")}>
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
              <Field label={t("prod.openingDamaged")}>
                <Input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={form.openingDamagedStock}
                  onChange={(e) => set({ openingDamagedStock: e.target.value })}
                />
              </Field>
            )}
            <Field label={t("prod.lowThreshold")}>
              <Input
                type="number"
                min="0"
                className={inputCls}
                value={form.lowStockThreshold}
                onChange={(e) => set({ lowStockThreshold: e.target.value })}
              />
            </Field>
            <Field label={t("prod.weight")}>
              <Input
                type="number"
                min="0"
                className={inputCls}
                value={form.weightGrams}
                onChange={(e) => set({ weightGrams: e.target.value })}
              />
            </Field>
            <Field label={t("prod.barcode")}>
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
              {t("cmn.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={!canSave} className="h-9">
              {saving ? t("prod.saving") : editing ? t("prod.saveChanges") : t("prod.createProduct")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
