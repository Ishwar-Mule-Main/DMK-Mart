"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SALES ORDERS VIEW (owner portal)
// The deep-scan order pipeline:
//   1. UPLOAD — order PDF / scan / photo / WhatsApp text hits the AI
//      deep-scanning engine (OCR + table structure parser).
//   2. MATCH  — dual intelligent matcher links the buyer (phone →
//      GSTIN → name) and every line to the DMK catalog.
//   3. STAGING TERMINAL — original document on the left, editable
//      draft on the right: unmatched customers/products pop their
//      pre-filled quick-add modals, quantities/rates are corrected
//      inline against live availability.
//   4. CONFIRM & BOOK — SalesOrder CONFIRMED: sellable stock
//      reserved, 4-digit Delivery OTP stamped, order pushed to the
//      Trip Planner's unassigned pool (auto-billed at dispatch).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ScanSearch,
  RefreshCw,
  FileUp,
  ClipboardList,
  Sparkles,
  UserPlus,
  PackagePlus,
  CheckCircle2,
  AlertTriangle,
  X,
  Trash2,
  Loader2,
  Truck,
  Eye,
  Ban,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useT, type TFn } from "@/lib/i18n";
import { formatINR, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  KpiCard,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  RegisterCard,
  RegisterRow,
  AsideCard,
} from "../shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ───────────────────────────────────────────────────────

interface StagedProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  hsnCode: string;
  gstRate: number;
  stockQuantity: number;
  reservedQty: number;
  available: number;
  tiers: Record<string, number>;
}

interface StagedItemView {
  id: string;
  rawName: string;
  quantity: number;
  uom: string;
  statedPrice: number;
  appliedPrice: number;
  discountPercent: number;
  isUnlisted: boolean;
  matchConfidence: number;
  matchMethod: string;
  linePosition: number;
  matchedSkuId: string | null;
  product: StagedProduct | null;
  available: number;
}

interface StagedCustomer {
  id: string;
  partyName: string;
  firmName: string;
  phone: string;
  city: string;
  address: string;
  gstin: string;
  assignedTier: string;
  creditLimit: number;
  closingBalance: number;
  customerType: string;
}

interface StagedDetail {
  id: string;
  source: string;
  status: string;
  originalFileName: string;
  originalFileType: string;
  hasFile: boolean;
  scanModel: string;
  scanNote: string;
  extracted: {
    businessName: string;
    contactPerson: string;
    phone: string;
    address: string;
    city: string;
    gstin: string;
  };
  customer: StagedCustomer | null;
  customerMatchMethod: string;
  customerMatchScore: number;
  confirmedSalesOrderId: string;
  confirmedAt: string | null;
  createdAt: string;
  items: StagedItemView[];
  subtotal: number;
  itemCount: number;
  unlistedCount: number;
}

interface StagedListRow {
  id: string;
  source: string;
  status: string;
  originalFileName: string;
  scanModel: string;
  scanNote: string;
  extracted: { businessName: string; phone: string; city: string };
  customer: { id: string; partyName: string; city: string; assignedTier: string } | null;
  customerMatchMethod: string;
  customerMatchScore: number;
  confirmedSalesOrderId: string;
  createdAt: string;
  itemCount: number;
  unlistedCount: number;
  subtotal: number;
}

interface StagedTotals {
  needsReview: number;
  booked: number;
  unlistedLines: number;
}

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
}

interface SalesOrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: "BOOKED" | "CONFIRMED" | "CONVERTED" | "CANCELLED";
  estimatedTotal: number;
  deliveryOtp: string;
  stockReserved: boolean;
  notes: string;
  customer?: { id: string; partyName: string; phone: string; city: string } | null;
  items?: Array<{ id: string; productName: string; quantity: number; unitPrice: number }>;
  salesMember?: { fullName: string; username: string } | null;
}

interface OrderTotals {
  count: number;
  booked: number;
  estimatedAmount: number;
}

const TIER_LABELS: Record<string, string> = {
  tier1Distributor: "Distributor",
  tier2Wholesale: "Wholesale",
  tier3SemiWholesale: "Semi-Wholesale",
  tier4Retailer: "Retailer",
  tier5Mrp: "MRP",
};

/** Translated tier label (falls back to the raw English label). */
function tierLabelOf(t: TFn, key: string): string {
  switch (key) {
    case "tier1Distributor": return t("sale.tierDistributor");
    case "tier2Wholesale": return t("sale.tierWholesale");
    case "tier3SemiWholesale": return t("sale.tierSemiWholesale");
    case "tier4Retailer": return t("sale.tierRetailer");
    case "tier5Mrp": return t("sale.tierMrp");
    default: return TIER_LABELS[key] ?? key;
  }
}

function statusBadge(status: string) {
  const map: Record<string, "warning" | "success" | "info" | "danger" | "neutral"> = {
    NEEDS_REVIEW: "warning",
    BOOKED: "success",
    DISCARDED: "neutral",
    CONFIRMED: "success",
    CONVERTED: "info",
    CANCELLED: "danger",
  };
  return <Badge tone={map[status] ?? "neutral"}>{status.replace("_", " ")}</Badge>;
}

const SOURCE_LABEL: Record<string, string> = {
  PDF_UPLOAD: "PDF",
  IMAGE_UPLOAD: "SCAN",
  WHATSAPP_TEXT: "WHATSAPP",
};

// ═══════════════════════════════════════════════════════════════
// MAIN VIEW
// ═══════════════════════════════════════════════════════════════

export default function SalesOrdersView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);

  const [stagedRows, setStagedRows] = React.useState<StagedListRow[] | null>(null);
  const [stagedTotals, setStagedTotals] = React.useState<StagedTotals>({ needsReview: 0, booked: 0, unlistedLines: 0 });
  const [statusFilter, setStatusFilter] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const [orders, setOrders] = React.useState<SalesOrderRow[] | null>(null);
  const [orderTotals, setOrderTotals] = React.useState<OrderTotals>({ count: 0, booked: 0, estimatedAmount: 0 });
  const [ordersLoading, setOrdersLoading] = React.useState(true);

  const [openStagedId, setOpenStagedId] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [confirmOf, setConfirmOf] = React.useState<SalesOrderRow | null>(null);
  const [cancelOf, setCancelOf] = React.useState<SalesOrderRow | null>(null);
  const [busyOrderId, setBusyOrderId] = React.useState("");
  const [bookingResult, setBookingResult] = React.useState<{
    orderNumber: string;
    deliveryOtp: string;
    estimatedTotal: number;
    warnings: string[];
    mode: string;
  } | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  const loadStaged = React.useCallback(() => {
    if (!activeFirmId) return;
    setLoading(true);
    apiGet<{ orders: StagedListRow[]; totals: StagedTotals }>("/api/v1/sales-orders/staged", {
      firmId: activeFirmId,
      status: statusFilter || undefined,
    })
      .then((r) => {
        setStagedRows(r.orders ?? []);
        setStagedTotals(r.totals ?? { needsReview: 0, booked: 0, unlistedLines: 0 });
      })
      .catch((e) => {
        setStagedRows([]);
        if (e instanceof ApiError)
          toast({ variant: "destructive", title: t("so.errLoadQueue"), description: e.message });
      })
      .finally(() => setLoading(false));
  }, [activeFirmId, statusFilter, toast, t]);

  const loadOrders = React.useCallback(() => {
    if (!activeFirmId) return;
    setOrdersLoading(true);
    apiGet<{ orders: SalesOrderRow[]; totals: OrderTotals }>("/api/v1/sales-orders", { firmId: activeFirmId })
      .then((r) => {
        setOrders(r.orders ?? []);
        setOrderTotals(r.totals ?? { count: 0, booked: 0, estimatedAmount: 0 });
      })
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false));
  }, [activeFirmId]);

  React.useEffect(() => {
    loadStaged();
  }, [loadStaged, refresh]);
  React.useEffect(() => {
    loadOrders();
  }, [loadOrders, refresh]);

  const filteredStaged = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stagedRows ?? [];
    return (stagedRows ?? []).filter((o) =>
      [o.extracted.businessName, o.extracted.phone, o.extracted.city, o.customer?.partyName ?? "", o.originalFileName]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [stagedRows, query]);

  const confirmedOrders = (orders ?? []).filter((o) => o.status === "CONFIRMED");

  async function scanFile(file: File) {
    if (!activeFirmId) return;
    setScanning(true);
    try {
      const form = new FormData();
      form.set("firmId", activeFirmId);
      form.set("file", file);
      const res = await fetch("/api/v1/sales-orders/staged", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new ApiError(json.error || "Scan failed", json.code || "ERR_UNKNOWN", res.status);
      const staged = json.data.staged as StagedDetail;
      toast({
        title: t("so.toastScanDone"),
        description: `${t("so.scanLines", { n: staged.itemCount })} · ${t("so.scanUnmatched", { n: staged.unlistedCount })} · ${staged.customer ? t("so.scanCustMatched") : t("so.scanCustReview")}`,
      });
      setRefresh((r) => r + 1);
      setOpenStagedId(staged.id);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("so.toastScanFailed"),
        description: e instanceof Error ? e.message : t("so.errScanDoc"),
      });
    } finally {
      setScanning(false);
    }
  }

  async function scanPastedText() {
    if (!activeFirmId || !pasteText.trim()) return;
    setScanning(true);
    try {
      const staged = await apiPost<{ staged: StagedDetail }>("/api/v1/sales-orders/staged", {
        firmId: activeFirmId,
        text: pasteText.trim(),
      }).then((r) => r.staged);
      toast({ title: t("so.toastScanDone"), description: t("so.toastScanTextDesc", { n: staged.itemCount }) });
      setPasteOpen(false);
      setPasteText("");
      setRefresh((r) => r + 1);
      setOpenStagedId(staged.id);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("so.toastScanFailed"),
        description: e instanceof Error ? e.message : t("so.errScanText"),
      });
    } finally {
      setScanning(false);
    }
  }

  async function confirmOrder(order: SalesOrderRow) {
    if (!activeFirmId) return;
    setBusyOrderId(order.id);
    try {
      const res = await apiPost<{
        orderNumber: string;
        deliveryOtp: string;
        warnings: string[];
        salesOrder: SalesOrderRow;
      }>(`/api/v1/sales-orders/${order.id}/confirm`, { firmId: activeFirmId });
      setBookingResult({
        orderNumber: res.orderNumber,
        deliveryOtp: res.deliveryOtp,
        estimatedTotal: order.estimatedTotal,
        warnings: res.warnings ?? [],
        mode: "CONFIRMED",
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("so.toastConfirmFail"),
        description: e instanceof Error ? e.message : t("sale.tryAgain"),
      });
    } finally {
      setBusyOrderId("");
      setConfirmOf(null);
    }
  }

  async function cancelOrder(order: SalesOrderRow) {
    if (!activeFirmId) return;
    setBusyOrderId(order.id);
    try {
      await apiPatch(`/api/v1/sales-orders/${order.id}`, { status: "CANCELLED" });
      toast({ title: t("so.toastCancelOk", { no: order.orderNumber }), description: t("so.toastCancelOkDesc") });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("so.toastCancelFail"),
        description: e instanceof Error ? e.message : t("sale.tryAgain"),
      });
    } finally {
      setBusyOrderId("");
      setCancelOf(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.salesOrders")}
        subtitle={t("so.subtitle")}
        icon={ClipboardList}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => setRefresh((r) => r + 1)}
            >
              <RefreshCw className="h-4 w-4" /> {t("cmn.refresh")}
            </Button>
            <Button
              size="sm"
              className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
              onClick={() => setPasteOpen(true)}
            >
              <MessageSquareText className="h-4 w-4" /> {t("so.pasteWhatsapp")}
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <KpiCard
          label={t("so.kpiNeedsReview")}
          value={String(stagedTotals.needsReview)}
          sub={stagedTotals.unlistedLines > 0 ? t("so.kpiUnmatched", { n: stagedTotals.unlistedLines }) : t("so.kpiQueueClear")}
          icon={ScanSearch}
          tone={stagedTotals.needsReview > 0 ? "yellow" : "default"}
        />
        <KpiCard
          label={t("so.kpiConfirmed")}
          value={String(confirmedOrders.length)}
          sub={t("so.kpiWaitingTrip")}
          icon={Truck}
          tone="info"
        />
        <KpiCard
          label={t("so.kpiBookValue")}
          value={formatINR(orderTotals.estimatedAmount)}
          sub={t("so.kpiOrdersTotal", { n: orderTotals.count })}
          icon={ClipboardList}
          tone="gold"
        />
        <KpiCard
          label={t("so.kpiDrafts")}
          value={String((orders ?? []).filter((o) => o.status === "BOOKED").length)}
          sub={t("so.kpiNoReservation")}
          icon={AlertTriangle}
          tone={(orders ?? []).some((o) => o.status === "BOOKED") ? "orange" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4">
        {/* LEFT — staging queue + order book */}
        <div className="min-w-0 flex flex-col gap-4">
          <RegisterCard
            title={t("so.stagingTitle")}
            icon={ScanSearch}
            count={filteredStaged.length}
            countLabel={t("so.uploads")}
            filters={
              <>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ["", t("cmn.all")],
                    ["NEEDS_REVIEW", t("so.fNeedsReview")],
                    ["BOOKED", t("so.fBooked")],
                    ["DISCARDED", t("so.fDiscarded")],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setStatusFilter(value)}
                      className={cn(
                        "h-7 rounded-full px-3 text-[11.5px] font-semibold transition-colors",
                        statusFilter === value
                          ? "bg-dmk-yellow text-[#0A0F1D]"
                          : "bg-dmk-input-well text-dmk-text-secondary hover:text-dmk-text-primary"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <SearchInput value={query} onChange={setQuery} placeholder={t("so.searchPh")} />
              </>
            }
            footer={
              <>
                <span>{t("so.footerScan")}</span>
              </>
            }
          >
            {loading ? (
              <LoadingRows rows={5} />
            ) : filteredStaged.length === 0 ? (
              <EmptyState
                icon={FileUp}
                title={t("so.emptyUploads")}
                hint={t("so.emptyUploadsHint")}
              />
            ) : (
              filteredStaged.map((o) => (
                <RegisterRow key={o.id} onClick={() => o.status === "NEEDS_REVIEW" && setOpenStagedId(o.id)}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                      <ScanSearch className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] font-semibold text-dmk-text-primary truncate">
                          {o.customer?.partyName || o.extracted.businessName || t("so.unknownBuyer")}
                        </p>
                        <Badge tone="neutral">{SOURCE_LABEL[o.source] ?? o.source}</Badge>
                        {statusBadge(o.status)}
                        {o.unlistedCount > 0 && o.status === "NEEDS_REVIEW" && (
                          <Badge tone="warning">{t("so.unmatchedBadge", { n: o.unlistedCount })}</Badge>
                        )}
                      </div>
                      <p className="text-[11.5px] text-dmk-text-muted truncate mt-0.5">
                        {o.originalFileName} · {t("so.lineCount", { n: o.itemCount })} ·{" "}
                        {formatDate(o.createdAt)}
                        {o.customerMatchMethod ? ` · ${t("so.matchedBy", { method: o.customerMatchMethod.toLowerCase() })}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-money text-[13px] font-semibold text-dmk-yellow">{formatINR(o.subtotal)}</p>
                      {o.status === "NEEDS_REVIEW" ? (
                        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-blue">
                          {t("so.openStaging")}
                        </span>
                      ) : o.confirmedSalesOrderId ? (
                        <span className="text-[10.5px] text-dmk-text-muted">{t("so.soBooked")}</span>
                      ) : null}
                    </div>
                  </div>
                </RegisterRow>
              ))
            )}
          </RegisterCard>

          <RegisterCard
            title={t("so.orderBook")}
            icon={ClipboardList}
            count={(orders ?? []).length}
            countLabel={t("so.orders")}
            footer={
              <>
                <span>{t("so.footerConfirmed")}</span>
              </>
            }
          >
            {ordersLoading ? (
              <LoadingRows rows={5} />
            ) : (orders ?? []).length === 0 ? (
              <EmptyState icon={ClipboardList} title={t("so.emptyOrders")} hint={t("so.emptyOrdersHint")} />
            ) : (
              (orders ?? []).slice(0, 30).map((o) => (
                <RegisterRow key={o.id}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-money text-[13px] font-semibold text-dmk-text-primary">{o.orderNumber}</p>
                        {statusBadge(o.status)}
                        {o.deliveryOtp && (
                          <Badge tone="gold">OTP {o.deliveryOtp}</Badge>
                        )}
                        {o.stockReserved && <Badge tone="info">{t("so.stockHeld")}</Badge>}
                      </div>
                      <p className="text-[11.5px] text-dmk-text-muted truncate mt-0.5">
                        {o.customer?.partyName ?? "—"}
                        {o.customer?.city ? ` · ${o.customer.city}` : ""} · {formatDate(o.orderDate)}
                        {o.salesMember ? ` · ${t("so.bookedBy", { name: o.salesMember.fullName })}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-money text-[13px] font-semibold text-dmk-text-primary">
                        {formatINR(o.estimatedTotal)}
                      </p>
                      {o.status === "BOOKED" && (
                        <Button
                          size="sm"
                          className="h-7 bg-dmk-yellow px-2.5 text-[11px] font-bold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                          disabled={busyOrderId === o.id}
                          onClick={() => setConfirmOf(o)}
                        >
                          {busyOrderId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t("cmn.confirm")}
                        </Button>
                      )}
                      {(o.status === "BOOKED" || o.status === "CONFIRMED") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] text-dmk-danger hover:bg-[rgba(239,68,68,0.12)]"
                          disabled={busyOrderId === o.id}
                          onClick={() => setCancelOf(o)}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </RegisterRow>
              ))
            )}
          </RegisterCard>
        </div>

        {/* RIGHT — scanner + playbook */}
        <aside className="min-w-0 flex flex-col gap-4">
          <UploadCard scanning={scanning} onFile={scanFile} onPaste={() => setPasteOpen(true)} />

          <AsideCard
            title={t("so.playbookTitle")}
            icon={ShieldCheck}
            iconClass="text-dmk-success"
            footnote={t("so.playbookFoot")}
          >
            <ul className="space-y-2 text-[12px] text-dmk-text-secondary">
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-dmk-success" strokeWidth={1.75} />
                <span>{t("so.pbReserve")}</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-dmk-success" strokeWidth={1.75} />
                <span>{t("so.pbOtp")}</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-dmk-success" strokeWidth={1.75} />
                <span>{t("so.pbTrip")}</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-dmk-success" strokeWidth={1.75} />
                <span>{t("so.pbInvoice")}</span>
              </li>
            </ul>
          </AsideCard>

          <AsideCard title={t("so.engineTitle")} icon={Sparkles} footnote={t("so.engineFoot")}>
            <div className="space-y-1.5 text-[12px] text-dmk-text-secondary">
              <p>{t("so.engineLine1")}</p>
              <p className="text-dmk-text-muted">
                {t("so.engineLine2")}
              </p>
            </div>
          </AsideCard>
        </aside>
      </div>

      {/* Staging terminal */}
      {openStagedId && (
        <StagingTerminal
          stagedId={openStagedId}
          onClose={(changed) => {
            setOpenStagedId(null);
            if (changed) setRefresh((r) => r + 1);
          }}
          onBooked={(result) => {
            setOpenStagedId(null);
            setBookingResult(result);
            setRefresh((r) => r + 1);
          }}
        />
      )}

      {/* Paste WhatsApp order */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-dmk-yellow" /> {t("so.pasteTitle")}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {t("so.pasteDesc")}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder={"e.g.\nParihar Trading, Wagholi — 9822099881\nBalaji Dustbin Padel 107 × 24\nAp Container 5-7-12 kg × 180\nBlack Bucket 20 Ltr × 36"}
            className="w-full rounded-lg border border-dmk-border-subtle bg-dmk-input-well p-3 text-[12.5px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus:outline-none focus:ring-1 focus:ring-dmk-yellow/50"
          />
          <DialogFooter>
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={() => setPasteOpen(false)}>
              {t("cmn.cancel")}
            </Button>
            <Button
              className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
              disabled={scanning || !pasteText.trim()}
              onClick={scanPastedText}
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {scanning ? t("so.scanningBtn") : t("so.scanBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm a draft SO */}
      <Dialog open={!!confirmOf} onOpenChange={(v) => !v && setConfirmOf(null)}>
        <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary">{t("so.confirmTitle", { no: confirmOf?.orderNumber ?? "" })}</DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {t("so.confirmDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={() => setConfirmOf(null)}>
              {t("so.notYet")}
            </Button>
            <Button
              className="h-9 bg-dmk-success text-[#0A0F1D] hover:brightness-110"
              disabled={!!busyOrderId}
              onClick={() => confirmOf && confirmOrder(confirmOf)}
            >
              {t("so.confirmPush")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel an SO */}
      <Dialog open={!!cancelOf} onOpenChange={(v) => !v && setCancelOf(null)}>
        <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary">{t("so.cancelTitle", { no: cancelOf?.orderNumber ?? "" })}</DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {cancelOf?.status === "CONFIRMED"
                ? t("so.cancelDescConfirmed")
                : t("so.cancelDescDraft")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={() => setCancelOf(null)}>
              {t("so.keepOrder")}
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              disabled={!!busyOrderId}
              onClick={() => cancelOf && cancelOrder(cancelOf)}
            >
              {t("so.cancelOrderBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Booking success — OTP front and centre */}
      <Dialog open={!!bookingResult} onOpenChange={(v) => !v && setBookingResult(null)}>
        <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <CheckCircle2 className="h-5 w-5 text-dmk-success" />
              {bookingResult?.mode === "CONFIRMED" ? t("so.bookedTitle") : t("so.draftSaved")}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted text-[12px]">
              {bookingResult?.orderNumber} · {bookingResult ? formatINR(bookingResult.estimatedTotal) : ""}
            </DialogDescription>
          </DialogHeader>
          {bookingResult?.deliveryOtp ? (
            <div className="rounded-xl border border-dmk-border-subtle bg-dmk-input-well p-4 text-center">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-dmk-text-muted">{t("so.otpPrints")}</p>
              <p className="font-money text-[38px] font-bold tracking-[0.35em] text-dmk-yellow mt-1">{bookingResult.deliveryOtp}</p>
            </div>
          ) : null}
          {bookingResult && bookingResult.warnings.length > 0 && (
            <div className="rounded-lg border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] p-3 space-y-1.5">
              {bookingResult.warnings.map((w, i) => (
                <p key={i} className="flex gap-2 text-[12px] text-[#F5A623]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}
          <DialogFooter>
            {bookingResult?.mode === "CONFIRMED" && (
              <Button
                className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
                onClick={() => {
                  setBookingResult(null);
                  setView("logistics/planner");
                }}
              >
                <Truck className="h-4 w-4" /> {t("so.openPlanner")}
              </Button>
            )}
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={() => setBookingResult(null)}>
              {t("cmn.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD CARD (drag & drop + file picker)
// ═══════════════════════════════════════════════════════════════

function UploadCard({
  scanning,
  onFile,
  onPaste,
}: {
  scanning: boolean;
  onFile: (f: File) => void;
  onPaste: () => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { t } = useT();

  return (
    <AsideCard title={t("so.uploadTitle")} icon={FileUp} iconClass="text-dmk-yellow">
      <div
        role="button"
        tabIndex={0}
        aria-label={t("so.uploadAria")}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragOver
            ? "border-dmk-yellow bg-[rgba(245,197,24,0.07)]"
            : "border-dmk-border-medium hover:border-dmk-yellow/60 hover:bg-dmk-hover/40"
        )}
      >
        {scanning ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-dmk-yellow" strokeWidth={1.5} />
            <p className="text-[13px] font-semibold text-dmk-text-primary">{t("so.scanningTitle")}</p>
            <p className="text-[11px] text-dmk-text-muted">{t("so.scanningSub")}</p>
          </>
        ) : (
          <>
            <ScanSearch className="h-7 w-7 text-dmk-text-muted" strokeWidth={1.5} />
            <p className="text-[13px] font-semibold text-dmk-text-primary">{t("so.dropHere")}</p>
            <p className="text-[11px] text-dmk-text-muted">{t("so.browse")}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <Button
        variant="outline"
        className="mt-3 h-8 w-full border-dmk-border-subtle text-[12px] text-dmk-text-secondary hover:bg-dmk-hover"
        onClick={onPaste}
      >
        <MessageSquareText className="h-3.5 w-3.5" /> {t("so.orPaste")}
      </Button>
    </AsideCard>
  );
}

// ═══════════════════════════════════════════════════════════════
// STAGING TERMINAL — original left, editable draft right
// ═══════════════════════════════════════════════════════════════

interface EditableLine {
  key: string;
  id?: string;
  rawName: string;
  matchedSkuId: string;
  quantity: number;
  uom: string;
  statedPrice: number;
  appliedPrice: number;
  discountPercent: number;
  isUnlisted: boolean;
}

function StagingTerminal({
  stagedId,
  onClose,
  onBooked,
}: {
  stagedId: string;
  onClose: (changed: boolean) => void;
  onBooked: (result: { orderNumber: string; deliveryOtp: string; estimatedTotal: number; warnings: string[]; mode: string }) => void;
}) {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [detail, setDetail] = React.useState<StagedDetail | null>(null);
  const [lines, setLines] = React.useState<EditableLine[]>([]);
  const [products, setProducts] = React.useState<ProductRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [booking, setBooking] = React.useState(false);
  const [error, setError] = React.useState("");

  const [newCustomerOpen, setNewCustomerOpen] = React.useState(false);
  const [quickAddLine, setQuickAddLine] = React.useState<EditableLine | null>(null);
  const [changeCustomerOpen, setChangeCustomerOpen] = React.useState(false);

  const fileUrl = `/api/v1/sales-orders/staged/${stagedId}/file`;
  const isImage = detail?.originalFileType.startsWith("image/") ?? false;
  const isPdf = detail?.originalFileType === "application/pdf";
  const isText = detail?.originalFileType.startsWith("text/") ?? false;

  const loadDetail = React.useCallback(() => {
    setLoading(true);
    apiGet<{ staged: StagedDetail }>(`/api/v1/sales-orders/staged/${stagedId}`)
      .then((r) => {
        setDetail(r.staged);
        setLines(
          (r.staged.items ?? []).map((i, idx) => ({
            key: `${i.id}-${idx}`,
            id: i.id,
            rawName: i.rawName,
            matchedSkuId: i.matchedSkuId ?? "",
            quantity: i.quantity,
            uom: i.uom,
            statedPrice: i.statedPrice,
            appliedPrice: i.appliedPrice,
            discountPercent: i.discountPercent,
            isUnlisted: i.isUnlisted,
          }))
        );
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t("so.errLoadUpload"));
      })
      .finally(() => setLoading(false));
  }, [stagedId, t]);

  React.useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const refetchProducts = React.useCallback(() => {
    if (!activeFirmId) return;
    apiGet<{ products: ProductRow[] }>("/api/v1/products", { firmId: activeFirmId, activeOnly: "true" })
      .then((r) => setProducts(r.products ?? []))
      .catch(() => {});
  }, [activeFirmId]);

  React.useEffect(() => {
    refetchProducts();
  }, [refetchProducts]);

  function productById(id: string): ProductRow | undefined {
    return products.find((p) => p.id === id);
  }

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let gst = 0;
    for (const l of lines) {
      const rate = l.appliedPrice > 0 ? l.appliedPrice : l.statedPrice;
      const disc = rate * (l.discountPercent / 100);
      const line = Math.max(0, l.quantity * (rate - disc));
      subtotal += line;
      const p = l.matchedSkuId ? detail?.items.find((d) => d.matchedSkuId === l.matchedSkuId)?.product : null;
      gst += line * ((p?.gstRate ?? 18) / 100);
    }
    return { subtotal, gst, net: subtotal + gst };
  }, [lines, detail]);

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        rawName: "",
        matchedSkuId: "",
        quantity: 1,
        uom: "Pcs",
        statedPrice: 0,
        appliedPrice: 0,
        discountPercent: 0,
        isUnlisted: true,
      },
    ]);
  }

  function mapSku(key: string, skuId: string) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    if (!skuId) {
      updateLine(key, { matchedSkuId: "", isUnlisted: true });
      return;
    }
    const stagedProduct = detail?.items.find((d) => d.matchedSkuId === skuId)?.product;
    const tierPrice = stagedProduct?.tiers?.tier4Retailer ?? 0;
    updateLine(key, {
      matchedSkuId: skuId,
      isUnlisted: false,
      rawName: line.rawName || productById(skuId)?.name || "",
      uom: stagedProduct?.unit ?? line.uom,
      appliedPrice: line.appliedPrice > 0 ? line.appliedPrice : tierPrice,
    });
  }

  async function persistLines(): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const payload = {
        items: lines.map((l) => ({
          rawName: l.rawName || productById(l.matchedSkuId)?.name || "Item",
          matchedSkuId: l.matchedSkuId || "",
          quantity: Number(l.quantity) || 0,
          uom: l.uom || "Pcs",
          statedPrice: Number(l.statedPrice) || 0,
          appliedPrice: Number(l.appliedPrice) || 0,
          discountPercent: Number(l.discountPercent) || 0,
        })),
      };
      const r = await apiPatch<{ staged: StagedDetail }>(`/api/v1/sales-orders/staged/${stagedId}`, payload);
      setDetail(r.staged);
      // The server replaced every row (delete + recreate) — sync the
      // editable lines so quick-add carries the fresh item ids.
      setLines(
        (r.staged.items ?? []).map((i, idx) => ({
          key: `${i.id}-${idx}`,
          id: i.id,
          rawName: i.rawName,
          matchedSkuId: i.matchedSkuId ?? "",
          quantity: i.quantity,
          uom: i.uom,
          statedPrice: i.statedPrice,
          appliedPrice: i.appliedPrice,
          discountPercent: i.discountPercent,
          isUnlisted: i.isUnlisted,
        }))
      );
      toast({ title: t("so.toastLinesSaved") });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("so.errSaveDraft"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    try {
      await apiPatch(`/api/v1/sales-orders/staged/${stagedId}`, { status: "DISCARDED" });
      toast({ title: t("so.toastDiscarded"), description: t("so.toastDiscardedDesc") });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("so.errDiscard"));
    }
  }

  async function book(mode: "DRAFT" | "CONFIRMED") {
    if (lines.length === 0) {
      setError(t("so.errKeepOne"));
      return;
    }
    setBooking(true);
    setError("");
    try {
      const saved = await persistLines();
      if (!saved) return;
      const r = await apiPost<{
        orderNumber: string;
        deliveryOtp: string;
        estimatedTotal: number;
        warnings: string[];
        status: string;
      }>(`/api/v1/sales-orders/staged/${stagedId}/confirm`, { mode });
      onBooked({
        orderNumber: r.orderNumber,
        deliveryOtp: r.deliveryOtp,
        estimatedTotal: r.estimatedTotal,
        warnings: r.warnings ?? [],
        mode,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("so.errBook"));
    } finally {
      setBooking(false);
    }
  }

  const shortLines = lines.filter((l) => {
    if (!l.matchedSkuId) return false;
    const p = detail?.items.find((d) => d.matchedSkuId === l.matchedSkuId)?.product;
    return p ? l.quantity > p.available : false;
  });

  return (
    <>
    <Dialog open onOpenChange={(v) => !v && onClose(false)}>
      <DialogContent className="sm:max-w-[1400px] sm:w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] w-[calc(100vw-1rem)] h-[calc(100vh-4rem)] dmk-card border-dmk-border-subtle bg-[#0B1322] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-dmk-border-subtle shrink-0">
          <DialogTitle className="flex items-center gap-2 text-dmk-text-primary text-[16px]">
            <ScanSearch className="h-5 w-5 text-dmk-yellow" />
            Staging terminal — {detail?.customer?.partyName || detail?.extracted.businessName || "Review & book"}
            {detail && <Badge tone="neutral">{SOURCE_LABEL[detail.source] ?? detail.source}</Badge>}
            {detail && statusBadge(detail.status)}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            {detail?.originalFileName} · scanned by {detail?.scanModel || "AI engine"}
            {detail?.scanNote ? ` · ${detail.scanNote}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 p-6">
            <LoadingRows rows={8} />
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center text-dmk-text-muted text-[13px]">{error || "Upload not found"}</div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-0 overflow-hidden">
            {/* LEFT — original document */}
            <div className="min-w-0 border-b lg:border-b-0 lg:border-r border-dmk-border-subtle flex flex-col bg-[#090E1A]">
              <div className="px-4 py-2 border-b border-dmk-border-subtle flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-dmk-text-muted" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">{t("so.origDocument")}</p>
              </div>
              <div className="flex-1 overflow-auto p-3">
                {isImage && (
                  <img src={fileUrl} alt={`Original order document: ${detail.originalFileName}`} className="max-w-full h-auto rounded-lg border border-dmk-border-subtle" />
                )}
                {isPdf && (
                  <iframe title="Original order PDF" src={fileUrl} className="w-full h-full min-h-[480px] rounded-lg border border-dmk-border-subtle bg-white" />
                )}
                {isText && (
                  <pre className="whitespace-pre-wrap rounded-lg border border-dmk-border-subtle bg-dmk-input-well p-4 text-[12.5px] leading-relaxed text-dmk-text-secondary font-mono">
                    <TextPreview url={fileUrl} />
                  </pre>
                )}
                {!detail.hasFile && (
                  <EmptyState icon={Eye} title="No stored document" hint="This upload has no previewable file." />
                )}
              </div>
            </div>

            {/* RIGHT — editable draft */}
            <div className="min-w-0 flex flex-col overflow-hidden">
              <div className="px-4 py-2 border-b border-dmk-border-subtle flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-dmk-yellow" />
                <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">Parsed draft — review &amp; edit</p>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 dmk-scroll">
                {/* Customer block */}
                {detail.customer ? (
                  <div className="rounded-xl border border-dmk-border-subtle bg-dmk-input-well p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13.5px] font-bold text-dmk-text-primary truncate">{detail.customer.partyName}</p>
                          <Badge tone="success">{TIER_LABELS[detail.customer.assignedTier] ?? detail.customer.assignedTier}</Badge>
                          {detail.customerMatchMethod === "NEW" ? (
                            <Badge tone="info">NEW CUSTOMER</Badge>
                          ) : detail.customerMatchMethod ? (
                            <Badge tone="info">matched · {detail.customerMatchMethod.toLowerCase()} {Math.round((detail.customerMatchScore || 0) * 100)}%</Badge>
                          ) : null}
                        </div>
                        <p className="text-[11.5px] text-dmk-text-muted mt-1 truncate">
                          {[detail.customer.phone, detail.customer.city, detail.customer.gstin].filter(Boolean).join(" · ") || "no contact details"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-dmk-border-subtle text-[11px] text-dmk-text-secondary"
                        onClick={() => setChangeCustomerOpen(true)}
                      >
                        Change
                      </Button>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2 text-[11.5px]">
                      <Badge tone={detail.customer.closingBalance > 0.005 ? "dr" : "neutral"}>
                        Ledger Dr {formatINR(detail.customer.closingBalance)}
                      </Badge>
                      <Badge tone="neutral">Credit limit {formatINR(detail.customer.creditLimit)}</Badge>
                      {detail.customer.closingBalance + totals.subtotal > detail.customer.creditLimit && (
                        <Badge tone="warning">
                          <AlertTriangle className="mr-1 inline h-3 w-3" />
                          This order pushes them past the credit limit
                        </Badge>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.07)] p-3.5">
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-[#F5A623]" />
                      <p className="text-[13px] font-bold text-[#F5A623]">NEW CUSTOMER DETECTED IN DOCUMENT</p>
                    </div>
                    <p className="text-[11.5px] text-dmk-text-secondary mt-1.5">
                      {detail.extracted.businessName || "Unnamed buyer"}
                      {detail.extracted.phone ? ` · ${detail.extracted.phone}` : ""}
                      {detail.extracted.city ? ` · ${detail.extracted.city}` : ""}
                      {detail.extracted.gstin ? ` · GSTIN ${detail.extracted.gstin}` : ""}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="h-8 bg-dmk-yellow text-[12px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                        onClick={() => setNewCustomerOpen(true)}
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Review &amp; save customer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-dmk-border-subtle text-[12px] text-dmk-text-secondary"
                        onClick={() => setChangeCustomerOpen(true)}
                      >
                        Link an existing customer
                      </Button>
                    </div>
                  </div>
                )}

                {/* Line items */}
                <div className="rounded-xl border border-dmk-border-subtle overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 border-b border-dmk-border-subtle bg-dmk-input-well/50">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                      Line items ({lines.length})
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-dmk-blue hover:bg-dmk-hover"
                      onClick={addLine}
                    >
                      + Add item
                    </Button>
                  </div>
                  <div className="divide-y divide-dmk-border-subtle">
                    {lines.map((l, idx) => {
                      const prod = l.matchedSkuId ? detail.items.find((d) => d.matchedSkuId === l.matchedSkuId)?.product ?? null : null;
                      const rate = l.appliedPrice > 0 ? l.appliedPrice : l.statedPrice;
                      const lineTotal = Math.max(0, (Number(l.quantity) || 0) * (rate - rate * ((Number(l.discountPercent) || 0) / 100)));
                      const short = prod ? (Number(l.quantity) || 0) > prod.available : false;
                      return (
                        <div key={l.key} className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dmk-input-well text-[10px] font-bold text-dmk-text-muted">
                              {idx + 1}
                            </span>
                            <input
                              value={l.rawName}
                              onChange={(e) => updateLine(l.key, { rawName: e.target.value })}
                              placeholder="Item description (as printed)"
                              className={cn(inputCls, "h-8 flex-1 text-[12.5px]")}
                            />
                            <button
                              onClick={() => removeLine(l.key)}
                              aria-label={`Delete row ${idx + 1}`}
                              className="h-8 w-8 shrink-0 rounded-lg text-dmk-text-muted hover:bg-[rgba(239,68,68,0.12)] hover:text-dmk-danger"
                            >
                              <Trash2 className="h-4 w-4 mx-auto" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <label className="col-span-2 sm:col-span-1">
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Catalog SKU</span>
                              <select
                                value={l.matchedSkuId}
                                onChange={(e) => mapSku(l.key, e.target.value)}
                                className={cn(inputCls, "mt-1 h-8 w-full text-[12px]")}
                              >
                                <option value="">— Unmatched —</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku} · {p.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Qty</span>
                              <input
                                type="number"
                                min={0}
                                value={l.quantity}
                                onChange={(e) => updateLine(l.key, { quantity: Number(e.target.value) })}
                                className={cn(inputCls, "mt-1 h-8 w-full text-[12.5px]", short && "border-[rgba(245,158,11,0.6)] text-[#F5A623]")}
                              />
                            </label>
                            <label>
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Rate ₹</span>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={l.appliedPrice || l.statedPrice}
                                onChange={(e) => updateLine(l.key, { appliedPrice: Number(e.target.value) })}
                                className={cn(inputCls, "mt-1 h-8 w-full text-[12.5px]")}
                              />
                            </label>
                            <label>
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-dmk-text-muted">Disc %</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={l.discountPercent}
                                onChange={(e) => updateLine(l.key, { discountPercent: Number(e.target.value) })}
                                className={cn(inputCls, "mt-1 h-8 w-full text-[12.5px]")}
                              />
                            </label>
                            <div className="flex flex-col justify-end">
                              <span className="text-[9.5px] font-bold uppercase tracking-wider text-dmk-text-muted">{t("so.lineTotal")}</span>
                              <span className="font-money text-[13px] font-semibold text-dmk-text-primary mt-1">{formatINR(lineTotal)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {l.matchedSkuId && prod ? (
                              <>
                                <Badge tone="success">{prod.sku}</Badge>
                                <span className="text-[11px] text-dmk-text-muted truncate max-w-[240px]">{prod.name}</span>
                                <Badge tone={short ? "warning" : "neutral"}>
                                  {short ? (
                                    <>
                                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                                      avail {prod.available} — short {(Number(l.quantity) - prod.available).toLocaleString()}
                                    </>
                                  ) : (
                                    `available ${prod.available}`
                                  )}
                                </Badge>
                              </>
                            ) : (
                              <>
                                <Badge tone="warning">
                                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                                  Unmatched: &ldquo;{l.rawName || "line"}&rdquo;
                                </Badge>
                                <Button
                                  size="sm"
                                  className="h-6 bg-[rgba(245,158,11,0.15)] px-2 text-[11px] font-semibold text-[#F5A623] hover:bg-[rgba(245,158,11,0.25)]"
                                  onClick={() => setQuickAddLine(l)}
                                >
                                  <PackagePlus className="h-3 w-3" /> Add to catalog
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {lines.length === 0 && (
                      <p className="px-4 py-6 text-center text-[12px] text-dmk-text-muted">No lines — add one with “+ Add item”.</p>
                    )}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-xl border border-dmk-border-subtle bg-dmk-input-well/40 p-3.5 space-y-1.5 text-[12.5px]">
                  <div className="flex justify-between text-dmk-text-secondary">
                    <span>{t("so.itemsSubtotal")}</span>
                    <span className="font-money">{formatINR(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-dmk-text-secondary">
                    <span>GST (estimated at billing)</span>
                    <span className="font-money">{formatINR(totals.gst)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dmk-border-subtle pt-1.5 text-[13.5px] font-bold text-dmk-text-primary">
                    <span>Net payable (est.)</span>
                    <span className="font-money text-dmk-yellow">{formatINR(totals.net)}</span>
                  </div>
                  {shortLines.length > 0 && (
                    <p className="flex gap-2 text-[11.5px] text-[#F5A623] pt-1">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {shortLines.length} line{shortLines.length === 1 ? "" : "s"} exceed available stock — they book as pre-orders.
                    </p>
                  )}
                </div>

                {error && (
                  <p className="text-[12px] text-dmk-danger bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-md px-3 py-2">
                    {error}
                  </p>
                )}
              </div>

              {/* Footer actions */}
              <div className="shrink-0 border-t border-dmk-border-subtle p-3 flex flex-wrap items-center justify-end gap-2 bg-[#0B1322]">
                <Button
                  variant="ghost"
                  className="h-9 text-[12.5px] text-dmk-danger hover:bg-[rgba(239,68,68,0.12)]"
                  onClick={discard}
                >
                  <X className="h-4 w-4" /> Discard
                </Button>
                <Button
                  variant="outline"
                  className="h-9 border-dmk-border-subtle text-[12.5px] text-dmk-text-secondary hover:bg-dmk-hover"
                  disabled={saving || booking}
                  onClick={() => book("DRAFT")}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save draft
                </Button>
                <Button
                  className="h-9 bg-dmk-success text-[12.5px] font-bold text-[#0A0F1D] hover:brightness-110"
                  disabled={saving || booking || !detail.customer || lines.some((l) => !l.matchedSkuId)}
                  onClick={() => book("CONFIRMED")}
                >
                  {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirm &amp; Book SO
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      </Dialog>

      {/* Quick-add customer modal */}
      {detail && (
        <NewCustomerModal
          open={newCustomerOpen || changeCustomerOpen}
          mode={newCustomerOpen ? "create" : "link"}
          staged={detail}
          onClose={() => {
            setNewCustomerOpen(false);
            setChangeCustomerOpen(false);
          }}
          onSaved={(staged) => {
            setDetail(staged);
            setNewCustomerOpen(false);
            setChangeCustomerOpen(false);
            toast({ title: "Customer attached", description: staged.customer?.partyName ?? "" });
          }}
        />
      )}

      {/* Quick-add product modal */}
      {detail && quickAddLine && (
        <NewProductModal
          stagedId={detail.id}
          line={quickAddLine}
          suggestedGst={detail.items.find((d) => d.matchedSkuId === quickAddLine.matchedSkuId)?.product?.gstRate ?? 18}
          onClose={() => setQuickAddLine(null)}
          onSaved={(staged) => {
            setDetail(staged);
            refetchProducts();
            setLines((prev) =>
              prev.map((l) => {
                if (l.key !== quickAddLine.key) return l;
                const fresh = staged.items.find((d) => d.id === l.id) ?? staged.items.find((d) => d.rawName === l.rawName && d.matchMethod === "NEW");
                return fresh
                  ? {
                      ...l,
                      id: fresh.id,
                      matchedSkuId: fresh.matchedSkuId ?? "",
                      isUnlisted: false,
                      appliedPrice: fresh.appliedPrice || l.appliedPrice,
                      uom: fresh.uom || l.uom,
                    }
                  : l;
              })
            );
            setQuickAddLine(null);
            toast({ title: "Product added to catalog", description: "Mapped onto this order line." });
          }}
        />
      )}
    </>
  );
}

/** Tiny fetch-and-render for pasted-text previews. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = React.useState("Loading…");
  React.useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText("(could not load text)"));
  }, [url]);
  return <>{text}</>;
}

// ═══════════════════════════════════════════════════════════════
// NEW CUSTOMER MODAL (pre-filled from the scan) + existing picker
// ═══════════════════════════════════════════════════════════════

function NewCustomerModal({
  open,
  mode,
  staged,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "link";
  staged: StagedDetail;
  onClose: () => void;
  onSaved: (staged: StagedDetail) => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [form, setForm] = React.useState({
    businessName: staged.extracted.businessName,
    contactPerson: staged.extracted.contactPerson,
    phone: staged.extracted.phone,
    city: staged.extracted.city,
    address: staged.extracted.address,
    gstin: staged.extracted.gstin,
    assignedTier: "tier2Wholesale",
    creditLimit: "50000",
  });
  const [saving, setSaving] = React.useState(false);
  const [customers, setCustomers] = React.useState<Array<{ id: string; partyName: string; phone: string; city: string }>>([]);
  const [pickId, setPickId] = React.useState("");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!activeFirmId || !open) return;
    apiGet<Array<{ id: string; partyName: string; phone: string; city: string }>>("/api/v1/customers", { firmId: activeFirmId })
      .then((r) => setCustomers(Array.isArray(r) ? r : []))
      .catch(() => setCustomers([]));
  }, [activeFirmId, open]);

  async function saveAndAttach() {
    if (!staged) return;
    setSaving(true);
    try {
      const r = await apiPost<{ staged: StagedDetail }>(`/api/v1/sales-orders/staged/${staged.id}/customer`, {
        businessName: form.businessName,
        contactPerson: form.contactPerson,
        phone: form.phone,
        city: form.city,
        address: form.address,
        gstin: form.gstin,
        assignedTier: form.assignedTier,
        creditLimit: Number(form.creditLimit) || 0,
      });
      onSaved(r.staged);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not save the customer",
        description: e instanceof Error ? e.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  }

  async function linkExisting() {
    if (!pickId) return;
    setSaving(true);
    try {
      const r = await apiPatch<{ staged: StagedDetail }>(`/api/v1/sales-orders/staged/${staged.id}`, { customerId: pickId });
      onSaved(r.staged);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not link the customer",
        description: e instanceof Error ? e.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  }

  const filteredCustomers = customers
    .filter((c) =>
      search.trim() ? `${c.partyName} ${c.phone} ${c.city}`.toLowerCase().includes(search.trim().toLowerCase()) : true
    )
    .slice(0, 60);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
            <UserPlus className="h-4 w-4 text-dmk-yellow" />
            {mode === "create" ? "New customer detected in the document" : "Link an existing customer"}
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            {mode === "create"
              ? "Pre-filled from the scan — verify and save to the master directory with one click."
              : "Search the buyer directory and attach the right account to this order."}
          </DialogDescription>
        </DialogHeader>

        {mode === "create" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Business name">
                <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={cn(inputCls, "w-full")} />
              </Field>
            </div>
            <Field label="Contact person">
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className={cn(inputCls, "w-full")} />
            </Field>
            <Field label="Mobile number">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={cn(inputCls, "w-full")} />
            </Field>
            <Field label="City / route">
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={cn(inputCls, "w-full")} />
            </Field>
            <Field label="GSTIN (optional)">
              <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} className={cn(inputCls, "w-full")} />
            </Field>
            <div className="col-span-2">
              <Field label="Delivery address">
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={cn(inputCls, "w-full")} />
              </Field>
            </div>
            <Field label="Default tier">
              <select value={form.assignedTier} onChange={(e) => setForm({ ...form, assignedTier: e.target.value })} className={cn(inputCls, "w-full")}>
                {Object.entries(TIER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Credit limit ₹">
              <input type="number" min={0} value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} className={cn(inputCls, "w-full")} />
            </Field>
          </div>
        ) : (
          <div className="space-y-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search shop, phone, city…" />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-dmk-border-subtle divide-y divide-dmk-border-subtle">
              {filteredCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPickId(c.id)}
                  className={cn(
                    "w-full px-3 py-2 text-left hover:bg-dmk-hover transition-colors",
                    pickId === c.id && "bg-dmk-hover"
                  )}
                >
                  <p className="text-[12.5px] font-semibold text-dmk-text-primary">{c.partyName}</p>
                  <p className="text-[11px] text-dmk-text-muted">{[c.phone, c.city].filter(Boolean).join(" · ")}</p>
                </button>
              ))}
              {filteredCustomers.length === 0 && <p className="px-3 py-4 text-[12px] text-dmk-text-muted">No matches.</p>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={onClose}>
            Cancel
          </Button>
          {mode === "create" ? (
            <Button className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" disabled={saving || !form.businessName.trim()} onClick={saveAndAttach}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; attach to order
            </Button>
          ) : (
            <Button className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" disabled={saving || !pickId} onClick={linkExisting}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Attach to order
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// NEW PRODUCT MODAL (pre-filled from the PDF line)
// ═══════════════════════════════════════════════════════════════

function NewProductModal({
  stagedId,
  line,
  suggestedGst,
  onClose,
  onSaved,
}: {
  stagedId: string;
  line: EditableLine;
  suggestedGst: number;
  onClose: () => void;
  onSaved: (staged: StagedDetail) => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [form, setForm] = React.useState({
    name: line.rawName,
    category: "Cleaning / Household",
    unit: line.uom || "Pcs",
    hsnCode: "3924",
    gstRate: String(suggestedGst),
    purchasePrice: "",
    wholesaleRate: line.statedPrice ? String(line.statedPrice) : "",
    retailRate: "",
    openingStock: "0",
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    if (!activeFirmId || !line.id) {
      toast({
        variant: "destructive",
        title: "Save the draft first",
        description: "New rows must be saved before they can be quick-added — press Save draft, then Add to catalog.",
      });
      return;
    }
    setSaving(true);
    try {
      const r = await apiPost<{ staged: StagedDetail }>(
        `/api/v1/sales-orders/staged/${stagedId}/product`,
        {
          stagedItemId: line.id,
          name: form.name,
          category: form.category,
          unit: form.unit,
          hsnCode: form.hsnCode,
          gstRate: Number(form.gstRate) || 18,
          purchasePrice: Number(form.purchasePrice) || 0,
          wholesaleRate: Number(form.wholesaleRate) || 0,
          retailRate: Number(form.retailRate) || 0,
          openingStock: Number(form.openingStock) || 0,
        }
      );
      onSaved(r.staged);
    } catch (e) {
      toast({ variant: "destructive", title: "Could not add the product", description: e instanceof Error ? e.message : "Try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dmk-card border-dmk-border-subtle bg-[#0D1527] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
            <PackagePlus className="h-4 w-4 text-[#F5A623]" /> Add unlisted product to DMK catalog
          </DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            Scanned from the order line: &ldquo;{line.rawName}&rdquo; — once saved it is permanently in the catalog and mapped to this order.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Product name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cn(inputCls, "w-full")} />
            </Field>
          </div>
          <Field label="Category">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
          <Field label="Unit of measure">
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={cn(inputCls, "w-full")}>
              {["Pcs", "Set", "Box", "Carton", "Packet", "Kg", "Ltr"].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label="HSN code">
            <input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
          <Field label="GST rate %">
            <select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} className={cn(inputCls, "w-full")}>
              {[0, 5, 12, 18, 28].map((g) => (
                <option key={g} value={String(g)}>
                  {g}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Purchase price ₹">
            <input type="number" min={0} step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
          <Field label="Wholesale rate ₹">
            <input type="number" min={0} step="0.01" value={form.wholesaleRate} onChange={(e) => setForm({ ...form, wholesaleRate: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
          <Field label="Retail / MRP ₹">
            <input type="number" min={0} step="0.01" value={form.retailRate} onChange={(e) => setForm({ ...form, retailRate: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
          <Field label="Opening stock">
            <input type="number" min={0} value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} className={cn(inputCls, "w-full")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary" onClick={onClose}>
            Discard line
          </Button>
          <Button className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" disabled={saving || !form.name.trim()} onClick={save}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save &amp; add to order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
