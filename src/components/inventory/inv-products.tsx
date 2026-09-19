"use client";

// ═══════════════════════════════════════════════════════════════
// INV-PRODUCTS — the shared catalog.
// Image-forward grid + table, search/filters, per-product detail
// with the warehouse breakdown (portal-only), AI image↔name
// verification badges, canonical file name, stock operations and
// batch AI verification.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  invGet, invPost, invPatch, invDelete, thumbUrl, formatMoney, timeAgo,
  type InvProduct, type WarehouseRef,
} from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Search, Package, ImageIcon, BadgeCheck, FileWarning, CircleHelp, ShieldQuestion,
  Boxes, Pencil, Download, ChevronLeft, ChevronRight, RefreshCw, X, Warehouse as WarehouseIcon, Sparkles, Loader2,
} from "lucide-react";

function VerifyBadge({ p }: { p: InvProduct }) {
  if (p.imageVerified === "MATCHED") {
    return (
      <span className="dmk-badge dmk-badge-success h-5.5 px-1.5 gap-1 text-[9.5px]" title={p.imageMatchName ? `Image says "${p.imageMatchName}"` : "AI verified"}>
        <BadgeCheck className="h-3 w-3" /> MATCHED
      </span>
    );
  }
  if (p.imageVerified === "MISMATCH") {
    return (
      <span className="dmk-badge h-5.5 px-1.5 gap-1 text-[9.5px] bg-red-500/15 text-red-400" title={p.imageMatchName ? `Image says "${p.imageMatchName}" but catalog says "${p.name}"` : "Mismatch"}>
        <FileWarning className="h-3 w-3" /> MISMATCH
      </span>
    );
  }
  if (p.imageVerified === "UNREADABLE") {
    return (
      <span className="dmk-badge h-5.5 px-1.5 gap-1 text-[9.5px] bg-amber-500/15 text-amber-400" title="No readable name text on the image">
        <ShieldQuestion className="h-3 w-3" /> NO TEXT
      </span>
    );
  }
  if (p.imageVerified === "NO_IMAGE") {
    return <span className="dmk-badge h-5.5 px-1.5 gap-1 text-[9.5px] bg-dmk-hover text-dmk-text-muted"><CircleHelp className="h-3 w-3" /> NO IMAGE</span>;
  }
  return <span className="dmk-badge h-5.5 px-1.5 gap-1 text-[9.5px] bg-dmk-blue/10 text-dmk-blue"><ImageIcon className="h-3 w-3" /> PENDING</span>;
}

function StockPill({ p }: { p: InvProduct }) {
  const available = p.available ?? p.stockQuantity - p.reservedQty;
  if (p.stockQuantity <= 0) return <span className="dmk-badge h-5.5 px-1.5 text-[9.5px] bg-red-500/15 text-red-400">OUT</span>;
  if (p.lowStockThreshold > 0 && p.stockQuantity <= p.lowStockThreshold) return <span className="dmk-badge h-5.5 px-1.5 text-[9.5px] bg-amber-500/15 text-amber-400">LOW</span>;
  return <span className="text-[11.5px] font-money font-bold text-dmk-text-primary">{available.toLocaleString("en-IN")} <span className="text-dmk-text-muted font-normal">avail.</span></span>;
}

function ProductThumb({ p, w = 96 }: { p: InvProduct; w?: number }) {
  const [failed, setFailed] = React.useState(false);
  const src = thumbUrl(p.photoUrl, w * 2);
  if (!p.photoUrl || failed) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-dmk-text-muted" style={{ minHeight: w }}>
        <ImageIcon className="h-5 w-5 opacity-50" />
        <span className="text-[8.5px] uppercase tracking-wider">no image</span>
      </div>
    );
  }
  return (
    <img
      src={src ?? p.photoUrl}
      alt={`${p.brand} ${p.name}`}
      width={w}
      height={w}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

export function InvProducts() {
  const { toast } = useToast();
  const [products, setProducts] = React.useState<InvProduct[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(36);
  const [search, setSearch] = React.useState("");
  const [searchDebounced, setSearchDebounced] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [verified, setVerified] = React.useState("");
  const [brands, setBrands] = React.useState<string[]>([]);
  const [categories, setCategories] = React.useState<string[]>([]);
  const [detail, setDetail] = React.useState<InvProduct | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [verifyBusy, setVerifyBusy] = React.useState(false);
  const [verifyProgress, setVerifyProgress] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => { setSearchDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = React.useCallback(async () => {
    try {
      const data = await invGet<{ total: number; products: InvProduct[] }>("/api/v1/inventory/products", {
        search: searchDebounced, brand, category, verified, page, pageSize, activeOnly: "false",
      });
      setProducts(data.products);
      setTotal(data.total);
    } catch (e) {
      toast({ title: "Load failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setProducts([]);
    }
  }, [searchDebounced, brand, category, verified, page, pageSize, toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    invGet<{ products: InvProduct[] }>("/api/v1/inventory/products", { pageSize: 200, activeOnly: "false" })
      .then((d) => {
        setBrands([...new Set(d.products.map((p) => p.brand).filter(Boolean))].sort());
        setCategories([...new Set(d.products.map((p) => p.category).filter(Boolean))].sort());
      })
      .catch(() => undefined);
  }, []);

  async function openDetail(p: InvProduct) {
    setDetailLoading(true);
    setDetail(p);
    try {
      const d = await invGet<{ product: InvProduct }>(`/api/v1/inventory/products/${p.id}`, { withWarehouses: "true" });
      setDetail(d.product);
    } catch {
      // keep the row-level card as fallback detail
    } finally {
      setDetailLoading(false);
    }
  }

  async function runVerifyBatch() {
    setVerifyBusy(true);
    setVerifyProgress("Reading product images with the AI verifier…");
    try {
      const res = await invPost<{ matched: number; mismatch: number; unreadable: number; errors: number; results: Array<{ name: string; verdict: string; detail: string }> }>(
        "/api/v1/inventory/verify-images", { limit: 10 }
      );
      toast({
        title: "AI verification batch done",
        description: `${res.matched} matched · ${res.mismatch} mismatch · ${res.unreadable} no-text · ${res.errors} errors`,
      });
      setVerifyProgress("");
      await load();
      setVerified("");
    } catch (e) {
      toast({ title: "Verification failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setVerifyBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Shared Catalog</h1>
          <p className="text-[12px] text-dmk-text-muted mt-0.5">{total.toLocaleString("en-IN")} SKUs · every image carries its canonical “Brand Name + Product Name” file name</p>
        </div>
        <div className="flex items-center gap-2">
          {verifyProgress && <span className="text-[11px] text-dmk-blue">{verifyProgress}</span>}
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={runVerifyBatch} disabled={verifyBusy}>
            {verifyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Verify images (AI)
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="dmk-card p-3 grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="relative col-span-2 md:col-span-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, barcode…" className="pl-8.5 h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" aria-label="Search products" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-dmk-text-muted hover:text-dmk-text-primary" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); setPage(1); }} className="h-9 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Filter by brand">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="h-9 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={verified} onChange={(e) => { setVerified(e.target.value); setPage(1); }} className="h-9 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Filter by image verification">
          <option value="">All image states</option>
          <option value="MATCHED">AI matched</option>
          <option value="MISMATCH">AI mismatch</option>
          <option value="UNREADABLE">No text on image</option>
          <option value="PENDING">Pending check</option>
          <option value="NO_IMAGE">No image</option>
        </select>
      </div>

      {/* Grid */}
      {products === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[210px] rounded-xl" />)}
        </div>
      ) : products.length === 0 ? (
        <div className="dmk-card p-10 text-center">
          <Package className="h-8 w-8 text-dmk-text-muted mx-auto" />
          <p className="mt-3 text-[13px] text-dmk-text-secondary">No products match these filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {products.map((p) => (
            <button
              key={p.id}
              onClick={() => openDetail(p)}
              className="dmk-card overflow-hidden text-left hover:bg-dmk-hover transition-colors focus-visible:ring-2 focus-visible:ring-dmk-yellow/60"
              aria-label={`Open ${p.name}`}
            >
              <div className="aspect-square w-full overflow-hidden bg-[#111827]">
                <ProductThumb p={p} />
              </div>
              <div className="p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-mono text-[9.5px] text-dmk-text-muted truncate">{p.sku}</span>
                  <VerifyBadge p={p} />
                </div>
                <p className="text-[12px] font-semibold text-dmk-text-primary leading-snug line-clamp-2 min-h-[2.1em]">{p.name}</p>
                <p className="text-[10px] text-dmk-text-muted truncate">{p.brand} · {p.category}</p>
                <div className="flex items-center justify-between gap-1">
                  <StockPill p={p} />
                  <span className="text-[10px] font-money text-dmk-text-muted">{formatMoney(p.tier5Mrp)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {products !== null && total > pageSize && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-[12px] text-dmk-text-muted">Page {page} of {pages} · {total.toLocaleString("en-IN")} SKUs</span>
          <Button variant="outline" size="sm" className="h-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-[680px] max-h-[88vh] overflow-y-auto dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-left">
                  <span className="h-11 w-11 rounded-lg overflow-hidden bg-[#111827] shrink-0 border border-dmk-border-subtle">
                    <ProductThumb p={detail} w={44} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{detail.name}</span>
                    <span className="block text-[11px] font-normal text-dmk-text-muted">{detail.sku} · {detail.brand} · {detail.category}</span>
                  </span>
                </DialogTitle>
                <DialogDescription className="sr-only">Product details, image audit and warehouse breakdown</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-1">
                {/* Image audit */}
                <div className="dmk-well rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">Image audit</p>
                    <VerifyBadge p={detail} />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2 text-[11.5px]">
                    <div>
                      <p className="text-dmk-text-muted">Canonical file name</p>
                      <p className="font-mono text-[11px] text-dmk-yellow break-all">{detail.imageFileName || "—"}</p>
                    </div>
                    <div>
                      <p className="text-dmk-text-muted">AI read on image</p>
                      <p className="text-dmk-text-primary break-all">{detail.imageMatchName || "—"} {detail.imageVerifiedAt && <span className="text-dmk-text-muted">· {timeAgo(detail.imageVerifiedAt)}</span>}</p>
                    </div>
                  </div>
                  {detail.photoUrl && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <a href={`/api/v1/inventory/images/${detail.id}?download=1`} className="dmk-badge h-7 px-2.5 gap-1.5 text-[10.5px] bg-dmk-yellow/15 text-dmk-yellow hover:bg-dmk-yellow/25 transition-colors">
                        <Download className="h-3 w-3" /> Download as {detail.imageFileName}
                      </a>
                      <Button
                        variant="outline" size="sm" className="h-7 text-[10.5px] gap-1"
                        onClick={async () => {
                          try {
                            await invPost("/api/v1/inventory/verify-images", { limit: 1, productIds: [detail.id] });
                            const d = await invGet<{ product: InvProduct }>(`/api/v1/inventory/products/${detail.id}`);
                            setDetail(d.product);
                            toast({ title: "Image re-verified", description: "AI re-read the artwork." });
                          } catch (e) {
                            toast({ title: "Verify failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
                          }
                        }}
                      >
                        <Sparkles className="h-3 w-3" /> Re-verify
                      </Button>
                    </div>
                  )}
                </div>

                {/* Stock */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="dmk-well rounded-lg py-2.5">
                    <p className="text-[9.5px] uppercase tracking-wider text-dmk-text-muted">Sellable</p>
                    <p className="text-[16px] font-black text-dmk-text-primary font-money mt-0.5">{detail.stockQuantity.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="dmk-well rounded-lg py-2.5">
                    <p className="text-[9.5px] uppercase tracking-wider text-dmk-text-muted">Reserved</p>
                    <p className="text-[16px] font-black text-amber-400 font-money mt-0.5">{detail.reservedQty.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="dmk-well rounded-lg py-2.5">
                    <p className="text-[9.5px] uppercase tracking-wider text-dmk-text-muted">Damaged</p>
                    <p className="text-[16px] font-black text-red-400 font-money mt-0.5">{detail.damagedStock.toLocaleString("en-IN")}</p>
                  </div>
                </div>

                {/* Warehouse breakdown (portal-only) */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <WarehouseIcon className="h-3.5 w-3.5 text-dmk-yellow" />
                    <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">Warehouse placement — never leaves this portal</p>
                  </div>
                  {detail.warehouseBreakdown && detail.warehouseBreakdown.length > 0 ? (
                    <div className="rounded-lg border border-dmk-border-subtle overflow-hidden">
                      <table className="w-full text-[11.5px]">
                        <thead>
                          <tr className="bg-dmk-hover text-left text-[9.5px] uppercase tracking-wider text-dmk-text-muted">
                            <th className="py-1.5 px-2 font-bold">Warehouse</th>
                            <th className="py-1.5 px-2 font-bold text-right">Sellable</th>
                            <th className="py-1.5 px-2 font-bold text-right">Reserved</th>
                            <th className="py-1.5 px-2 font-bold text-right">Damaged</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.warehouseBreakdown.map((w: WarehouseRef) => (
                            <tr key={w.warehouseId} className="border-t border-dmk-border-subtle/60">
                              <td className="py-1.5 px-2 text-dmk-text-primary"><span className="font-mono text-[10px] text-dmk-text-muted">{w.code}</span> {w.name}</td>
                              <td className="py-1.5 px-2 text-right font-money">{w.quantity.toLocaleString("en-IN")}</td>
                              <td className="py-1.5 px-2 text-right font-money text-amber-400">{w.reservedQty.toLocaleString("en-IN")}</td>
                              <td className="py-1.5 px-2 text-right font-money text-red-400">{w.damagedQty.toLocaleString("en-IN")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-dmk-text-muted dmk-well rounded-lg p-3">No placement rows yet — the sync engine will anchor this SKU on its next pass.</p>
                  )}
                </div>

                {/* Pricing */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted mb-1.5">5-tier pricing</p>
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {([["T1 Dist", detail.tier1Distributor], ["T2 Whole", detail.tier2Wholesale], ["T3 Semi", detail.tier3SemiWholesale], ["T4 Retail", detail.tier4Retailer], ["MRP", detail.tier5Mrp]] as const).map(([label, val]) => (
                      <div key={label} className="dmk-well rounded-lg py-2">
                        <p className="text-[9px] uppercase tracking-wider text-dmk-text-muted">{label}</p>
                        <p className="text-[11.5px] font-bold text-dmk-text-primary font-money mt-0.5">{formatMoney(val)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-[10.5px] text-dmk-text-muted">
                    Source: <span className="dmk-badge h-5 px-1.5 text-[9.5px]">{detail.sourcePortal}</span> · HSN {detail.hsnCode} · GST {detail.gstRate}% · updated {timeAgo(detail.updatedAt)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline" size="sm" className="h-8 gap-1.5"
                      onClick={async () => {
                        try {
                          const d = await invGet<{ product: InvProduct }>(`/api/v1/inventory/products/${detail.id}`);
                          setDetail(d.product);
                          toast({ title: "Refreshed" });
                        } catch { /* ignore */ }
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                    <ProductEditInline p={detail} onSaved={(np) => setDetail(np)} />
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductEditInline({ p, onSaved }: { p: InvProduct; onSaved: (p: InvProduct) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: p.name, brand: p.brand, category: p.category, unit: p.unit,
    photoUrl: p.photoUrl ?? "", lowStockThreshold: String(p.lowStockThreshold), isActive: p.isActive,
  });

  React.useEffect(() => {
    setForm({ name: p.name, brand: p.brand, category: p.category, unit: p.unit, photoUrl: p.photoUrl ?? "", lowStockThreshold: String(p.lowStockThreshold), isActive: p.isActive });
  }, [p]);

  async function save() {
    setBusy(true);
    try {
      const d = await invPatch<{ product: InvProduct }>(`/api/v1/inventory/products/${p.id}`, {
        name: form.name, brand: form.brand, category: form.category, unit: form.unit,
        photoUrl: form.photoUrl, lowStockThreshold: Number(form.lowStockThreshold) || 0, isActive: form.isActive,
      });
      toast({ title: "Product updated", description: `Canonical image name re-stamped for ${d.product.sku}.` });
      setOpen(false);
      onSaved(d.product);
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" className="h-8 gap-1.5 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[440px] dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-[15px]">Edit {p.sku}</DialogTitle>
            <DialogDescription className="text-[11.5px]">Renaming or rebranding re-stamps the canonical image file name automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            {([["name", "Product name"], ["brand", "Brand"], ["category", "Category"], ["unit", "Unit"], ["photoUrl", "Image URL"], ["lowStockThreshold", "Low-stock threshold"]] as const).map(([field, label]) => (
              <div key={field} className="space-y-1">
                <Label className="text-[11px] text-dmk-text-muted">{label}</Label>
                <Input
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]"
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-[12px] text-dmk-text-secondary">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="accent-[var(--accent-yellow)]" />
              Active in the shared catalog
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="h-8" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-8 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={save} disabled={busy || !form.name.trim()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />} Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
