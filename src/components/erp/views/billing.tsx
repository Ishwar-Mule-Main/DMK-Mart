"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — B2B FAST BILLING (two-panel: cart left, summary right)
// Tier pricing + bulk/packaging discount + manual disc + GST split
// preview (client mirrors server formula). Server recomputes ALL
// money — client preview only. Credit lock & stock enforced API-side.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, toISODate, amountInWords } from "@/lib/format";
import { calculateBulkPricing, formatLabel, TIERS } from "@/lib/pricing";
import { round2 } from "@/lib/gst";
import type { Customer, Product, Invoice } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
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

// ─── Indian states (code → name) ───────────────────────────────
const STATES: Array<{ code: string; name: string }> = [
  { code: "27", name: "Maharashtra (27)" },
  { code: "29", name: "Karnataka (29)" },
  { code: "36", name: "Telangana (36)" },
  { code: "33", name: "Tamil Nadu (33)" },
  { code: "24", name: "Gujarat (24)" },
  { code: "07", name: "Delhi (07)" },
  { code: "09", name: "Uttar Pradesh (09)" },
  { code: "23", name: "Madhya Pradesh (23)" },
  { code: "37", name: "Andhra Pradesh (37)" },
  { code: "32", name: "Kerala (32)" },
  { code: "19", name: "West Bengal (19)" },
  { code: "21", name: "Odisha (21)" },
  { code: "10", name: "Bihar (10)" },
  { code: "06", name: "Haryana (06)" },
  { code: "08", name: "Rajasthan (08)" },
  { code: "03", name: "Punjab (03)" },
];

function tierLabel(key: string): string {
  return TIERS.find((t) => t.key === key)?.label ?? "Retailer";
}

function tierPriceOf(p: Product, tierKey: string): number {
  const map = p as unknown as Record<string, number>;
  return Number(map[tierKey] ?? p.tier4Retailer) || 0;
}

function tierBadgeTone(key: string): "info" | "success" | "warning" | "neutral" | "dr" {
  switch (key) {
    case "tier1Distributor": return "info";
    case "tier2Wholesale": return "success";
    case "tier3SemiWholesale": return "warning";
    case "tier4Retailer": return "neutral";
    default: return "dr";
  }
}

/** Client-side GST split preview — mirrors lib/gst calculateGST. */
function previewGst(taxable: number, rate: number, seller: string, buyer: string) {
  const intra = seller && buyer && seller === buyer;
  if (intra) return { cgst: round2((taxable * rate) / 200), sgst: round2((taxable * rate) / 200), igst: 0 };
  return { cgst: 0, sgst: 0, igst: round2((taxable * rate) / 100) };
}

interface CartLine {
  product: Product;
  qty: number;
  manualDiscPct: number;
}

const PAYMENT_MODES = ["CREDIT", "CASH", "UPI", "NEFT"] as const;

export default function BillingView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const setView = useErpStore((s) => s.setView);

  // Customer picker
  const [custQuery, setCustQuery] = React.useState("");
  const [custResults, setCustResults] = React.useState<Customer[]>([]);
  const [custOpen, setCustOpen] = React.useState(false);
  const [custSearching, setCustSearching] = React.useState(false);
  const [customer, setCustomer] = React.useState<Customer | null>(null);
  const [newCustOpen, setNewCustOpen] = React.useState(false);

  // Product typeahead
  const [prodQuery, setProdQuery] = React.useState("");
  const [prodResults, setProdResults] = React.useState<Product[]>([]);
  const [prodOpen, setProdOpen] = React.useState(false);
  const [prodHi, setProdHi] = React.useState(0);
  const [prodSearching, setProdSearching] = React.useState(false);

  // Cart
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = React.useState<(typeof PAYMENT_MODES)[number]>("CREDIT");
  const [invoiceDate, setInvoiceDate] = React.useState<string>(toISODate(new Date()));
  const [submitting, setSubmitting] = React.useState(false);
  const [lastInvoice, setLastInvoice] = React.useState<Invoice | null>(null);
  const [successOpen, setSuccessOpen] = React.useState(false);

  const tierKey = React.useMemo(() => {
    if (customer && TIERS.some((t) => t.key === customer.assignedTier)) return customer.assignedTier;
    return "tier4Retailer";
  }, [customer]);

  // ── Customer search (debounced) ──────────────────────────────
  React.useEffect(() => {
    if (!activeFirmId) return;
    const q = custQuery.trim();
    if (!q) {
      setCustResults([]);
      setCustOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setCustSearching(true);
        const res = await apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2B", search: q });
        setCustResults(res.slice(0, 8));
        setCustOpen(res.length > 0);
      } catch (e) {
        if (e instanceof ApiError) toast({ variant: "destructive", title: "Customer search failed", description: e.message });
      } finally {
        setCustSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [custQuery, activeFirmId]);

  // ── Product typeahead (debounced, min 1 char) ────────────────
  React.useEffect(() => {
    if (!activeFirmId) return;
    const q = prodQuery.trim();
    if (q.length < 1) {
      setProdResults([]);
      setProdOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setProdSearching(true);
        const res = await apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, search: q, activeOnly: "true" });
        const list = Array.isArray(res) ? res : (res.products ?? []);
        setProdResults(list.slice(0, 8));
        setProdOpen(list.length > 0);
        setProdHi(0);
      } catch (e) {
        if (e instanceof ApiError) toast({ variant: "destructive", title: "Product search failed", description: e.message });
      } finally {
        setProdSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [prodQuery, activeFirmId]);

  function addProduct(p: Product) {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { product: p, qty: 1, manualDiscPct: 0 }];
    });
    setProdQuery("");
    setProdResults([]);
    setProdOpen(false);
  }

  function setQty(productId: string, qty: number) {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qty: Math.max(1, qty) } : l)));
  }
  function setDisc(productId: string, pct: number) {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, manualDiscPct: Math.min(100, Math.max(0, pct)) } : l)));
  }
  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product.id !== productId));
  }
  function resetCart() {
    setLines([]);
    setProdQuery("");
  }

  // ── Live totals (preview — server recomputes) ────────────────
  const totals = React.useMemo(() => {
    const buyerState = customer?.stateCode ?? firm?.stateCode ?? "";
    const sellerState = firm?.stateCode ?? "";
    let baseSubtotal = 0;
    let taxable = 0;
    let savings = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const tp = tierPriceOf(l.product, tierKey);
      const bp = calculateBulkPricing(tp, l.qty, l.manualDiscPct);
      baseSubtotal += tp * l.qty;
      taxable += bp.taxable;
      savings += bp.savings;
      const g = previewGst(bp.taxable, l.product.gstRate, sellerState, buyerState);
      cgst += g.cgst;
      sgst += g.sgst;
      igst += g.igst;
    }
    baseSubtotal = round2(baseSubtotal);
    taxable = round2(taxable);
    savings = round2(savings);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const exact = round2(taxable + cgst + sgst + igst);
    const grand = Math.round(exact);
    const roundOff = round2(grand - exact);
    return { baseSubtotal, taxable, savings, cgst, sgst, igst, exact, grand, roundOff, intra: sellerState === buyerState && !!buyerState };
  }, [lines, tierKey, customer, firm]);

  const creditWarning = React.useMemo(() => {
    if (!customer || customer.customerType !== "B2B") return null;
    if (paymentMode !== "CREDIT") return null;
    if (customer.creditLimit <= 0) return "No credit limit set — CREDIT sale may be blocked by the server.";
    const outstanding = Number(customer.closingBalance) || 0;
    if (outstanding + totals.grand > customer.creditLimit) {
      return `Credit check: outstanding ${formatINR(outstanding)} + this sale ${formatINR(totals.grand)} exceeds limit ${formatINR(customer.creditLimit)}. Server will block this sale.`;
    }
    return null;
  }, [customer, paymentMode, totals.grand]);

  async function confirmSale() {
    if (!activeFirmId || !customer || lines.length === 0) return;
    setSubmitting(true);
    try {
      const inv = await apiPost<Invoice>("/api/v1/invoices", {
        firmId: activeFirmId,
        customerId: customer.id,
        isCounterSale: false,
        invoiceDate,
        paymentMode,
        lines: lines.map((l) => ({
          productId: l.product.id,
          quantity: l.qty,
          ...(l.manualDiscPct > 0 ? { manualDiscountPct: l.manualDiscPct } : {}),
        })),
      });
      setLastInvoice(inv);
      setSuccessOpen(true);
      resetCart();
      toast({ title: `Invoice ${inv.invoiceNumber} created`, description: `${formatINR(inv.grandTotal)} · ${paymentMode}` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong while posting the invoice.";
      const code = e instanceof ApiError ? e.code : "ERR_UNKNOWN";
      toast({
        variant: "destructive",
        title: code === "ERR_CUSTOMER_CREDIT_LOCK" ? "Credit limit blocked" : code === "ERR_INSUFFICIENT_SELLABLE_STOCK" ? "Stock unavailable" : "Sale failed",
        description: `${msg} (${code})`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeFirmId) {
    return (
      <EmptyState icon={ShoppingCart} title="No active firm" hint="Select a firm from the header switcher to start billing." />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="B2B Fast Billing"
        subtitle={`Tier pricing with bulk packaging discounts · GST ${totals.intra ? "CGST+SGST (intra-state)" : "IGST (inter-state)"} preview`}
        icon={ReceiptText}
        actions={
          <Button variant="outline" size="sm" onClick={resetCart} disabled={lines.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
            <Trash2 className="h-4 w-4" /> Clear cart
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* ══════════ LEFT — CART ══════════ */}
        <div className="space-y-4 min-w-0">
          {/* Customer picker */}
          <div className="dmk-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Customer</span>
              <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setNewCustOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> New Customer
              </Button>
            </div>

            {customer ? (
              <div className="dmk-well p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold text-dmk-text-primary truncate">{customer.partyName}</span>
                    <Badge tone={tierBadgeTone(customer.assignedTier)}>{tierLabel(customer.assignedTier)}</Badge>
                  </div>
                  <div className="text-[11.5px] text-dmk-text-muted mt-1 flex flex-wrap gap-x-3">
                    <span>GSTIN <span className="font-money text-dmk-text-secondary">{customer.gstin || "—"}</span></span>
                    <span>State {customer.stateCode || "—"} {customer.stateCode === firm?.stateCode ? "(intra)" : "(inter)"}</span>
                    <span>Credit days {customer.creditDays}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">Credit limit</p>
                    <p className="font-money text-[13px] text-dmk-text-primary">{formatINR(customer.creditLimit)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted">Outstanding</p>
                    <p className={cn("font-money text-[13px]", Number(customer.closingBalance) > 0.005 ? "text-dmk-yellow" : "text-dmk-success")}>
                      {Number(customer.closingBalance) > 0.005 ? `Dr ${formatINR(Number(customer.closingBalance))}` : "Clear"}
                    </p>
                  </div>
                  <button
                    aria-label="Change customer"
                    onClick={() => setCustomer(null)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-dmk-border-subtle text-dmk-text-muted hover:text-dmk-danger hover:border-dmk-danger/40 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <SearchInput value={custQuery} onChange={setCustQuery} placeholder="Search B2B customers by name, phone or GSTIN…" className="pl-9" />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                {custSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted animate-spin" />}
                {custOpen && custResults.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-72 overflow-y-auto">
                    {custResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCustomer(c);
                          setCustQuery("");
                          setCustOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-dmk-hover transition-colors border-b border-dmk-border-subtle last:border-b-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-dmk-text-primary truncate">{c.partyName}</span>
                          <Badge tone={tierBadgeTone(c.assignedTier)}>{tierLabel(c.assignedTier)}</Badge>
                        </div>
                        <div className="text-[11px] text-dmk-text-muted mt-0.5">
                          {c.city || "—"} · {c.phone || "no phone"} · {c.gstin || "no GSTIN"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Product typeahead */}
          <div className="dmk-card p-4 space-y-3">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Add products</span>
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
                placeholder="Scan or type SKU / product name, press Enter to add first match…"
                className={cn(inputCls, "h-10 pl-9")}
                aria-label="Product search"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
              {prodSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted animate-spin" />}
              {prodOpen && prodResults.length > 0 && (
                <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-80 overflow-y-auto" role="listbox">
                  {prodResults.map((p, i) => {
                    const tp = tierPriceOf(p, tierKey);
                    return (
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
                          <span className="font-money text-[12.5px] text-dmk-gold shrink-0">{formatINR(tp)}</span>
                        </div>
                        <div className="text-[11px] text-dmk-text-muted mt-0.5">
                          {tierLabel(tierKey)} price · GST {p.gstRate}% · {p.unit} · stock {p.stockQuantity}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cart table */}
          <div className="dmk-card overflow-hidden">
            <div className="overflow-x-auto">
              {lines.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Cart is empty"
                  hint="Search a product above (SKU or name) and press Enter to add the first match. Quantity unlocks automatic bulk discounts."
                />
              ) : (
                <table className="dmk-table min-w-[860px]">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Tier price</th>
                      <th>Packaging</th>
                      <th className="text-right">Disc %</th>
                      <th className="text-right">Eff. price</th>
                      <th className="text-right">Taxable</th>
                      <th className="text-right">GST</th>
                      <th className="text-right">Saved</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const tp = tierPriceOf(l.product, tierKey);
                      const bp = calculateBulkPricing(tp, l.qty, l.manualDiscPct);
                      return (
                        <tr key={l.product.id}>
                          <td className="font-money text-[12px] text-dmk-text-secondary">{l.product.sku}</td>
                          <td className="max-w-[220px]">
                            <p className="truncate text-[13px]">{l.product.name}</p>
                            <p className="text-[10.5px] text-dmk-text-muted">{l.product.unit} · stock {l.product.stockQuantity}</p>
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={l.qty}
                              onChange={(e) => setQty(l.product.id, Number(e.target.value) || 1)}
                              aria-label={`Quantity for ${l.product.name}`}
                              className="h-8 w-16 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(tp)}</td>
                          <td>
                            {bp.discountPct > 0 ? (
                              <span className="inline-flex flex-col">
                                <span className="text-[11.5px] text-dmk-text-secondary">{formatLabel(bp.format)}</span>
                                <span className="text-[10.5px] font-semibold text-dmk-gold">−{bp.discountPct}% bulk</span>
                              </span>
                            ) : (
                              <span className="text-[11.5px] text-dmk-text-muted">Piece</span>
                            )}
                          </td>
                          <td className="text-right">
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              value={l.manualDiscPct}
                              onChange={(e) => setDisc(l.product.id, Number(e.target.value) || 0)}
                              aria-label={`Manual discount percent for ${l.product.name}`}
                              className="h-8 w-16 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                            />
                          </td>
                          <td className="num text-[12.5px] text-dmk-text-primary">{formatINR(bp.unitPrice)}</td>
                          <td className="num text-[12.5px]">{formatINR(bp.taxable)}</td>
                          <td className="num text-[12.5px] text-dmk-text-secondary">{l.product.gstRate}%</td>
                          <td className="num text-[12px] text-dmk-gold">{bp.savings > 0 ? `−${formatINR(bp.savings)}` : "—"}</td>
                          <td>
                            <button
                              onClick={() => removeLine(l.product.id)}
                              aria-label={`Remove ${l.product.name}`}
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
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Invoice summary</span>

            <div className="space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-dmk-text-secondary">Subtotal (tier prices)</span>
                <span className="font-money text-dmk-text-primary">{formatINR(totals.baseSubtotal)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-dmk-text-secondary">Bulk + manual discounts</span>
                <span className="font-money text-dmk-gold">{totals.savings > 0 ? `−${formatINR(totals.savings)}` : formatINR(0)}</span>
              </div>
              <div className="flex justify-between text-[13px] border-t border-dmk-border-subtle pt-2">
                <span className="text-dmk-text-secondary">Taxable value</span>
                <span className="font-money text-dmk-text-primary">{formatINR(totals.taxable)}</span>
              </div>
              {totals.intra ? (
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
              <div className="flex justify-between text-[12px] text-dmk-text-muted">
                <span>Round-off</span>
                <span className="font-money">{totals.roundOff !== 0 ? formatINR(totals.roundOff) : "—"}</span>
              </div>
            </div>

            <div className="border-t border-dmk-border-medium pt-3 flex items-end justify-between">
              <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">Grand Total</span>
              <span className="font-money text-[28px] font-bold leading-none text-dmk-yellow">{formatINR(totals.grand)}</span>
            </div>
            <p className="text-[11.5px] italic text-dmk-text-muted">{amountInWords(totals.grand)}</p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment mode">
                <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as (typeof PAYMENT_MODES)[number])}>
                  <SelectTrigger className={cn(inputCls, "w-full")}>
                    <SelectValue placeholder="Mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Invoice date">
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputCls} aria-label="Invoice date" />
              </Field>
            </div>

            {creditWarning && (
              <div className="flex items-start gap-2 rounded-md border border-dmk-warning/30 bg-[rgba(245,158,11,0.08)] px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-dmk-warning shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-dmk-warning leading-snug">{creditWarning}</p>
              </div>
            )}

            <Button
              className="w-full h-11 text-[14px] font-semibold bg-dmk-yellow text-white hover:bg-dmk-yellow/90"
              onClick={confirmSale}
              disabled={!customer || lines.length === 0 || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {submitting ? "Posting invoice…" : "Confirm Sale"}
            </Button>
            {!customer && <p className="text-[11px] text-dmk-text-muted text-center">Select a B2B customer to enable billing</p>}
          </div>
        </div>
      </div>

      {/* Success dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-dmk-success" />
              <DialogTitle className="text-dmk-text-primary">Invoice created</DialogTitle>
            </div>
            <DialogDescription className="text-dmk-text-muted">
              Journal, ledger and stock movements have been posted.
            </DialogDescription>
          </DialogHeader>
          {lastInvoice && (
            <div className="dmk-well p-4 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Invoice #</span>
                <span className="font-money text-dmk-text-primary">{lastInvoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Date</span>
                <span className="text-dmk-text-secondary">{lastInvoice.invoiceDate.slice(0, 10)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Customer</span>
                <span className="text-dmk-text-secondary">{lastInvoice.customer?.partyName ?? lastInvoice.walkInName ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Payment</span>
                <Badge tone={lastInvoice.paymentMode === "CREDIT" ? "warning" : "success"}>{lastInvoice.paymentMode}</Badge>
              </div>
              <div className="flex justify-between border-t border-dmk-border-subtle pt-2">
                <span className="text-dmk-text-muted">Grand total</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(lastInvoice.grandTotal)}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => {
                setSuccessOpen(false);
                setView("docs/invoices");
              }}
            >
              <FileText className="h-4 w-4" /> View A4 document
            </Button>
            <Button className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={() => setSuccessOpen(false)}>
              New sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewCustomerDialog
        open={newCustOpen}
        onOpenChange={setNewCustOpen}
        onCreated={(c) => {
          setCustomer(c);
          setNewCustOpen(false);
          toast({ title: `Customer added — ${c.partyName}` });
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Quick new-customer dialog (B2B)
// ═══════════════════════════════════════════════════════════════
function NewCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (c: Customer) => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    city: "",
    firmName: "",
    gstin: "",
    stateCode: "27",
    assignedTier: "tier3SemiWholesale",
    creditLimit: "0",
    creditDays: "30",
    phone: "",
  });

  React.useEffect(() => {
    if (open && firm) setForm((f) => ({ ...f, stateCode: firm.stateCode }));
  }, [open, firm]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!activeFirmId) return;
    if (!form.city.trim() || !form.firmName.trim()) {
      toast({ variant: "destructive", title: "Missing fields", description: "City and firm name are required (party name is composed as “City FirmName”)." });
      return;
    }
    setSaving(true);
    try {
      const c = await apiPost<Customer>("/api/v1/customers", {
        firmId: activeFirmId,
        customerType: "B2B",
        city: form.city.trim(),
        firmName: form.firmName.trim(),
        gstin: form.gstin.trim(),
        stateCode: form.stateCode,
        assignedTier: form.assignedTier,
        creditLimit: Number(form.creditLimit) || 0,
        creditDays: Number(form.creditDays) || 0,
        phone: form.phone.trim(),
      });
      onCreated(c);
      setForm((f) => ({ ...f, city: "", firmName: "", gstin: "", phone: "", creditLimit: "0" }));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not create customer.";
      toast({ variant: "destructive", title: "Create failed", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">New B2B customer</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">Location-first naming — party name becomes “City FirmName”.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City *">
            <Input value={form.city} onChange={set("city")} placeholder="e.g. Latur" className={inputCls} />
          </Field>
          <Field label="Firm name *">
            <Input value={form.firmName} onChange={set("firmName")} placeholder="e.g. Ishwar Mule" className={inputCls} />
          </Field>
          <Field label="GSTIN">
            <Input value={form.gstin} onChange={set("gstin")} placeholder="27…" className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} placeholder="98…" className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="State code">
            <Select value={form.stateCode} onValueChange={(v) => setForm((f) => ({ ...f, stateCode: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assigned tier">
            <Select value={form.assignedTier} onValueChange={(v) => setForm((f) => ({ ...f, assignedTier: v }))}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIERS.slice(0, 4).map((t) => (
                  <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Credit limit ₹">
            <Input type="number" min={0} value={form.creditLimit} onChange={set("creditLimit")} className={cn(inputCls, "font-money")} />
          </Field>
          <Field label="Credit days">
            <Input type="number" min={0} value={form.creditDays} onChange={set("creditDays")} className={cn(inputCls, "font-money")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
