"use client";

// ═══════════════════════════════════════════════════════════════
// DOCS — A4 TAX INVOICE PREVIEW (Rule 46, R16)
// Left: invoice picker list. Right: A4 sheet (pure CSS, white for
// print). Toolbar: print, zoom 80/100/125, page estimate.
// `print-a4` on the sheet + `no-print` on chrome → globals print CSS
// renders ONLY the document on window.print().
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { FileText, Minus, Plus, Printer, Search } from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, amountInWords } from "@/lib/format";
import type { Firm, Invoice, InvoiceLineItem } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { A4PrintPortal, printA4 } from "@/components/erp/print-portal";

type InvoiceListRow = Omit<Invoice, "customer"> & {
  customer?: { id: string; partyName: string; customerType?: string; stateCode?: string } | null;
};

/** Detail line items carry product { unit, brand } from /invoices/[id]. */
type DetailLineItem = InvoiceLineItem & {
  product?: { id: string; unit: string; brand: string } | null;
};

const ZOOMS = [0.8, 1, 1.25] as const;

/** Plain Indian-grouped number for A4 document cells (no ₹ symbol). */
const money = (n: number | null | undefined) => formatINR(Number(n ?? 0), false);

export default function InvoiceDocsView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();

  const [query, setQuery] = React.useState("");
  const [list, setList] = React.useState<InvoiceListRow[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [invoice, setInvoice] = React.useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [zoom, setZoom] = React.useState<(typeof ZOOMS)[number]>(1);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await apiGet<InvoiceListRow[]>("/api/v1/invoices", { firmId: activeFirmId, search: query.trim() });
        if (alive) {
          setList(res);
          setSelectedId((cur) => cur ?? res[0]?.id ?? null);
        }
      } catch (e) {
        if (alive) {
          setList([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: t("invr.errLoad"), description: e.message });
        }
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeFirmId, query, toast, t]);

  React.useEffect(() => {
    if (!selectedId) {
      setInvoice(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    apiGet<Invoice>(`/api/v1/invoices/${selectedId}`)
      .then((res) => alive && setInvoice(res))
      .catch((e) => {
        if (alive) {
          setInvoice(null);
          toast({ variant: "destructive", title: t("invr.errLoadDetail"), description: e instanceof ApiError ? e.message : t("invr.errUnknown") });
        }
      })
      .finally(() => alive && setDetailLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedId, toast, t]);

  const pageCount = React.useMemo(() => {
    if (!invoice) return 0;
    // ~12 line items fill a page under fixed chrome (header/billto/footers)
    return Math.max(1, Math.ceil(invoice.lineItems.length / 12));
  }, [invoice]);

  if (!activeFirmId) {
    return <EmptyState icon={FileText} title={t("sale.noFirm")} hint={t("sale.noFirmHint")} />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar (no-print) */}
      <div className="no-print space-y-4">
        <PageHeader
          title={t("invd.title")}
          subtitle={t("invd.subtitle")}
          icon={FileText}
          actions={
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1 dmk-well p-1">
                {ZOOMS.map((z) => (
                  <button
                    key={z}
                    onClick={() => setZoom(z)}
                    aria-label={t("invd.zoomAria", { n: Math.round(z * 100) })}
                    className={cn(
                      "h-7 px-2.5 rounded-md text-[11.5px] font-semibold font-money transition-colors",
                      zoom === z ? "bg-dmk-hover text-dmk-text-primary" : "text-dmk-text-muted hover:text-dmk-text-secondary"
                    )}
                  >
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </div>
              <Button size="sm" className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={printA4} disabled={!invoice}>
                <Printer className="h-4 w-4" /> {t("cmn.print")}
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* ═══ LEFT — invoice list (no-print) ═══ */}
        <div className="no-print dmk-card overflow-hidden lg:sticky lg:top-20">
          <div className="p-3 border-b border-dmk-border-subtle">
            <div className="relative">
              <SearchInput value={query} onChange={setQuery} placeholder={t("invd.searchPh")} className="pl-9" />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {list === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState icon={FileText} title={t("invd.empty")} hint={t("invd.emptyHint")} />
            ) : (
              list.map((i) => (
                <button
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={cn(
                    "w-full text-left px-3.5 py-2.5 border-b border-dmk-border-subtle transition-colors",
                    selectedId === i.id ? "bg-dmk-hover" : "hover:bg-dmk-hover/60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-money text-[12.5px] text-dmk-text-primary">{i.invoiceNumber}</span>
                    <span className="font-money text-[12px] text-dmk-yellow">{formatINR(Number(i.grandTotal))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-dmk-text-muted truncate">{i.customer?.partyName || i.walkInName || t("sale.walkIn")}</span>
                    <span className="text-[11px] text-dmk-text-muted whitespace-nowrap">{formatDate(i.invoiceDate)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ═══ RIGHT — A4 preview ═══ */}
        <div className="min-w-0">
          {detailLoading ? (
            <div className="dmk-card p-6"><LoadingRows rows={8} /></div>
          ) : !invoice ? (
            <div className="dmk-card">
              <EmptyState icon={FileText} title={t("invd.select")} hint={t("invd.selectHint")} />
            </div>
          ) : (
            <>
              <div className="no-print flex items-center justify-between px-1 pb-2">
                <div className="flex items-center gap-2">
                  <Badge tone="info">{t("invd.taxInvoiceBadge")}</Badge>
                  <span className="text-[11.5px] text-dmk-text-muted">{t("invd.pages", { n: pageCount })}</span>
                </div>
                <div className="sm:hidden flex items-center gap-1 dmk-well p-1">
                  <button aria-label={t("invd.zoomOut")} onClick={() => setZoom((z) => (z === 1.25 ? 1 : 0.8))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="text-[11px] font-money px-1">{Math.round(zoom * 100)}%</span>
                  <button aria-label={t("invd.zoomIn")} onClick={() => setZoom((z) => (z === 0.8 ? 1 : 1.25))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="overflow-x-auto pb-4">
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} className="print:transform-none inline-block">
                  <A4TaxInvoice invoice={invoice} firm={firm} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chrome-free print copy — the ONLY thing that reaches paper */}
      {invoice && (
        <A4PrintPortal>
          <A4TaxInvoice invoice={invoice} firm={firm} />
        </A4PrintPortal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// A4 sheet — pure CSS, white paper, print friendly
// ═══════════════════════════════════════════════════════════════
function A4TaxInvoice({ invoice, firm }: { invoice: Invoice; firm?: Firm }) {
  return (
    <div
      className="print-a4 bg-white text-gray-900 w-[794px] min-h-[1123px] px-10 py-8 flex flex-col shadow-lg"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <InvoiceSheet invoice={invoice} firm={firm} />
    </div>
  );
}

function InvoiceSheet({ invoice, firm }: { invoice: Invoice; firm?: Firm }) {
  const { t } = useT();
  const items = invoice.lineItems as DetailLineItem[];
  const isCounter = invoice.isCounterSale;
  const buyerName = invoice.customer?.partyName || invoice.walkInName || t("invd.walkInCustomer");
  const buyerGstin = invoice.customer?.gstin ?? "";
  const buyerState = invoice.customer?.stateCode ?? "";
  const placeOfSupply = buyerState || firm?.stateCode || "";
  const intra = !!firm && !!buyerState && buyerState === firm.stateCode;

  return (
    <>
      <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
        <div className="min-w-0 flex items-start gap-3">
          <img src={firm?.logoUrl ?? "/dmk-logo.png"} alt={`${firm?.firmName ?? "DMK Mart"} logo`} width={56} height={56} className="rounded-full shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold leading-tight text-gray-900">{firm?.firmName ?? "DMK Mart"}</h2>
            <p className="text-[11px] text-gray-600 mt-1 whitespace-pre-line leading-snug">{firm?.address ?? ""}</p>
            <div className="text-[11px] text-gray-700 mt-1.5 space-x-3">
              <span>GSTIN: <span className="font-semibold" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>{firm?.gstin ?? "—"}</span></span>
              {firm?.phone && <span>Ph: {firm.phone}</span>}
            </div>
            {firm?.email && <p className="text-[11px] text-gray-600">{firm.email}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[20px] font-extrabold tracking-wide text-gray-900 uppercase">{t("invd.docTaxInvoice")}</p>
          <p className="text-[10.5px] text-gray-500 mt-1">{t("invd.originalRecipient")}</p>
          {isCounter && (
            <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wider text-gray-700 border border-gray-400 rounded px-2 py-0.5">
              {t("invd.counterSale")}
            </span>
          )}
        </div>
      </div>

      {/* Meta + Bill To */}
      <div className="grid grid-cols-2 gap-6 border-b border-gray-300 py-3">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t("invd.billTo")}</p>
          <p className="text-[13.5px] font-bold text-gray-900 leading-snug">{buyerName}</p>
          {/* Faint invoice number under the party name (A4 doc, ~50% opacity) */}
          <p className="text-[10.5px] font-normal text-gray-800 opacity-50 leading-tight" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
            {invoice.invoiceNumber}
          </p>
          {invoice.customer?.address && <p className="text-[11px] text-gray-600 mt-0.5 leading-snug">{invoice.customer.address}</p>}
          {invoice.customer?.city && <p className="text-[11px] text-gray-600">{invoice.customer.city}</p>}
          <p className="text-[11px] text-gray-700 mt-1">
            GSTIN: <span className="font-semibold" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>{buyerGstin || t("invd.urp")}</span>
          </p>
          {invoice.walkInPhone && <p className="text-[11px] text-gray-600">Ph: {invoice.walkInPhone}</p>}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] content-start">
          <span className="text-gray-500">{t("invd.date")}</span>
          <span className="font-semibold text-right">{formatDate(invoice.invoiceDate)}</span>
          <span className="text-gray-500">{t("invd.paymentMode")}</span>
          <span className="font-semibold text-right">{invoice.paymentMode}</span>
          <span className="text-gray-500">{t("invd.placeOfSupply")}</span>
          <span className="font-semibold text-right">{placeOfSupply || "—"}</span>
        </div>
      </div>

      {/* Line items */}
      <table className="w-full border-collapse mt-3" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-left w-8">#</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-left w-[86px]">SKU</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-left">{t("invd.colDescription")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-center w-14">HSN</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-10">{t("sale.qty")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-center w-11">{t("invd.colUnit")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-16">{t("invd.colRate")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-12">{t("invr.colDisc")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-[74px]">{t("invd.colTaxable")}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-[62px]">CGST</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-[70px]">{intra ? "SGST" : "IGST"}</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[10px] font-bold uppercase text-gray-700 text-right w-[74px]">{t("invd.colAmount")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => (
            <InvoiceRow key={li.id ?? idx} li={li} idx={idx} intra={intra} />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={12} className="border border-gray-300 px-2 py-4 text-center text-[11px] text-gray-500">{t("invd.noLines")}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Totals + words */}
      <div className="grid grid-cols-2 gap-6 mt-3 flex-1">
        <div className="flex flex-col justify-between gap-3">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t("invd.words")}</p>
            <p className="text-[11.5px] italic text-gray-800 leading-snug">
              {invoice.amountInWords || amountInWords(Number(invoice.grandTotal))}
            </p>
          </div>
          <div className="border border-gray-300 rounded p-2.5">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t("invd.bankDetails")}</p>
            <div className="text-[10.5px] text-gray-700 space-y-0.5" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              <p>{t("invd.bankLbl")}: {firm?.bankName || "—"}</p>
              <p>{t("invd.acLbl")}: {firm?.bankAccount || "—"}</p>
              <p>{t("invd.ifscLbl")}: {firm?.ifsc || "—"}</p>
            </div>
          </div>
          {!invoice.isCounterSale && invoice.deliveryOtp ? (
            <div className="border-2 border-gray-900 rounded p-2.5 bg-gray-50">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-600 mb-0.5">{t("invd.otpTitle")}</p>
              <p className="text-[19px] font-black tracking-[0.45em] text-gray-900 leading-tight text-center" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
                [{invoice.deliveryOtp.split("").join(" ")}]
              </p>
              <p className="text-[8.5px] text-gray-600 leading-snug mt-0.5">
                {t("invd.otpHint")}
              </p>
            </div>
          ) : null}
        </div>
        <div className="justify-self-end w-full max-w-[300px]">
          <table className="w-full text-[11.5px]">
            <tbody>
              <tr>
                <td className="py-1 text-gray-600">{t("invd.taxableValue")}</td>
                <td className="py-1 text-right font-semibold">{money(invoice.subtotal)}</td>
              </tr>
              {Number(invoice.totalCgst) > 0 && (
                <tr>
                  <td className="py-1 text-gray-600">CGST</td>
                  <td className="py-1 text-right font-semibold">{money(invoice.totalCgst)}</td>
                </tr>
              )}
              {Number(invoice.totalSgst) > 0 && (
                <tr>
                  <td className="py-1 text-gray-600">SGST</td>
                  <td className="py-1 text-right font-semibold">{money(invoice.totalSgst)}</td>
                </tr>
              )}
              {Number(invoice.totalIgst) > 0 && (
                <tr>
                  <td className="py-1 text-gray-600">IGST</td>
                  <td className="py-1 text-right font-semibold">{money(invoice.totalIgst)}</td>
                </tr>
              )}
              <tr>
                <td className="py-1 text-gray-600">{t("invd.roundOff")}</td>
                <td className="py-1 text-right font-semibold">{money(invoice.roundOff)}</td>
              </tr>
              <tr className="bg-gray-100 border-t-2 border-gray-800">
                <td className="py-1.5 px-1 font-bold text-gray-900 text-[12.5px]">{t("invd.grandTotal")}</td>
                <td className="py-1.5 px-1 text-right font-bold text-[14px]">{money(invoice.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Declaration + authorisation */}
      <div className="grid grid-cols-2 gap-6 border-t border-gray-300 mt-4 pt-3">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t("invd.declaration")}</p>
          <p className="text-[10px] text-gray-600 leading-snug">
            {t("invd.declarationBody")}
          </p>
          <p className="text-[10px] text-gray-600 mt-1.5">{t("invd.jurisdiction", { place: firm?.state ? firm.state : t("invd.local") })}</p>
        </div>
        <div className="text-right flex flex-col justify-end">
          <p className="text-[10px] text-gray-600 mb-10">{t("invd.forFirm")} <span className="font-bold text-gray-800">{firm?.firmName ?? "DMK Mart"}</span></p>
          <p className="text-[10.5px] text-gray-700 border-t border-gray-400 inline-block pt-1 ml-auto w-40">{t("invd.signatory")}</p>
        </div>
      </div>

      <p className="text-center text-[9px] text-gray-400 mt-3">
        This is a computer-generated invoice under GST Rules — Rule 46 · {firm?.firmCode ?? ""} · {invoice.invoiceNumber}
      </p>
    </>
  );
}

function InvoiceRow({ li, idx, intra }: { li: DetailLineItem; idx: number; intra: boolean }) {
  const money = (n: number | string) => formatINR(Number(n));
  return (
    <tr>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-700">{idx + 1}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-800">{li.sku}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-900">{li.productName}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-700 text-center">{li.hsnCode}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-900 text-right">{li.quantity}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10px] text-gray-600 text-center">{li.product?.unit ?? "PCS"}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-900 text-right">{money(li.unitPrice)}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-700 text-right">
        {Number(li.bulkDiscountPct) > 0 ? `${Number(li.bulkDiscountPct)}%` : "—"}
      </td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-900 text-right">{money(li.taxableAmount)}</td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-800 text-right">
        {intra ? money(li.cgstAmount) : "—"}
      </td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-800 text-right">
        {intra ? money(li.sgstAmount) : money(li.igstAmount)}
      </td>
      <td className="border border-gray-300 px-1.5 py-1.5 text-[10.5px] text-gray-900 text-right font-semibold">{money(li.totalAmount)}</td>
    </tr>
  );
}
