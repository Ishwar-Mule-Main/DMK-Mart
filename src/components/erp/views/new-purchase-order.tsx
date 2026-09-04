"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — NEW PURCHASE ORDER (billing-style two-panel screen)
// Mirrors B2B Fast Billing: vendor + product search + lines on the
// left, live GST summary + submit on the right.
// Vendor scoping (R10 + vendor-specific): a MANUFACTURER vendor only
// lists the products it makes (manufacturerVendorId link); a
// DISTRIBUTOR lists the whole catalog.
// Creating a PO sends it straight to the verification team portal —
// stock & payable book only after owner acceptance.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, toISODate } from "@/lib/format";
import type { Product, Vendor } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PoLine {
  productId: string;
  sku: string;
  name: string;
  gstRate: number;
  qty: string;
  cost: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(s: string | number): number {
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Client replica of lib/gst calculateGST (server stays source of truth). */
function gstPreview(taxable: number, gstRate: number, intra: boolean) {
  if (intra) {
    return { cgst: round2(taxable * (gstRate / 200)), sgst: round2(taxable * (gstRate / 200)), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: round2(taxable * (gstRate / 100)) };
}

function normalizeProducts(res: unknown): Product[] {
  if (Array.isArray(res)) return res as Product[];
  const obj = res as { products?: Product[] } | null;
  return obj?.products ?? [];
}

/**
 * Vendor-specific product scoping:
 * · MANUFACTURER vendor → ONLY its own products (direct link first,
 *   legacy brand match as fallback)
 * · DISTRIBUTOR vendor → the entire catalog
 */
function scopedProducts(products: Product[], vendor: Vendor | null): Product[] {
  if (!vendor || vendor.vendorType !== "MANUFACTURER") return products;
  const brand = (vendor.brand ?? "").toLowerCase();
  return products.filter(
    (p) =>
      (p.manufacturerVendorId && p.manufacturerVendorId === vendor.id) ||
      (!!brand && (p.brand ?? "").toLowerCase() === brand)
  );
}

export default function NewPurchaseOrderView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const setView = useErpStore((s) => s.setView);
  const firmStateCode = firm?.stateCode ?? "27";

  // Vendor picker
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [vendorQuery, setVendorQuery] = React.useState("");
  const [vendorOpen, setVendorOpen] = React.useState(false);
  const [vendor, setVendor] = React.useState<Vendor | null>(null);

  // Products
  const [products, setProducts] = React.useState<Product[]>([]);
  const [prodQuery, setProdQuery] = React.useState("");
  const [prodHi, setProdHi] = React.useState(0);

  // Form
  const [poDate, setPoDate] = React.useState(toISODate(new Date()));
  const [vendorBillNo, setVendorBillNo] = React.useState("");
  const [vendorBillDate, setVendorBillDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<PoLine[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [createdPo, setCreatedPo] = React.useState<{ poNumber: string; grandTotal: number } | null>(null);
  const [successOpen, setSuccessOpen] = React.useState(false);

  // Load vendors + products once
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId })
      .then((res) => alive && setVendors(res))
      .catch(() => alive && setVendors([]));
    apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId })
      .then((res) => alive && setProducts(normalizeProducts(res)))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  const vendorResults = React.useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    const base = vendors.filter((v) => v.isActive);
    if (!q) return base.slice(0, 8);
    return base
      .filter(
        (v) =>
          v.vendorName.toLowerCase().includes(q) ||
          (v.gstin ?? "").toLowerCase().includes(q) ||
          (v.phone ?? "").includes(q) ||
          (v.brand ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [vendors, vendorQuery]);

  const intra = !!vendor && vendor.stateCode === firmStateCode;
  const isManufacturer = vendor?.vendorType === "MANUFACTURER";

  /** R4 — scoped pick list: manufacturer → own products, distributor → all. */
  const pickable = React.useMemo(() => {
    const scoped = scopedProducts(products, vendor).filter((p) => p.isActive);
    const q = prodQuery.trim().toLowerCase();
    if (!q) return scoped.slice(0, 8);
    return scoped
      .filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.brand ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [products, vendor, prodQuery]);

  // Keep the visible highlight in range
  React.useEffect(() => setProdHi(0), [prodQuery, vendor?.id]);

  function addProduct(p: Product) {
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...ls];
        next[idx] = { ...next[idx], qty: String(num(next[idx].qty) + 1) };
        return next;
      }
      return [
        ...ls,
        { productId: p.id, sku: p.sku, name: p.name, gstRate: p.gstRate, qty: "1", cost: String(p.purchaseCost) },
      ];
    });
    setProdQuery("");
  }

  function updateLine(i: number, patch: Partial<PoLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  function resetForm(clearVendor = true) {
    setLines([]);
    setProdQuery("");
    setNotes("");
    setVendorBillNo("");
    setVendorBillDate("");
    setPoDate(toISODate(new Date()));
    if (clearVendor) {
      setVendor(null);
      setVendorQuery("");
    }
  }

  // ── Live totals (preview — server recomputes) ─────────────────
  const totals = React.useMemo(() => {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const t = round2(num(l.qty) * num(l.cost));
      const g = gstPreview(t, l.gstRate, intra);
      taxable += t;
      cgst += g.cgst;
      sgst += g.sgst;
      igst += g.igst;
    }
    taxable = round2(taxable);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const grand = round2(taxable + cgst + sgst + igst);
    return { taxable, cgst, sgst, igst, grand };
  }, [lines, intra]);

  const itemsValid = lines.every(
    (l) => num(l.qty) > 0 && num(l.cost) >= 0 && Number.isFinite(num(l.qty)) && Number.isFinite(num(l.cost))
  );
  const canSave = !!vendor && lines.length > 0 && itemsValid;

  async function createPo() {
    if (!activeFirmId || !canSave || !vendor) return;
    setSubmitting(true);
    try {
      const created = await apiPost<{ poNumber: string; grandTotal: number }>("/api/v1/purchase-orders", {
        firmId: activeFirmId,
        vendorId: vendor.id,
        poDate,
        notes: notes.trim(),
        vendorBillNo: vendorBillNo.trim(),
        vendorBillDate: vendorBillDate || null,
        items: lines.map((l) => ({ productId: l.productId, quantity: num(l.qty), unitCost: num(l.cost) })),
      });
      setCreatedPo(created);
      setSuccessOpen(true);
      resetForm(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not create purchase order",
        description: e instanceof ApiError ? e.message : "Something went wrong.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeFirmId) {
    return <EmptyState icon={ClipboardList} title="No active firm" hint="Select a firm from the header switcher." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Purchase Order"
        subtitle={
          vendor
            ? `${vendor.vendorName} · GST ${intra ? "CGST+SGST (intra-state)" : "IGST (inter-state)"} · goes to the verification team on create`
            : "Pick a vendor to see its products — manufacturers show only their own make"
        }
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setView("purchase/orders")}>
              <Truck className="h-4 w-4" /> All purchase orders
            </Button>
            <Button variant="outline" size="sm" onClick={() => resetForm(true)} disabled={!vendor && lines.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
              <Trash2 className="h-4 w-4" /> Clear form
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* ══════════ LEFT — VENDOR + PICKER + LINES ══════════ */}
        <div className="space-y-4 min-w-0">
          {/* Vendor picker */}
          <div className="dmk-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Vendor / Manufacturer</span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                onClick={() => setView("purchase/vendors")}
              >
                <Plus className="h-3.5 w-3.5" /> New Vendor
              </Button>
            </div>

            {vendor ? (
              <div className="dmk-well p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-dmk-text-primary truncate">{vendor.vendorName}</span>
                    <Badge tone={vendor.vendorType === "MANUFACTURER" ? "dr" : "info"}>
                      {vendor.vendorType === "MANUFACTURER" ? "MANUFACTURER" : "DISTRIBUTOR"}
                    </Badge>
                    {isManufacturer && vendor.brand && <Badge tone="warning">Brand · {vendor.brand}</Badge>}
                  </div>
                  <div className="text-[11.5px] text-dmk-text-muted mt-1 flex flex-wrap gap-x-3">
                    <span>GSTIN <span className="font-money text-dmk-text-secondary">{vendor.gstin || "—"}</span></span>
                    <span>State {vendor.stateCode} {intra ? "(intra)" : "(inter)"}</span>
                    <span>Terms {vendor.paymentTerms.replace("_", "-")}</span>
                    <span>
                      Owed{" "}
                      <span className={cn("font-money", Number(vendor.closingBalance) > 0.005 ? "text-dmk-yellow" : "text-dmk-success")}>
                        {Number(vendor.closingBalance) > 0.005 ? formatINR(Number(vendor.closingBalance)) : "Clear"}
                      </span>
                    </span>
                  </div>
                </div>
                <button
                  aria-label="Change vendor"
                  onClick={() => {
                    setVendor(null);
                    setVendorQuery("");
                    setLines([]);
                  }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-dmk-border-subtle text-dmk-text-muted hover:text-dmk-danger hover:border-dmk-danger/40 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={vendorQuery}
                  onChange={(e) => {
                    setVendorQuery(e.target.value);
                    setVendorOpen(true);
                  }}
                  onFocus={() => setVendorOpen(true)}
                  placeholder="Search vendors by name, GSTIN, phone or brand…"
                  className={cn(inputCls, "h-10 pl-9")}
                  aria-label="Vendor search"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                {vendorOpen && vendorResults.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-72 overflow-y-auto">
                    {vendorResults.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setVendor(v);
                          setVendorQuery("");
                          setVendorOpen(false);
                          setLines([]);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-dmk-hover transition-colors border-b border-dmk-border-subtle last:border-b-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-dmk-text-primary truncate">{v.vendorName}</span>
                          <Badge tone={v.vendorType === "MANUFACTURER" ? "dr" : "info"}>
                            {v.vendorType === "MANUFACTURER" ? "MFR" : "DIST"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-dmk-text-muted mt-0.5">
                          {v.vendorType === "MANUFACTURER" && v.brand ? `${v.brand} · ` : ""}
                          {v.stateCode} · {v.phone || "no phone"} · owed {formatINR(Number(v.closingBalance))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Product picker — vendor-scoped */}
          <div className="dmk-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Add products</span>
              {vendor && (
                <span className="text-[10.5px] text-dmk-text-muted">
                  {isManufacturer
                    ? `Showing only ${vendor.vendorName}'s products`
                    : "Distributor — full catalog available"}
                </span>
              )}
            </div>
            <div className="relative">
              <Input
                value={prodQuery}
                onChange={(e) => setProdQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setProdHi((h) => Math.min(h + 1, pickable.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setProdHi((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter" && pickable[prodHi]) {
                    e.preventDefault();
                    addProduct(pickable[prodHi]);
                  } else if (e.key === "Escape") {
                    setProdQuery("");
                  }
                }}
                disabled={!vendor}
                placeholder={vendor ? "Scan or type SKU / product name, press Enter to add…" : "Select a vendor first — products are vendor-scoped"}
                className={cn(inputCls, "h-10 pl-9")}
                aria-label="Product search"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
              {prodQuery && pickable.length > 0 && (
                <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-80 overflow-y-auto" role="listbox">
                  {pickable.map((p, i) => (
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
                        <span className="text-[13px] text-dmk-text-primary truncate">
                          <span className="font-money text-dmk-text-secondary">{p.sku}</span> · {p.name}
                        </span>
                        <span className="font-money text-[12.5px] text-dmk-gold shrink-0">{formatINR(p.purchaseCost)}</span>
                      </div>
                      <div className="text-[11px] text-dmk-text-muted mt-0.5">
                        GST {p.gstRate}% · {p.unit} · stock {p.stockQuantity} · damaged {p.damagedStock}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {vendor && prodQuery.trim() !== "" && pickable.length === 0 && (
                <div className="absolute z-30 mt-1 w-full dmk-elevated px-3 py-3 text-[12px] text-dmk-text-muted text-center">
                  {isManufacturer
                    ? `No ${vendor.vendorName} products match "${prodQuery.trim()}"`
                    : `No products match "${prodQuery.trim()}"`}
                </div>
              )}
            </div>
            {!vendor && (
              <p className="text-[11.5px] text-dmk-text-muted">
                Manufacturer vendors list only the products they make (names start with the vendor&apos;s name). Distributors list everything.
              </p>
            )}
          </div>

          {/* Lines table */}
          <div className="dmk-card overflow-hidden">
            <div className="overflow-x-auto">
              {lines.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="No order lines yet"
                  hint={
                    vendor
                      ? "Search a product above and press Enter — lines carry the vendor's GST treatment."
                      : "Pick a vendor first — the product list is scoped to that vendor."
                  }
                />
              ) : (
                <table className="dmk-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">Taxable</th>
                      <th className="text-right">{intra ? "CGST+SGST" : "IGST"}</th>
                      <th className="text-right">Line total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const taxable = round2(num(l.qty) * num(l.cost));
                      const g = gstPreview(taxable, l.gstRate, intra);
                      const total = round2(taxable + g.cgst + g.sgst + g.igst);
                      const invalid = num(l.qty) <= 0 || num(l.cost) < 0;
                      return (
                        <tr key={l.productId} className={cn(invalid && "bg-[rgba(239,68,68,0.06)]")}>
                          <td className="font-money text-[12px] text-dmk-text-secondary">{l.sku}</td>
                          <td className="max-w-[240px]">
                            <p className="truncate text-[13px]" title={l.name}>{l.name}</p>
                            <p className="text-[10.5px] text-dmk-text-muted">GST {l.gstRate}%</p>
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={l.qty}
                              onChange={(e) => updateLine(i, { qty: e.target.value })}
                              aria-label={`Quantity for ${l.name}`}
                              className="h-8 w-16 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step={0.01}
                              value={l.cost}
                              onChange={(e) => updateLine(i, { cost: e.target.value })}
                              aria-label={`Unit cost for ${l.name}`}
                              className="h-8 w-20 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="num text-[12.5px]">{formatINR(taxable)}</td>
                          <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(g.cgst + g.sgst + g.igst)}</td>
                          <td className="num text-[12.5px] font-semibold text-dmk-text-primary">{formatINR(total)}</td>
                          <td>
                            <button
                              onClick={() => removeLine(i)}
                              aria-label={`Remove ${l.name}`}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
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

        {/* ══════════ RIGHT — SUMMARY (sticky) ══════════ */}
        <div className="lg:sticky lg:top-20 space-y-4">
          <div className="dmk-elevated p-5 space-y-4">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">PO summary</span>

            <div className="space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-dmk-text-secondary">Taxable value</span>
                <span className="font-money text-dmk-text-primary">{formatINR(totals.taxable)}</span>
              </div>
              {intra ? (
                <>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-dmk-text-secondary">CGST</span>
                    <span className="font-money text-dmk-text-primary">{formatINR(totals.cgst)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-dmk-text-secondary">SGST</span>
                    <span className="font-money text-dmk-text-primary">{formatINR(totals.sgst)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-[13px]">
                  <span className="text-dmk-text-secondary">IGST</span>
                  <span className="font-money text-dmk-text-primary">{formatINR(totals.igst)}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dmk-border-medium pt-3 flex items-end justify-between">
              <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">PO value</span>
              <span className="font-money text-[28px] font-bold leading-none text-dmk-yellow">{formatINR(totals.grand)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="PO date">
                <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={inputCls} aria-label="PO date" />
              </Field>
              <Field label="Vendor bill no.">
                <Input value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} placeholder="e.g. SB/4512" className={cn(inputCls, "font-money")} />
              </Field>
              <Field label="Bill date">
                <Input type="date" value={vendorBillDate} onChange={(e) => setVendorBillDate(e.target.value)} className={inputCls} aria-label="Vendor bill date" />
              </Field>
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" className={inputCls} />
              </Field>
            </div>

            <div className="dmk-well px-3 py-2.5 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-dmk-yellow shrink-0 mt-0.5" />
              <p className="text-[11px] text-dmk-text-muted leading-snug">
                On create the PO lands on the <span className="font-semibold text-dmk-text-secondary">verification team portal</span> (product
                names + ordered qty only). Stock, payable and the PURCHASE journal book when you accept their counts.
              </p>
            </div>

            <Button
              className="w-full h-11 text-[14px] font-semibold bg-dmk-yellow text-white hover:bg-dmk-yellow/90"
              onClick={createPo}
              disabled={!canSave || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? "Creating PO…" : "Create PO & send to verification"}
            </Button>
            {!vendor && <p className="text-[11px] text-dmk-text-muted text-center">Select a vendor to enable the order</p>}
            {vendor && lines.length === 0 && <p className="text-[11px] text-dmk-text-muted text-center">Add at least one product line</p>}
          </div>
        </div>
      </div>

      {/* Success dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-dmk-success" />
              <DialogTitle className="text-dmk-text-primary">Purchase order created</DialogTitle>
            </div>
            <DialogDescription className="text-dmk-text-muted">
              Sent to the verification team portal — nothing is booked until you accept their counts.
            </DialogDescription>
          </DialogHeader>
          {createdPo && (
            <div className="dmk-well p-4 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">PO number</span>
                <span className="font-money text-dmk-text-primary">{createdPo.poNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Vendor</span>
                <span className="text-dmk-text-secondary">{vendor?.vendorName ?? "—"}</span>
              </div>
              <div className="flex justify-between border-t border-dmk-border-subtle pt-2">
                <span className="text-dmk-text-muted">PO value</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(createdPo.grandTotal)}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => {
                setSuccessOpen(false);
                setView("purchase/verification");
              }}
            >
              <ShieldCheck className="h-4 w-4" /> Open verification cockpit
            </Button>
            <Button className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={() => setSuccessOpen(false)}>
              Create another PO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
