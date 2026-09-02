"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — RETURNS / CREDIT NOTES (R4)
// Returned quantity is ALWAYS quarantined to DAMAGED stock and
// never re-enters sellable inventory. Server posts CREDIT_NOTE
// journal + customer ledger credit; client previews money only.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { AlertTriangle, Eye, Plus, RotateCcw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import { round2 } from "@/lib/gst";
import type { Customer, Product, Invoice } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, Field, inputCls } from "@/components/erp/shared";
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

interface ReturnItemRow {
  id: string;
  productId: string;
  damagedQty: number;
  unitPrice: number;
  gstRate: number;
  totalAmount: number;
  defectType: string;
  product?: { id: string; sku: string; name: string } | null;
}

interface ReturnListRow {
  id: string;
  creditNoteNo: string;
  invoiceRef: string;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  customer?: { id: string; partyName: string } | null;
  items: ReturnItemRow[];
}

const DEFECTS = ["Damaged", "Broken", "Defective", "Wrong Item"] as const;

function defectTone(d: string): "danger" | "warning" | "info" | "neutral" {
  switch (d) {
    case "Broken": return "danger";
    case "Damaged": return "warning";
    case "Defective": return "info";
    default: return "neutral";
  }
}

function previewGst(taxable: number, rate: number, seller: string, buyer: string) {
  const intra = seller && buyer && seller === buyer;
  if (intra) return { cgst: round2((taxable * rate) / 200), sgst: round2((taxable * rate) / 200), igst: 0 };
  return { cgst: 0, sgst: 0, igst: round2((taxable * rate) / 100) };
}

interface DraftItem {
  productId: string;
  qty: number;
  defectType: (typeof DEFECTS)[number];
  unitPrice: number;
}

export default function SalesReturnsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();

  const [rows, setRows] = React.useState<ReturnListRow[] | null>(null);
  const [view, setView] = React.useState<ReturnListRow | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    try {
      const res = await apiGet<ReturnListRow[]>("/api/v1/sales-returns", { firmId: activeFirmId });
      setRows(res);
    } catch (e) {
      setRows([]);
      if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load returns", description: e.message });
    }
  }, [activeFirmId, toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!activeFirmId) {
    return <EmptyState icon={RotateCcw} title="No active firm" hint="Select a firm from the header switcher." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Returns"
        subtitle="Customer returns → credit notes · goods quarantined to Damaged Stock (R4)"
        icon={RotateCcw}
        actions={
          <Button size="sm" className="h-9 bg-dmk-orange text-white hover:bg-dmk-orange/90" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New Return
          </Button>
        }
      />

      {/* Quarantine banner */}
      <div className="dmk-well p-3.5 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-dmk-warning shrink-0 mt-0.5" />
        <div>
          <p className="text-[13px] font-semibold text-dmk-warning">Returned items are quarantined to Damaged Stock</p>
          <p className="text-[12px] text-dmk-text-secondary mt-0.5">
            Returned quantity NEVER re-enters sellable inventory — it is added to the product&apos;s damaged pool and can only leave via purchase return (debit note) or write-off.
          </p>
        </div>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState icon={RotateCcw} title="No returns recorded" hint="Create a return from the button above — a credit note is generated and the customer ledger is credited." />
          ) : (
            <table className="dmk-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Credit Note #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Invoice ref</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Subtotal</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-money text-[12.5px] text-dmk-text-primary">{r.creditNoteNo}</td>
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.returnDate)}</td>
                    <td className="max-w-[220px] truncate text-[13px]">{r.customer?.partyName ?? "—"}</td>
                    <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.invoiceRef || "—"}</td>
                    <td className="num text-[12.5px]">{r.items.length}</td>
                    <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.subtotal))}</td>
                    <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.totalTax))}</td>
                    <td className="num text-[13px] font-semibold">{formatINR(Number(r.grandTotal))}</td>
                    <td className="text-right">
                      <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setView(r)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* View dialog */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="sm:max-w-xl dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{view?.creditNoteNo}</span>
              <Badge tone="warning">CREDIT NOTE</Badge>
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {view ? `${formatDate(view.returnDate)} · ${view.customer?.partyName ?? "—"}${view.invoiceRef ? ` · ref ${view.invoiceRef}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-3">
              <div className="dmk-well overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Product</th>
                        <th className="text-right">Qty</th>
                        <th>Defect</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((it) => (
                        <tr key={it.id}>
                          <td className="font-money text-[11.5px] text-dmk-text-secondary">{it.product?.sku ?? "—"}</td>
                          <td className="max-w-[180px] truncate text-[12.5px]">{it.product?.name ?? "—"}</td>
                          <td className="num text-[12px]">{it.damagedQty}</td>
                          <td><Badge tone={defectTone(it.defectType)}>{it.defectType}</Badge></td>
                          <td className="num text-[12px]">{formatINR(Number(it.unitPrice))}</td>
                          <td className="num text-[12px]">{formatINR(Number(it.totalAmount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center dmk-well px-3 py-2.5">
                <span className="text-[12px] text-dmk-text-muted">Subtotal {formatINR(Number(view.subtotal))} + Tax {formatINR(Number(view.totalTax))} =</span>
                <span className="font-money text-[16px] text-dmk-orange">{formatINR(Number(view.grandTotal))}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewReturnDialog open={newOpen} onOpenChange={setNewOpen} onCreated={() => load()} firmStateCode={firm?.stateCode ?? ""} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// New return dialog
// ═══════════════════════════════════════════════════════════════
function NewReturnDialog({
  open,
  onOpenChange,
  onCreated,
  firmStateCode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  firmStateCode: string;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [customerId, setCustomerId] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");
  const [custInvoices, setCustInvoices] = React.useState<Invoice[]>([]);
  const [returnDate, setReturnDate] = React.useState(toISODate(new Date()));
  const [items, setItems] = React.useState<DraftItem[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId }),
          apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" }),
        ]);
        if (alive) {
          setCustomers(c);
          setProducts(Array.isArray(p) ? p : (p.products ?? []));
        }
      } catch (e) {
        if (alive && e instanceof ApiError) toast({ variant: "destructive", title: "Could not load data", description: e.message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, activeFirmId]);

  // Load the selected customer's invoices for the reference picker
  React.useEffect(() => {
    if (!open || !activeFirmId || !customerId) {
      setCustInvoices([]);
      setInvoiceId("");
      return;
    }
    let alive = true;
    apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, customerId })
      .then((res) => alive && setCustInvoices(res))
      .catch(() => alive && setCustInvoices([]));
    return () => {
      alive = false;
    };
  }, [customerId, activeFirmId, open]);

  function addItem() {
    if (products.length === 0) return;
    const p = products[0];
    setItems((prev) => [...prev, { productId: p.id, qty: 1, defectType: "Damaged", unitPrice: Number(p.tier4Retailer) || 0 }]);
  }

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const draftTotals = React.useMemo(() => {
    let taxable = 0;
    let tax = 0;
    for (const it of items) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) continue;
      const t = round2(Number(it.unitPrice) * it.qty);
      taxable += t;
      const g = previewGst(t, p.gstRate, firmStateCode, customers.find((c) => c.id === customerId)?.stateCode ?? firmStateCode);
      tax += g.cgst + g.sgst + g.igst;
    }
    return { taxable: round2(taxable), tax: round2(tax), grand: round2(round2(taxable) + round2(tax)) };
  }, [items, products, customerId, customers, firmStateCode]);

  const selectedInvoice = custInvoices.find((i) => i.id === invoiceId);

  async function submit() {
    if (!activeFirmId) return;
    if (items.length === 0) {
      toast({ variant: "destructive", title: "No items", description: "Add at least one returned product." });
      return;
    }
    const valid = items.every((it) => it.productId && it.qty > 0 && Number(it.unitPrice) >= 0);
    if (!valid) {
      toast({ variant: "destructive", title: "Invalid rows", description: "Every line needs a product, positive qty and a rate." });
      return;
    }
    setSaving(true);
    try {
      await apiPost("/api/v1/sales-returns", {
        firmId: activeFirmId,
        customerId: customerId || undefined,
        invoiceId: invoiceId || undefined,
        invoiceRef: selectedInvoice?.invoiceNumber ?? "",
        returnDate,
        notes: "",
        items: items.map((it) => ({ productId: it.productId, damagedQty: it.qty, unitPrice: Number(it.unitPrice), defectType: it.defectType })),
      });
      toast({ title: "Return recorded", description: "Credit note posted — qty moved to Damaged Stock." });
      setItems([]);
      setCustomerId("");
      setInvoiceId("");
      onCreated();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not record return.";
      toast({ variant: "destructive", title: "Return failed", description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">New sales return</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Returned qty is quarantined to Damaged Stock — never sellable again. Credit note reduces the customer receivable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer">
            <Select
              value={customerId}
              onValueChange={(v) => setCustomerId(v)}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.partyName} {c.customerType === "B2C_COUNTER" ? "(counter)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Invoice reference (optional)">
            <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!customerId}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder={customerId ? "Select invoice" : "Pick a customer first"} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {custInvoices.length === 0 ? (
                  <SelectItem value="none" disabled>No invoices for this customer</SelectItem>
                ) : (
                  custInvoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="font-money">{i.invoiceNumber}</span> · {formatDate(i.invoiceDate)} · {formatINR(Number(i.grandTotal))}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Return date">
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Item rows */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Returned items</span>
            <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={addItem} disabled={products.length === 0}>
              <Plus className="h-3.5 w-3.5" /> Add item
            </Button>
          </div>
          {items.length === 0 ? (
            <div className="dmk-well p-4 text-center text-[12px] text-dmk-text-muted">No item rows — click “Add item”.</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {items.map((it, idx) => {
                const p = products.find((x) => x.id === it.productId);
                const lineTaxable = round2(Number(it.unitPrice) * it.qty);
                const g = p ? previewGst(lineTaxable, p.gstRate, firmStateCode, customers.find((c) => c.id === customerId)?.stateCode ?? firmStateCode) : { cgst: 0, sgst: 0, igst: 0 };
                return (
                  <div key={idx} className="dmk-well p-2.5 grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-12 sm:col-span-5">
                      <Select
                        value={it.productId}
                        onValueChange={(v) => {
                          const np = products.find((x) => x.id === v);
                          updateItem(idx, { productId: v, unitPrice: np ? Number(np.tier4Retailer) || 0 : it.unitPrice });
                        }}
                      >
                        <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-64">
                          {products.map((pr) => (
                            <SelectItem key={pr.id} value={pr.id}>
                              <span className="font-money">{pr.sku}</span> · {pr.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={it.qty}
                        onChange={(e) => updateItem(idx, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="Returned quantity"
                        className={cn(inputCls, "font-money")}
                        placeholder="Qty"
                      />
                    </div>
                    <div className="col-span-8 sm:col-span-3">
                      <Select value={it.defectType} onValueChange={(v) => updateItem(idx, { defectType: v as DraftItem["defectType"] })}>
                        <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEFECTS.map((d) => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-10 sm:col-span-1.5">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={it.unitPrice}
                        onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                        aria-label="Unit price"
                        className={cn(inputCls, "font-money")}
                        placeholder="₹"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-0.5 flex justify-end">
                      <button
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove item"
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="col-span-12 flex items-center justify-between text-[11px] text-dmk-text-muted px-1">
                      <span>
                        Taxable <span className="font-money text-dmk-text-secondary">{formatINR(lineTaxable)}</span>
                        {" · "}GST {p?.gstRate ?? 0}% <span className="font-money text-dmk-text-secondary">{formatINR(g.cgst + g.sgst + g.igst)}</span>
                      </span>
                      <span>
                        Line total <span className="font-money text-dmk-text-primary">{formatINR(round2(lineTaxable + g.cgst + g.sgst + g.igst))}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-dmk-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Qty quarantined to Damaged Stock
          </div>
          <div className="text-right">
            <span className="text-[11px] text-dmk-text-muted block">Preview total (taxable {formatINR(draftTotals.taxable)} + tax {formatINR(draftTotals.tax)})</span>
            <span className="font-money text-[16px] text-dmk-orange">{formatINR(draftTotals.grand)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving || items.length === 0} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">
            {saving ? "Posting…" : "Create credit note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
