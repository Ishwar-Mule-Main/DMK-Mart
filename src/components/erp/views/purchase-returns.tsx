"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — RETURNS (Debit Notes, R5)
// Damaged stock ↓ (quarantine pool), vendor payable ↓,
// Input Tax Credit reversed. DEBIT_NOTE journal (R6/R7).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  AlertTriangle,
  FileWarning,
  IndianRupee,
  Loader2,
  PackageX,
  Plus,
  RotateCcw,
  Trash2,
  Truck,
  Undo2,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import type { Product, Vendor } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  Field,
  inputCls,
  ErrorText,
  Money,
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

// ── API row shapes ──────────────────────────────────────────────
interface PrItem {
  id?: string;
  productId: string;
  sku: string;
  productName: string;
  damagedQty: number;
  unitCost: number;
  gstRate: number;
  totalAmount: number;
  reason: string;
}

interface PrRow {
  id: string;
  debitNoteNo: string;
  poRef: string;
  vendorId?: string | null;
  vendor?: { id: string; vendorName: string } | null;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  items: PrItem[];
}

const REASONS = ["Transit Damage", "Defective", "Wrong Item", "Expired", "Other"] as const;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeProducts(res: unknown): Product[] {
  if (Array.isArray(res)) return res as Product[];
  const obj = res as { products?: Product[] } | null;
  return obj?.products ?? [];
}

function gstPreview(taxable: number, gstRate: number, intra: boolean) {
  if (intra) {
    return { cgst: round2(taxable * (gstRate / 200)), sgst: round2(taxable * (gstRate / 200)), igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: round2(taxable * (gstRate / 100)) };
}

export default function PurchaseReturnsView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [rows, setRows] = React.useState<PrRow[] | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [newOpen, setNewOpen] = React.useState(false);
  const [viewOf, setViewOf] = React.useState<PrRow | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<PrRow[]>("/api/v1/purchase-returns", { firmId: activeFirmId })
      .then((res) => alive && setRows(res))
      .catch((e) => {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load purchase returns", description: e.message });
        }
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, refresh, toast]);

  // ── Masonry summary stats ───────────────────────────────────────
  const list = rows ?? [];
  const totalValue = list.reduce((s, r) => s + Number(r.grandTotal), 0);
  const totalTax = list.reduce((s, r) => s + Number(r.totalTax), 0);
  const totalItems = list.reduce((s, r) => s + r.items.length, 0);
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthValue = list.filter((r) => r.returnDate.slice(0, 7) === monthPrefix).reduce((s, r) => s + Number(r.grandTotal), 0);
  const reasonCounts = new Map<string, { count: number; value: number }>();
  for (const r of list) {
    for (const it of r.items) {
      const cur = reasonCounts.get(it.reason) ?? { count: 0, value: 0 };
      reasonCounts.set(it.reason, { count: cur.count + it.damagedQty, value: cur.value + Number(it.totalAmount) });
    }
  }
  const reasonRows = [...reasonCounts.entries()].sort((a, b) => b[1].value - a[1].value);
  const reasonTotal = Math.max(1, reasonRows.reduce((s, [, v]) => s + v.value, 0));
  const reasonBar: Record<string, string> = {
    "Transit Damage": "bg-dmk-warning",
    Defective: "bg-dmk-danger",
    "Wrong Item": "bg-dmk-info",
    Expired: "bg-dmk-gold",
    Other: "bg-dmk-orange",
  };
  const vendorAgg = new Map<string, { name: string; count: number; value: number }>();
  for (const r of list) {
    const name = r.vendor?.vendorName ?? "No vendor on file";
    const key = r.vendorId ?? "NONE";
    const cur = vendorAgg.get(key) ?? { name, count: 0, value: 0 };
    vendorAgg.set(key, { name, count: cur.count + 1, value: cur.value + Number(r.grandTotal) });
  }
  const topVendors = [...vendorAgg.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 4);
  const topVendorMax = Math.max(1, topVendors[0]?.[1].value ?? 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Returns"
        subtitle="Debit notes to vendors · Damaged (quarantine) stock goes back, payable reduces"
        icon={Undo2}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-orange text-white hover:bg-dmk-orange/90"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="h-4 w-4" /> New Debit Note
          </Button>
        }
      />

      <SectionGrid
        list={
          <RegisterCard
            title="Debit notes"
            icon={Undo2}
            count={list.length}
            countLabel="returns"
            footer={
              <>
                <span><span className="font-money text-dmk-text-secondary">{formatINR(totalValue)}</span> returned value</span>
                <span><span className="font-money text-dmk-info">{formatINR(totalTax)}</span> ITC reversed</span>
                <span className="hidden sm:inline">damaged pool ↓ · payable ↓ · sellable untouched (R3/R5)</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={RotateCcw}
                title="No debit notes yet"
                hint="Return damaged goods to a vendor — damaged stock and payable reduce together."
              />
            ) : (
              list.map((r) => (
                <RegisterRow key={r.id} onClick={() => setViewOf(r)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-money text-[12px] text-dmk-text-primary shrink-0">{r.debitNoteNo}</span>
                      <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(r.returnDate)}</span>
                      {r.poRef && <span className="font-money text-[10.5px] text-dmk-text-muted truncate" title={`Against PO ${r.poRef}`}>ref {r.poRef}</span>}
                    </div>
                    <Badge tone="dr">DEBIT NOTE</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-dmk-text-secondary truncate">
                      {r.vendor?.vendorName ?? <span className="text-dmk-text-muted">No vendor on file</span>}
                      <span className="text-dmk-text-muted"> · {r.items.length} item{r.items.length === 1 ? "" : "s"}</span>
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="text-[10.5px] text-dmk-text-muted hidden sm:inline">sub {formatINR(r.subtotal)} · tax {formatINR(r.totalTax)}</span>
                      <span className="font-money text-[13px] font-semibold text-dmk-info">{formatINR(r.grandTotal)}</span>
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
              <KpiCard label="Debit notes" value={String(list.length)} sub={`${totalItems} line items`} icon={Undo2} />
              <KpiCard label="Returned value" value={formatINR(totalValue)} sub={`${formatINR(monthValue)} this month`} icon={IndianRupee} tone="blue" />
              <KpiCard label="ITC reversed" value={formatINR(totalTax)} sub="input tax credit adjusted" icon={FileWarning} tone="gold" />
              <KpiCard label="This month" value={formatINR(monthValue)} sub="debit notes issued" icon={AlertTriangle} tone={monthValue > 0 ? "orange" : "default"} />
            </div>

            <AsideCard
              title="Return policy"
              icon={AlertTriangle}
              iconClass="text-dmk-warning"
              footnote="Quantities are drawn from the Damaged pool only — the server rejects returns larger than the available damaged stock."
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                A debit note reduces <span className="font-semibold text-dmk-warning">Damaged (quarantine) stock</span> and{' '}
                <span className="font-semibold text-dmk-info">vendor payable</span>, and reverses Input Tax Credit. Sellable
                stock is never touched (R3/R5).
              </p>
            </AsideCard>

            <AsideCard title="Reason mix" icon={PackageX} iconClass="text-dmk-danger" footnote="Grouped by the reason recorded on each returned line.">
              <div className="space-y-2.5">
                {reasonRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">No returns recorded yet.</p>
                ) : (
                  reasonRows.map(([reason, v]) => (
                    <MixBar
                      key={reason}
                      label={<>{reason} <span className="text-dmk-text-muted">· {v.count} qty</span></>}
                      value={formatINR(v.value)}
                      pct={(v.value / reasonTotal) * 100}
                      barClass={reasonBar[reason] ?? "bg-dmk-orange"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title="Vendor recovery"
              icon={Truck}
              iconClass="text-dmk-info"
              footnote="Returned value by vendor — each debit note also reduces that vendor's payable balance."
            >
              <div className="space-y-2.5">
                {topVendors.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">No vendors yet.</p>
                ) : (
                  topVendors.map(([key, v]) => (
                    <MixBar
                      key={key}
                      label={<>{v.name} <span className="text-dmk-text-muted">· {v.count} DN</span></>}
                      value={formatINR(v.value)}
                      pct={(v.value / topVendorMax) * 100}
                      barClass="bg-dmk-blue"
                    />
                  ))
                )}
              </div>
            </AsideCard>
          </>
        }
      />

      <NewDebitNoteDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onSaved={() => setRefresh((r) => r + 1)}
      />

      <ViewReturnDialog row={viewOf} onClose={() => setViewOf(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// New debit note dialog
// ═══════════════════════════════════════════════════════════════
interface DnLine {
  productId: string;
  qty: string;
  cost: string;
  reason: string;
}

interface PoLite {
  id: string;
  poNumber: string;
  poDate: string;
  vendorId: string;
  items: Array<{ productId: string; sku: string; productName: string; quantity: number }>;
}

function NewDebitNoteDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const firmStateCode = firm?.stateCode ?? "27";

  const [saving, setSaving] = React.useState(false);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [vendorId, setVendorId] = React.useState("NONE");
  const [poId, setPoId] = React.useState("NONE");
  const [poOptions, setPoOptions] = React.useState<PoLite[]>([]);
  const [returnDate, setReturnDate] = React.useState(toISODate(new Date()));
  const [lines, setLines] = React.useState<DnLine[]>([]);

  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId })
      .then((res) => alive && setVendors(res))
      .catch(() => alive && setVendors([]));
    apiGet<Product[]>("/api/v1/products", { firmId: activeFirmId })
      .then((res) => alive && setProducts(normalizeProducts(res)))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [open, activeFirmId]);

  // Load the vendor's CONFIRMED POs for the reference select
  React.useEffect(() => {
    if (!open || !activeFirmId || vendorId === "NONE") {
      setPoOptions([]);
      setPoId("NONE");
      return;
    }
    let alive = true;
    apiGet<PoLite[]>("/api/v1/purchase-orders", { firmId: activeFirmId, status: "CONFIRMED" })
      .then((res) => {
        if (!alive) return;
        const mine = res.filter((p) => p.vendorId === vendorId);
        setPoOptions(mine);
        setPoId("NONE");
      })
      .catch(() => alive && setPoOptions([]));
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, vendorId]);

  React.useEffect(() => {
    if (!open) return;
    setVendorId("NONE");
    setPoId("NONE");
    setPoOptions([]);
    setReturnDate(toISODate(new Date()));
    setLines([]);
  }, [open]);

  const vendor = vendors.find((v) => v.id === vendorId);
  // No vendor → seller state falls back to the firm's own state (intra, per server)
  const intra = !vendor || vendor.stateCode === firmStateCode;
  const refPo = poOptions.find((p) => p.id === poId);

  const productMap = new Map(products.map((p) => [p.id, p]));

  const computed = lines.map((l) => {
    const p = productMap.get(l.productId);
    const taxable = round2(num(l.qty) * num(l.cost));
    const gst = gstPreview(taxable, p?.gstRate ?? 0, intra);
    const overStock = !!p && num(l.qty) > p.damagedStock + 0.001;
    return { line: l, product: p, taxable, gst, total: round2(taxable + gst.cgst + gst.sgst + gst.igst), overStock };
  });

  const totals = computed.reduce(
    (acc, c) => ({
      taxable: round2(acc.taxable + c.taxable),
      cgst: round2(acc.cgst + c.gst.cgst),
      sgst: round2(acc.sgst + c.gst.sgst),
      igst: round2(acc.igst + c.gst.igst),
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
  );
  const grand = round2(totals.taxable + totals.cgst + totals.sgst + totals.igst);

  const stockErrors = computed.filter((c) => c.overStock);
  const linesValid = lines.every((l) => num(l.qty) > 0 && num(l.cost) >= 0);
  const canSave = lines.length > 0 && linesValid && stockErrors.length === 0;

  function addProduct(p: Product) {
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...ls];
        next[idx] = { ...next[idx], qty: String(num(next[idx].qty) + 1) };
        return next;
      }
      return [...ls, { productId: p.id, qty: "1", cost: String(p.purchaseCost), reason: "Transit Damage" }];
    });
  }

  function updateLine(i: number, patch: Partial<DnLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!activeFirmId || !canSave) return;
    setSaving(true);
    try {
      const res = await apiPost<{ purchaseReturn: PrRow; journal: unknown }>("/api/v1/purchase-returns", {
        firmId: activeFirmId,
        vendorId: vendorId === "NONE" ? undefined : vendorId,
        poId: poId === "NONE" ? undefined : poId,
        returnDate,
        items: lines.map((l) => ({
          productId: l.productId,
          damagedQty: num(l.qty),
          unitCost: num(l.cost),
          reason: l.reason,
        })),
      });
      toast({
        title: `Debit note ${res.purchaseReturn?.debitNoteNo ?? ""} created`,
        description: "Damaged stock reduced · Vendor payable reduced · ITC reversed · Journal posted",
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not create debit note.";
      toast({
        variant: "destructive",
        title: e instanceof ApiError && e.code === "ERR_NEGATIVE_STOCK" ? "Not enough damaged stock" : "Save failed",
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">New debit note — purchase return</DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            Quantities are drawn from the Damaged pool only — the server rejects returns larger than available damaged
            stock.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Vendor" hint="Optional — omit for stock-only write-back">
            <Select
              value={vendorId}
              onValueChange={(v) => {
                setVendorId(v);
                setLines([]); // scope may change — start clean
              }}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}>
                <SelectValue placeholder="Select vendor…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— No vendor —</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.vendorName}
                    {v.vendorType === "MANUFACTURER" && v.brand ? ` — Mfr · ${v.brand}` : " — Distributor"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Reference PO" hint={vendorId === "NONE" ? "Pick a vendor first" : "Optional — their confirmed POs"}>
            <Select value={poId} onValueChange={setPoId} disabled={vendorId === "NONE"}>
              <SelectTrigger className={cn(inputCls, "w-full")}>
                <SelectValue placeholder={vendorId === "NONE" ? "—" : "None"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— None —</SelectItem>
                {poOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.poNumber} · {formatDate(p.poDate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Return date">
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Quick-add from the referenced PO */}
        {refPo && (
          <div className="dmk-well px-3 py-2.5">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted mb-1.5">
              Quick add from {refPo.poNumber}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {refPo.items.map((it) => (
                <button
                  key={it.productId}
                  type="button"
                  onClick={() => {
                    const p = productMap.get(it.productId);
                    if (p) addProduct(p);
                  }}
                  className="dmk-badge dmk-badge-info hover:bg-dmk-hover cursor-pointer"
                >
                  + {it.sku} · {it.productName}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Item rows */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
              Returned items (damaged pool)
            </span>
            <Select onValueChange={(pid) => {
              const p = productMap.get(pid);
              if (p) addProduct(p);
            }} value="">
              <SelectTrigger className={cn(inputCls, "w-full sm:w-[320px]")}>
                <SelectValue placeholder="+ Add product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                    {p.brand ? ` (${p.brand})` : ""} — damaged {p.damagedStock}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lines.length === 0 ? (
            <p className="text-[12px] text-dmk-text-muted dmk-well px-3 py-4 text-center">
              No items yet — add products above or quick-add from the referenced PO.
            </p>
          ) : (
            <div className="space-y-2">
              {computed.map(({ line, product, taxable, gst, total, overStock }, i) => (
                <div key={`${line.productId}-${i}`} className="dmk-card p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-4">
                      <span className="text-[12.5px] font-medium">
                        <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{product?.sku ?? "—"}</span>
                        {product?.name ?? line.productId}
                      </span>
                      <p className="text-[10.5px] text-dmk-text-muted mt-0.5">
                        Damaged in stock:{" "}
                        <span className={cn("font-money", overStock ? "text-dmk-danger" : "text-dmk-text-secondary")}>
                          {product?.damagedStock ?? 0}
                        </span>
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="Qty">
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={line.qty}
                          onChange={(e) => updateLine(i, { qty: e.target.value })}
                          className={cn(inputCls, "h-8 text-right font-money", overStock && "border-dmk-danger/60")}
                          aria-label="Return quantity"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field label="Unit cost">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.cost}
                          onChange={(e) => updateLine(i, { cost: e.target.value })}
                          className={cn(inputCls, "h-8 text-right font-money")}
                          aria-label="Unit cost"
                        />
                      </Field>
                    </div>
                    <div className="sm:col-span-3">
                      <Field label="Reason">
                        <Select value={line.reason} onValueChange={(v) => updateLine(i, { reason: v })}>
                          <SelectTrigger className={cn(inputCls, "h-8 w-full")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {REASONS.map((r) => (
                              <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <div className="sm:col-span-1 flex sm:justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover"
                        onClick={() => removeLine(i)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11.5px] text-dmk-text-muted">
                    <span>Taxable <span className="num text-dmk-text-secondary">{formatINR(taxable)}</span></span>
                    <span>
                      {intra ? "CGST+SGST" : "IGST"}{" "}
                      <span className="num text-dmk-text-secondary">
                        {intra ? `${formatINR(gst.cgst)} + ${formatINR(gst.sgst)}` : formatINR(gst.igst)}
                      </span>
                    </span>
                    <span>Total <span className="num text-dmk-text-primary font-semibold">{formatINR(total)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {stockErrors.length > 0 && (
          <ErrorText>
            Damaged stock is insufficient:{" "}
            {stockErrors
              .map((c) => `${c.product?.name ?? "item"} (available ${c.product?.damagedStock ?? 0})`)
              .join(", ")}
            . Reduce the quantities or check the quarantine pool.
          </ErrorText>
        )}

        {lines.length > 0 && (
          <div className="dmk-well px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>Subtotal (taxable)</span>
              <Money value={totals.taxable} />
            </div>
            {intra ? (
              <>
                <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                  <span>CGST reversal</span><Money value={totals.cgst} />
                </div>
                <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                  <span>SGST reversal</span><Money value={totals.sgst} />
                </div>
              </>
            ) : (
              <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                <span>IGST reversal</span><Money value={totals.igst} />
              </div>
            )}
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>Debit note total</span>
              <Money value={grand} className="text-dmk-orange text-[15px]" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave || saving} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create debit note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// View return dialog (items + reasons)
// ═══════════════════════════════════════════════════════════════
function reasonTone(reason: string): "warning" | "danger" | "info" | "neutral" {
  switch (reason) {
    case "Transit Damage": return "warning";
    case "Defective": return "danger";
    case "Wrong Item": return "info";
    default: return "neutral";
  }
}

function ViewReturnDialog({ row, onClose }: { row: PrRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary flex items-center gap-2.5">
            <FileWarning className="h-5 w-5 text-dmk-warning" /> {row?.debitNoteNo}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {row?.vendor?.vendorName ?? "No vendor"} · {row ? formatDate(row.returnDate) : ""}
            {row?.poRef ? ` · Ref PO ${row.poRef}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">Total</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(row?.items ?? []).map((it, i) => (
                  <tr key={it.id ?? `${it.productId}-${i}`}>
                    <td className="text-[12.5px] max-w-[200px] truncate">
                      <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{it.sku}</span>
                      {it.productName}
                    </td>
                    <td className="num text-[12.5px]">{it.damagedQty}</td>
                    <td className="num text-[12.5px]">{formatINR(it.unitCost)}</td>
                    <td className="num text-[12px] text-dmk-text-secondary">{it.gstRate}%</td>
                    <td className="num text-[12.5px] font-semibold">{formatINR(it.totalAmount)}</td>
                    <td><Badge tone={reasonTone(it.reason)}>{it.reason}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dmk-well px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>Subtotal</span><Money value={row?.subtotal ?? 0} />
            </div>
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>Tax reversal</span><Money value={row?.totalTax ?? 0} />
            </div>
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>Debit note total</span>
              <Money value={row?.grandTotal ?? 0} className="text-dmk-orange text-[15px]" />
            </div>
          </div>
        </div>

        {row?.notes && (
          <p className="text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted uppercase tracking-wider text-[10.5px] font-semibold mr-2">Notes</span>
            {row.notes}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
