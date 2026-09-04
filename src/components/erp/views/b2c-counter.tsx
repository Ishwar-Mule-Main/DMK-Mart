"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — B2C COUNTER POS (R9/R14)
// Buyer directory (name + phone), walk-in support, Retailer tier,
// instant payment ONLY: CASH / UPI / CARD — no credit, ever.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  CheckCircle2,
  Coins,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, toISODate, amountInWords, formatDate } from "@/lib/format";
import { calculateBulkPricing, formatLabel } from "@/lib/pricing";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function tierPriceOf(p: Product): number {
  // B2C buyers have no assigned tier → Retailer tier (R12/R14)
  return Number(p.tier4Retailer) || 0;
}

function previewGst(taxable: number, rate: number, seller: string, buyer: string) {
  const intra = seller && buyer && seller === buyer;
  if (intra) return { cgst: round2((taxable * rate) / 200), sgst: round2((taxable * rate) / 200), igst: 0 };
  return { cgst: 0, sgst: 0, igst: round2((taxable * rate) / 100) };
}

interface CartLine {
  product: Product;
  qty: number;
}

const PAYMENT_PILLS = ["CASH", "UPI", "CARD"] as const;

export default function B2CCounterView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();

  // ── Counter stats (today) ────────────────────────────────────
  const [counterInvoices, setCounterInvoices] = React.useState<Invoice[] | null>(null);

  // ── Buyer picker ─────────────────────────────────────────────
  const [buyerQuery, setBuyerQuery] = React.useState("");
  const [buyerResults, setBuyerResults] = React.useState<Customer[]>([]);
  const [buyerSearching, setBuyerSearching] = React.useState(false);
  const [buyerOpen, setBuyerOpen] = React.useState(false);
  const [buyer, setBuyer] = React.useState<Customer | null>(null);
  const [newBuyerOpen, setNewBuyerOpen] = React.useState(false);

  // ── Walk-in (when no buyer chosen) ───────────────────────────
  const [walkInName, setWalkInName] = React.useState("");
  const [walkInPhone, setWalkInPhone] = React.useState("");

  // ── Product typeahead ────────────────────────────────────────
  const [prodQuery, setProdQuery] = React.useState("");
  const [prodResults, setProdResults] = React.useState<Product[]>([]);
  const [prodOpen, setProdOpen] = React.useState(false);
  const [prodHi, setProdHi] = React.useState(0);
  const [prodSearching, setProdSearching] = React.useState(false);

  // ── Cart ─────────────────────────────────────────────────────
  const [lines, setLines] = React.useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = React.useState<(typeof PAYMENT_PILLS)[number]>("CASH");
  const [invoiceDate] = React.useState<string>(toISODate(new Date()));
  const [submitting, setSubmitting] = React.useState(false);
  const [lastInvoice, setLastInvoice] = React.useState<Invoice | null>(null);
  const [successOpen, setSuccessOpen] = React.useState(false);

  const loadCounterInvoices = React.useCallback(async () => {
    if (!activeFirmId) return;
    try {
      const res = await apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, isCounterSale: "true" });
      setCounterInvoices(res);
    } catch {
      setCounterInvoices([]);
    }
  }, [activeFirmId]);

  React.useEffect(() => {
    loadCounterInvoices();
  }, [loadCounterInvoices, successOpen]);

  // ── Buyer search (debounced, name OR phone) ──────────────────
  React.useEffect(() => {
    if (!activeFirmId) return;
    const q = buyerQuery.trim();
    if (!q) {
      setBuyerResults([]);
      setBuyerOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setBuyerSearching(true);
        const res = await apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2C_COUNTER", search: q });
        setBuyerResults(res.slice(0, 8));
        // No match → keep the dropdown open so the inline "create buyer" affordance shows
        setBuyerOpen(true);
      } catch (e) {
        if (e instanceof ApiError) toast({ variant: "destructive", title: "Buyer search failed", description: e.message });
      } finally {
        setBuyerSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [buyerQuery, activeFirmId]);

  // ── Product typeahead (debounced) ────────────────────────────
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
      const ex = prev.find((l) => l.product.id === p.id);
      if (ex) return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product: p, qty: 1 }];
    });
    setProdQuery("");
    setProdResults([]);
    setProdOpen(false);
  }

  // ── Totals preview ───────────────────────────────────────────
  const totals = React.useMemo(() => {
    const sellerState = firm?.stateCode ?? "";
    const buyerState = buyer?.stateCode ?? sellerState; // walk-in = home state
    let taxable = 0;
    let savings = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    for (const l of lines) {
      const tp = tierPriceOf(l.product);
      const bp = calculateBulkPricing(tp, l.qty, 0);
      taxable += bp.taxable;
      savings += bp.savings;
      const g = previewGst(bp.taxable, l.product.gstRate, sellerState, buyerState);
      cgst += g.cgst;
      sgst += g.sgst;
      igst += g.igst;
    }
    taxable = round2(taxable);
    cgst = round2(cgst);
    sgst = round2(sgst);
    igst = round2(igst);
    const exact = round2(taxable + cgst + sgst + igst);
    const grand = Math.round(exact);
    return { taxable, savings: round2(savings), cgst, sgst, igst, roundOff: round2(grand - exact), grand, intra: sellerState === buyerState };
  }, [lines, firm, buyer]);

  const todayStats = React.useMemo(() => {
    const list = counterInvoices ?? [];
    const today = toISODate(new Date());
    const todays = list.filter((i) => (i.invoiceDate ?? "").slice(0, 10) === today);
    return { count: todays.length, amount: round2(todays.reduce((s, i) => s + Number(i.grandTotal), 0)) };
  }, [counterInvoices]);

  async function confirmSale() {
    if (!activeFirmId || lines.length === 0) return;
    setSubmitting(true);
    try {
      const inv = await apiPost<Invoice>("/api/v1/invoices", {
        firmId: activeFirmId,
        customerId: buyer?.id || undefined,
        isCounterSale: true,
        walkInName: buyer ? "" : walkInName.trim(),
        walkInPhone: buyer ? "" : walkInPhone.trim(),
        invoiceDate,
        paymentMode,
        lines: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      });
      setLastInvoice(inv);
      setSuccessOpen(true);
      setLines([]);
      setProdQuery("");
      setBuyer(null);
      setBuyerQuery("");
      setWalkInName("");
      setWalkInPhone("");
      toast({ title: `Receipt ${inv.invoiceNumber}`, description: `${formatINR(inv.grandTotal)} · ${paymentMode}` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong while posting the counter sale.";
      const code = e instanceof ApiError ? e.code : "ERR_UNKNOWN";
      toast({ variant: "destructive", title: "Counter sale failed", description: `${msg} (${code})` });
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeFirmId) {
    return <EmptyState icon={Store} title="No active firm" hint="Select a firm from the header switcher to use the counter." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="B2C Counter POS" subtitle="Walk-in & counter billing · Retailer pricing · instant payment only (R14 — no credit)" icon={Store} />

      {/* Today's counter chips */}
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 max-w-md">
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Counter sales today</span>
            <ReceiptText className="h-4 w-4 text-dmk-text-muted" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-text-primary">{todayStats.count}</span>
          <span className="text-[11px] text-dmk-text-muted">receipts</span>
        </div>
        <div className="dmk-kpi p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Amount today</span>
            <Coins className="h-4 w-4 text-dmk-text-muted" />
          </div>
          <span className="font-money text-[20px] font-semibold leading-none text-dmk-success">{formatINR(todayStats.amount)}</span>
          <span className="text-[11px] text-dmk-text-muted">cash + UPI + card</span>
        </div>
      </div>

      <Tabs defaultValue="pos" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="pos" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <ShoppingCart className="h-4 w-4" /> Counter POS
          </TabsTrigger>
          <TabsTrigger value="buyers" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Store className="h-4 w-4" /> Buyers List
          </TabsTrigger>
        </TabsList>

        {/* ══════════ POS TAB ══════════ */}
        <TabsContent value="pos" className="mt-0 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
            <div className="space-y-4 min-w-0">
              {/* Buyer picker */}
              <div className="dmk-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Buyer (optional — walk-in allowed)</span>
                  <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setNewBuyerOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5" /> New Buyer
                  </Button>
                </div>
                {buyer ? (
                  <div className="dmk-well p-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-dmk-text-primary truncate">{buyer.partyName}</p>
                      <p className="text-[11.5px] text-dmk-text-muted font-money">{buyer.phone || "no phone"} · {buyer.visitCount} visits · spent {formatINR(Number(buyer.lifetimeSpend))}</p>
                    </div>
                    <Badge tone="neutral">Retailer</Badge>
                    <button aria-label="Clear buyer" onClick={() => setBuyer(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-dmk-border-subtle text-dmk-text-muted hover:text-dmk-danger hover:border-dmk-danger/40 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <SearchInput value={buyerQuery} onChange={setBuyerQuery} placeholder="Search buyer by name or phone…" className="pl-9" />
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                      {buyerOpen && buyerResults.length > 0 && (
                        <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-64 overflow-y-auto">
                          {buyerResults.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => {
                                setBuyer(c);
                                setBuyerQuery("");
                                setBuyerOpen(false);
                              }}
                              className="w-full text-left px-3 py-2.5 hover:bg-dmk-hover transition-colors border-b border-dmk-border-subtle last:border-b-0"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-medium text-dmk-text-primary truncate">{c.partyName}</span>
                                <span className="font-money text-[11.5px] text-dmk-gold">{formatINR(Number(c.lifetimeSpend))}</span>
                              </div>
                              <div className="text-[11px] text-dmk-text-muted mt-0.5 font-money">{c.phone || "—"} · {c.visitCount} visits</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Search miss → offer to create this buyer on the spot */}
                      {buyerOpen && !buyerSearching && buyerQuery.trim().length > 0 && buyerResults.length === 0 && (
                        <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden">
                          <button
                            onClick={() => {
                              const q = buyerQuery.trim();
                              const isPhone = /^[+\d][\d\s-]{6,}$/.test(q);
                              if (isPhone) setWalkInPhone(q); else setWalkInName(q);
                              setBuyerQuery("");
                              setBuyerOpen(false);
                              toast({ title: "New counter buyer", description: isPhone ? "Phone pre-filled — add the buyer's name, then bill." : "Name pre-filled — add a phone (optional), then bill. The buyer joins the counter list automatically." });
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-dmk-hover transition-colors flex items-center gap-2"
                          >
                            <UserPlus className="h-4 w-4 text-dmk-yellow shrink-0" />
                            <span className="text-[12.5px] text-dmk-text-secondary">
                              No buyer found for <span className="font-semibold text-dmk-text-primary">&ldquo;{buyerQuery.trim()}&rdquo;</span> — create as new counter buyer
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Walk-in name">
                        <Input value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="Anonymous" className={inputCls} />
                      </Field>
                      <Field label="Walk-in phone">
                        <Input value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} placeholder="optional" className={cn(inputCls, "font-money")} />
                      </Field>
                    </div>
                  </>
                )}
              </div>

              {/* Product typeahead */}
              <div className="dmk-card p-4 space-y-3">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Add products (Retailer price)</span>
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
                    placeholder="Type SKU / name, Enter adds first match…"
                    className={cn(inputCls, "h-10 pl-9")}
                    aria-label="Product search"
                  />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                  {prodSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted animate-spin" />}
                  {prodOpen && prodResults.length > 0 && (
                    <div className="absolute z-30 mt-1 w-full dmk-elevated overflow-hidden max-h-72 overflow-y-auto" role="listbox">
                      {prodResults.map((p, i) => (
                        <button
                          key={p.id}
                          role="option"
                          aria-selected={i === prodHi}
                          onMouseEnter={() => setProdHi(i)}
                          onClick={() => addProduct(p)}
                          className={cn("w-full text-left px-3 py-2.5 transition-colors border-b border-dmk-border-subtle last:border-b-0", i === prodHi ? "bg-dmk-hover" : "hover:bg-dmk-hover")}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] text-dmk-text-primary truncate">
                              <span className="font-money text-dmk-text-secondary">{p.sku}</span> · {p.name}
                            </span>
                            <span className="font-money text-[12.5px] text-dmk-gold shrink-0">{formatINR(tierPriceOf(p))}</span>
                          </div>
                          <div className="text-[11px] text-dmk-text-muted mt-0.5">GST {p.gstRate}% · stock {p.stockQuantity}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Cart */}
              <div className="dmk-card overflow-hidden">
                <div className="overflow-x-auto">
                  {lines.length === 0 ? (
                    <EmptyState icon={ShoppingCart} title="Counter cart is empty" hint="Search a product above and press Enter — bulk packaging discounts apply automatically by quantity." />
                  ) : (
                    <table className="dmk-table min-w-[680px]">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th className="text-right">Qty</th>
                          <th className="text-right">Retailer price</th>
                          <th>Pack</th>
                          <th className="text-right">Eff. price</th>
                          <th className="text-right">Taxable</th>
                          <th className="text-right">Saved</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => {
                          const tp = tierPriceOf(l.product);
                          const bp = calculateBulkPricing(tp, l.qty, 0);
                          return (
                            <tr key={l.product.id}>
                              <td className="font-money text-[12px] text-dmk-text-secondary">{l.product.sku}</td>
                              <td className="max-w-[200px]"><p className="truncate text-[13px]">{l.product.name}</p></td>
                              <td className="text-right">
                                <Input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={l.qty}
                                  onChange={(e) => setLines((prev) => prev.map((x) => (x.product.id === l.product.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))}
                                  aria-label={`Quantity for ${l.product.name}`}
                                  className="h-8 w-16 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-money text-right ml-auto dmk-input"
                                />
                              </td>
                              <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(tp)}</td>
                              <td className="text-[11.5px] text-dmk-text-secondary">{bp.discountPct > 0 ? `${formatLabel(bp.format)} · −${bp.discountPct}%` : "Piece"}</td>
                              <td className="num text-[12.5px]">{formatINR(bp.unitPrice)}</td>
                              <td className="num text-[12.5px]">{formatINR(bp.taxable)}</td>
                              <td className="num text-[12px] text-dmk-gold">{bp.savings > 0 ? `−${formatINR(bp.savings)}` : "—"}</td>
                              <td>
                                <button
                                  onClick={() => setLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}
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

            {/* Summary — instant payment only */}
            <div className="lg:sticky lg:top-20 space-y-4">
              <div className="dmk-elevated p-5 space-y-4">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Receipt summary</span>
                <div className="space-y-2">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-dmk-text-secondary">Taxable value</span>
                    <span className="font-money text-dmk-text-primary">{formatINR(totals.taxable)}</span>
                  </div>
                  {totals.savings > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-dmk-text-secondary">Bulk discount</span>
                      <span className="font-money text-dmk-gold">−{formatINR(totals.savings)}</span>
                    </div>
                  )}
                  {totals.intra ? (
                    <>
                      <div className="flex justify-between text-[13px]">
                        <span className="text-dmk-text-secondary">CGST</span>
                        <span className="font-money">{formatINR(totals.cgst)}</span>
                      </div>
                      <div className="flex justify-between text-[13px]">
                        <span className="text-dmk-text-secondary">SGST</span>
                        <span className="font-money">{formatINR(totals.sgst)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-dmk-text-secondary">IGST</span>
                      <span className="font-money">{formatINR(totals.igst)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[12px] text-dmk-text-muted">
                    <span>Round-off</span>
                    <span className="font-money">{totals.roundOff !== 0 ? formatINR(totals.roundOff) : "—"}</span>
                  </div>
                </div>

                <div className="border-t border-dmk-border-medium pt-3 flex items-end justify-between">
                  <span className="text-[12px] uppercase tracking-wider font-semibold text-dmk-text-muted">Pay now</span>
                  <span className="font-money text-[28px] font-bold leading-none text-dmk-yellow">{formatINR(totals.grand)}</span>
                </div>
                <p className="text-[11.5px] italic text-dmk-text-muted">{amountInWords(totals.grand)}</p>

                {/* Payment pills — CASH/UPI/CARD only (R14) */}
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block mb-2">Payment mode</span>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment mode">
                    {PAYMENT_PILLS.map((m) => (
                      <button
                        key={m}
                        role="radio"
                        aria-checked={paymentMode === m}
                        onClick={() => setPaymentMode(m)}
                        className={cn(
                          "h-10 rounded-lg border text-[12.5px] font-semibold transition-colors",
                          paymentMode === m
                            ? "border-dmk-success/50 bg-[rgba(34,197,94,0.12)] text-dmk-success"
                            : "border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full h-11 text-[14px] font-semibold bg-dmk-yellow text-white hover:bg-dmk-yellow/90"
                  onClick={confirmSale}
                  disabled={lines.length === 0 || submitting}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {submitting ? "Posting…" : "Confirm Counter Sale"}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ══════════ BUYERS TAB ══════════ */}
        <TabsContent value="buyers" className="mt-0">
          <BuyersDirectory onNew={() => setNewBuyerOpen(true)} />
        </TabsContent>
      </Tabs>

      {/* Success dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-dmk-success" />
              <DialogTitle className="text-dmk-text-primary">Counter sale complete</DialogTitle>
            </div>
            <DialogDescription className="text-dmk-text-muted">Stock and books updated instantly.</DialogDescription>
          </DialogHeader>
          {lastInvoice && (
            <div className="dmk-well p-4 space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Receipt #</span>
                <span className="font-money text-dmk-text-primary">{lastInvoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Buyer</span>
                <span className="text-dmk-text-secondary">{lastInvoice.customer?.partyName || lastInvoice.walkInName || "Walk-in"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dmk-text-muted">Paid via</span>
                <Badge tone="success">{lastInvoice.paymentMode}</Badge>
              </div>
              <div className="flex justify-between border-t border-dmk-border-subtle pt-2">
                <span className="text-dmk-text-muted">Amount</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(lastInvoice.grandTotal)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={() => setSuccessOpen(false)}>Next sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewBuyerDialog
        open={newBuyerOpen}
        onOpenChange={setNewBuyerOpen}
        onCreated={(c) => {
          setBuyer(c);
          setNewBuyerOpen(false);
          setWalkInName("");
          setWalkInPhone("");
          toast({ title: `Buyer added — ${c.partyName}` });
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Buyers directory (B2C_COUNTER) with invoice history dialog
// ═══════════════════════════════════════════════════════════════
function BuyersDirectory({ onNew }: { onNew: () => void }) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<Customer[] | null>(null);
  const [historyOf, setHistoryOf] = React.useState<Customer | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2C_COUNTER", search: query.trim() });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load buyers", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, activeFirmId]);

  return (
    <div className="dmk-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 border-b border-dmk-border-subtle">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search buyers by name or phone…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={onNew}>
          <UserPlus className="h-4 w-4" /> New Buyer
        </Button>
      </div>
      <div className="overflow-x-auto max-h-[calc(100vh-380px)] overflow-y-auto">
        {rows === null ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState icon={Store} title="No counter buyers yet" hint="Buyers are created at the counter with just a name and phone — no credit, instant payment." />
        ) : (
          <table className="dmk-table min-w-[640px]">
            <thead>
              <tr>
                <th>Buyer name</th>
                <th>Phone</th>
                <th className="text-right">Visits</th>
                <th className="text-right">Lifetime spend</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="text-[13px] font-medium">{c.partyName}</td>
                  <td className="font-money text-[12.5px] text-dmk-text-secondary">{c.phone || "—"}</td>
                  <td className="num text-[12.5px]">{c.visitCount}</td>
                  <td className="num text-[12.5px] text-dmk-gold">{formatINR(Number(c.lifetimeSpend))}</td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setHistoryOf(c)}>
                      History
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BuyerHistoryDialog buyer={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

function BuyerHistoryDialog({ buyer, onClose }: { buyer: Customer | null; onClose: () => void }) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [invoices, setInvoices] = React.useState<Invoice[] | null>(null);

  React.useEffect(() => {
    if (!buyer || !activeFirmId) return;
    let alive = true;
    setInvoices(null);
    apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, customerId: buyer.id })
      .then((res) => alive && setInvoices(res))
      .catch(() => alive && setInvoices([]));
    return () => {
      alive = false;
    };
  }, [buyer, activeFirmId]);

  return (
    <Dialog open={!!buyer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">{buyer?.partyName}</DialogTitle>
          <DialogDescription className="text-dmk-text-muted font-money">{buyer?.phone || "—"} · {buyer?.visitCount ?? 0} visits · lifetime {formatINR(Number(buyer?.lifetimeSpend ?? 0))}</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {invoices === null ? (
            <LoadingRows rows={3} />
          ) : invoices.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No purchases yet" />
          ) : (
            <div className="dmk-well overflow-hidden">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="font-money text-[12px]">{i.invoiceNumber}</td>
                      <td className="text-[12px] text-dmk-text-secondary">{formatDate(i.invoiceDate)}</td>
                      <td><Badge tone="success">{i.paymentMode}</Badge></td>
                      <td className="num text-[12.5px] text-dmk-text-primary">{formatINR(Number(i.grandTotal))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// New buyer dialog — name + phone ONLY (R9/R14: no credit fields)
// ═══════════════════════════════════════════════════════════════
function NewBuyerDialog({
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
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!activeFirmId) return;
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name required", description: "Enter the buyer's name to add them to the counter directory." });
      return;
    }
    setSaving(true);
    try {
      const c = await apiPost<Customer>("/api/v1/customers", {
        firmId: activeFirmId,
        customerType: "B2C_COUNTER",
        firmName: name.trim(),
        phone: phone.trim(),
        city: "",
        stateCode: firm?.stateCode ?? "",
        assignedTier: "tier4Retailer",
        creditLimit: 0,
        creditDays: 0,
      });
      onCreated(c);
      setName("");
      setPhone("");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not create buyer.";
      toast({ variant: "destructive", title: "Create failed", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">New counter buyer</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">Name + phone only — no credit, instant payment (R14).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Buyer name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunita Pawar" className={inputCls} autoFocus />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98…" className={cn(inputCls, "font-money")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add buyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
