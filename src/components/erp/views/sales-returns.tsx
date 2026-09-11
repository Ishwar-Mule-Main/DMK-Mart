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
  X,
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
import { useT, type TFn } from "@/lib/i18n";
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

/** Translated defect label — stored value stays the canonical code. */
function defectLabel(t: TFn, d: string): string {
  switch (d) {
    case "Damaged": return t("sret.dfnDamaged");
    case "Broken": return t("sret.dfnBroken");
    case "Defective": return t("sret.dfnDefective");
    case "Wrong Item": return t("sret.dfnWrong");
    default: return d;
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

const REFUND_MODES: RefundMode[] = ["CREDIT", "UPI_NEFT", "CASH"];

/** Translated refund-settlement copy (label + sub) for a refund mode. */
function refundModeCopy(t: TFn, mode: RefundMode): { label: string; sub: string } {
  switch (mode) {
    case "CREDIT": return { label: t("sret.refundCredit"), sub: t("sret.refundCreditSub") };
    case "UPI_NEFT": return { label: t("sret.refundBank"), sub: t("sret.refundBankSub") };
    default: return { label: t("sret.refundCash"), sub: t("sret.refundCashSub") };
  }
}

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
  const { t } = useT();
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
      if (e instanceof ApiError) toast({ variant: "destructive", title: t("sret.errLoadReturns"), description: e.message });
    }
  }, [activeFirmId, toast, t]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!activeFirmId) {
    return <EmptyState icon={RotateCcw} title={t("sale.noFirm")} hint={t("sale.noFirmHint")} />;
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
        title={t("nav.salesReturns")}
        subtitle={t("sret.subtitle")}
        icon={RotateCcw}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-dmk-info/40 bg-dmk-info/10 text-dmk-info hover:bg-dmk-info/20 hover:text-dmk-info font-semibold"
              disabled={list.length === 0}
              onClick={() => setSendOpen(true)}
              title={t("sret.sendTooltip")}
            >
              <ArrowRightLeft className="h-4 w-4" /> {t("sret.sendToPurchase")}
            </Button>
            <Button
              size="sm"
              aria-expanded={newOpen}
              className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
              onClick={() => setNewOpen((o) => !o)}
            >
              {newOpen ? (
                <>
                  <X className="h-4 w-4" /> {t("sret.closeForm")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> {t("sret.newReturn")}
                </>
              )}
            </Button>
          </div>
        }
      />

      {/* New return — inline container (no popup) */}
      {newOpen && (
        <NewReturnPanel
          onClose={() => setNewOpen(false)}
          onCreated={() => load()}
          firmStateCode={firm?.stateCode ?? ""}
        />
      )}

      <SectionGrid
        list={
          <RegisterCard
            title={t("sret.creditNotes")}
            icon={RotateCcw}
            count={list.length}
            countLabel={t("sret.returns")}
            footer={
              <>
                <span>{t("sret.returnedValue", { amt: formatINR(totalValue) })}</span>
                <span>{t("sret.itemsQuarantined", { n: totalItems })}</span>
                <span className="hidden sm:inline">{t("sret.neverSellable")}</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState icon={RotateCcw} title={t("sret.empty")} hint={t("sret.emptyHint")} />
            ) : (
              list.map((r) => (
                <RegisterRow key={r.id} onClick={() => setView(r)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-money text-[12px] text-dmk-text-primary shrink-0">{r.creditNoteNo}</span>
                      <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(r.returnDate)}</span>
                      {r.invoiceRef && <span className="font-money text-[10.5px] text-dmk-text-muted truncate" title={t("sret.againstInvoice", { no: r.invoiceRef })}>{t("sale.refShort", { no: r.invoiceRef })}</span>}
                    </div>
                    <Badge tone="warning">{t("sale.creditNote")}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-dmk-text-secondary truncate">
                      {r.customer?.partyName ?? "—"}
                      <span className="text-dmk-text-muted"> · {t("sret.itemCount", { n: r.items.length })}</span>
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="text-[10.5px] text-dmk-text-muted hidden sm:inline">{t("sret.subTax", { sub: formatINR(Number(r.subtotal)), tax: formatINR(Number(r.totalTax)) })}</span>
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
              <KpiCard label={t("sret.creditNotes")} value={String(list.length)} sub={t("sret.kpiLineItems", { n: totalItems })} icon={RotateCcw} />
              <KpiCard label={t("sret.kpiReturnedValue")} value={formatINR(totalValue)} sub={t("sret.kpiThisMonthSub", { amt: formatINR(monthValue) })} icon={IndianRupee} tone="gold" />
              <KpiCard label={t("sret.kpiQuarantined")} value={String(totalItems)} sub={t("sret.kpiQuarantinedSub")} icon={PackageX} tone="gold" />
              <KpiCard label={t("cmn.thisMonth")} value={formatINR(monthValue)} sub={t("sret.kpiIssued")} icon={AlertTriangle} tone={monthValue > 0 ? "orange" : "default"} />
            </div>

            <AsideCard
              title={t("sret.policyTitle")}
              icon={ShieldAlert}
              iconClass="text-dmk-warning"
              footnote={t("sret.policyFoot")}
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                {t("sret.policyBody")}
              </p>
            </AsideCard>

            <AsideCard title={t("sret.defectMix")} icon={PackageX} iconClass="text-dmk-danger" footnote={t("sret.defectFoot")}>
              <div className="space-y-2.5">
                {defectRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("sret.noDefects")}</p>
                ) : (
                  defectRows.map(([d, v]) => (
                    <MixBar
                      key={d}
                      label={<Badge tone={defectTone(d)}>{defectLabel(t, d)}</Badge>}
                      value={t("sret.qtyValue", { n: v.count, amt: formatINR(v.value) })}
                      pct={(v.value / defectTotal) * 100}
                      barClass={defectToneBar[d] ?? "bg-dmk-yellow"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title={t("sret.recoverTitle")}
              icon={ArrowRightLeft}
              iconClass="text-dmk-info"
              footnote={t("sret.recoverFoot")}
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                {t("sret.recoverBody1")}{" "}
                <button
                  type="button"
                  onClick={() => navigate("purchase/returns")}
                  className="font-semibold text-dmk-info underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  {t("sret.purchaseReturnsLink")}
                </button>{" "}
                {t("sret.recoverBody2")}
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
              <Badge tone="warning">{t("sale.creditNote")}</Badge>
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {view ? `${formatDate(view.returnDate)} · ${view.customer?.partyName ?? "—"}${view.invoiceRef ? ` · ${t("sale.refShort", { no: view.invoiceRef })}` : ""}` : ""}
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
                        <th>{t("cmn.product")}</th>
                        <th className="text-right">{t("sale.qty")}</th>
                        <th>{t("sret.colDefect")}</th>
                        <th className="text-right">{t("cmn.rate")}</th>
                        <th className="text-right">{t("cmn.amount")}</th>
                        <th className="text-right">{t("sret.colToVendor")}</th>
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
                            <td><Badge tone={defectTone(it.defectType)}>{defectLabel(t, it.defectType)}</Badge></td>
                            <td className="num text-[12px]">{formatINR(Number(it.unitPrice))}</td>
                            <td className="num text-[12px]">{formatINR(Number(it.totalAmount))}</td>
                            <td className="num text-right">
                              {fully ? (
                                <Badge tone="success">{t("sret.recovered")}</Badge>
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
                <span className="text-[12px] text-dmk-text-muted">{t("sret.viewSubtotal", { sub: formatINR(Number(view.subtotal)), tax: formatINR(Number(view.totalTax)) })}</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(Number(view.grandTotal))}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">{t("cmn.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selective vendor recovery — only lines NOT yet sent to vendors are
          listed, and the user picks exactly what goes. Nothing is swept
          from leftover damaged-pool stock on its own. */}
      <SendToPurchaseDialog open={sendOpen} onOpenChange={setSendOpen} onSent={() => load()} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// New return — INLINE CONTAINER (rendered in the page, not a popup)
// ═══════════════════════════════════════════════════════════════
function NewReturnPanel({
  onClose,
  onCreated,
  firmStateCode,
}: {
  onClose: () => void;
  onCreated: () => void;
  firmStateCode: string;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [customerId, setCustomerId] = React.useState("");
  const [invoiceId, setInvoiceId] = React.useState("");
  const [custInvoices, setCustInvoices] = React.useState<Invoice[]>([]);
  const [invLoading, setInvLoading] = React.useState(false);
  const [refundMode, setRefundMode] = React.useState<RefundMode>("CREDIT");
  const [returnDate, setReturnDate] = React.useState(toISODate(new Date()));
  const [items, setItems] = React.useState<DraftItem[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Inline container: a fresh draft on every mount (rendered when open)
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  React.useEffect(() => {
    if (!activeFirmId) return;
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
        if (alive && e instanceof ApiError) toast({ variant: "destructive", title: t("sret.errLoadData"), description: e.message });
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, t]);

  // Load the selected customer's invoices for the reference picker
  React.useEffect(() => {
    if (!activeFirmId || !customerId) {
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
  }, [customerId, activeFirmId]);

  // Newest invoices first — automatic, no toggle (new returns usually
  // reference the most recent invoices)
  const sortedInvoices = React.useMemo(() => {
    const arr = [...custInvoices];
    arr.sort((a, b) => {
      const da = new Date(a.invoiceDate).getTime() || 0;
      const dbb = new Date(b.invoiceDate).getTime() || 0;
      if (dbb !== da) return dbb - da; // newest first, then most recently created first
      return (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0);
    });
    return arr;
  }, [custInvoices]);

  // Selecting an invoice auto-loads its products at the INVOICED pricing —
  // every row starts with damaged qty 0 (not returned) until typed in.
  React.useEffect(() => {
    if (!invoiceId) return;
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
  }, [invoiceId]);

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
      toast({ variant: "destructive", title: t("sret.errNothing"), description: t("sret.errNothingDesc") });
      return;
    }
    const over = returnItems.filter((it) => it.invoicedQty != null && it.qty > (it.invoicedQty ?? 0));
    if (over.length > 0) {
      toast({ variant: "destructive", title: t("sret.errOverQty"), description: t("sret.errOverQtyDesc", { n: over.length }) });
      return;
    }
    const valid = returnItems.every((it) => it.productId && Number(it.unitPrice) >= 0);
    if (!valid) {
      toast({ variant: "destructive", title: t("sret.errInvalid"), description: t("sret.errInvalidDesc") });
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
          ? t("sret.noteCreditAmt", { amt: formatINR(res.salesReturn?.grandTotal ?? 0) })
          : refundMode === "UPI_NEFT"
            ? t("sret.noteBankAmt", { amt: formatINR(res.salesReturn?.grandTotal ?? 0) })
            : t("sret.noteCashAmt", { amt: formatINR(res.salesReturn?.grandTotal ?? 0) });
      toast({ title: t("sret.toastRecorded", { no: res.salesReturn?.creditNoteNo ?? t("sret.phCreditNotePosted") }), description: t("sret.toastRecordedDesc", { note: settleNote }) });
      setItems([]);
      setCustomerId("");
      setInvoiceId("");
      onCreated();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("sret.errRecordReturn");
      toast({ variant: "destructive", title: t("sret.errReturnFailed"), description: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={t("sret.formAria")}
      className="dmk-card relative overflow-hidden dmk-enter"
    >
      {/* Accent strip */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-dmk-yellow via-dmk-warning/50 to-transparent" />

      <div className="p-4 sm:p-5 space-y-4">
        {/* Panel header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 rounded-lg bg-dmk-warning/12 border border-dmk-warning/30 flex items-center justify-center shrink-0">
              <RotateCcw className="h-4 w-4 text-dmk-warning" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("sret.formTitle")}</h2>
              <p className="text-[11.5px] text-dmk-text-muted leading-snug">
                {t("sret.formDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("sret.closeFormAria")}
            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label={t("sret.fCustomer")}>
            <Select
              value={customerId}
              onValueChange={(v) => setCustomerId(v)}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder={t("sret.phSelectCust")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.partyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {t("sret.b2bOnly")}
            </p>
          </Field>
          <Field label={t("sret.fInvoices")}>
            <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!customerId}>
              <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue placeholder={customerId ? t("sret.phPickInvoice") : t("sret.phPickCustFirst")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {sortedInvoices.length === 0 ? (
                  <SelectItem value="none" disabled>{t("sret.noInvoices")}</SelectItem>
                ) : (
                  sortedInvoices.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="font-money">{i.invoiceNumber}</span> · {formatDate(i.invoiceDate)} · {formatINR(Number(i.grandTotal))}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {t("sret.invoicesHint")}
            </p>
          </Field>
          <Field label={t("sret.fReturnDate")}>
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label={t("sret.fRefund")}>
            <div className="grid grid-cols-3 gap-1.5">
              {REFUND_MODES.map((m) => {
                const copy = refundModeCopy(t, m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRefundMode(m)}
                    title={`${copy.label} — ${copy.sub}`}
                    aria-pressed={refundMode === m}
                    className={cn(
                      "h-9 rounded-md border px-1 text-[11px] font-medium leading-tight transition-colors",
                      refundMode === m
                        ? "border-dmk-yellow bg-dmk-yellow text-[#0A0F1D] shadow-sm"
                        : "border-dmk-border-medium bg-transparent text-dmk-text-secondary hover:bg-dmk-hover",
                    )}
                  >
                    {m === "CREDIT" ? t("sret.refundCreditBtn") : m === "UPI_NEFT" ? t("sret.refundBankBtn") : t("sret.refundCashBtn")}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {refundModeCopy(t, refundMode).sub}
            </p>
          </Field>
        </div>

        {/* Item rows — auto-loaded from the invoice (damaged qty per row) or manual */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
              {invLoading ? t("sret.loadingInvoice") : selectedInvoice ? t("sret.productsFrom", { no: selectedInvoice.invoiceNumber }) : t("sret.returnedItems")}
            </span>
            {selectedInvoice ? (
              <span className="text-[11px] text-dmk-text-muted">{t("sret.setQtyHint")}</span>
            ) : (
              <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={addItem} disabled={products.length === 0}>
                <Plus className="h-3.5 w-3.5" /> {t("sret.addItem")}
              </Button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="dmk-well p-4 text-center text-[12px] text-dmk-text-muted">
              {selectedInvoice
                ? t("sret.emptyNoLines")
                : customerId
                  ? t("sret.emptyPickInvoice")
                  : t("sret.emptySelectCust")}
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
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
                            {p?.name ?? t("cmn.product")}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-dmk-text-muted">
                            {t("sret.invoiced", { qty: it.invoicedQty ?? 0, price: formatINR(it.unitPrice) })}
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
                        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">{t("sret.damagedQty")}</label>
                      )}
                      <Input
                        type="number"
                        min={it.fromInvoice ? 0 : 1}
                        step={1}
                        value={it.qty}
                        onChange={(e) => updateItem(idx, { qty: it.fromInvoice ? Math.max(0, Math.floor(Number(e.target.value) || 0)) : Math.max(1, Number(e.target.value) || 1) })}
                        aria-label={it.fromInvoice ? t("sret.damagedQtyAria") : t("sret.returnedQtyAria")}
                        className={cn(inputCls, "font-money", over && "border-dmk-danger")}
                        placeholder={it.fromInvoice ? "0" : t("sret.phQty")}
                      />
                      {over && <span className="mt-0.5 block text-[10px] text-dmk-danger">{t("sret.maxQty", { n: it.invoicedQty ?? 0 })}</span>}
                    </div>
                    <div className="col-span-8 sm:col-span-3">
                      {it.fromInvoice && (
                        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">{t("sret.colDefect")}</label>
                      )}
                      <Select value={it.defectType} onValueChange={(v) => updateItem(idx, { defectType: v as DraftItem["defectType"] })}>
                        <SelectTrigger className={cn(inputCls, "w-full")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEFECTS.map((d) => (
                            <SelectItem key={d} value={d}>{defectLabel(t, d)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {it.fromInvoice ? (
                      <div className="col-span-10 sm:col-span-1.5 text-right">
                        <span className="block text-[10px] uppercase tracking-wide text-dmk-text-muted sm:hidden">{t("sret.lineTotalMobile")}</span>
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
                          aria-label={t("sret.unitPriceAria")}
                          className={cn(inputCls, "font-money")}
                          placeholder="₹"
                        />
                      </div>
                    )}
                    <div className="col-span-2 sm:col-span-0.5 flex justify-end">
                      <button
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label={t("sret.removeAria")}
                        className="h-8 w-8 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="col-span-12 flex items-center justify-between text-[11px] text-dmk-text-muted px-1">
                      <span>
                        {over ? (
                          <span className="text-dmk-danger font-medium">{t("sret.exceeds", { n: it.invoicedQty ?? 0 })}</span>
                        ) : (
                          t("sret.taxableGst", { taxable: formatINR(lineTaxable), rate: p?.gstRate ?? 0, tax: formatINR(g.cgst + g.sgst + g.igst) })
                        )}
                      </span>
                      <span>
                        {t("sret.lineTotal", { amt: formatINR(round2(lineTaxable + g.cgst + g.sgst + g.igst)) })}
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
            {t("sret.overWarn", { n: overQtyRows.length })}
          </div>
        )}

        <div className="flex items-center justify-between dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-dmk-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> {t("sret.quarantineWarn")}
          </div>
          <div className="text-right">
            <span className="text-[11px] text-dmk-text-muted block">
              {refundMode === "CREDIT" ? t("sret.settleCredit") : refundMode === "UPI_NEFT" ? t("sret.settleBank") : t("sret.settleCash")}
              {t("sret.settleDetail", { t: formatINR(draftTotals.taxable), x: formatINR(draftTotals.tax) })}
            </span>
            <span className="font-money text-[16px] text-dmk-yellow">{formatINR(draftTotals.grand)}</span>
          </div>
        </div>

        {/* Panel footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-dmk-border-subtle pt-3">
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">{t("cmn.cancel")}</Button>
          <Button onClick={submit} disabled={saving || returnRows.length === 0 || overQtyRows.length > 0} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving ? t("sret.posting") : returnRows.length > 0 ? t("sret.createCnItems", { n: returnRows.length }) : t("sret.createCn")}
          </Button>
        </div>
      </div>
    </div>
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
  const { t } = useT();
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
        if (e instanceof ApiError) toast({ variant: "destructive", title: t("sret.errLoadPending"), description: e.message });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, toast, t]);

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
        title: t("sret.toastCreated", { n: res.totals.debitNotes }),
        description: t("sret.toastCreatedDesc", { msg: res.message, amt: formatINR(res.totals.value) }),
      });
      onOpenChange(false);
      await onSent();
      navigate("purchase/returns");
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("sret.errSend"),
        description: e instanceof ApiError ? e.message : t("sret.errSendGeneric"),
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
            <ArrowRightLeft className="h-5 w-5 text-dmk-info" /> {t("sret.sendTitle")}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-secondary">
            {t("sret.sendDesc")}
          </DialogDescription>
        </DialogHeader>

        {loading || lines === null ? (
          <div className="space-y-2">
            <LoadingRows rows={4} />
            <p className="text-center text-[11.5px] text-dmk-text-muted">{t("sret.checking")}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="dmk-well flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CheckCircle2 className="h-9 w-9 text-dmk-success" />
            <p className="text-[14px] font-semibold text-dmk-text-primary">{t("sret.nothingPending")}</p>
            <p className="max-w-sm text-[12px] leading-relaxed text-dmk-text-muted">
              {allRecovered ? t("sret.allRecovered") : t("sret.noReturns")}{" "}
              {t("sret.manualNote")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                {t("sret.pendingLines", { n: list.length })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set(list.filter((l) => l.sendableQty > 0).map((l) => l.itemId)))}
                  className="text-[11px] font-medium text-dmk-info underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  {t("sret.selectAll")}
                </button>
                <span className="text-dmk-border-medium">·</span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[11px] font-medium text-dmk-text-muted underline underline-offset-2 hover:text-dmk-text-primary"
                >
                  {t("sret.clear")}
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
                      aria-label={t("sret.selectAria", { prod: l.productName, no: l.creditNoteNo })}
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
                          · {t("sret.returned", { n: l.damagedQty })}
                          {l.sentToVendorQty > 0 && (
                            <>
                              {" "}
                              · {t("sret.alreadySent", { n: l.sentToVendorQty })}
                            </>
                          )}
                        </span>
                        {l.vendorName && <span className="truncate">· {t("sret.vendorLbl", { name: l.vendorName })}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {sendable ? (
                          <Badge tone="info">
                            {t("sret.sendBadge", { qty: l.sendableQty, price: formatINR(l.unitCost) })}
                          </Badge>
                        ) : (
                          <Badge tone="warning">{t("sret.poolEmpty")}</Badge>
                        )}
                        {l.poolBlocked && sendable && (
                          <span className="text-[10px] text-dmk-warning">
                            {t("sret.partial", { a: l.sendableQty, b: l.eligibleQty })}
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
                    {t("sret.blockedWarn", { n: poolBlockedCount })}
                  </span>
                )}
                {poolBlockedCount > 0 && partialCount > 0 && " "}
                {partialCount > 0 && (
                  <span>
                    {t("sret.partialWarn", { n: partialCount })}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between dmk-well px-3 py-2.5">
              <span className="text-[11.5px] text-dmk-text-muted">
                {chosen.length === 0
                  ? t("sret.noneSelected")
                  : t("sret.selectedSummary", { n: chosen.length, qty: chosenQty })}
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
            {t("cmn.cancel")}
          </Button>
          <Button
            onClick={send}
            disabled={sending || loading || chosen.length === 0}
            className="bg-dmk-info text-white hover:bg-dmk-info/90"
            title={list.length === 0 ? t("sret.tooltipNothing") : t("sret.tooltipCreate")}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            {sending
              ? t("sret.sending")
              : chosen.length === 0
                ? t("sret.sendBtn")
                : t("sret.sendN", { n: chosen.length, amt: formatINR(chosenValue) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
