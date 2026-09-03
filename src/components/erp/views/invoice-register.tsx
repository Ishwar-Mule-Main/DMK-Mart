"use client";

// ═══════════════════════════════════════════════════════════════
// SALES — INVOICE REGISTER (B2B + B2C counter)
// Search, type filter, CSV export, full-detail dialog → A4 docs.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Download, Eye, FileText, HandCoins, ReceiptText, Search, Zap } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, downloadCSV, amountInWords } from "@/lib/format";
import type { Invoice } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput, inputCls } from "@/components/erp/shared";
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
    const t = setTimeout(async () => {
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
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load invoices", description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, query, filter]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const inv = await apiGet<Invoice>(`/api/v1/invoices/${id}`);
      setDetail(inv);
    } catch (e) {
      setDetailOpen(false);
      toast({ variant: "destructive", title: "Could not load invoice", description: e instanceof ApiError ? e.message : "Unknown error" });
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
      title: "Opening receipt dialog",
      description: `${inv.invoiceNumber} · ${formatINR(inv.outstanding)} outstanding pre-allocated — confirm there.`,
    });
  }

  function exportCsv() {
    const list = rows ?? [];
    downloadCSV("invoice-register.csv", [
      ["Invoice #", "Date", "Customer / Walk-in", "Type", "Payment", "Taxable", "Tax", "Round off", "Grand Total", "Outstanding"],
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoice Register"
        subtitle="All sales invoices — B2B credit & B2C counter, most recent first"
        icon={ReceiptText}
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows || rows.length === 0} className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="dmk-card p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search invoice #, customer or walk-in name / phone…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className={cn(inputCls, "sm:w-48")}>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All invoices</SelectItem>
            <SelectItem value="b2b">B2B only</SelectItem>
            <SelectItem value="counter">B2C counter only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {rows === null ? (
            <LoadingRows rows={8} />
          ) : rows.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No invoices found" hint="Create one from B2B Fast Billing or the Counter POS." />
          ) : (
            <table className="dmk-table min-w-[1020px]">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer / Walk-in</th>
                  <th>Type</th>
                  <th>Payment</th>
                  <th className="text-right">Taxable</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Grand Total</th>
                  <th className="text-right">Outstanding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const tax = Number(i.totalCgst) + Number(i.totalSgst) + Number(i.totalIgst);
                  const isCredit = i.paymentMode === "CREDIT" && i.status === "POSTED";
                  const osd = i.outstanding;
                  const settled = isCredit && osd !== undefined && osd <= 0.009;
                  const settleable = isCredit && !!i.customer?.id && osd !== undefined && osd > 0.009;
                  return (
                    <tr key={i.id} className="group/row">
                      <td className="font-money text-[12.5px] text-dmk-text-primary">{i.invoiceNumber}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(i.invoiceDate)}</td>
                      <td className="max-w-[240px] truncate text-[13px]" title={i.customer?.partyName || i.walkInName || "Walk-in"}>{i.customer?.partyName || i.walkInName || "Walk-in"}</td>
                      <td>
                        {i.isCounterSale ? <Badge tone="dr">COUNTER</Badge> : <Badge tone="info">B2B</Badge>}
                        {i.templateId && (
                          <span
                            title="Auto-posted from a recurring billing template — see Recurring Billing → run history"
                            className="ml-1 inline-flex items-center gap-0.5 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-dmk-success align-middle"
                          >
                            <Zap className="h-2.5 w-2.5" /> AUTO
                          </span>
                        )}
                      </td>
                      <td><Badge tone={paymentBadge(i.paymentMode)}>{i.paymentMode}</Badge></td>
                      <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(i.subtotal))}</td>
                      <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(tax)}</td>
                      <td className="num text-[13px] font-semibold text-dmk-text-primary">{formatINR(Number(i.grandTotal))}</td>
                      <td className="num text-right whitespace-nowrap">
                        {i.isCounterSale || i.paymentMode !== "CREDIT" ? (
                          <span className="text-[11px] text-dmk-text-muted">—</span>
                        ) : osd === undefined ? (
                          <span className="text-[11px] text-dmk-text-muted">…</span>
                        ) : settled ? (
                          <Badge tone="success">SETTLED</Badge>
                        ) : (
                          <span className={cn("font-money text-[12.5px] font-semibold", osd > 0.009 ? "text-dmk-orange" : "text-dmk-text-muted")}>
                            {formatINR(osd)}
                          </span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {settleable && (
                          <button
                            type="button"
                            onClick={() => settleFromRow(i)}
                            title={`Record a receipt settling ${i.invoiceNumber} (${formatINR(osd ?? 0)})`}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide mr-1.5",
                              "opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-all",
                              "border-dmk-border-medium bg-dmk-input-well hover:bg-dmk-hover text-dmk-success hover:border-dmk-success/40"
                            )}
                          >
                            <HandCoins className="h-3 w-3" /> Settle
                          </button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => openDetail(i.id)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{detail?.invoiceNumber ?? "…"}</span>
              {detail && (detail.isCounterSale ? <Badge tone="dr">COUNTER</Badge> : <Badge tone="info">B2B</Badge>)}
              {detail && <Badge tone={paymentBadge(detail.paymentMode)}>{detail.paymentMode}</Badge>}
              {detail?.templateId && (
                <span
                  title="Auto-posted from a recurring billing template"
                  className="inline-flex items-center gap-0.5 rounded-md bg-dmk-success/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-dmk-success"
                >
                  <Zap className="h-2.5 w-2.5" /> AUTO
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {detail ? `${formatDate(detail.invoiceDate)} · ${detail.customer?.partyName || detail.walkInName || "Walk-in"}` : "Loading…"}
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
                        <th>Product</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Disc%</th>
                        <th className="text-right">Taxable</th>
                        <th className="text-right">GST</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lineItems.map((li) => (
                        <tr key={li.id ?? li.productId}>
                          <td className="font-money text-[11.5px] text-dmk-text-secondary">{li.sku}</td>
                          <td className="max-w-[200px] truncate text-[12.5px]">{li.productName}</td>
                          <td className="num text-[12px]">{li.quantity}</td>
                          <td className="num text-[12px]">{formatINR(Number(li.unitPrice))}</td>
                          <td className="num text-[12px] text-dmk-gold">{Number(li.bulkDiscountPct) > 0 ? `−${Number(li.bulkDiscountPct)}%` : "—"}</td>
                          <td className="num text-[12px]">{formatINR(Number(li.taxableAmount))}</td>
                          <td className="num text-[12px] text-dmk-text-secondary">
                            {Number(li.cgstAmount) + Number(li.sgstAmount) > 0
                              ? `${formatINR(Number(li.cgstAmount) + Number(li.sgstAmount))} (C+S)`
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
                  <div className="flex justify-between"><span className="text-dmk-text-muted">Taxable</span><span className="font-money">{formatINR(Number(detail.subtotal))}</span></div>
                  <div className="flex justify-between"><span className="text-dmk-text-muted">Discounts</span><span className="font-money text-dmk-gold">−{formatINR(Number(detail.discountTotal))}</span></div>
                  {Number(detail.totalCgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">CGST</span><span className="font-money">{formatINR(Number(detail.totalCgst))}</span></div>}
                  {Number(detail.totalSgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">SGST</span><span className="font-money">{formatINR(Number(detail.totalSgst))}</span></div>}
                  {Number(detail.totalIgst) > 0 && <div className="flex justify-between"><span className="text-dmk-text-muted">IGST</span><span className="font-money">{formatINR(Number(detail.totalIgst))}</span></div>}
                  <div className="flex justify-between"><span className="text-dmk-text-muted">Round-off</span><span className="font-money">{formatINR(Number(detail.roundOff))}</span></div>
                  <div className="flex justify-between border-t border-dmk-border-subtle pt-1.5"><span className="text-dmk-text-secondary font-semibold">Grand Total</span><span className="font-money text-[15px] text-dmk-orange font-bold">{formatINR(Number(detail.grandTotal))}</span></div>
                </div>
                <div className="dmk-well p-3">
                  <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted mb-1">Amount in words</p>
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
              <FileText className="h-4 w-4" /> Open A4
            </Button>
            <Button onClick={() => setDetailOpen(false)} className="bg-dmk-orange text-white hover:bg-dmk-orange/90">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
