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
import { rankSearch } from "@/lib/search-rank";
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
import { useT } from "@/lib/i18n";
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
  const { t } = useT();
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
            toast({ variant: "destructive", title: t("po.toastLoadFail"), description: e.message });
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
      title: t("po.toastPayOpening"),
      description: t("po.toastPayOpeningDesc", { po: po.poNumber, amt: formatINR(po.outstanding) }),
    });
  }

  async function confirmCancel() {
    if (!cancelOf) return;
    setCancelling(true);
    try {
      await apiPost<PoRow>(`/api/v1/purchase-orders/${cancelOf.id}/cancel`, {});
      toast({ title: t("po.toastCancelled"), description: t("po.toastCancelledDesc", { po: cancelOf.poNumber }) });
      setCancelOf(null);
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("po.toastCancelFail"),
        description: e instanceof ApiError ? e.message : t("po.toastCancelFailDesc"),
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
        title={t("po.title")}
        subtitle={t("po.subtitle")}
        icon={ClipboardList}
        actions={
          <Button
            size="sm"
            className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
            onClick={() => setView("purchase/new-order")}
          >
            <Plus className="h-4 w-4" /> {t("po.newPo")}
          </Button>
        }
      />

      <SectionGrid
        list={
          <RegisterCard
            title={t("po.cardTitle")}
            icon={ClipboardList}
            count={list.length}
            countLabel={t("po.countOrders")}
            filters={
              <>
                <div className="relative flex-1 min-w-0">
                  <SearchInput value={query} onChange={setQuery} placeholder={t("po.searchPh")} className="pl-9" />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                </div>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className={cn(inputCls, "w-full sm:w-[170px] shrink-0")}>
                    <SelectValue placeholder={t("po.allStatuses")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">{t("po.allStatuses")}</SelectItem>
                    <SelectItem value="PENDING">{t("po.stPending")}</SelectItem>
                    <SelectItem value="CONFIRMED">{t("po.stConfirmed")}</SelectItem>
                    <SelectItem value="CANCELLED">{t("po.stCancelled")}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            footer={
              <>
                <span><span className="font-money text-dmk-warning">{pendingCount}</span> {t("po.footerAtVerification")}</span>
                {openPayable > 0.009 && (
                  <span><span className="font-money text-dmk-blue">{formatINR(openPayable)}</span> {t("po.footerOpenPayable")} <span className="text-dmk-info font-semibold">{t("po.pay")}</span></span>
                )}
                <span className="hidden sm:inline">{t("po.footerAcceptance")}</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={7} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={t("po.emptyTitle")}
                hint={t("po.emptyHint")}
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
                            <span className="block text-[10px] text-dmk-text-muted" title={t("po.billTooltip")}>
                              {t("po.billPrefix")} {po.vendorBillNo}
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
                        <span className="text-dmk-text-muted">{t("po.itemsTax", { n: po.items.length, tax: formatINR(tax) })}</span>
                      </span>
                      <span className="flex items-baseline gap-2 shrink-0">
                        <span className="font-money text-[13px] font-semibold text-dmk-text-primary">{formatINR(po.grandTotal)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] shrink-0">
                        {po.status !== "CONFIRMED" ? (
                          <span className="text-dmk-text-muted">{t("po.balanceDash")}</span>
                        ) : settled ? (
                          <Badge tone="success">{t("po.settled")}</Badge>
                        ) : osd !== undefined ? (
                          <span className="font-money font-semibold text-dmk-blue">{t("po.balanceAmt", { amt: formatINR(osd) })}</span>
                        ) : (
                          <span className="text-dmk-text-muted">{t("po.balanceEllipsis")}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {payable && (
                          <button
                            type="button"
                            onClick={() => payFromRow(po)}
                            title={t("po.payTooltip", { po: po.poNumber, amt: formatINR(osd ?? 0) })}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-all border-dmk-border-medium bg-dmk-input-well hover:bg-dmk-hover text-dmk-info hover:border-dmk-info/40"
                          >
                            <HandCoins className="h-3 w-3" /> {t("po.pay")}
                          </button>
                        )}
                        {po.status === "PENDING" && (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-[11px] bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold"
                              onClick={() => {
                                setView("purchase/verification");
                                toast({ title: t("po.toastInVerification", { po: po.poNumber }), description: t("po.toastInVerificationDesc") });
                              }}
                            >
                              <PackageSearch className="h-3 w-3" /> {t("po.verify")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setEditOf(po)} aria-label={t("po.editAria", { po: po.poNumber })}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-dmk-border-subtle text-dmk-danger hover:bg-dmk-hover" onClick={() => setCancelOf(po)} aria-label={t("po.cancelAria", { po: po.poNumber })}>
                              <X className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {po.status !== "PENDING" && (
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setViewOf(po)}>
                            <Eye className="h-3 w-3" /> {t("po.view")}
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
              <KpiCard label={t("po.kpiValue")} value={formatINR(totalValue)} sub={t("po.kpiValueSub", { n: list.length })} icon={IndianRupee} tone="orange" />
              <KpiCard label={t("po.kpiVerification")} value={String(pendingCount)} sub={t("po.kpiVerificationSub", { amt: formatINR(pendingValue) })} icon={Timer} tone={pendingCount > 0 ? "gold" : "success"} />
              <KpiCard label={t("po.kpiConfirmed")} value={formatINR(confirmedValue)} sub={t("po.kpiConfirmedSub")} icon={PackageCheck} tone="success" />
              <KpiCard label={t("po.kpiOpenPayable")} value={formatINR(openPayable)} sub={t("po.kpiOpenPayableSub")} icon={Truck} tone="blue" />
            </div>

            <AsideCard title={t("po.statusMix")} icon={Layers} iconClass="text-dmk-info" footnote={t("po.statusMixNote")}>
              <div className="space-y-2.5">
                {statusRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("po.noOrdersFiltered")}</p>
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
              title={t("po.topVendors")}
              icon={Truck}
              iconClass="text-dmk-yellow"
              footnote={t("po.topVendorsNote")}
            >
              <div className="space-y-2.5">
                {topVendors.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("po.noVendorsYet")}</p>
                ) : (
                  topVendors.map(([, v]) => (
                    <MixBar
                      key={v.name}
                      label={<>{v.name} <span className="text-dmk-text-muted">{t("po.poCount", { n: v.count })}</span></>}
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
            <AlertDialogTitle className="text-dmk-text-primary">{t("po.cancelQ", { po: cancelOf?.poNumber ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-secondary">
              {t("po.cancelDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
              {t("po.keepPo")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              disabled={cancelling}
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
            >
              {t("po.cancelPo")}
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
  const { t } = useT();
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
  const pickable = rankSearch(
    products.filter((p) => {
      if (!p.isActive) return false;
      if (isManufacturer && vendor) {
        const brandMatch = !!vendor.brand && p.brand.toLowerCase() === vendor.brand.toLowerCase();
        if (p.manufacturerVendorId !== vendor.id && !brandMatch) return false;
      }
      return true;
    }),
    pickQuery,
    (p) => [p.sku, p.name, p.category, p.brand]
  );

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
        toast({ title: t("po.toastUpdated"), description: t("po.toastUpdatedDesc", { po: editing.poNumber }) });
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
        toast({ title: t("po.toastCreated", { po: created.poNumber }), description: t("po.toastCreatedDesc") });
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const isLocked = e instanceof ApiError && (e.code === "ERR_NOT_EDITABLE" || e.status === 409);
      toast({
        variant: "destructive",
        title: isLocked ? t("po.toastLocked") : t("po.toastSaveFail"),
        description: e instanceof ApiError ? e.message : t("po.toastSaveFailDesc"),
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
            {editing ? t("po.editTitle", { po: editing.poNumber }) : t("po.newTitle")}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {editing
              ? t("po.editDesc")
              : t("po.newDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field label={t("po.vendorField")}>
              <Select
                value={vendorId}
                onValueChange={(v) => {
                  setVendorId(v);
                  setLines([]); // brand scope changes → clear lines
                }}
                disabled={!!editing}
              >
                <SelectTrigger className={cn(inputCls, "w-full")}>
                  <SelectValue placeholder={t("po.vendorPh")} />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.vendorName}
                      {v.vendorType === "MANUFACTURER" && v.brand ? t("po.mfrSuffix", { brand: v.brand }) : t("po.distributorSuffix")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label={t("po.dateField")}>
            <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {/* Vendor bill identity — powers bill-first GSTR-2B matching */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t("po.billNoField")} hint={t("po.billNoHint")}>
            <Input
              value={vendorBillNo}
              onChange={(e) => setVendorBillNo(e.target.value)}
              className={inputCls}
              placeholder={t("po.billNoPh")}
            />
          </Field>
          <Field label={t("po.billDateField")}>
            <Input
              type="date"
              value={vendorBillDate}
              onChange={(e) => setVendorBillDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="hidden sm:block self-end pb-1 text-[10.5px] text-dmk-text-muted leading-snug">
            {t("po.billNoNote")}
          </div>
        </div>

        {isManufacturer && vendor && (
          <div className="dmk-well px-3 py-2 text-[11.5px] text-dmk-gold flex items-center gap-2">
            <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold">{t("po.brandScope")}</span>
            {t("po.brandScopePre")} <span className="font-semibold">{vendor.brand}</span>{t("po.brandScopePost")}
          </div>
        )}
        {vendor && (
          <div className="dmk-well px-3 py-2 text-[11.5px] text-dmk-text-muted">
            {t("po.gstMode")}{" "}
            {intra ? (
              <span className="text-dmk-info">{t("po.gstIntra", { state: vendor.stateCode })}</span>
            ) : (
              <span className="text-dmk-gold">{t("po.gstInter", { v: vendor.stateCode, f: firmStateCode })}</span>
            )}
          </div>
        )}

        {/* Product picker */}
        <div className="space-y-2">
          <div className="relative">
            <SearchInput
              value={pickQuery}
              onChange={setPickQuery}
              placeholder={vendor ? t("po.pickPh") : t("po.pickNoVendorPh")}
              className="pl-9"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
          </div>
          <div className="dmk-card max-h-44 overflow-y-auto overflow-x-hidden">
            {!vendor ? (
              <p className="text-[12px] text-dmk-text-muted px-3 py-4 text-center">{t("po.pickVendorFirst")}</p>
            ) : pickable.length === 0 ? (
              <p className="text-[12px] text-dmk-text-muted px-3 py-4 text-center">
                {isManufacturer ? t("po.noBrandMatch", { brand: vendor?.brand ?? "" }) : t("po.noMatch")}
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
                        <span className="dmk-badge dmk-badge-info">{t("po.addChip")}</span>
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
                {t("po.noLines")}
              </p>
            ) : (
              <table className="dmk-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>{t("cmn.product")}</th>
                    <th className="text-right w-[92px]">{t("po.colQty")}</th>
                    <th className="text-right w-[118px]">{t("po.colUnitCost")}</th>
                    <th className="text-right">{t("po.colTaxable")}</th>
                    <th className="text-right">{intra ? t("po.colCgstSgst") : t("po.colIgst")}</th>
                    <th className="text-right">{t("po.colLineTotal")}</th>
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
                            aria-label={t("po.qtyAria", { name: line.name })}
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
                            aria-label={t("po.costAria", { name: line.name })}
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
                            aria-label={t("po.removeAria", { name: line.name })}
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
                <span>{t("po.colTaxable")}</span>
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
                <span>{t("po.grandTotal")}</span>
                <Money value={grand} className="text-dmk-yellow text-[15px]" />
              </div>
            </div>
          )}
        </div>

        <Field label={t("cmn.notes")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder={t("po.notesPh")} />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSave || saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {editing ? t("cmn.saveChanges") : t("po.createPo")}
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
  const { t } = useT();
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
              <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">{t("po.vendorBillLabel")}</span>
              <span className="font-money text-dmk-text-primary">{d.vendorBillNo}</span>
            </span>
            {d.vendorBillDate && (
              <span className="text-dmk-text-muted">{t("po.dated", { date: formatDate(d.vendorBillDate) })}</span>
            )}
            <span className="text-[10.5px] text-dmk-gold">{t("po.billMatching")}</span>
          </div>
        )}
        {d?.receivedNote && (
          <div className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">{t("po.receivedNote")}</span>
            {d.receivedNote}
          </div>
        )}
        {d?.notes && (
          <div className="dmk-well px-3 py-2 text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted font-semibold uppercase tracking-wider text-[10.5px] mr-2">{t("cmn.notes")}</span>
            {d.notes}
          </div>
        )}

        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t("cmn.sku")}</th>
                  <th>{t("cmn.product")}</th>
                  <th className="text-right">{t("po.colQty")}</th>
                  <th className="text-right">{t("po.colReceived")}</th>
                  <th className="text-right">{t("po.colUnitCost")}</th>
                  <th className="text-right">{t("po.colTaxable")}</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">{t("cmn.total")}</th>
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
              <span>{t("po.colTaxable")}</span><Money value={d?.subtotal ?? 0} />
            </div>
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>GST (CGST {formatINR(d?.totalCgst ?? 0)} + SGST {formatINR(d?.totalSgst ?? 0)} + IGST {formatINR(d?.totalIgst ?? 0)})</span>
              <Money value={tax} />
            </div>
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>{t("po.grandTotal")}</span>
              <Money value={d?.grandTotal ?? 0} className="text-dmk-yellow text-[15px]" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
