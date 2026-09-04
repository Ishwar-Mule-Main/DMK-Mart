"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — ORDERS + GRN COCKPIT
// Lifecycle: PENDING (editable / cancellable) → CONFIRMED via GRN
// (locked — changes only via Purchase Return) → CANCELLED.
// GRN splits received qty → Accepted (sellable) + Damaged (quarantine).
// GST computed vs vendor.stateCode (IGST if ≠ firm.stateCode).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ClipboardList,
  Eye,
  HandCoins,
  IndianRupee,
  Layers,
  PackageCheck,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Timer,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, toISODate } from "@/lib/format";
import type { Product, Vendor } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  StatusBadge,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { requestPayPo } from "@/lib/settle-bus";
import { cn } from "@/lib/utils";

// ── API row shapes (as returned by the routes) ──────────────────
interface PoVendor {
  id: string;
  vendorName: string;
  vendorType: string;
  brand: string;
}

interface PoItemRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  hsnCode: string;
  quantity: number;
  receivedQty: number;
  unitCost: number;
  taxableAmount: number;
  gstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

interface PoRow {
  id: string;
  firmId: string;
  vendorId: string;
  vendor?: PoVendor;
  poNumber: string;
  poDate: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  grandTotal: number;
  receivedNote: string;
  vendorBillNo: string;
  vendorBillDate: string | null;
  notes: string;
  items: PoItemRow[];
  createdAt: string;
  /** AP subledger (CONFIRMED only — from purchase-orders GET, cycle 17). */
  paid?: number;
  credited?: number;
  outstanding?: number;
}

interface PoLine {
  productId: string;
  sku: string;
  name: string;
  gstRate: number;
  qty: string;
  cost: string;
}

// ── helpers ──────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(s: string | number): number {
  const n = typeof s === "number" ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Client-side replica of lib/gst calculateGST (server stays source of truth). */
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

export default function PurchaseOrdersView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);

  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState("ALL");
  const [rows, setRows] = React.useState<PoRow[] | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  const [editOf, setEditOf] = React.useState<PoRow | null>(null);
  const [viewOf, setViewOf] = React.useState<PoRow | null>(null);
  const [cancelOf, setCancelOf] = React.useState<PoRow | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await apiGet<PoRow[]>("/api/v1/purchase-orders", {
          firmId: activeFirmId,
          status: status === "ALL" ? undefined : status,
          search: query.trim(),
        });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load purchase orders", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, query, status, refresh, toast]);

  /** Cycle 17: pay a specific bill from its PO row. */
  function payFromRow(po: PoRow) {
    if (po.status !== "CONFIRMED" || !po.outstanding || po.outstanding <= 0.009) return;
    requestPayPo(po.id, po.vendorId);
    setView("purchase/payments");
    toast({
      title: "Opening payment dialog",
      description: `${po.poNumber} · ${formatINR(po.outstanding)} outstanding pre-allocated — confirm there.`,
    });
  }

  async function confirmCancel() {
    if (!cancelOf) return;
    setCancelling(true);
    try {
      await apiPost<PoRow>(`/api/v1/purchase-orders/${cancelOf.id}/cancel`, {});
      toast({ title: "PO cancelled", description: `${cancelOf.poNumber} — no stock or ledger impact.` });
      setCancelOf(null);
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Cancel failed",
        description: e instanceof ApiError ? e.message : "Could not cancel this PO.",
      });
    } finally {
      setCancelling(false);
    }
  }

  const pendingCount = (rows ?? []).filter((r) => r.status === "PENDING").length;
  const openPayable = (rows ?? [])
    .filter((r) => r.status === "CONFIRMED" && (r.outstanding ?? 0) > 0.009)
    .reduce((s, r) => s + (r.outstanding ?? 0), 0);

  // ── Masonry summary stats ───────────────────────────────────────
  const list = rows ?? [];
  const totalValue = list.reduce((s, r) => s + Number(r.grandTotal), 0);
  const confirmedValue = list.filter((r) => r.status === "CONFIRMED").reduce((s, r) => s + Number(r.grandTotal), 0);
  const pendingValue = list.filter((r) => r.status === "PENDING").reduce((s, r) => s + Number(r.grandTotal), 0);
  const denom = Math.max(1, list.length);
  const statusRows = (["PENDING", "CONFIRMED", "CANCELLED"] as const)
    .map((st) => ({ st, count: list.filter((r) => r.status === st).length, value: list.filter((r) => r.status === st).reduce((s, r) => s + Number(r.grandTotal), 0) }))
    .filter((x) => x.count > 0);
  const statusBar: Record<string, string> = { PENDING: "bg-dmk-warning", CONFIRMED: "bg-dmk-success", CANCELLED: "bg-dmk-danger" };
  const vendorAgg = new Map<string, { name: string; count: number; value: number }>();
  for (const r of list) {
    const name = r.vendor?.vendorName ?? "—";
    const cur = vendorAgg.get(r.vendorId) ?? { name, count: 0, value: 0 };
    vendorAgg.set(r.vendorId, { name, count: cur.count + 1, value: cur.value + Number(r.grandTotal) });
  }
  const topVendors = [...vendorAgg.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 4);
  const topVendorMax = Math.max(1, topVendors[0]?.[1].value ?? 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        subtitle="PENDING → team verification → your acceptance → CONFIRMED · damaged units quarantined"
        icon={ClipboardList}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-yellow text-white hover:bg-dmk-yellow/90"
            onClick={() => setView("purchase/new-order")}
          >
            <Plus className="h-4 w-4" /> New PO
          </Button>
        }
      />

      <SectionGrid
        list={
          <RegisterCard
            title="Purchase orders"
            icon={ClipboardList}
            count={list.length}
            countLabel="orders"
            filters={
              <>
                <div className="relative flex-1 min-w-0">
                  <SearchInput value={query} onChange={setQuery} placeholder="Search PO number or vendor…" className="pl-9" />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                </div>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className={cn(inputCls, "w-full sm:w-[170px] shrink-0")}>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            footer={
              <>
                <span><span className="font-money text-dmk-warning">{pendingCount}</span> at the verification team</span>
                {openPayable > 0.009 && (
                  <span><span className="font-money text-dmk-blue">{formatINR(openPayable)}</span> open payable — hover a row to <span className="text-dmk-info font-semibold">Pay</span></span>
                )}
                <span className="hidden sm:inline">Acceptance posts: stock IN · payable Cr · PURCHASE journal</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={7} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No purchase orders"
                hint="Create a PO to a manufacturer or distributor — the verification team counts the delivery, then you accept it to book stock and payable."
              />
            ) : (
              list.map((po) => {
                const tax = po.totalCgst + po.totalSgst + po.totalIgst;
                const osd = po.outstanding;
                const settled = po.status === "CONFIRMED" && osd !== undefined && osd <= 0.009;
                const payable = po.status === "CONFIRMED" && osd !== undefined && osd > 0.009;
                return (
                  <RegisterRow key={po.id} className={po.status === "PENDING" ? "bg-[rgba(245,158,11,0.04)]" : undefined}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-money text-[12px] text-dmk-text-primary shrink-0">
                          {po.poNumber}
                          {po.vendorBillNo && (
                            <span className="block text-[10px] text-dmk-text-muted" title="Vendor bill no.">
                              Bill {po.vendorBillNo}
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(po.poDate)}</span>
                      </div>
                      <StatusBadge status={po.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-dmk-text-secondary truncate">
                        <span className="font-medium">{po.vendor?.vendorName ?? "—"}</span>
                        <span className="text-dmk-text-muted"> · {po.items.length} item{po.items.length === 1 ? "" : "s"} · tax {formatINR(tax)}</span>
                      </span>
                      <span className="flex items-baseline gap-2 shrink-0">
                        <span className="font-money text-[13px] font-semibold text-dmk-text-primary">{formatINR(po.grandTotal)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] shrink-0">
                        {po.status !== "CONFIRMED" ? (
                          <span className="text-dmk-text-muted">balance —</span>
                        ) : settled ? (
                          <Badge tone="success">SETTLED</Badge>
                        ) : osd !== undefined ? (
                          <span className="font-money font-semibold text-dmk-blue">balance {formatINR(osd)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">balance …</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {payable && (
                          <button
                            type="button"
                            onClick={() => payFromRow(po)}
                            title={`Record a payment against ${po.poNumber} (${formatINR(osd ?? 0)})`}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-all border-dmk-border-medium bg-dmk-input-well hover:bg-dmk-hover text-dmk-info hover:border-dmk-info/40"
                          >
                            <HandCoins className="h-3 w-3" /> Pay
                          </button>
                        )}
                        {po.status === "PENDING" && (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-[11px] bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold"
                              onClick={() => {
                                setView("purchase/verification");
                                toast({ title: `${po.poNumber} is in verification`, description: "The team portal counts sellable vs damaged — you accept the counts to book stock & payable." });
                              }}
                            >
                              <PackageSearch className="h-3 w-3" /> Verify
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setEditOf(po)} aria-label={`Edit ${po.poNumber}`}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-dmk-border-subtle text-dmk-danger hover:bg-dmk-hover" onClick={() => setCancelOf(po)} aria-label={`Cancel ${po.poNumber}`}>
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {po.status !== "PENDING" && (
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setViewOf(po)}>
                            <Eye className="h-3 w-3" /> View
                          </Button>
                        )}
                      </span>
                    </div>
                  </RegisterRow>
                );
              })
            )}
          </RegisterCard>
        }
        aside={
          <>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label="PO value" value={formatINR(totalValue)} sub={`${list.length} orders listed`} icon={IndianRupee} tone="orange" />
              <KpiCard label="In verification" value={String(pendingCount)} sub={`${formatINR(pendingValue)} awaiting counts`} icon={Timer} tone={pendingCount > 0 ? "gold" : "success"} />
              <KpiCard label="Confirmed value" value={formatINR(confirmedValue)} sub="booked on acceptance" icon={PackageCheck} tone="success" />
              <KpiCard label="Open payable" value={formatINR(openPayable)} sub="owed to vendors" icon={Truck} tone="blue" />
            </div>

            <AsideCard title="Status mix" icon={Layers} iconClass="text-dmk-info" footnote="Only PENDING orders can be edited or cancelled — CONFIRMED orders change via Purchase Returns.">
              <div className="space-y-2.5">
                {statusRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">No orders in the current filter.</p>
                ) : (
                  statusRows.map((x) => (
                    <MixBar
                      key={x.st}
                      label={<><StatusBadge status={x.st} /> <span className="text-dmk-text-muted">· {x.count}</span></>}
                      value={formatINR(x.value)}
                      pct={(x.count / denom) * 100}
                      barClass={statusBar[x.st] ?? "bg-dmk-yellow"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title="Top vendors"
              icon={Truck}
              iconClass="text-dmk-yellow"
              footnote="Manufacturers are brand-scoped (R10) — their POs only list that brand's products."
            >
              <div className="space-y-2.5">
                {topVendors.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">No vendors yet.</p>
                ) : (
                  topVendors.map(([, v]) => (
                    <MixBar
                      key={v.name}
                      label={<>{v.name} <span className="text-dmk-text-muted">· {v.count} PO</span></>}
                      value={formatINR(v.value)}
                      pct={(v.value / topVendorMax) * 100}
                      barClass="bg-dmk-yellow"
                    />
                  ))
                )}
              </div>
            </AsideCard>
          </>
        }
      />

      <PoFormDialog
        open={!!editOf}
        editing={editOf}
        onOpenChange={(o) => {
          if (!o) {
            setEditOf(null);
          }
        }}
        onSaved={() => setRefresh((r) => r + 1)}
      />


      <ViewPoDialog po={viewOf} onClose={() => setViewOf(null)} />

      <AlertDialog open={!!cancelOf} onOpenChange={(o) => !o && setCancelOf(null)}>
        <AlertDialogContent className="dmk-elevated border-dmk-border-medium">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Cancel PO {cancelOf?.poNumber}?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-secondary">
              Only PENDING orders can be cancelled. Cancelled orders have no stock, payable or journal impact.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
              Keep PO
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              disabled={cancelling}
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
            >
              Cancel PO
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// New / Edit PO form (shared) — vendor brand scope + GST preview
// ═══════════════════════════════════════════════════════════════
function PoFormDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: PoRow | null;
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
  const [vendorId, setVendorId] = React.useState("");
  const [poDate, setPoDate] = React.useState(toISODate(new Date()));
  const [vendorBillNo, setVendorBillNo] = React.useState("");
  const [vendorBillDate, setVendorBillDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<PoLine[]>([]);
  const [pickQuery, setPickQuery] = React.useState("");

  // Load vendors + products whenever the dialog opens
  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    apiGet<Vendor[]>("/api/v1/vendors", { firmId: activeFirmId })
      .then((res) => alive && setVendors(res))
      .catch(() => alive && setVendors([]));
    apiGet<Product[]>("/api/v1/products", { firmId: activeFirmId, activeOnly: !editing })
      .then((res) => alive && setProducts(normalizeProducts(res)))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, editing]);

  // Prefill for edit / reset for new (gstRate from the stored PO item —
  // no dependency on the async products fetch)
  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setVendorId(editing.vendorId);
      setPoDate(toISODate(editing.poDate));
      setVendorBillNo(editing.vendorBillNo ?? "");
      setVendorBillDate(editing.vendorBillDate ? toISODate(editing.vendorBillDate) : "");
      setNotes(editing.notes ?? "");
      setLines(
        editing.items.map((it) => ({
          productId: it.productId,
          sku: it.sku,
          name: it.productName,
          gstRate: it.gstRate,
          qty: String(it.quantity),
          cost: String(it.unitCost),
        }))
      );
    } else {
      setVendorId("");
      setPoDate(toISODate(new Date()));
      setVendorBillNo("");
      setVendorBillDate("");
      setNotes("");
      setLines([]);
    }
    setPickQuery("");
  }, [open, editing]);

  const vendor = vendors.find((v) => v.id === vendorId);
  const isManufacturer = vendor?.vendorType === "MANUFACTURER";
  const intra = !!vendor && vendor.stateCode === firmStateCode;

  // R4/R10 — manufacturer POs list ONLY that vendor's own products
  // (manufacturerVendorId link, legacy brand match as fallback);
  // distributors list the whole catalog.
  const pickable = products.filter((p) => {
    if (!p.isActive) return false;
    if (isManufacturer && vendor) {
      const brandMatch = !!vendor.brand && p.brand.toLowerCase() === vendor.brand.toLowerCase();
      if (p.manufacturerVendorId !== vendor.id && !brandMatch) return false;
    }
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q)
    );
  });

  const computed = lines.map((l) => {
    const taxable = round2(num(l.qty) * num(l.cost));
    const gst = gstPreview(taxable, l.gstRate, intra);
    return { line: l, taxable, gst, total: round2(taxable + gst.cgst + gst.sgst + gst.igst) };
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
  }

  function updateLine(i: number, patch: Partial<PoLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  const itemsValid = lines.every(
    (l) => num(l.qty) > 0 && num(l.cost) >= 0 && Number.isFinite(num(l.qty)) && Number.isFinite(num(l.cost))
  );
  const canSave = !!vendorId && lines.length > 0 && itemsValid;

  async function submit() {
    if (!activeFirmId || !canSave) return;
    setSaving(true);
    const body = {
      poDate,
      notes: notes.trim(),
      vendorBillNo: vendorBillNo.trim(),
      vendorBillDate: vendorBillDate || null,
      items: lines.map((l) => ({ productId: l.productId, quantity: num(l.qty), unitCost: num(l.cost) })),
    };
    try {
      if (editing) {
        await apiPatch<PoRow>(`/api/v1/purchase-orders/${editing.id}`, body);
        toast({ title: "PO updated", description: `${editing.poNumber} re-priced and saved.` });
      } else {
        const created = await apiPost<PoRow>("/api/v1/purchase-orders", {
          firmId: activeFirmId,
          vendorId,
          poDate,
          notes: notes.trim(),
          vendorBillNo: vendorBillNo.trim(),
          vendorBillDate: vendorBillDate || null,
          items: body.items,
        });
        toast({ title: `PO ${created.poNumber} created`, description: "Sent to the verification team portal — stock & payable book when you accept their counts." });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const isLocked = e instanceof ApiError && (e.code === "ERR_NOT_EDITABLE" || e.status === 409);
      toast({
        variant: "destructive",
        title: isLocked ? "PO is locked" : "Save failed",
        description: e instanceof ApiError ? e.message : "Could not save purchase order.",
      });
      if (isLocked) {
        onSaved();
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[94vh] overflow-y-auto sm:w-[880px]">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary">
            {editing ? `Edit PO ${editing.poNumber}` : "New purchase order"}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {editing
              ? "Only PENDING orders can be edited — items are replaced and totals re-computed."
              : "Draft a PENDING order — it goes to the verification team portal; nothing is booked until you accept their counts."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field label="Vendor *">
              <Select
                value={vendorId}
                onValueChange={(v) => {
                  setVendorId(v);
                  setLines([]); // brand scope changes → clear lines
                }}
                disabled={!!editing}
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
            </Field>
          </div>
          <Field label="PO date">
            <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Vendor bill identity — powers bill-first GSTR-2B matching */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Vendor bill no." hint="Supplier's sales-invoice number">
            <Input
              value={vendorBillNo}
              onChange={(e) => setVendorBillNo(e.target.value)}
              className={inputCls}
              placeholder="e.g. SB/26-27/4512"
            />
          </Field>
          <Field label="Vendor bill date">
            <Input
              type="date"
              value={vendorBillDate}
              onChange={(e) => setVendorBillDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="hidden sm:block self-end pb-1 text-[10.5px] text-dmk-text-muted leading-snug">
            Optional — capturing the supplier's bill no. lets GSTR-2B matching
            key on the bill itself instead of amount guesses.
          </div>
        </div>

        {isManufacturer && vendor && (
          <div className="dmk-well px-3 py-2 text-[11.5px] text-dmk-gold flex items-center gap-2">
            <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold">Brand scope</span>
            Only <span className="font-semibold">{vendor.brand}</span> products appear in the picker (R10).
          </div>
        )}
        {vendor && (
          <div className="dmk-well px-3 py-2 text-[11.5px] text-dmk-text-muted">
            GST mode:{" "}
            {intra ? (
              <span className="text-dmk-info">Intra-state — CGST + SGST (vendor & firm both in {vendor.stateCode})</span>
            ) : (
              <span className="text-dmk-gold">Inter-state — IGST (vendor {vendor.stateCode} ≠ firm {firmStateCode})</span>
            )}
          </div>
        )}

        {/* Product picker */}
        <div className="space-y-2">
          <div className="relative">
            <SearchInput
              value={pickQuery}
              onChange={setPickQuery}
              placeholder={vendor ? "Search products to add (SKU, name, category)…" : "Select a vendor first"}
              className="pl-9"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
          </div>
          <div className="dmk-card max-h-44 overflow-y-auto overflow-x-hidden">
            {!vendor ? (
              <p className="text-[12px] text-dmk-text-muted px-3 py-4 text-center">Pick a vendor to list products.</p>
            ) : pickable.length === 0 ? (
              <p className="text-[12px] text-dmk-text-muted px-3 py-4 text-center">
                {isManufacturer ? `No ${vendor?.brand} products match.` : "No products match your search."}
              </p>
            ) : (
              <table className="dmk-table">
                <tbody>
                  {pickable.slice(0, 60).map((p) => (
                    <tr key={p.id} className="cursor-pointer" onClick={() => addProduct(p)}>
                      <td className="font-money text-[11px] text-dmk-text-secondary w-[110px]">{p.sku}</td>
                      <td className="text-[12.5px] max-w-[280px] truncate">
                        {p.name}
                        {p.brand && <span className="ml-1.5 text-[10.5px] text-dmk-text-muted">({p.brand})</span>}
                      </td>
                      <td className="num text-[12px] text-dmk-text-secondary w-[110px]">GST {p.gstRate}%</td>
                      <td className="num text-[12.5px] w-[110px]">{formatINR(p.purchaseCost)}</td>
                      <td className="w-[90px] text-right">
                        <span className="dmk-badge dmk-badge-info">+ Add</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Lines */}
        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            {lines.length === 0 ? (
              <p className="text-[12px] text-dmk-text-muted px-3 py-5 text-center">
                No items yet — click products above to add lines.
              </p>
            ) : (
              <table className="dmk-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right w-[92px]">Qty</th>
                    <th className="text-right w-[118px]">Unit cost</th>
                    <th className="text-right">Taxable</th>
                    <th className="text-right">{intra ? "CGST + SGST" : "IGST"}</th>
                    <th className="text-right">Line total</th>
                    <th className="w-[44px]" />
                  </tr>
                </thead>
                <tbody>
                  {computed.map(({ line, taxable, gst, total }, i) => {
                    const lineGst = gst.cgst + gst.sgst + gst.igst;
                    const invalid = num(line.qty) <= 0 || num(line.cost) < 0;
                    return (
                      <tr key={line.productId} className={cn(invalid && "bg-[rgba(239,68,68,0.06)]")}>
                        <td className="max-w-[260px]">
                          <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{line.sku}</span>
                          <span className="text-[12.5px]">{line.name}</span>
                          <span className="ml-1.5 text-[10.5px] text-dmk-text-muted">GST {line.gstRate}%</span>
                        </td>
                        <td>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={line.qty}
                            onChange={(e) => updateLine(i, { qty: e.target.value })}
                            className={cn(inputCls, "h-8 text-right font-money")}
                            aria-label={`Quantity for ${line.name}`}
                          />
                        </td>
                        <td>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.cost}
                            onChange={(e) => updateLine(i, { cost: e.target.value })}
                            className={cn(inputCls, "h-8 text-right font-money")}
                            aria-label={`Unit cost for ${line.name}`}
                          />
                        </td>
                        <td className="num text-[12.5px]">{formatINR(taxable)}</td>
                        <td className="num text-[12px] text-dmk-text-secondary">
                          {intra ? `${formatINR(gst.cgst)} + ${formatINR(gst.sgst)}` : formatINR(gst.igst)}
                        </td>
                        <td className="num text-[12.5px] font-semibold">{formatINR(total)}</td>
                        <td>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover"
                            onClick={() => removeLine(i)}
                            aria-label={`Remove ${line.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {lines.length > 0 && (
            <div className="dmk-well px-4 py-3 space-y-1">
              <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                <span>Taxable</span>
                <Money value={totals.taxable} />
              </div>
              {intra ? (
                <>
                  <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                    <span>CGST</span><Money value={totals.cgst} />
                  </div>
                  <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                    <span>SGST</span><Money value={totals.sgst} />
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                  <span>IGST</span><Money value={totals.igst} />
                </div>
              )}
              <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
                <span>Grand Total</span>
                <Money value={grand} className="text-dmk-yellow text-[15px]" />
              </div>
            </div>
          )}
        </div>

        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional — delivery instructions, packaging…" />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSave || saving} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
            {editing ? "Save changes" : "Create PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// GRN receive moved to the PO VERIFICATION flow (owner portal →
// Purchase → PO Verification): the team counts sellable vs damaged
// on their portal; the owner's acceptance runs the same GRN
// pipeline (stock IN + damaged quarantine + payable + PURCHASE
// journal). PENDING rows here link straight to that cockpit.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// View PO detail dialog (CONFIRMED / CANCELLED)
// ═══════════════════════════════════════════════════════════════
interface PoDetailVendor extends PoVendor {
  stateCode?: string;
  gstin?: string;
}

interface PoDetail extends Omit<PoRow, "vendor"> {
  vendor?: PoDetailVendor;
}

function ViewPoDialog({ po, onClose }: { po: PoRow | null; onClose: () => void }) {
  const [detail, setDetail] = React.useState<PoDetail | null>(null);

  React.useEffect(() => {
    if (!po) return;
    let alive = true;
    setDetail(null);
    apiGet<PoDetail>(`/api/v1/purchase-orders/${po.id}`)
      .then((res) => alive && setDetail(res))
      .catch(() => alive && setDetail(po));
    return () => {
      alive = false;
    };
  }, [po]);

  const d: PoDetail | null = detail ?? po;
  const tax = (d?.totalCgst ?? 0) + (d?.totalSgst ?? 0) + (d?.totalIgst ?? 0);

  return (
    <Dialog open={!!po} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium max-h-[94vh] overflow-y-auto sm:w-[800px]">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary flex items-center gap-2.5">
            {d?.poNumber} <StatusBadge status={d?.status ?? "PENDING"} />
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {d?.vendor?.vendorName} {d?.vendor?.brand ? `· ${d.vendor.brand}` : ""} · {d ? formatDate(d.poDate) : ""}
            {d?.vendor?.gstin && (
              <>
                {" · GSTIN "}
                <span className="font-money">{d.vendor.gstin}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {d?.vendorBillNo && (
          <div className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">Vendor bill</span>
              <span className="font-money text-dmk-text-primary">{d.vendorBillNo}</span>
            </span>
            {d.vendorBillDate && (
              <span className="text-dmk-text-muted">dated {formatDate(d.vendorBillDate)}</span>
            )}
            <span className="text-[10.5px] text-dmk-gold">used for GSTR-2B bill-first matching</span>
          </div>
        )}
        {d?.receivedNote && (
          <div className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">Received note</span>
            {d.receivedNote}
          </div>
        )}
        {d?.notes && (
          <div className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">Notes</span>
            {d.notes}
          </div>
        )}

        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[720px]">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(d?.items ?? []).map((it) => {
                  const gstAmt = it.cgstAmount + it.sgstAmount + it.igstAmount;
                  return (
                    <tr key={it.id}>
                      <td className="font-money text-[11px] text-dmk-text-secondary">{it.sku}</td>
                      <td className="text-[12.5px] max-w-[200px] truncate">{it.productName}</td>
                      <td className="num text-[12.5px]">{it.quantity}</td>
                      <td className="num text-[12.5px]">{it.receivedQty || "—"}</td>
                      <td className="num text-[12.5px]">{formatINR(it.unitCost)}</td>
                      <td className="num text-[12.5px]">{formatINR(it.taxableAmount)}</td>
                      <td className="num text-[12px] text-dmk-text-secondary">{formatINR(gstAmt)} <span className="text-dmk-text-muted">({it.gstRate}%)</span></td>
                      <td className="num text-[12.5px] font-semibold">{formatINR(it.totalAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dmk-well px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>Taxable</span><Money value={d?.subtotal ?? 0} />
            </div>
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>GST (CGST {formatINR(d?.totalCgst ?? 0)} + SGST {formatINR(d?.totalSgst ?? 0)} + IGST {formatINR(d?.totalIgst ?? 0)})</span>
              <Money value={tax} />
            </div>
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>Grand Total</span>
              <Money value={d?.grandTotal ?? 0} className="text-dmk-yellow text-[15px]" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
