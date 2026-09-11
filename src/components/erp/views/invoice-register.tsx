"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — INVOICE REGISTER (B2B + B2C counter)
// Search, type filter, CSV export, full-detail dialog → A4 docs.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Download, FileText, HandCoins, ReceiptText, Search, Zap, IndianRupee, Clock3, CheckCircle2, Layers } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, downloadCSV, amountInWords } from "@/lib/format";
import type { Invoice } from "@/types/erp";
import {
  PageHeader,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  inputCls,
  SectionGrid,
  RegisterCard,
  RegisterRow,
  AsideCard,
  MixBar,
  KpiCard,
} from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
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
import { requestSettleInvoice } from "@/lib/settle-bus";
import { cn } from "@/lib/utils";

/** List rows carry a partial customer (id, partyName, customerType, stateCode). */
type InvoiceListRow = Omit<Invoice, "customer"> & {
  customer?: { id: string; partyName: string; customerType: string; stateCode: string } | null;
};

function paymentBadge(mode: string): "warning" | "success" | "info" | "neutral" {
  switch (mode) {
    case "CREDIT": return "warning";
    case "CASH": return "success";
    case "UPI": return "info";
    default: return "neutral";
  }
}

export default function InvoiceRegisterView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);

  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "b2b" | "counter">("all");
  const [rows, setRows] = React.useState<InvoiceListRow[] | null>(null);
  const [detail, setDetail] = React.useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<InvoiceListRow[]>("/api/v1/invoices", {
          firmId: activeFirmId,
          search: query.trim(),
          isCounterSale: filter === "all" ? undefined : filter === "counter" ? "true" : "false",
        });
        if (alive) setRows(res);
      } catch (e) {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: t("invr.errLoad"), description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeFirmId, query, filter, toast, t]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const inv = await apiGet<Invoice>(`/api/v1/invoices/${id}`);
      setDetail(inv);
    } catch (e) {
      setDetailOpen(false);
      toast({ variant: "destructive", title: t("invr.errLoadDetail"), description: e instanceof ApiError ? e.message : t("invr.errUnknown") });
    } finally {
      setDetailLoading(false);
    }
  }

  /** Cycle 17: settle a specific invoice from its register row. */
  function settleFromRow(inv: InvoiceListRow) {
    if (!inv.customer?.id || !inv.outstanding || inv.outstanding <= 0.009) return;
    requestSettleInvoice(inv.id, inv.customer.id);
    setView("sales/receipts");
    toast({
      title: t("invr.toastOpening"),
      description: t("invr.toastOpeningDesc", { no: inv.invoiceNumber, amt: formatINR(inv.outstanding) }),
    });
  }

  function exportCsv() {
    const list = rows ?? [];
    downloadCSV("invoice-register.csv", [
      [t("invr.csvNo"), t("cmn.date"), t("invr.csvCustomer"), t("invr.phType"), t("invr.csvPayment"), t("invr.sumTaxable"), t("cdn.colTax"), t("invr.csvRoundOff"), t("invr.sumGrand"), t("invr.csvOutstanding")],
      ...list.map((i) => [
        i.invoiceNumber,
        i.invoiceDate.slice(0, 10),
        i.customer?.partyName || i.walkInName || "Walk-in",
        i.isCounterSale ? "COUNTER" : "B2B",
        i.paymentMode,
        Number(i.subtotal).toFixed(2),
        (Number(i.totalCgst) + Number(i.totalSgst) + Number(i.totalIgst)).toFixed(2),
        Number(i.roundOff).toFixed(2),
        Number(i.grandTotal).toFixed(2),
        i.paymentMode === "CREDIT" && i.outstanding !== undefined ? i.outstanding.toFixed(2) : "",
      ]),
    ]);
  }

  /** Cycle 17+: derived stats for the masonry summary column. */
  const list = rows ?? [];
  const totalValue = list.reduce((s, i) => s + Number(i.grandTotal), 0);
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthValue = list.filter((i) => i.invoiceDate.slice(0, 7) === monthPrefix).reduce((s, i) => s + Number(i.grandTotal), 0);
  const openCredit = list.filter((i) => i.paymentMode === "CREDIT" && i.status === "POSTED" && (i.outstanding ?? 0) > 0.009);
  const openCreditValue = openCredit.reduce((s, i) => s + (i.outstanding ?? 0), 0);
  const settledCount = list.filter((i) => i.paymentMode === "CREDIT" && i.status === "POSTED" && i.outstanding !== undefined && i.outstanding <= 0.009).length;
  const creditCount = list.filter((i) => i.paymentMode === "CREDIT").length;
  const denom = Math.max(1, list.length);
  const payMix = ("UPI,CASH,CREDIT,BT" as const)
    .split(",")
    .map((m) => ({
      mode: m,
      count: list.filter((i) => i.paymentMode === m).length,
      value: list.filter((i) => i.paymentMode === m).reduce((s, i) => s + Number(i.grandTotal), 0),
    }))
    .filter((x) => x.count > 0);
  const mixBar: Record<string, string> = { UPI: "bg-dmk-info", CASH: "bg-dmk-success", CREDIT: "bg-dmk-gold", BT: "bg-dmk-blue" };
  const b2bCount = list.filter((i) => !i.isCounterSale).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.invoices")}
        subtitle={t("invr.subtitle")}
        icon={ReceiptText}
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
            <Download className="h-4 w-4" /> {t("invr.exportCsv")}
          </Button>
        }
      />

      <SectionGrid
        list={
          <RegisterCard
            title={t("invr.cardTitle")}
            icon={ReceiptText}
            count={list.length}
            countLabel={t("invr.invoices")}
            filters={
              <>
                <div className="relative flex-1 min-w-0">
                  <SearchInput value={query} onChange={setQuery} placeholder={t("invr.searchPh")} className="pl-9" />
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
                </div>
                <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
                  <SelectTrigger className={cn(inputCls, "sm:w-44 shrink-0")}>
                    <SelectValue placeholder={t("invr.phType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("invr.allInvoices")}</SelectItem>
                    <SelectItem value="b2b">{t("invr.b2bOnly")}</SelectItem>
                    <SelectItem value="counter">{t("invr.counterOnly")}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            footer={
              <>
                <span>{t("invr.listedValue", { amt: formatINR(totalValue) })}</span>
                <span>{t("invr.openCredit", { n: openCredit.length })}</span>
                <span className="hidden sm:inline">{t("invr.hoverSettle")} <span className="text-dmk-success font-semibold">{t("invr.settle")}</span></span>
              </>
            }
          >
            {rows === null ? (
              <LoadingRows rows={8} />
            ) : list.length === 0 ? (
              <EmptyState icon={ReceiptText} title={t("invr.empty")} hint={t("invr.emptyHint")} />
            ) : (
              list.map((i) => {
                const tax = Number(i.totalCgst) + Number(i.totalSgst) + Number(i.totalIgst);
                const isCredit = i.paymentMode === "CREDIT" && i.status === "POSTED";
                const osd = i.outstanding;
                const settled = isCredit && osd !== undefined && osd <= 0.009;
                const settleable = isCredit && !!i.customer?.id && osd !== undefined && osd > 0.009;
                return (
                  <RegisterRow key={i.id} onClick={() => openDetail(i.id)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-money text-[12px] text-dmk-text-primary shrink-0">{i.invoiceNumber}</span>
                        <span className="text-[11px] text-dmk-text-muted shrink-0">{formatDate(i.invoiceDate)}</span>
                        {i.templateId && (
                          <span
                            title={t("invr.autoTip")}
                            className="inline-flex items-center gap-0.5 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-dmk-success shrink-0"
                          >
                            <Zap className="h-2.5 w-2.5" /> AUTO
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {i.isCounterSale ? <Badge tone="dr">COUNTER</Badge> : <Badge tone="info">B2B</Badge>}
                        <Badge tone={paymentBadge(i.paymentMode)}>{i.paymentMode}</Badge>
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-dmk-text-secondary truncate" title={i.customer?.partyName || i.walkInName || t("sale.walkIn")}>
                        {i.customer?.partyName || i.walkInName || t("sale.walkIn")}
                      </span>
                      <span className="flex items-baseline gap-2 shrink-0">
                        <span className="text-[10.5px] text-dmk-text-muted hidden sm:inline">{t("invr.taxableTax", { t: formatINR(Number(i.subtotal)), x: formatINR(tax) })}</span>
                        <span className="font-money text-[13px] font-semibold text-dmk-text-primary">{formatINR(Number(i.grandTotal))}</span>
                      </span>
                    </div>
                    {isCredit && (
                      <div className="mt-1 flex items-center justify-end gap-2">
                        {settleable && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              settleFromRow(i);
                            }}
                            title={t("invr.settleTip", { no: i.invoiceNumber, amt: formatINR(osd ?? 0) })}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-all border-dmk-border-medium bg-dmk-input-well hover:bg-dmk-hover text-dmk-success hover:border-dmk-success/40"
                          >
                            <HandCoins className="h-3 w-3" /> {t("invr.settle")}
                          </button>
                        )}
                        {settled ? (
                          <Badge tone="success">SETTLED</Badge>
                        ) : osd !== undefined ? (
                          <span className="font-money text-[11.5px] font-semibold text-dmk-yellow">{t("invr.outstanding", { amt: formatINR(osd) })}</span>
                        ) : (
                          <span className="text-[10.5px] text-dmk-text-muted">{t("invr.outstandingDots")}</span>
                        )}
                      </div>
                    )}
                  </RegisterRow>
                );
              })
            )}
          </RegisterCard>
        }
        aside={
          <>
            <div className="grid grid-cols-2 gap-3">
              <KpiCard label={t("invr.kpiInvoices")} value={String(list.length)} sub={t("invr.kpiOnCredit", { n: creditCount })} icon={Layers} />
              <KpiCard label={t("invr.kpiSalesValue")} value={formatINR(totalValue)} sub={t("invr.kpiThisMonthSub", { amt: formatINR(monthValue) })} icon={IndianRupee} tone="orange" />
              <KpiCard
                label={t("invr.kpiOutstanding")}
                value={formatINR(openCreditValue)}
                sub={t("invr.kpiUnsettled", { n: openCredit.length })}
                icon={Clock3}
                tone={openCreditValue > 0.009 ? "gold" : "success"}
              />
              <KpiCard label={t("invr.kpiSettled")} value={String(settledCount)} sub={t("invr.kpiSettledSub")} icon={CheckCircle2} tone="success" />
            </div>

            <AsideCard
              title={t("invr.payMix")}
              icon={Layers}
              iconClass="text-dmk-info"
              footnote={t("invr.payMixFoot")}
            >
              <div className="space-y-2.5">
                {payMix.length === 0 ? (
                  <p className="text-[12px] text-dmk-text-muted">{t("invr.noInvFilter")}</p>
                ) : (
                  payMix.map((x) => (
                    <MixBar
                      key={x.mode}
                      label={<>{x.mode} <span className="text-dmk-text-muted">· {t("sale.invCount", { n: x.count })}</span></>}
                      value={formatINR(x.value)}
                      pct={(x.count / denom) * 100}
                      barClass={mixBar[x.mode] ?? "bg-dmk-yellow"}
                    />
                  ))
                )}
              </div>
            </AsideCard>

            <AsideCard
              title={t("invr.channel")}
              icon={ReceiptText}
              iconClass="text-dmk-yellow"
              footnote={t("invr.channelFoot")}
            >
              <div className="space-y-2.5">
                <MixBar
                  label={<><span className="dmk-badge dmk-badge-info">B2B</span> <span className="text-dmk-text-muted">· {t("sale.invCount", { n: b2bCount })}</span></>}
                  value={formatINR(list.filter((i) => !i.isCounterSale).reduce((s, i) => s + Number(i.grandTotal), 0))}
                  pct={(b2bCount / denom) * 100}
                  barClass="bg-dmk-blue"
                />
                <MixBar
                  label={<><span className="dmk-badge dmk-badge-dr">COUNTER</span> <span className="text-dmk-text-muted">· {t("sale.invCount", { n: list.length - b2bCount })}</span></>}
                  value={formatINR(list.filter((i) => i.isCounterSale).reduce((s, i) => s + Number(i.grandTotal), 0))}
                  pct={((list.length - b2bCount) / denom) * 100}
                  barClass="bg-dmk-yellow"
                />
              </div>
            </AsideCard>
          </>
        }
      />

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{detail?.invoiceNumber ?? "…"}</span>
              {detail && (detail.isCounterSale ? <Badge tone="dr">COUNTER</Badge> : <Badge tone="info">B2B</Badge>)}
              {detail && <Badge tone={paymentBadge(detail.paymentMode)}>{detail.paymentMode}</Badge>}
              {detail?.templateId && (
                <span
                  title={t("invr.autoTipShort")}
                  className="inline-flex items-center gap-0.5 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-dmk-success"
                >
                  <Zap className="h-2.5 w-2.5" /> AUTO
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {detail ? `${formatDate(detail.invoiceDate)} · ${detail.customer?.partyName || detail.walkInName || t("sale.walkIn")}` : t("cmn.loading")}
            </DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="space-y-3">
              <div className="dmk-well overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>{t("cmn.product")}</th>
                        <th className="text-right">{t("sale.qty")}</th>
                        <th className="text-right">{t("cmn.rate")}</th>
                        <th className="text-right">{t("invr.colDisc")}</th>
                        <th className="text-right">{t("invr.sumTaxable")}</th>
                        <th className="text-right">{t("bill.colGst")}</th>
                        <th className="text-right">{t("cmn.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lineItems.map((li) => (
                        <tr key={li.id ?? li.productId}>
                          <td className="font-money text-[11.5px] text-dmk-text-secondary whitespace-nowrap">{li.sku}</td>
                          <td className="max-w-[200px] truncate text-[12.5px]">{li.productName}</td>
                          <td className="num text-[12px]">{li.quantity}</td>
                          <td className="num text-[12px]">{formatINR(Number(li.unitPrice))}</td>
                          <td className="num text-[12px] text-dmk-gold">{Number(li.bulkDiscountPct) > 0 ? `−${Number(li.bulkDiscountPct)}%` : "—"}</td>
                          <td className="num text-[12px]">{formatINR(Number(li.taxableAmount))}</td>
                          <td className="num text-[12px] text-dmk-text-secondary">
                            {Number(li.cgstAmount) + Number(li.sgstAmount) > 0
                              ? `${formatINR(Number(li.cgstAmount) + Number(li.sgstAmount))} ${t("invr.csLabel")}`
                              : formatINR(Number(li.igstAmount))}
                          </td>
                          <td className="num text-[12px]">{formatINR(Number(li.totalAmount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="dmk-well p-3 space-y-1.5 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-dmk-text-muted">{t("invr.sumTaxable")}</span><span className="font-money">{formatINR(Number(detail.subtotal))}</span></div>
                  <div className="flex justify-between"><span className="text-dmk-text-muted">{t("invr.sumDiscounts")}</span><span className="font-money text-dmk-gold">−{formatINR(Number(detail.discountTotal))}</span></div>
                  {Number(detail.totalCgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">CGST</span><span className="font-money">{formatINR(Number(detail.totalCgst))}</span></div>}
                  {Number(detail.totalSgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">SGST</span><span className="font-money">{formatINR(Number(detail.totalSgst))}</span></div>}
                  {Number(detail.totalIgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">IGST</span><span className="font-money">{formatINR(Number(detail.totalIgst))}</span></div>}
                  <div className="flex justify-between"><span className="text-dmk-text-muted">{t("invr.sumRoundOff")}</span><span className="font-money">{formatINR(Number(detail.roundOff))}</span></div>
                  <div className="flex justify-between border-t border-dmk-border-subtle pt-1.5"><span className="text-dmk-text-secondary font-semibold">{t("invr.sumGrand")}</span><span className="font-money text-[15px] text-dmk-yellow font-bold">{formatINR(Number(detail.grandTotal))}</span></div>
                </div>
                <div className="dmk-well p-3">
                  <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted mb-1">{t("invr.words")}</p>
                  <p className="text-[12px] italic text-dmk-text-secondary">{detail.amountInWords || amountInWords(Number(detail.grandTotal))}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => {
                setDetailOpen(false);
                setView("docs/invoices");
              }}
            >
              <FileText className="h-4 w-4" /> {t("invr.openA4")}
            </Button>
            <Button onClick={() => setDetailOpen(false)} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90">{t("cmn.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
