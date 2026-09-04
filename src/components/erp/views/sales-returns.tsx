"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — RETURNS / CREDIT NOTES (R4)
// Returned quantity is ALWAYS quarantined to DAMAGED stock and
// never re-enters sellable inventory. Server posts CREDIT_NOTE
// journal + customer ledger credit; client previews money only.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  IndianRupee,
  Loader2,
  PackageX,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import { round2 } from "@/lib/gst";
import type { Customer, Product, Invoice } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  Field,
  inputCls,
  SectionGrid,
  RegisterCard,
  RegisterRow,
  AsideCard,
  MixBar,
  KpiCard,
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
import { Checkbox } from "@/components/ui/checkbox";

interface ReturnItemRow {
  id: string;
  productId: string;
  damagedQty: number;
  unitPrice: number;
  gstRate: number;
  totalAmount: number;
  defectType: string;
  sentToVendorQty?: number; // qty already recovered to the vendor via purchase returns
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
  qty: number; // damaged qty to return — 0 means "not returned"
  defectType: (typeof DEFECTS)[number];
  unitPrice: number;
  invoicedQty?: number | null; // set when the row came from a customer invoice
  fromInvoice?: boolean;
}

type RefundMode = "CREDIT" | "UPI_NEFT" | "CASH";

const REFUND_MODES: Array<{ value: RefundMode; label: string; sub: string }> = [
  { value: "CREDIT", label: "Add to customer credit", sub: "Amount stays as credit in the customer's account" },
  { value: "UPI_NEFT", label: "Pay via UPI/NEFT", sub: "Refund the amount instantly via bank transfer" },
  { value: "CASH", label: "Pay via Cash", sub: "Refund the amount instantly in cash" },
];

// Line shape returned by GET /api/v1/invoices/[id]
interface InvoiceLineLite {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  gstRate: number;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  grandTotal: number;
  lineItems: InvoiceLineLite[];
}

export default function SalesReturnsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const navigate = useErpStore((s) => s.setView);

  const [rows, setRows] = React.useState<ReturnListRow[] | null>(null);
  const [view, setView] = React.useState<ReturnListRow | null>(null);
  const [newOpen, setNewOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);

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

  // ── Masonry summary stats (computed from the loaded rows) ──────
  const list = rows ?? [];
  const totalValue = list.reduce((s, r) => s + Number(r.grandTotal), 0);
  const totalItems = list.reduce((s, r) => s + r.items.length, 0);
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthValue = list.filter((r) => r.returnDate.slice(0, 7) === monthPrefix).reduce((s, r) => s + Number(r.grandTotal), 0);
  const defectCounts = new Map<string, { count: number; value: number }>();
  for (const r of list) {
    for (const it of r.items) {
      const cur = defectCounts.get(it.defectType) ?? { count: 0, value: 0 };
      defectCounts.set(it.defectType, { count: cur.count + it.damagedQty, value: cur.value + Number(it.totalAmount) });
    }
  }
  const defectRows = [...defectCounts.entries()].sort((a, b) => b[1].value - a[1].value);
  const defectTotal = Math.max(1, defectRows.reduce((s, [, v]) => s + v.value, 0));
  const defectToneBar: Record<string, string> = {
    Damaged: "bg-dmk-warning",
    Broken: "bg-dmk-danger",
    Defective: "bg-dmk-info",
    "Wrong Item": "bg-dmk-gold",
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales Returns"
        subtitle="Customer returns → credit notes · goods quarantined to Damaged Stock (R4)"
        icon={RotateCcw}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-dmk-info/40 bg-dmk-info/10 text-dmk-info hover:bg-dmk-info/20 hover:text-dmk-info font-semibold"
              disabled={list.length === 0}
              onClick={() => setSendOpen(true)}
              title="Pick exactly which returned lines to send to vendors — nothing is sent on its own"
            >
              <ArrowRightLeft className="h-4 w-4" /> Send to Purchase Return
            </Button>
            <Button size="sm" className="h-9 bg-dmk-yellow text-white hover:bg-dmk-yellow/90" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> New Return
            </Button>
          </div>
        }
      />

      <SectionGrid
        list={
          <RegisterCard
            title="Credit notes"
            icon={RotateCcw}
            count={list.length}
            countLabel="returns"
            footer={
              <>
                <span><span className="font-money text-dmk-text-secondary">{formatINR(totalValue)}</span> returned value</span>
                <span><span className="font-money text-dmk-warning">{totalItems}</span> items quarantined</span>
                <span className="hidden sm:inline">qty NEVER re-enters sellable stock</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState icon={RotateCcw} title="No returns recorded" hint="Create a return from the button above — a credit note is generated and the customer ledger is credited." />
            ) : (
              list.map((r) => (
                <RegisterRow key={r.id} onClick={() => setView(r)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-money text-[12px] text-dmk-text-primary shrink-0">{r.creditNoteNo}</span>
                      <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(r.returnDate)}</span>
                      {r.invoiceRef && <span className="font-money text-[10.5px] text-dmk-text-muted truncate" title={`Against invoice ${r.invoiceRef}`}>ref {r.invoiceRef}</span>}
                    </div>
                    <Badge tone="warning">CREDIT NOTE</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-dmk-text-secondary truncate">
                      {r.customer?.partyName ?? "—"}
                      <span className="text-dmk-text-muted"> · {r.items.length} item{r.items.length === 1 ? "" : "s"}</span>
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="text-[10.5px] text-dmk-text-muted hidden sm:inline">sub {formatINR(Number(r.subtotal))} · tax {formatINR(Number(r.totalTax))}</span>
                      <span className="font-money text-[13px] font-semibold text-dmk-warning">{formatINR(Number(r.grandTotal))}</span>
                    </span>
                  </div>
                </RegisterRow>
              ))
            )}
          </RegisterCard>
        }
        aside={
          <>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="Credit notes" value={String(list.length)} sub={`${totalItems} line items`} icon={RotateCcw} />
              <KpiCard label="Returned value" value={formatINR(totalValue)} sub={`${formatINR(monthValue)} this month`} icon={IndianRupee} tone="gold" />
              <KpiCard label="Quarantined qty" value={String(totalItems)} sub="sits in Damaged pool" icon={PackageX} tone="gold" />
              <KpiCard label="This month" value={formatINR(monthValue)} sub="credit notes issued" icon={AlertTriangle} tone={monthValue > 0 ? "orange" : "default"} />
            </div>

            <AsideCard
              title="Quarantine policy"
              icon={ShieldAlert}
              iconClass="text-dmk-warning"
              footnote="Returned quantity can only leave the Damaged pool via a purchase return (debit note) to the vendor or a write-off — never via a sale."
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                Every return posts a <span className="font-semibold text-dmk-warning">CREDIT NOTE</span> journal, credits the customer
                ledger, and moves the qty into the product&apos;s <span className="font-semibold">Damaged (quarantine) stock</span> —
                sellable inventory is never touched (R4).
              </p>
            </AsideCard>

            <AsideCard title="Defect mix" icon={PackageX} iconClass="text-dmk-danger" footnote="Grouped by the defect recorded on each returned line.">
              <div className="space-y-2.5">
                {defectRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">No defective qty recorded yet.</p>
                ) : (
                  defectRows.map(([d, v]) => (
                    <MixBar
                      key={d}
                      label={<Badge tone={defectTone(d)}>{d}</Badge>}
                      value={`${v.count} qty · ${formatINR(v.value)}`}
                      pct={(v.value / defectTotal) * 100}
                      barClass={defectToneBar[d] ?? "bg-dmk-yellow"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title="Recover from vendor"
              icon={ArrowRightLeft}
              iconClass="text-dmk-info"
              footnote="Create a debit note in Purchase Returns — damaged stock and vendor payable reduce together."
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                Quarantined goods can be sent back to the supplier. Open{' '}
                <button
                  type="button"
                  onClick={() => navigate("purchase/returns")}
                  className="font-semibold text-dmk-info underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  Purchase Returns
                </button>{' '}
                and raise a debit note against the same products.
              </p>
            </AsideCard>
          </>
        }
      />

      {/* View dialog */}
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
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
                        <th className="text-right">To vendor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((it) => {
                        const sent = Number(it.sentToVendorQty ?? 0);
                        const fully = sent >= Number(it.damagedQty) - 0.001;
                        return (
                          <tr key={it.id}>
                            <td className="font-money text-[11.5px] text-dmk-text-secondary">{it.product?.sku ?? "—"}</td>
                            <td className="max-w-[180px] truncate text-[12.5px]">{it.product?.name ?? "—"}</td>
                            <td className="num text-[12px]">{it.damagedQty}</td>
                            <td><Badge tone={defectTone(it.defectType)}>{it.defectType}</Badge></td>
                            <td className="num text-[12px]">{formatINR(Number(it.unitPrice))}</td>
                            <td className="num text-[12px]">{formatINR(Number(it.totalAmount))}</td>
                            <td className="num text-right">
                              {fully ? (
                                <Badge tone="success">recovered</Badge>
                              ) : (
                                <span className="font-money text-[11.5px] text-dmk-text-muted">{sent} / {it.damagedQty}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center dmk-well px-3 py-2.5">
                <span className="text-[12px] text-dmk-text-muted">Subtotal {formatINR(Number(view.subtotal))} + Tax {formatINR(Number(view.totalTax))} =</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(Number(view.grandTotal))}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewReturnDialog open={newOpen} onOpenChange={setNewOpen} onCreated={() => load()} firmStateCode={firm?.stateCode ?? ""} />

      {/* Selective vendor recovery — only lines NOT yet sent to vendors are
          listed, and the user picks exactly what goes. Nothing is swept
          from leftover damaged-pool stock on its own. */}
      <SendToPurchaseDialog open={sendOpen} onOpenChange={setSendOpen} onSent={() => load()} />
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
  const [invoiceSort, setInvoiceSort] = React.useState<"recent" | "oldest">("recent");
  const [invLoading, setInvLoading] = React.useState(false);
  const [refundMode, setRefundMode] = React.useState<RefundMode>("CREDIT");
  const [returnDate, setReturnDate] = React.useState(toISODate(new Date()));
  const [items, setItems] = React.useState<DraftItem[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Fresh draft every time the dialog opens
  React.useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setInvoiceId("");
    setCustInvoices([]);
    setInvoiceSort("recent");
    setRefundMode("CREDIT");
    setReturnDate(toISODate(new Date()));
    setItems([]);
  }, [open]);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    (async () => {
      try {
        const [c, p] = await Promise.all([
          // B2B ONLY — returns are not collected from B2C counter buyers
          apiGet<Customer[]>("/api/v1/customers", { firmId: activeFirmId, type: "B2B" }),
          apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" }),
        ]);
        if (alive) {
          // Belt-and-braces: even if the API ever widens, keep the picker B2B-only
          setCustomers(c.filter((x) => x.customerType === "B2B"));
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
      setItems([]);
      return;
    }
    let alive = true;
    // customer switched — clear any previously loaded invoice cart
    setInvoiceId("");
    setItems([]);
    apiGet<Invoice[]>("/api/v1/invoices", { firmId: activeFirmId, customerId })
      .then((res) => alive && setCustInvoices(res))
      .catch(() => alive && setCustInvoices([]));
    return () => {
      alive = false;
    };
  }, [customerId, activeFirmId, open]);

  // Recent-first by default, flip with the sort toggle
  const sortedInvoices = React.useMemo(() => {
    const arr = [...custInvoices];
    arr.sort((a, b) => {
      const da = new Date(a.invoiceDate).getTime() || 0;
      const dbb = new Date(b.invoiceDate).getTime() || 0;
      return invoiceSort === "recent" ? dbb - da : da - dbb;
    });
    return arr;
  }, [custInvoices, invoiceSort]);

  // Selecting an invoice auto-loads its products at the INVOICED pricing —
  // every row starts with damaged qty 0 (not returned) until typed in.
  React.useEffect(() => {
    if (!open || !invoiceId) return;
    let alive = true;
    setInvLoading(true);
    apiGet<InvoiceDetail>(`/api/v1/invoices/${invoiceId}`)
      .then((inv) => {
        if (!alive) return;
        setItems(
          (inv.lineItems ?? []).map((l) => ({
            productId: l.productId,
            qty: 0,
            defectType: "Damaged" as DraftItem["defectType"],
            unitPrice: Number(l.unitPrice) || 0,
            invoicedQty: Number(l.quantity) || 0,
            fromInvoice: true,
          })),
        );
      })
      .catch(() => alive && setItems([]))
      .finally(() => alive && setInvLoading(false));
    return () => {
      alive = false;
    };
  }, [invoiceId, open]);

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
      if (!(it.qty > 0)) continue; // rows with damaged qty 0 never reach the return
      const p = products.find((x) => x.id === it.productId);
      const t = round2(Number(it.unitPrice) * it.qty);
      taxable += t;
      const g = previewGst(t, p?.gstRate ?? 0, firmStateCode, customers.find((c) => c.id === customerId)?.stateCode ?? firmStateCode);
      tax += g.cgst + g.sgst + g.igst;
    }
    return { taxable: round2(taxable), tax: round2(tax), grand: round2(round2(taxable) + round2(tax)) };
  }, [items, products, customerId, customers, firmStateCode]);

  const selectedInvoice = custInvoices.find((i) => i.id === invoiceId);
  const returnRows = React.useMemo(() => items.filter((it) => it.qty > 0), [items]);
  const overQtyRows = React.useMemo(
    () => returnRows.filter((it) => it.invoicedQty != null && it.qty > (it.invoicedQty ?? 0)),
    [returnRows],
  );

  async function submit() {
    if (!activeFirmId) return;
    const returnItems = items.filter((it) => it.qty > 0);
    if (returnItems.length === 0) {
      toast({ variant: "destructive", title: "Nothing to return", description: "Set a damaged quantity (at least 1) on the products being returned — rows left at 0 stay out of the return." });
      return;
    }
    const over = returnItems.filter((it) => it.invoicedQty != null && it.qty > (it.invoicedQty ?? 0));
    if (over.length > 0) {
      toast({ variant: "destructive", title: "Quantity exceeds the invoice", description: `${over.length} row(s) exceed the invoiced quantity — reduce the damaged qty on those rows.` });
      return;
    }
    const valid = returnItems.every((it) => it.productId && Number(it.unitPrice) >= 0);
    if (!valid) {
      toast({ variant: "destructive", title: "Invalid rows", description: "Every returned line needs a product and a rate." });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ salesReturn: { creditNoteNo: string; grandTotal: number } | null; refundMode: RefundMode }>("/api/v1/sales-returns", {
        firmId: activeFirmId,
        customerId: customerId || undefined,
        invoiceId: invoiceId || undefined,
        invoiceRef: selectedInvoice?.invoiceNumber ?? "",
        returnDate,
        notes: "",
        refundMode,
        items: returnItems.map((it) => ({ productId: it.productId, damagedQty: it.qty, unitPrice: Number(it.unitPrice), defectType: it.defectType })),
      });
      const settleNote =
        refundMode === "CREDIT"
          ? `${formatINR(res.salesReturn?.grandTotal ?? 0)} credited to the customer's account`
          : refundMode === "UPI_NEFT"
            ? `${formatINR(res.salesReturn?.grandTotal ?? 0)} refund payable via UPI/NEFT`
            : `${formatINR(res.salesReturn?.grandTotal ?? 0)} refund payable in Cash`;
      toast({ title: `Return recorded — ${res.salesReturn?.creditNoteNo ?? "credit note posted"}`, description: `Damaged qty quarantined · ${settleNote}.` });
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
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">New sales return</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            B2B customers only — damaged/broken goods are not collected from B2C counter buyers. Pick a customer invoice to auto-load its products at the invoiced prices, then set the damaged qty per row (0 = not returned).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer (B2B)">
            <Select
              value={customerId}
              onValueChange={(v) => setCustomerId(v)}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder="Select B2B customer" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.partyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              B2B only — no returns from B2C counter buyers.
            </p>
          </Field>
          <Field label="Customer invoices">
            <div className="flex gap-1.5">
              <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!customerId}>
                <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder={customerId ? "Pick an invoice…" : "Pick a customer first"} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {sortedInvoices.length === 0 ? (
                    <SelectItem value="none" disabled>No invoices for this customer</SelectItem>
                  ) : (
                    sortedInvoices.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        <span className="font-money">{i.invoiceNumber}</span> · {formatDate(i.invoiceDate)} · {formatINR(Number(i.grandTotal))}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 shrink-0 border-dmk-border-subtle px-2 text-[11px] text-dmk-text-secondary hover:bg-dmk-hover"
                onClick={() => setInvoiceSort((s) => (s === "recent" ? "oldest" : "recent"))}
                disabled={!customerId || sortedInvoices.length < 2}
                title="Toggle invoice sort order"
              >
                {invoiceSort === "recent" ? "Newest ↓" : "Oldest ↑"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              Recent invoices first — picking one loads its products &amp; prices below.
            </p>
          </Field>
          <Field label="Return date">
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Refund settlement">
            <div className="grid grid-cols-3 gap-1.5">
              {REFUND_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setRefundMode(m.value)}
                  title={`${m.label} — ${m.sub}`}
                  aria-pressed={refundMode === m.value}
                  className={cn(
                    "h-9 rounded-md border px-1 text-[11px] font-medium leading-tight transition-colors",
                    refundMode === m.value
                      ? "border-dmk-yellow bg-dmk-yellow text-white shadow-sm"
                      : "border-dmk-border-medium bg-transparent text-dmk-text-secondary hover:bg-dmk-hover",
                  )}
                >
                  {m.value === "CREDIT" ? "Add to credit" : m.value === "UPI_NEFT" ? "UPI / NEFT" : "Cash"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {REFUND_MODES.find((m) => m.value === refundMode)?.sub}
            </p>
          </Field>
        </div>

        {/* Item rows — auto-loaded from the invoice (damaged qty per row) or manual */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
              {invLoading ? "Loading invoice products…" : selectedInvoice ? `Products from ${selectedInvoice.invoiceNumber} — invoiced prices` : "Returned items"}
            </span>
            {selectedInvoice ? (
              <span className="text-[11px] text-dmk-text-muted">Set damaged qty — rows left at 0 are not returned</span>
            ) : (
              <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={addItem} disabled={products.length === 0}>
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="dmk-well p-4 text-center text-[12px] text-dmk-text-muted">
              {selectedInvoice
                ? "No product lines on this invoice."
                : customerId
                  ? "Pick an invoice above to auto-load its products, or click “Add item”."
                  : "Select a B2B customer to begin."}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {items.map((it, idx) => {
                const p = products.find((x) => x.id === it.productId);
                const lineTaxable = round2(Number(it.unitPrice) * Math.max(0, it.qty));
                const g = p ? previewGst(lineTaxable, p.gstRate, firmStateCode, customers.find((c) => c.id === customerId)?.stateCode ?? firmStateCode) : { cgst: 0, sgst: 0, igst: 0 };
                const over = it.invoicedQty != null && it.qty > (it.invoicedQty ?? 0);
                const inactive = !(it.qty > 0);
                return (
                  <div key={`${it.productId}-${idx}`} className={cn("dmk-well p-2.5 grid grid-cols-12 gap-2 items-center", inactive && "opacity-60")}>
                    <div className="col-span-12 sm:col-span-5">
                      {it.fromInvoice ? (
                        <div>
                          <span className="block text-[12.5px] font-medium leading-tight">
                            <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{p?.sku ?? "—"}</span>
                            {p?.name ?? "Product"}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-dmk-text-muted">
                            Invoiced <span className="font-money">{it.invoicedQty}</span> × <span className="font-money">{formatINR(it.unitPrice)}</span> — invoiced price
                          </span>
                        </div>
                      ) : (
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
                      )}
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      {it.fromInvoice && (
                        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">Damaged qty</label>
                      )}
                      <Input
                        type="number"
                        min={it.fromInvoice ? 0 : 1}
                        step={1}
                        value={it.qty}
                        onChange={(e) => updateItem(idx, { qty: it.fromInvoice ? Math.max(0, Math.floor(Number(e.target.value) || 0)) : Math.max(1, Number(e.target.value) || 1) })}
                        aria-label={it.fromInvoice ? "Damaged quantity" : "Returned quantity"}
                        className={cn(inputCls, "font-money", over && "border-dmk-danger")}
                        placeholder={it.fromInvoice ? "0" : "Qty"}
                      />
                      {over && <span className="mt-0.5 block text-[10px] text-dmk-danger">Max {it.invoicedQty}</span>}
                    </div>
                    <div className="col-span-8 sm:col-span-3">
                      {it.fromInvoice && (
                        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">Defect</label>
                      )}
                      <Select value={it.defectType} onValueChange={(v) => updateItem(idx, { defectType: v as DraftItem["defectType"] })}>
                        <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEFECTS.map((d) => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {it.fromInvoice ? (
                      <div className="col-span-10 sm:col-span-1.5 text-right">
                        <span className="block text-[10px] uppercase tracking-wide text-dmk-text-muted sm:hidden">Line total</span>
                        <span className="font-money text-[12.5px] text-dmk-text-primary">{formatINR(round2(lineTaxable + g.cgst + g.sgst + g.igst))}</span>
                      </div>
                    ) : (
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
                    )}
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
                        {over ? (
                          <span className="text-dmk-danger font-medium">Exceeds invoiced qty ({it.invoicedQty})</span>
                        ) : (
                          <>
                            Taxable <span className="font-money text-dmk-text-secondary">{formatINR(lineTaxable)}</span>
                            {" · "}GST {p?.gstRate ?? 0}% <span className="font-money text-dmk-text-secondary">{formatINR(g.cgst + g.sgst + g.igst)}</span>
                          </>
                        )}
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

        {overQtyRows.length > 0 && (
          <div className="rounded-md border border-dmk-danger/40 bg-dmk-danger/10 px-3 py-2 text-[11.5px] text-dmk-danger">
            {overQtyRows.length} row{overQtyRows.length === 1 ? "" : "s"} exceed the invoiced quantity — reduce the damaged qty before posting.
          </div>
        )}

        <div className="flex items-center justify-between dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-dmk-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Damaged qty quarantined to Damaged Stock
          </div>
          <div className="text-right">
            <span className="text-[11px] text-dmk-text-muted block">
              {refundMode === "CREDIT" ? "Credited to customer account" : refundMode === "UPI_NEFT" ? "Refund via UPI/NEFT" : "Refund in Cash"}
              {" (taxable "}{formatINR(draftTotals.taxable)}{" + tax "}{formatINR(draftTotals.tax)}{")"}
            </span>
            <span className="font-money text-[16px] text-dmk-yellow">{formatINR(draftTotals.grand)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">Cancel</Button>
          <Button onClick={submit} disabled={saving || returnRows.length === 0 || overQtyRows.length > 0} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
            {saving ? "Posting…" : returnRows.length > 0 ? `Create credit note · ${returnRows.length} item${returnRows.length === 1 ? "" : "s"}` : "Create credit note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// Send to Purchase Return — SELECTIVE vendor recovery
// Only sales-return lines not yet sent to vendors are listed, and
// the user ticks exactly which lines go. When everything has
// already been recovered the dialog shows "Nothing pending" and
// the API refuses to create anything — no phantom debit notes.
// ═══════════════════════════════════════════════════════════════

interface SendPreviewLine {
  itemId: string;
  creditNoteNo: string;
  returnDate: string;
  customerName: string | null;
  productId: string;
  sku: string;
  productName: string;
  damagedQty: number;
  sentToVendorQty: number;
  eligibleQty: number;
  sendableQty: number;
  poolQty: number;
  vendorName: string | null;
  unitCost: number;
  estTotal: number;
  poolBlocked: boolean;
}

function SendToPurchaseDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const navigate = useErpStore((s) => s.setView);

  const [loading, setLoading] = React.useState(false);
  const [lines, setLines] = React.useState<SendPreviewLine[] | null>(null);
  const [allRecovered, setAllRecovered] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    setLoading(true);
    apiGet<{ lines: SendPreviewLine[]; allRecovered: boolean }>("/api/v1/sales-returns/send-to-purchase", {
      firmId: activeFirmId,
    })
      .then((res) => {
        if (!alive) return;
        setLines(res.lines);
        setAllRecovered(res.allRecovered);
        // every line that CAN be sent starts ticked — the user still sees and
        // controls exactly what goes before confirming
        setSelected(new Set(res.lines.filter((l) => l.sendableQty > 0).map((l) => l.itemId)));
      })
      .catch((e) => {
        if (!alive) return;
        setLines([]);
        if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load pending lines", description: e.message });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, toast]);

  const list = lines ?? [];
  const chosen = list.filter((l) => selected.has(l.itemId) && l.sendableQty > 0);
  const chosenQty = round2(chosen.reduce((s, l) => s + l.sendableQty, 0));
  const chosenValue = round2(chosen.reduce((s, l) => s + l.estTotal, 0));
  const poolBlockedCount = list.filter((l) => l.poolBlocked && l.sendableQty === 0).length;
  const partialCount = list.filter((l) => l.poolBlocked && l.sendableQty > 0).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (!activeFirmId || chosen.length === 0) return;
    setSending(true);
    try {
      const res = await apiPost<{
        created: Array<{ debitNoteNo: string; vendorName: string | null; items: number; total: number }>;
        totals: { debitNotes: number; items: number; qty: number; value: number };
        message: string;
      }>("/api/v1/sales-returns/send-to-purchase", {
        firmId: activeFirmId,
        itemIds: chosen.map((l) => l.itemId),
      });
      toast({
        title: `${res.totals.debitNotes} debit note${res.totals.debitNotes === 1 ? "" : "s"} created`,
        description: `${res.message} · ${formatINR(res.totals.value)} recovered from vendors.`,
      });
      onOpenChange(false);
      await onSent();
      navigate("purchase/returns");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not send to Purchase Return",
        description: e instanceof ApiError ? e.message : "Something went wrong.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="dmk-elevated max-w-2xl border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
            <ArrowRightLeft className="h-5 w-5 text-dmk-info" /> Send returned products to Purchase Return
          </DialogTitle>
          <DialogDescription className="text-dmk-text-secondary">
            Only sales-return quantities <span className="font-semibold text-dmk-text-primary">not yet sent to vendors</span> are
            listed below. Tick exactly what goes — nothing is sent on its own.
          </DialogDescription>
        </DialogHeader>

        {loading || lines === null ? (
          <div className="space-y-2">
            <LoadingRows rows={4} />
            <p className="text-center text-[11.5px] text-dmk-text-muted">Checking pending sales-return lines…</p>
          </div>
        ) : list.length === 0 ? (
          <div className="dmk-well flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CheckCircle2 className="h-9 w-9 text-dmk-success" />
            <p className="text-[14px] font-semibold text-dmk-text-primary">Nothing pending</p>
            <p className="max-w-sm text-[12px] leading-relaxed text-dmk-text-muted">
              {allRecovered
                ? "Every sales-return quantity has already been sent to vendors — there is nothing left to recover, so no debit note will be created."
                : "No sales returns recorded yet."}{" "}
              A debit note can still be raised manually from the Purchase Returns section.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                Pending lines · {list.length} not yet recovered
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(list.filter((l) => l.sendableQty > 0).map((l) => l.itemId)))}
                  className="text-[11px] font-medium text-dmk-info underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  Select all
                </button>
                <span className="text-dmk-border-medium">·</span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] font-medium text-dmk-text-muted underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {list.map((l) => {
                const sendable = l.sendableQty > 0;
                const checked = selected.has(l.itemId) && sendable;
                return (
                  <label
                    key={l.itemId}
                    className={cn(
                      "dmk-well flex cursor-pointer items-start gap-2.5 rounded-md p-2.5 transition-colors",
                      !sendable && "opacity-55",
                      checked && "ring-1 ring-dmk-info/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!sendable || sending}
                      onCheckedChange={() => toggle(l.itemId)}
                      className="mt-0.5"
                      aria-label={`Select ${l.productName} from ${l.creditNoteNo}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12.5px] font-medium text-dmk-text-primary">
                          <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{l.sku}</span>
                          {l.productName}
                        </span>
                        <span className="font-money shrink-0 text-[12.5px] font-semibold text-dmk-text-primary">
                          {formatINR(l.estTotal)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-dmk-text-muted">
                        <span className="font-money">{l.creditNoteNo}</span>
                        <span>· {formatDate(l.returnDate)}</span>
                        {l.customerName && <span className="truncate">· {l.customerName}</span>}
                        <span>
                          · returned <span className="font-money">{l.damagedQty}</span>
                          {l.sentToVendorQty > 0 && (
                            <>
                              {" "}
                              · already sent <span className="font-money text-dmk-success">{l.sentToVendorQty}</span>
                            </>
                          )}
                        </span>
                        {l.vendorName && <span className="truncate">· vendor {l.vendorName}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {sendable ? (
                          <Badge tone="info">
                            send {l.sendableQty} · {formatINR(l.unitCost)}/unit
                          </Badge>
                        ) : (
                          <Badge tone="warning">damaged stock empty — cannot send</Badge>
                        )}
                        {l.poolBlocked && sendable && (
                          <span className="text-[10px] text-dmk-warning">
                            only {l.sendableQty} of {l.eligibleQty} in damaged stock
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {(poolBlockedCount > 0 || partialCount > 0) && (
              <div className="rounded-md border border-dmk-warning/40 bg-dmk-warning/10 px-3 py-2 text-[11px] leading-relaxed text-dmk-warning">
                {poolBlockedCount > 0 && (
                  <span>
                    {poolBlockedCount} line{poolBlockedCount === 1 ? "" : "s"} cannot be sent — the returned goods are no longer in
                    the damaged pool (already recovered or written off).
                  </span>
                )}
                {poolBlockedCount > 0 && partialCount > 0 && " "}
                {partialCount > 0 && (
                  <span>
                    {partialCount} line{partialCount === 1 ? " is" : "s are"} only partially covered by damaged stock — the send is
                    capped at what is available.
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between dmk-well px-3 py-2.5">
              <span className="text-[11.5px] text-dmk-text-muted">
                {chosen.length === 0
                  ? "No lines selected — nothing will be sent"
                  : `${chosen.length} line${chosen.length === 1 ? "" : "s"} · ${chosenQty} qty → debit notes per vendor`}
              </span>
              <span className="font-money text-[16px] text-dmk-yellow">{formatINR(chosenValue)}</span>
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
          >
            Cancel
          </Button>
          <Button
            onClick={send}
            disabled={sending || loading || chosen.length === 0}
            className="bg-dmk-info text-white hover:bg-dmk-info/90"
            title={list.length === 0 ? "Nothing pending to send" : "Create the debit notes for the ticked lines"}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            {sending
              ? "Sending…"
              : chosen.length === 0
                ? "Send to vendors"
                : `Send ${chosen.length} line${chosen.length === 1 ? "" : "s"} · ${formatINR(chosenValue)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
