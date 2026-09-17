"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — PURCHASE BILLING (two-column, mirrors B2B Fast Billing)
// LEFT 30%: vendor details + order (receipt) summary
// RIGHT 70%: product search + cart lines (qty × unit cost)
// Creates a PENDING purchase order — stock/payable book on GRN.
// GST preview vs vendor.stateCode (IGST if ≠ firm.stateCode).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, toISODate } from "@/lib/format";
import { round2 } from "@/lib/gst";
import type { Product, Vendor } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  SearchInput,
  Field,
  inputCls,
} from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function num(s: string | number): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function gstPreview(taxable: number, gstRate: number, intra: boolean) {
  if (intra) return { cgst: round2((taxable * gstRate) / 200), sgst: round2((taxable * gstRate) / 200), igst: 0 };
  return { cgst: 0, sgst: 0, igst: round2((taxable * gstRate) / 100) };
}

interface CartLine {
  product: Product;
  qty: string;
  cost: string;
}

export default function PurchaseBillingView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const setView = useErpStore((s) => s.setView);
  const firmStateCode = firm?.stateCode ?? "";

  // Vendors + products
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loadingMaster, setLoadingMaster] = React.useState(true);

  // Vendor picker
  const [vendorId, setVendorId] = React.useState("");

  // Product typeahead
  const [prodQuery, setProdQuery] = React.useState("");
  const [prodResults, setProdResults] = React.useState<Product[]>([]);
  const [prodOpen, setProdOpen] = React.useState(false);
  const [prodHi, setProdHi] = React.useState(0);

  // Cart
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [poDate, setPoDate] = React.useState<string>(toISODate(new Date()));
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [lastPo, setLastPo] = React.useState<{ poNumber: string; grandTotal: number; lineCount: number } | null>(null);
  const [successOpen, setSuccessOpen] = React.useState(false);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoadingMaster(true);
    Promise.all([
      apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId }).catch(() => []),
      apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" }).catch(() => []),
    ]).then(([v, p]) => {
      if (!alive) return;
      setVendors(v);
      const list = Array.isArray(p) ? p : ((p as { products?: Product[] })?.products ?? []);
      setProducts(list);
      setLoadingMaster(false);
    });
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  const vendor = vendors.find((v) => v.id === vendorId);
  const isManufacturer = vendor?.vendorType === "MANUFACTURER" && !!vendor.brand;
  const intra = !!vendor && vendor.stateCode === firmStateCode;

  // ── Product typeahead (local, brand-scoped) ─────────────────
  React.useEffect(() => {
    const q = prodQuery.trim().toLowerCase();
    if (!vendor) {
      setProdResults([]);
      setProdOpen(false);
      return;
    }
    const pool = products.filter((p) => {
      if (isManufacturer && p.brand.toLowerCase() !== vendor.brand.toLowerCase()) return false;
      if (!q) return true;
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      );
    });
    setProdResults(pool.slice(0, 8));
    setProdOpen(pool.length > 0);
    setProdHi(0);
  }, [prodQuery, vendor, isManufacturer, products]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        return prev.map((l) => (l.product.id === p.id ? { ...l, qty: String(num(l.qty) + 1) } : l));
      }
      return [...prev, { product: p, qty: "1", cost: String(p.purchaseCost) }];
    });
    setProdQuery("");
    setProdResults([]);
    setProdOpen(false);
  }

  function setQty(productId: string, qty: string) {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  }
  function setCost(productId: string, cost: string) {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, cost } : l)));
  }
  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  }
  function resetCart() {
    setLines([]);
    setProdQuery("");
  }

  // ── Live totals (preview — the PO API recomputes) ────────────
  const totals = React.useMemo(() => {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const t = round2(num(l.qty) * num(l.cost));
      taxable += t;
      const g = gstPreview(t, l.product.gstRate, intra);
      cgst += g.cgst;
      sgst += g.sgst;
      igst += g.igst;
    }
    taxable = round2(taxable);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    return { taxable, cgst, sgst, igst, grand: round2(taxable + cgst + sgst + igst) };
  }, [lines, intra]);

  const itemsValid = lines.every(
    (l) => num(l.qty) > 0 && num(l.cost) >= 0 && Number.isFinite(num(l.qty)) && Number.isFinite(num(l.cost))
  );
  const canSave = !!vendorId && lines.length > 0 && itemsValid;

  async function confirmOrder() {
    if (!activeFirmId || !vendorId || lines.length === 0) return;
    setSubmitting(true);
    try {
      const po = await apiPost<{ poNumber: string; grandTotal: number }>("/api/v1/purchase-orders", {
        firmId: activeFirmId,
        vendorId,
        poDate,
        notes: notes.trim(),
        items: lines.map((l) => ({
          productId: l.product.id,
          quantity: num(l.qty),
          unitCost: num(l.cost),
        })),
      });
      setLastPo({ poNumber: po.poNumber, grandTotal: po.grandTotal, lineCount: lines.length });
      setSuccessOpen(true);
      resetCart();
      toast({ title: `PO ${po.poNumber} created`, description: `${formatINR(po.grandTotal)} · PENDING — receive via GRN` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong while creating the purchase order.";
      toast({ variant: "destructive", title: "Purchase order failed", description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeFirmId) {
    return <EmptyState icon={Truck} title="No active firm" hint="Select a firm from the header switcher to start purchase billing." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Billing"
        subtitle={`Vendor-first ordering · GST ${intra ? "CGST+SGST (intra-state)" : intra === false && vendor ? "IGST (inter-state)" : "preview"} · PO posts stock on GRN receive`}
        icon={ClipboardList}
        actions={
          <Button variant="outline" size="sm" onClick={resetCart} disabled={lines.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
            <Trash2 className="h-4 w-4" /> Clear cart
          </Button>
        }
      />

      {/* 2-column layout — LEFT 30%: vendor details + order summary · RIGHT 70%: product search + cart */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,30%)_minmax(0,1fr)] gap-4 items-start">
        {/* ══════════ LEFT (30%) — VENDOR DETAILS ══════════ */}
        <div className="order-1 lg:col-start-1 lg:row-start-1 min-w-0">
          <div className="dmk-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">Vendor</span>
              <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setView("purchase/vendors")}>
                <Plus className="h-3.5 w-3.5" /> Vendors
              </Button>
            </div>

            {loadingMaster ? (
              <div className="flex items-center gap-2 text-[13px] text-dmk-text-muted py-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading vendors…
              </div>
            ) : vendors.length === 0 ? (
              <p className="text-[13px] text-dmk-text-muted py-2">No vendors yet — add one from the Vendors page.</p>
            ) : (
              <Select
                value={vendorId}
                onValueChange={(v) => {
                  setVendorId(v);
                  setLines([]); // brand scope may change — start clean
                }}
              >
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder="Select vendor…" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                      {v.vendorType === "MANUFACTURER" && v.brand ? ` — Mfr · ${v.brand}` : " — Distributor"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {vendor && (
              <div className="dmk-well p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-dmk-text-primary truncate">{vendor.vendorName}</span>
                  <Badge tone={vendor.vendorType === "MANUFACTURER" ? "info" : "neutral"}>{vendor.vendorType}</Badge>
                </div>
                <div className="text-[12.5px] text-dmk-text-muted flex flex-wrap gap-x-3">
                  <span>GSTIN <span className="font-money text-dmk-text-secondary">{vendor.gstin || "—"}</span></span>
                  <span>State {vendor.stateCode || "—"}</span>
                  {vendor.brand && <span>Brand {vendor.brand}</span>}
                </div>
                <div className="text-[12.5px]">
                  {intra ? (
                    <span className="text-dmk-info">Intra-state — CGST + SGST (vendor &amp; firm both in {vendor.stateCode})</span>
                  ) : (
                    <span className="text-dmk-gold">Inter-state — IGST (vendor {vendor.stateCode} ≠ firm {firmStateCode})</span>
                  )}
                </div>
                {isManufacturer && (
                  <div className="text-[12.5px] text-dmk-gold flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Brand scope — only {vendor.brand} products are pickable (R10)
                  </div>
                )}
                <button
                  aria-label="Change vendor"
                  onClick={() => {
                    setVendorId("");
                    setLines([]);
                  }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-dmk-border-subtle text-dmk-text-muted hover:text-dmk-danger hover:border-dmk-danger/40 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ══════════ LEFT (30%) — ORDER SUMMARY (below vendor details) ══════════ */}
        <div className="order-2 lg:col-start-1 lg:row-start-2 min-w-0">
          <div className="dmk-elevated p-5 space-y-4 lg:sticky lg:top-20">
            <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">Order summary</span>

            <div className="space-y-2">
              <div className="flex justify-between text-[14px]">
                <span className="text-dmk-text-secondary">Taxable value</span>
                <span className="font-money text-dmk-text-primary">{formatINR(totals.taxable)}</span>
              </div>
              {intra ? (
                <>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-dmk-text-secondary">CGST</span>
                    <span className="font-money text-dmk-text-primary">{formatINR(totals.cgst)}</span>
                  </div>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-dmk-text-secondary">SGST</span>
                    <span className="font-money text-dmk-text-primary">{formatINR(totals.sgst)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-[14px]">
                  <span className="text-dmk-text-secondary">IGST</span>
                  <span className="font-money text-dmk-text-primary">{formatINR(totals.igst)}</span>
                </div>
              )}
              <div className="flex justify-between text-[13px] text-dmk-text-muted">
                <span>Lines</span>
                <span className="font-money">{lines.length}</span>
              </div>
            </div>

            <div className="border-t border-dmk-border-medium pt-3 flex items-end justify-between">
              <span className="text-[13px] uppercase tracking-wider font-semibold text-dmk-text-muted">Grand Total</span>
              <span className="font-money text-[26px] font-bold leading-none text-dmk-orange">{formatINR(totals.grand)}</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <Field label="PO date">
                <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={inputCls} aria-label="PO date" />
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery instructions, packaging…" className={inputCls} />
              </Field>
            </div>

            <Button
              className="w-full h-11 text-[15px] font-semibold bg-dmk-orange text-[#0A0F1D] hover:bg-dmk-orange/90"
              onClick={confirmOrder}
              disabled={!vendorId || lines.length === 0 || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? "Creating PO…" : "Create Purchase Order"}
            </Button>
            {!vendorId && <p className="text-[12px] text-dmk-text-muted text-center">Select a vendor to enable ordering</p>}
            {vendorId && <p className="text-[12px] text-dmk-text-muted text-center">Nothing is booked until you receive it via GRN</p>}
          </div>
        </div>

        {/* ══════════ RIGHT (70%) — PRODUCT SEARCH ══════════ */}
        <div className="order-3 lg:col-start-2 lg:row-start-1 min-w-0">
          <div className="dmk-card p-4 space-y-3">
            <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">Add products (purchase cost)</span>
            <div className="relative">
              <Input
                value={prodQuery}
                onChange={(e) => setProdQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setProdHi((h) => Math.min(h + 1, prodResults.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setProdHi((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter" && prodResults[prodHi]) {
                    e.preventDefault();
                    addProduct(prodResults[prodHi]);
                  } else if (e.key === "Escape") {
                    setProdOpen(false);
                  }
                }}
                placeholder={vendor ? "Search SKU / product / brand, Enter adds first match…" : "Select a vendor first"}
                disabled={!vendor}
                className={cn(inputCls, "h-10 pl-9")}
                aria-label="Product search"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
              {prodOpen && prodResults.length > 0 && (
                <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-80 overflow-y-auto" role="listbox">
                  {prodResults.map((p, i) => (
                    <button
                      key={p.id}
                      role="option"
                      aria-selected={i === prodHi}
                      onMouseEnter={() => setProdHi(i)}
                      onClick={() => addProduct(p)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 transition-colors border-b border-dmk-border-subtle last:border-b-0",
                        i === prodHi ? "bg-dmk-hover" : "hover:bg-dmk-hover"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[14px] text-dmk-text-primary truncate">
                          <span className="font-money text-dmk-text-secondary">{p.sku}</span> · {p.name}
                        </span>
                        <span className="font-money text-[13.5px] text-dmk-gold shrink-0">{formatINR(p.purchaseCost)}</span>
                      </div>
                      <div className="text-[12px] text-dmk-text-muted mt-0.5">
                        GST {p.gstRate}% · {p.unit} · stock {p.stockQuantity}{isManufacturer ? ` · ${p.brand}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══════════ RIGHT (70%) — CART ══════════ */}
        <div className="order-4 lg:col-start-2 lg:row-start-2 min-w-0">
          <div className="dmk-card overflow-hidden">
            <div className="overflow-x-auto">
              {lines.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Order cart is empty"
                  hint="Search a product above (SKU or name) and press Enter to add the first line. Quantities and unit costs are editable per line."
                />
              ) : (
                <table className="dmk-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">GST</th>
                      <th className="text-right">Taxable</th>
                      <th className="text-right">{intra ? "CGST+SGST" : "IGST"}</th>
                      <th className="text-right">Line total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const taxable = round2(num(l.qty) * num(l.cost));
                      const g = gstPreview(taxable, l.product.gstRate, intra);
                      const lineGst = round2(g.cgst + g.sgst + g.igst);
                      const invalid = num(l.qty) <= 0 || num(l.cost) < 0;
                      return (
                        <tr key={l.product.id} className={cn("whitespace-nowrap", invalid && "bg-[rgba(239,68,68,0.06)]")}>
                          <td className="font-money text-[12.5px] whitespace-nowrap text-dmk-text-secondary">{l.product.sku}</td>
                          <td className="max-w-[260px]">
                            <p className="text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis" title={l.product.name}>{l.product.name}</p>
                            <p className="text-[11.5px] text-dmk-text-muted whitespace-nowrap">{l.product.unit} · GST {l.product.gstRate}% · stock {l.product.stockQuantity}</p>
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={l.qty}
                              onChange={(e) => setQty(l.product.id, e.target.value)}
                              aria-label={`Quantity for ${l.product.name}`}
                              className="h-7 w-14 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={l.cost}
                              onChange={(e) => setCost(l.product.id, e.target.value)}
                              aria-label={`Unit cost for ${l.product.name}`}
                              className="h-7 w-20 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="num text-[12.5px] whitespace-nowrap text-dmk-text-secondary">{l.product.gstRate}%</td>
                          <td className="num text-[12.5px] whitespace-nowrap">{formatINR(taxable)}</td>
                          <td className="num text-[12.5px] whitespace-nowrap text-dmk-text-secondary">
                            {intra ? `${formatINR(g.cgst)} + ${formatINR(g.sgst)}` : formatINR(g.igst)}
                          </td>
                          <td className="num text-[12.5px] whitespace-nowrap font-semibold text-dmk-text-primary">{formatINR(round2(taxable + lineGst))}</td>
                          <td>
                            <button
                              onClick={() => removeLine(l.product.id)}
                              aria-label={`Remove ${l.product.name}`}
                              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Success dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-dmk-success" />
              <DialogTitle className="text-dmk-text-primary">Purchase order created</DialogTitle>
            </div>
            <DialogDescription className="text-dmk-text-muted">
              Status PENDING — receive it via GRN to book stock and vendor payable.
            </DialogDescription>
          </DialogHeader>
          {lastPo && (
            <div className="dmk-well p-4 space-y-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">PO #</span>
                <span className="font-money text-dmk-text-primary">{lastPo.poNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Vendor</span>
                <span className="text-dmk-text-secondary">{vendor?.vendorName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Lines</span>
                <span className="text-dmk-text-secondary">{lastPo.lineCount}</span>
              </div>
              <div className="flex justify-between border-t border-dmk-border-subtle pt-2">
                <span className="text-dmk-text-muted">Grand total</span>
                <span className="font-money text-[16px] text-dmk-orange">{formatINR(lastPo.grandTotal)}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => {
                setSuccessOpen(false);
                setView("purchase/orders");
              }}
            >
              <ClipboardList className="h-4 w-4" /> Open Purchase Orders
            </Button>
            <Button className="bg-dmk-orange text-[#0A0F1D] hover:bg-dmk-orange/90" onClick={() => setSuccessOpen(false)}>
              New order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
