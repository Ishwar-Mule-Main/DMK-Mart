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
  X,
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
import { useT } from "@/lib/i18n";
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

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Display label for a return reason (the value itself is the API enum). */
function reasonLabel(t: TFn, reason: string): string {
  if (reason === "Transit Damage") return t("pret.rnTransit");
  if (reason === "Defective") return t("pret.rnDefective");
  if (reason === "Wrong Item") return t("pret.rnWrong");
  if (reason === "Expired") return t("pret.rnExpired");
  if (reason === "Other") return t("pret.rnOther");
  return reason;
}

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
  const { t } = useT();
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
            toast({ variant: "destructive", title: t("pret.toastLoadFail"), description: e.message });
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
    Other: "bg-dmk-yellow",
  };
  const vendorAgg = new Map<string, { name: string; count: number; value: number }>();
  for (const r of list) {
    const name = r.vendor?.vendorName ?? t("pret.noVendorOnFile");
    const key = r.vendorId ?? "NONE";
    const cur = vendorAgg.get(key) ?? { name, count: 0, value: 0 };
    vendorAgg.set(key, { name, count: cur.count + 1, value: cur.value + Number(r.grandTotal) });
  }
  const topVendors = [...vendorAgg.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 4);
  const topVendorMax = Math.max(1, topVendors[0]?.[1].value ?? 1);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pret.title")}
        subtitle={t("pret.subtitle")}
        icon={Undo2}
        actions={
          <Button
            size="sm"
            aria-expanded={newOpen}
            className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
            onClick={() => setNewOpen((o) => !o)}
          >
            {newOpen ? (
              <>
                <X className="h-4 w-4" /> {t("pret.closeForm")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> {t("pret.newDn")}
              </>
            )}
          </Button>
        }
      />

      {/* New debit note — inline container (no popup) */}
      {newOpen && (
        <NewDebitNotePanel
          onClose={() => setNewOpen(false)}
          onSaved={() => setRefresh((r) => r + 1)}
        />
      )}

      <SectionGrid
        list={
          <RegisterCard
            title={t("pret.cardTitle")}
            icon={Undo2}
            count={list.length}
            countLabel={t("pret.countReturns")}
            footer={
              <>
                <span><span className="font-money text-dmk-text-secondary">{formatINR(totalValue)}</span> {t("pret.footerReturned")}</span>
                <span><span className="font-money text-dmk-info">{formatINR(totalTax)}</span> {t("pret.footerItc")}</span>
                <span className="hidden sm:inline">{t("pret.footerPool")}</span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={RotateCcw}
                title={t("pret.emptyTitle")}
                hint={t("pret.emptyHint")}
              />
            ) : (
              list.map((r) => (
                <RegisterRow key={r.id} onClick={() => setViewOf(r)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-money text-[12px] text-dmk-text-primary shrink-0">{r.debitNoteNo}</span>
                      <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(r.returnDate)}</span>
                      {r.poRef && <span className="font-money text-[10.5px] text-dmk-text-muted truncate" title={t("pret.refTooltip", { po: r.poRef })}>{t("pret.refPrefix", { po: r.poRef })}</span>}
                    </div>
                    <Badge tone="dr">DEBIT NOTE</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-dmk-text-secondary truncate">
                      {r.vendor?.vendorName ?? <span className="text-dmk-text-muted">{t("pret.noVendorOnFile")}</span>}
                      <span className="text-dmk-text-muted">{t("pret.itemsN", { n: r.items.length })}</span>
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="text-[10.5px] text-dmk-text-muted hidden sm:inline">{t("pret.subTax", { sub: formatINR(r.subtotal), tax: formatINR(r.totalTax) })}</span>
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
              <KpiCard label={t("pret.kpiNotes")} value={String(list.length)} sub={t("pret.kpiNotesSub", { n: totalItems })} icon={Undo2} />
              <KpiCard label={t("pret.kpiReturned")} value={formatINR(totalValue)} sub={t("pret.kpiReturnedSub", { amt: formatINR(monthValue) })} icon={IndianRupee} tone="blue" />
              <KpiCard label={t("pret.kpiItc")} value={formatINR(totalTax)} sub={t("pret.kpiItcSub")} icon={FileWarning} tone="gold" />
              <KpiCard label={t("pret.kpiMonth")} value={formatINR(monthValue)} sub={t("pret.kpiMonthSub")} icon={AlertTriangle} tone={monthValue > 0 ? "orange" : "default"} />
            </div>

            <AsideCard
              title={t("pret.policyTitle")}
              icon={AlertTriangle}
              iconClass="text-dmk-warning"
              footnote={t("pret.policyNote")}
            >
              <p className="text-[12px] text-dmk-text-secondary leading-relaxed">
                {t("pret.policyPre")}<span className="font-semibold text-dmk-warning">{t("pret.policyDamaged")}</span>{t("pret.policyMid")}
                <span className="font-semibold text-dmk-info">{t("pret.policyPayable")}</span>{t("pret.policyPost")}
              </p>
            </AsideCard>

            <AsideCard title={t("pret.reasonMix")} icon={PackageX} iconClass="text-dmk-danger" footnote={t("pret.reasonMixNote")}>
              <div className="space-y-2.5">
                {reasonRows.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("pret.noReturns")}</p>
                ) : (
                  reasonRows.map(([reason, v]) => (
                    <MixBar
                      key={reason}
                      label={<>{reasonLabel(t, reason)} <span className="text-dmk-text-muted">{t("pret.qtyN", { n: v.count })}</span></>}
                      value={formatINR(v.value)}
                      pct={(v.value / reasonTotal) * 100}
                      barClass={reasonBar[reason] ?? "bg-dmk-yellow"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title={t("pret.recoveryTitle")}
              icon={Truck}
              iconClass="text-dmk-info"
              footnote={t("pret.recoveryNote")}
            >
              <div className="space-y-2.5">
                {topVendors.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("pret.noVendorsYet")}</p>
                ) : (
                  topVendors.map(([key, v]) => (
                    <MixBar
                      key={key}
                      label={<>{v.name} <span className="text-dmk-text-muted">{t("pret.dnCount", { n: v.count })}</span></>}
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

      <ViewReturnDialog row={viewOf} onClose={() => setViewOf(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// New debit note — INLINE CONTAINER (rendered in the page, not a popup)
// ═══════════════════════════════════════════════════════════════
interface DnLine {
  productId: string;
  qty: string; // damaged qty to return — 0 means "not returned"
  cost: string;
  reason: string;
  poQty?: number | null; // set when the row came from a vendor PO
  fromPo?: boolean;
}

type SettlementMode = "CREDIT" | "UPI_NEFT" | "CASH";

/** Settlement options — display labels come from the dict (value is the API enum). */
function settlementModes(t: TFn): Array<{ value: SettlementMode; short: string; sub: string }> {
  return [
    { value: "CREDIT", short: t("pret.settleCredit"), sub: t("pret.settleCreditSub") },
    { value: "UPI_NEFT", short: t("pret.settleUpi"), sub: t("pret.settleUpiSub") },
    { value: "CASH", short: t("pret.settleCash"), sub: t("pret.settleCashSub") },
  ];
}

interface PoLite {
  id: string;
  poNumber: string;
  poDate: string;
  grandTotal: number;
  vendorId: string;
  items: Array<{ productId: string; sku: string; productName: string; quantity: number; unitCost: number }>;
}

function NewDebitNotePanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();
  const firmStateCode = firm?.stateCode ?? "27";
  const SETTLEMENT_MODES = settlementModes(t);

  const [saving, setSaving] = React.useState(false);
  const [vendors, setVendors] = React.useState<Vendor[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [vendorId, setVendorId] = React.useState("NONE");
  const [poId, setPoId] = React.useState("NONE");
  const [poOptions, setPoOptions] = React.useState<PoLite[]>([]);
  const [settlementMode, setSettlementMode] = React.useState<SettlementMode>("CREDIT");
  const [returnDate, setReturnDate] = React.useState(toISODate(new Date()));
  const [lines, setLines] = React.useState<DnLine[]>([]);

  // Inline container: a fresh draft on every mount (rendered when open)
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  React.useEffect(() => {
    if (!activeFirmId) return;
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
  }, [activeFirmId]);

  // Load the vendor's CONFIRMED POs for the reference select
  React.useEffect(() => {
    if (!activeFirmId || vendorId === "NONE") {
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
  }, [activeFirmId, vendorId]);

  // Newest POs first — automatic, no toggle (fresh bills are usually
  // returned to the vendor first)
  const sortedPoOptions = React.useMemo(() => {
    const arr = [...poOptions];
    arr.sort((a, b) => {
      const da = new Date(a.poDate).getTime() || 0;
      const dbb = new Date(b.poDate).getTime() || 0;
      return dbb - da;
    });
    return arr;
  }, [poOptions]);

  // Selecting a PO auto-loads its lines at the PO prices — every row
  // starts with damaged qty 0 (not returned) until typed in.
  React.useEffect(() => {
    if (poId === "NONE") return;
    const po = poOptions.find((p) => p.id === poId);
    if (!po) return;
    setLines(
      po.items.map((it) => ({
        productId: it.productId,
        qty: "0",
        cost: String(it.unitCost ?? 0),
        reason: "Transit Damage",
        poQty: Number(it.quantity) || 0,
        fromPo: true,
      })),
    );
  }, [poId]);

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
  const returnRows = computed.filter((c) => num(c.line.qty) > 0);
  const overPoRows = returnRows.filter((c) => c.line.poQty != null && num(c.line.qty) > (c.line.poQty ?? 0));
  const linesValid = returnRows.length > 0 && returnRows.every((c) => num(c.line.qty) > 0 && num(c.line.cost) >= 0);
  const canSave = linesValid && stockErrors.length === 0 && overPoRows.length === 0;

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
      const res = await apiPost<{ purchaseReturn: PrRow; journal: unknown; settlementMode: SettlementMode }>("/api/v1/purchase-returns", {
        firmId: activeFirmId,
        vendorId: vendorId === "NONE" ? undefined : vendorId,
        poId: poId === "NONE" ? undefined : poId,
        returnDate,
        settlementMode,
        items: returnRows.map(({ line }) => ({
          productId: line.productId,
          damagedQty: num(line.qty),
          unitCost: num(line.cost),
          reason: line.reason,
        })),
      });
      const settleNote =
        settlementMode === "CREDIT"
          ? t("pret.noteCredit")
          : settlementMode === "UPI_NEFT"
            ? t("pret.noteUpi", { amt: formatINR(res.purchaseReturn?.grandTotal ?? 0) })
            : t("pret.noteCash", { amt: formatINR(res.purchaseReturn?.grandTotal ?? 0) });
      toast({
        title: t("pret.toastCreated", { dn: res.purchaseReturn?.debitNoteNo ?? "" }),
        description: t("pret.toastCreatedDesc", { note: settleNote }),
      });
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("pret.toastFailDesc");
      toast({
        variant: "destructive",
        title: e instanceof ApiError && (e.code === "ERR_NEGATIVE_STOCK" || e.code === "ERR_RETURN_EXCEEDS_PO") ? t("pret.toastInvalidQty") : t("pret.toastSaveFail"),
        description: msg,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={t("pret.formAria")}
      className="dmk-card relative overflow-hidden dmk-enter"
    >
      {/* Accent strip */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-dmk-blue via-dmk-info/50 to-transparent" />

      <div className="p-4 sm:p-5 space-y-4">
        {/* Panel header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 rounded-lg bg-dmk-info/12 border border-dmk-info/30 flex items-center justify-center shrink-0">
              <Undo2 className="h-4 w-4 text-dmk-info" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-dmk-text-primary">{t("pret.panelTitle")}</h2>
              <p className="text-[11.5px] text-dmk-text-muted leading-snug">
                {t("pret.panelDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("pret.formCloseAria")}
            className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label={t("cmn.vendor")} hint={t("pret.vendorHint")}>
            <Select
              value={vendorId}
              onValueChange={(v) => {
                setVendorId(v);
                setPoId("NONE");
                setLines([]); // scope may change — start clean
              }}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}>
                <SelectValue placeholder={t("pret.vendorPh")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("pret.noVendorOption")}</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.vendorName}
                    {v.vendorType === "MANUFACTURER" && v.brand ? t("pret.mfrSuffix", { brand: v.brand }) : t("pret.distributorSuffix")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("pret.invoicesLabel")}>
            <Select
              value={poId}
              onValueChange={setPoId}
              disabled={vendorId === "NONE"}
            >
              <SelectTrigger className={cn(inputCls, "w-full")}>
                <SelectValue placeholder={vendorId === "NONE" ? t("pret.pickVendorFirst") : t("pret.pickPoPh")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("pret.noneOption")}</SelectItem>
                {sortedPoOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.poNumber} · {formatDate(p.poDate)} · {formatINR(Number(p.grandTotal))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {t("pret.newestFirst")}
            </p>
          </Field>

          <Field label={t("pret.returnDate")}>
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputCls} />
          </Field>

          <Field label={t("pret.settlementLabel")}>
            <div className="grid grid-cols-3 gap-1.5">
              {SETTLEMENT_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setSettlementMode(m.value)}
                  title={`${m.short} — ${m.sub}`}
                  aria-pressed={settlementMode === m.value}
                  className={cn(
                    "h-9 rounded-md border px-1 text-[11px] font-medium leading-tight transition-colors",
                    settlementMode === m.value
                      ? "border-dmk-yellow bg-dmk-yellow text-[#0A0F1D] shadow-sm"
                      : "border-dmk-border-medium bg-transparent text-dmk-text-secondary hover:bg-dmk-hover",
                  )}
                >
                  {m.short}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-tight text-dmk-text-muted">
              {SETTLEMENT_MODES.find((m) => m.value === settlementMode)?.sub}
            </p>
          </Field>
        </div>

        {/* Item rows — auto-loaded from the PO (damaged qty per row) or manual */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
              {refPo ? t("pret.fromPo", { po: refPo.poNumber }) : t("pret.returnedItems")}
            </span>
            {refPo ? (
              <span className="text-[11px] text-dmk-text-muted">{t("pret.setQtyHint")}</span>
            ) : (
              <Select onValueChange={(pid) => {
                const p = productMap.get(pid);
                if (p) addProduct(p);
              }} value="">
                <SelectTrigger className={cn(inputCls, "w-full sm:w-[320px]")}>
                  <SelectValue placeholder={t("pret.addProductPh")} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                      {p.brand ? ` (${p.brand})` : ""} {t("pret.damagedQtyN", { n: p.damagedStock })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="text-[12px] text-dmk-text-muted dmk-well px-3 py-4 text-center">
              {refPo ? t("pret.noLinesOnPo") : vendorId === "NONE" ? t("pret.beginWithVendor") : t("pret.beginWithPo")}
            </p>
          ) : (
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {computed.map(({ line, product, taxable, gst, total, overStock }, i) => {
                const overPo = line.poQty != null && num(line.qty) > (line.poQty ?? 0);
                const inactive = !(num(line.qty) > 0);
                return (
                  <div key={`${line.productId}-${i}`} className={cn("dmk-card p-3", inactive && "opacity-60")}>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                      <div className="sm:col-span-4">
                        <span className="text-[12.5px] font-medium">
                          <span className="font-money text-[10.5px] text-dmk-text-muted mr-1.5">{product?.sku ?? "—"}</span>
                          {product?.name ?? line.productId}
                        </span>
                        <p className="text-[10.5px] text-dmk-text-muted mt-0.5">
                          {line.fromPo && (
                            <span className="mr-2">
                              {t("pret.poLinePrefix", { qty: line.poQty ?? 0, cost: formatINR(num(line.cost)) })}{" "}
                            </span>
                          )}
                          {t("pret.damagedInStock")}{" "}
                          <span className={cn("font-money", overStock ? "text-dmk-danger" : "text-dmk-text-secondary")}>
                            {product?.damagedStock ?? 0}
                          </span>
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        {line.fromPo && (
                          <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">{t("pret.damagedQtyLabel")}</label>
                        )}
                        <Input
                          type="number"
                          min={line.fromPo ? 0 : 1}
                          step="1"
                          value={line.qty}
                          onChange={(e) => updateLine(i, { qty: line.fromPo ? String(Math.max(0, Math.floor(Number(e.target.value) || 0))) : e.target.value })}
                          aria-label={line.fromPo ? t("pret.damagedQtyAria") : t("pret.returnQtyAria")}
                          className={cn(inputCls, "h-8 text-right font-money", (overStock || overPo) && "border-dmk-danger/60")}
                        />
                        {overPo && <span className="mt-0.5 block text-[10px] text-dmk-danger">{t("pret.maxQty", { n: line.poQty ?? 0 })}</span>}
                      </div>
                      {line.fromPo ? (
                        <div className="sm:col-span-2 text-right">
                          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted sm:text-left">{t("pret.colLineTotal")}</span>
                          <span className="font-money text-[12.5px] text-dmk-text-primary">{formatINR(total)}</span>
                        </div>
                      ) : (
                        <div className="sm:col-span-2">
                          <Field label={t("pret.colUnitCost")}>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.cost}
                              onChange={(e) => updateLine(i, { cost: e.target.value })}
                              className={cn(inputCls, "h-8 text-right font-money")}
                              aria-label={t("pret.colUnitCost")}
                            />
                          </Field>
                        </div>
                      )}
                      <div className="sm:col-span-3">
                        {line.fromPo && (
                          <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-dmk-text-muted">{t("pret.reasonLabel")}</label>
                        )}
                        <Select value={line.reason} onValueChange={(v) => updateLine(i, { reason: v })}>
                          <SelectTrigger className={cn(inputCls, "h-8 w-full")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {REASONS.map((r) => (
                              <SelectItem key={r} value={r}>{reasonLabel(t, r)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-1 flex sm:justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-dmk-text-muted hover:text-dmk-danger hover:bg-dmk-hover"
                          onClick={() => removeLine(i)}
                          aria-label={t("pret.removeLineAria")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11.5px] text-dmk-text-muted">
                      <span>{t("pret.colTaxable")} <span className="num text-dmk-text-secondary">{formatINR(taxable)}</span></span>
                      <span>
                        {intra ? t("pret.colCgstSgst") : t("pret.colIgst")}{" "}
                        <span className="num text-dmk-text-secondary">
                          {intra ? `${formatINR(gst.cgst)} + ${formatINR(gst.sgst)}` : formatINR(gst.igst)}
                        </span>
                      </span>
                      <span>{t("cmn.total")} <span className="num text-dmk-text-primary font-semibold">{formatINR(total)}</span></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {overPoRows.length > 0 && (
          <ErrorText>
            {t("pret.overPoErr", { n: overPoRows.length })}
          </ErrorText>
        )}

        {stockErrors.length > 0 && (
          <ErrorText>
            {t("pret.stockErrPre")}{" "}
            {stockErrors
              .map((c) => t("pret.stockErrItem", { name: c.product?.name ?? t("pret.itemFallback"), avail: c.product?.damagedStock ?? 0 }))
              .join(", ")}
            {t("pret.stockErrPost")}
          </ErrorText>
        )}

        {lines.length > 0 && (
          <div className="dmk-well px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>{t("pret.subtotalTaxable")}</span>
              <Money value={totals.taxable} />
            </div>
            {intra ? (
              <>
                <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                  <span>{t("pret.cgstReversal")}</span><Money value={totals.cgst} />
                </div>
                <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                  <span>{t("pret.sgstReversal")}</span><Money value={totals.sgst} />
                </div>
              </>
            ) : (
              <div className="flex justify-between text-[12px] text-dmk-text-secondary">
                <span>{t("pret.igstReversal")}</span><Money value={totals.igst} />
              </div>
            )}
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>
                {t("pret.dnTotal")}
                <span className="ml-2 text-[10.5px] font-normal uppercase tracking-wide text-dmk-text-muted">
                  {settlementMode === "CREDIT" ? t("pret.chipCredit") : settlementMode === "UPI_NEFT" ? t("pret.chipUpi") : t("pret.chipCash")}
                </span>
              </span>
              <Money value={grand} className="text-dmk-yellow text-[15px]" />
            </div>
          </div>
        )}

        {/* Panel footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-dmk-border-subtle pt-3">
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSave || saving} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {returnRows.length > 0 ? t("pret.createBtnN", { n: returnRows.length }) : t("pret.createBtn")}
          </Button>
        </div>
      </div>
    </div>
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
  const { t } = useT();
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-elevated border-dmk-border-medium">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary flex items-center gap-2.5">
            <FileWarning className="h-5 w-5 text-dmk-warning" /> {row?.debitNoteNo}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted">
            {row?.vendor?.vendorName ?? t("pret.noVendor")} · {row ? formatDate(row.returnDate) : ""}
            {row?.poRef ? t("pret.refPo", { po: row.poRef }) : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="dmk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[560px]">
              <thead>
                <tr>
                  <th>{t("cmn.product")}</th>
                  <th className="text-right">{t("pret.colQty")}</th>
                  <th className="text-right">{t("pret.colUnitCost")}</th>
                  <th className="text-right">GST</th>
                  <th className="text-right">{t("cmn.total")}</th>
                  <th>{t("pret.reasonLabel")}</th>
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
                    <td><Badge tone={reasonTone(it.reason)}>{reasonLabel(t, it.reason)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dmk-well px-4 py-3 space-y-1">
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>{t("pret.subtotal")}</span><Money value={row?.subtotal ?? 0} />
            </div>
            <div className="flex justify-between text-[12px] text-dmk-text-secondary">
              <span>{t("pret.taxReversal")}</span><Money value={row?.totalTax ?? 0} />
            </div>
            <div className="flex justify-between text-[13.5px] font-semibold text-dmk-text-primary pt-1 border-t border-dmk-border-subtle">
              <span>{t("pret.dnTotal")}</span>
              <Money value={row?.grandTotal ?? 0} className="text-dmk-yellow text-[15px]" />
            </div>
          </div>
        </div>

        {row?.notes && (
          <p className="text-[12px] text-dmk-text-secondary">
            <span className="text-dmk-text-muted uppercase tracking-wider text-[10.5px] font-semibold mr-2">{t("cmn.notes")}</span>
            {row.notes}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">
            {t("cmn.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
