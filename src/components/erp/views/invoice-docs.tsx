"use client";

// ═══════════════════════════════════════════════════════════════
// DOCS — A4 TAX INVOICE PREVIEW (Tally/e-Invoice reference layout)
// Classic GST structure the owner files for ITR: centered "Tax
// Invoice" title + UPI QR, seller / Consignee (Ship to) / Buyer
// (Bill to) block beside the Invoice No./Dated/Dispatch meta grid,
// Sl | Description of Goods | HSN/SAC | Quantity | Rate | per |
// Amount table with CGST/SGST sub-rows under every taxed item,
// Total row, Amount Chargeable (in words) with E. & O.E., rate-wise
// tax summary, Tax Amount in words, PAN / Declaration / Bank block,
// signature row and the "Computer Generated Invoice" line.
// Long invoices still flow onto real A4 pages (shared page system)
// with a repeated table head and the totals block on the last page.
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
import {
  A4Sheet,
  A4PageStack,
  A4DocFooter,
  A4MeasureTwin,
  A4Replica,
  useA4Paginate,
  type A4PaginateRefs,
} from "@/components/erp/a4";

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

/** Indian-grouped quantity with 2 decimals (reference bills show 225.00 / 6.00). */
const qtyFmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "… Rupees Only" (stored) → reference style "INR … Only". */
const wordsINR = (stored: string | undefined, fallbackAmount: number) => {
  const w = stored || amountInWords(fallbackAmount);
  return `INR ${w.replace(/\s*Rupees? Only\.?$/i, "").trim()} Only`;
};

const pct = (r: number) => `${Number.isInteger(r) ? r : Number(r.toFixed(1))}%`;

// ─── Table row plan: item rows + their CGST/SGST/IGST sub-rows ───

type TrEntry =
  | { kind: "main"; li: DetailLineItem; idx: number }
  | { kind: "tax"; label: string; ratePct: number; amount: number };

function buildTrPlan(items: DetailLineItem[], intra: boolean): TrEntry[] {
  const plan: TrEntry[] = [];
  items.forEach((li, i) => {
    plan.push({ kind: "main", li, idx: i + 1 });
    const r = Number(li.gstRate) || 0;
    if (r <= 0) return;
    if (intra) {
      if (Number(li.cgstAmount) > 0) plan.push({ kind: "tax", label: `CGST ${pct(r / 2)}`, ratePct: r / 2, amount: Number(li.cgstAmount) });
      if (Number(li.sgstAmount) > 0) plan.push({ kind: "tax", label: `SGST ${pct(r / 2)}`, ratePct: r / 2, amount: Number(li.sgstAmount) });
    } else if (Number(li.igstAmount) > 0) {
      plan.push({ kind: "tax", label: `IGST ${pct(r)}`, ratePct: r, amount: Number(li.igstAmount) });
    }
  });
  return plan;
}

/** Rate-wise GST breakup for the summary table. */
function rateWise(items: DetailLineItem[], intra: boolean) {
  const map = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const li of items) {
    const r = Number(li.gstRate) || 0;
    const cur = map.get(r) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    cur.taxable += Number(li.taxableAmount) || 0;
    cur.cgst += Number(li.cgstAmount) || 0;
    cur.sgst += Number(li.sgstAmount) || 0;
    cur.igst += Number(li.igstAmount) || 0;
    map.set(r, cur);
  }
  return [...map.entries()]
    .filter(([r]) => r > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([r, v]) => ({ rate: r, taxable: v.taxable, cgst: v.cgst, sgst: v.sgst, igst: v.igst, intra }));
}

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
  const [pageCount, setPageCount] = React.useState<number | null>(null);

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
      setPageCount(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    apiGet<Invoice>(`/api/v1/invoices/${selectedId}`)
      .then((res) => {
        if (alive) {
          setInvoice(res);
          setPageCount(null);
        }
      })
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

  const handlePageCount = React.useCallback((n: number) => setPageCount(n), []);

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
                  <span className="text-[11.5px] text-dmk-text-muted">{t("invd.pagesExact", { n: pageCount ?? 1 })}</span>
                </div>
                <div className="sm:hidden flex items-center gap-1 dmk-well p-1">
                  <button aria-label={t("invd.zoomOut")} onClick={() => setZoom((z) => (z === 1.25 ? 1 : 0.8))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="text-[11px] font-money px-1">{Math.round(zoom * 100)}%</span>
                  <button aria-label={t("invd.zoomIn")} onClick={() => setZoom((z) => (z === 0.8 ? 1 : 1.25))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="overflow-x-auto pb-4">
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} className="print:transform-none inline-block">
                  <A4TaxInvoice invoice={invoice} firm={firm} onPageCount={handlePageCount} />
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
// A4 tax invoice — real paper pages via the shared A4 page system.
// Page 1: title/QR + seller/buyer block + first rows. Continuations:
// band + repeated table head + rows. Last page: Total row + words +
// rate-wise tax summary + PAN/declaration/bank/sign block + footer.
// ═══════════════════════════════════════════════════════════════
function A4TaxInvoice({
  invoice,
  firm,
  onPageCount,
}: {
  invoice: Invoice;
  firm?: Firm;
  onPageCount?: (n: number) => void;
}) {
  const { t } = useT();
  const lang = useErpStore((s) => s.language);
  const items = invoice.lineItems as DetailLineItem[];
  const buyerState = invoice.customer?.stateCode ?? "";
  const intra = !!firm && !!buyerState && buyerState === firm.stateCode;
  const buyerName = invoice.customer?.partyName || invoice.walkInName || t("invd.walkInCustomer");

  const trPlan = React.useMemo(() => buildTrPlan(items, intra), [items, intra]);
  const groups = React.useMemo(() => {
    const g: number[] = [];
    for (const e of trPlan) {
      if (e.kind === "main") g.push(1);
      else g[g.length - 1] += 1;
    }
    return g;
  }, [trPlan]);

  const fullRef = React.useRef<HTMLDivElement>(null);
  const firstRef = React.useRef<HTMLDivElement>(null);
  const contRef = React.useRef<HTMLDivElement>(null);
  const lastRef = React.useRef<HTMLDivElement>(null);
  const refs: A4PaginateRefs = React.useMemo(
    () => ({ full: fullRef, first: firstRef, cont: contRef, last: lastRef }),
    []
  );
  const pages = useA4Paginate(trPlan.length, `${invoice.id}:${items.length}:${lang}:${intra ? "i" : "g"}`, refs, groups);

  React.useEffect(() => {
    if (pages) onPageCount?.(pages.length);
  }, [pages, onPageCount]);

  const total = pages?.length ?? 1;
  const footerNote = `${t("invd.footerNote")}${firm?.firmCode ? ` · ${firm.firmCode}` : ""}`;
  const footerDoc = `${t("invd.docTaxInvoice").toUpperCase()} · ${invoice.invoiceNumber}`;
  const footerDate = formatDate(invoice.invoiceDate);
  const totalQty = items.reduce((s, li) => s + (Number(li.quantity) || 0), 0);
  const rowsUnit = items[0]?.product?.unit ?? "NOS";

  const renderRows = (entries: TrEntry[]) =>
    entries.map((e, k) => (e.kind === "main" ? <InvoiceRow key={`m-${k}-${e.idx}`} li={e.li} idx={e.idx} /> : <TaxRow key={`t-${k}-${e.label}`} entry={e} />));

  return (
    <>
      {/* Measurement twins — mirror the real pages 1:1, never printed */}
      <A4MeasureTwin>
        <A4Replica replicaRef={fullRef}>
          <InvoiceTopChrome invoice={invoice} firm={firm} />
          <InvoiceItemsTable rows={trPlan} totals={{ qty: totalQty, unit: rowsUnit, grand: Number(invoice.grandTotal) }} showTotalRow />
          <InvoiceBottomChrome invoice={invoice} firm={firm} intra={intra} items={items} page={1} total={1} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={firstRef}>
          <InvoiceTopChrome invoice={invoice} firm={firm} />
          <InvoiceItemsTable rows={[]} />
          <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={1} totalPages={1} date={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={contRef}>
          <InvoiceContHeader invoice={invoice} firm={firm} buyerName={buyerName} page={1} total={1} />
          <InvoiceItemsTable rows={[]} />
          <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={1} totalPages={1} date={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={lastRef}>
          <InvoiceContHeader invoice={invoice} firm={firm} buyerName={buyerName} page={1} total={1} />
          <InvoiceItemsTable rows={[]} totals={{ qty: totalQty, unit: rowsUnit, grand: Number(invoice.grandTotal) }} showTotalRow />
          <InvoiceBottomChrome invoice={invoice} firm={firm} intra={intra} items={items} page={1} total={1} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
        </A4Replica>
      </A4MeasureTwin>

      {/* Real paper pages */}
      {pages && (
        <A4PageStack>
          {pages.map((idxs, p) => {
            const isLast = p === pages.length - 1;
            const chunk = idxs.map((i) => trPlan[i]);
            return (
              <A4Sheet key={`${invoice.id}:${p}`}>
                {p === 0 ? (
                  <InvoiceTopChrome invoice={invoice} firm={firm} />
                ) : (
                  <InvoiceContHeader invoice={invoice} firm={firm} buyerName={buyerName} page={p + 1} total={pages.length} />
                )}
                <InvoiceItemsTable
                  rows={chunk}
                  totals={isLast ? { qty: totalQty, unit: rowsUnit, grand: Number(invoice.grandTotal) } : undefined}
                  showTotalRow={isLast}
                />
                {isLast ? (
                  <InvoiceBottomChrome invoice={invoice} firm={firm} intra={intra} items={items} page={p + 1} total={pages.length} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
                ) : (
                  <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={p + 1} totalPages={pages.length} date={footerDate} />
                )}
              </A4Sheet>
            );
          })}
        </A4PageStack>
      )}
    </>
  );
}

// ── Shared bordered-cell class helpers ──────────────────────────

const CELL = "border border-gray-400 px-1.5 py-1";
const HEAD = "border border-gray-500 px-1.5 py-1 text-[9px] font-bold uppercase text-gray-800 tracking-wide";

// ── Page 1 chrome: title + QR + seller / consignee / buyer + meta ──

function InvoiceTopChrome({ invoice, firm }: { invoice: Invoice; firm?: Firm }) {
  const { t } = useT();
  const isCounter = invoice.isCounterSale;
  const buyerName = invoice.customer?.partyName || invoice.walkInName || t("invd.walkInCustomer");
  const buyerGstin = invoice.customer?.gstin ?? "";
  const buyerState = invoice.customer?.stateCode ?? "";
  const buyerPhone = invoice.customer?.phone ?? invoice.walkInPhone ?? "";
  const buyerCity = invoice.customer?.city ?? "";

  const metaPairs: Array<[string, string, boolean?]> = [
    [t("invd.invoiceNo"), invoice.invoiceNumber, true],
    [t("invd.dated"), formatDate(invoice.invoiceDate), true],
    [t("invd.deliveryNote"), "—"],
    [t("invd.modeTerms"), invoice.paymentMode, true],
    [t("invd.refNoDate"), "—"],
    [t("invd.otherRefs"), "—"],
    [t("invd.buyerOrderNo"), "—"],
    [t("invd.dated"), "—"],
    [t("invd.dispatchDoc"), "—"],
    [t("invd.dnDate"), "—"],
    [t("invd.dispatchThrough"), "—"],
    [t("invd.destination"), buyerCity || "—", buyerCity !== ""],
  ];

  return (
    <>
      {/* Title band — centered, QR parked on the right like the e-Invoice slip */}
      <div className="relative flex items-start justify-between pb-2">
        <div className="w-24 shrink-0" />
        <div className="text-center">
          <h2 className="text-[18px] font-extrabold uppercase tracking-[0.08em] text-gray-900">{t("invd.docTaxInvoice")}</h2>
          <p className="text-[9.5px] text-gray-500 mt-0.5">{t("invd.originalRecipient")}</p>
          {isCounter && (
            <span className="inline-block mt-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-700 border border-gray-400 rounded px-2 py-0.5">
              {t("invd.counterSale")}
            </span>
          )}
        </div>
        {firm?.upiQrUrl ? (
          <div className="w-24 shrink-0 text-center">
            { }
            <img src={firm.upiQrUrl} alt="UPI QR" className="h-20 w-20 object-cover border border-gray-400 inline-block bg-white" />
            <p className="text-[7.5px] font-semibold uppercase tracking-wider text-gray-500 mt-0.5">{t("invd.scanPay")}</p>
          </div>
        ) : (
          <div className="w-24 shrink-0" />
        )}
      </div>

      {/* Seller / Consignee / Buyer | Invoice meta — the classic bordered grid */}
      <div className="grid grid-cols-[1.15fr_1fr] border border-gray-800 text-gray-900">
        {/* LEFT — seller, ship-to, bill-to */}
        <div className="border-r border-gray-800 min-w-0">
          <div className="p-2.5">
            <p className="text-[13px] font-extrabold leading-tight">{firm?.firmName ?? "DMK Mart"}</p>
            <p className="text-[10px] text-gray-700 mt-0.5 whitespace-pre-line leading-snug">{firm?.address ?? ""}</p>
            <div className="text-[9.5px] mt-1 space-y-px" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              <p>GSTIN/UIN : <span className="font-bold">{firm?.gstin || "—"}</span></p>
              <p>State Name : {firm?.state ?? "—"}, Code : {firm?.stateCode || "—"}</p>
            </div>
            <div className="text-[9.5px] text-gray-700 mt-0.5">
              {firm?.phone && <p>Ph : {firm.phone}</p>}
              {firm?.email && <p>E-Mail : {firm.email}</p>}
            </div>
          </div>
          <div className="p-2.5 border-t border-gray-500">
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-gray-500">{t("invd.consignee")}</p>
            <p className="text-[12px] font-bold leading-snug mt-0.5">{buyerName}</p>
            {buyerCity && <p className="text-[10px] text-gray-700">{buyerCity}</p>}
            <div className="text-[9.5px] mt-0.5 space-y-px" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              <p>GSTIN/UIN : <span className="font-bold">{buyerGstin || t("invd.urp")}</span></p>
              <p>State Name : {invoice.customer?.stateCode ? `${firm?.state ?? ""}, Code : ${buyerState}` : `${firm?.state ?? "—"}, Code : ${firm?.stateCode || "—"}`}</p>
            </div>
          </div>
          <div className="p-2.5 border-t border-gray-500">
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-gray-500">{t("invd.buyer")}</p>
            <p className="text-[12px] font-bold leading-snug mt-0.5">{buyerName}</p>
            {buyerCity && <p className="text-[10px] text-gray-700">{buyerCity}</p>}
            <div className="text-[9.5px] mt-0.5 space-y-px" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              <p>GSTIN/UIN : <span className="font-bold">{buyerGstin || t("invd.urp")}</span></p>
              <p>State Name : {invoice.customer?.stateCode ? `${firm?.state ?? ""}, Code : ${buyerState}` : `${firm?.state ?? "—"}, Code : ${firm?.stateCode || "—"}`}</p>
            </div>
            {buyerPhone && <p className="text-[9.5px] text-gray-700 mt-0.5">Ph : {buyerPhone}</p>}
          </div>
        </div>

        {/* RIGHT — invoice meta cells */}
        <div className="grid grid-cols-2 content-start">
          {metaPairs.map(([label, value, strong], i) => (
            <div key={`${label}-${i}`} className={cn("px-2 py-1 border-b border-gray-400 min-h-[26px]", i % 2 === 0 && "border-r border-gray-400")}>
              <p className="text-[8px] font-semibold uppercase tracking-wide text-gray-500 leading-tight">{label}</p>
              <p className={cn("text-[10px] leading-tight mt-0.5 truncate", strong ? "font-bold" : "text-gray-600")} style={strong ? { fontFamily: "var(--font-jetbrains), monospace" } : undefined}>
                {value}
              </p>
            </div>
          ))}
          <div className="px-2 py-1 col-span-2 border-b border-gray-400 min-h-[26px]">
            <p className="text-[8px] font-semibold uppercase tracking-wide text-gray-500 leading-tight">{t("invd.termsDelivery")}</p>
            <p className="text-[10px] text-gray-600 leading-tight mt-0.5">—</p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Continuation band (pages 2+) ────────────────────────────────

function InvoiceContHeader({
  invoice,
  firm,
  buyerName,
  page,
  total,
}: {
  invoice: Invoice;
  firm?: Firm;
  buyerName: string;
  page: number;
  total: number;
}) {
  const { t } = useT();
  return (
    <div className="flex items-end justify-between gap-6 border-b-2 border-gray-800 pb-2">
      <div className="min-w-0">
        <p className="text-[15px] font-extrabold uppercase tracking-wide text-gray-900">
          {t("invd.docTaxInvoice")} <span className="font-semibold text-gray-500 normal-case">— {t("invd.contd")}</span>
        </p>
        <p className="mt-0.5 text-[10.5px] text-gray-600 truncate">
          {firm?.firmName ?? "DMK Mart"} · {t("invd.buyer")} {buyerName} · {formatDate(invoice.invoiceDate)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11.5px] font-bold text-gray-800" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
          {invoice.invoiceNumber}
        </p>
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-500">{t("invd.pageOf", { a: page, b: total })}</p>
      </div>
    </div>
  );
}

// ── Line items table (Sl | Goods | HSN | Qty | Rate | per | Amount) ──

function InvoiceItemsTable({
  rows,
  totals,
  showTotalRow,
}: {
  rows: TrEntry[];
  totals?: { qty: number; unit: string; grand: number };
  showTotalRow?: boolean;
}) {
  const { t } = useT();
  return (
    <table className="mt-2 w-full border-collapse" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
      <thead>
        <tr className="bg-gray-100">
          <th className={cn(HEAD, "text-left w-8")}>{t("invd.slNo")}</th>
          <th className={cn(HEAD, "text-left")}>{t("invd.descGoods")}</th>
          <th className={cn(HEAD, "text-center w-14")}>{t("invd.hsnSac")}</th>
          <th className={cn(HEAD, "text-right w-16")}>{t("invd.quantityCol")}</th>
          <th className={cn(HEAD, "text-right w-16")}>{t("invd.colRate")}</th>
          <th className={cn(HEAD, "text-center w-10")}>{t("invd.per")}</th>
          <th className={cn(HEAD, "text-right w-[84px]")}>{t("invd.colAmount")}</th>
        </tr>
      </thead>
      <tbody data-a4-rows>
        {rows.length === 0 && !showTotalRow && (
          <tr>
            <td colSpan={7} className="border border-gray-400 px-2 py-4 text-center text-[11px] text-gray-500" style={{ fontFamily: "var(--font-inter), sans-serif" }}>{t("invd.noLines")}</td>
          </tr>
        )}
        {rows.map((e, k) =>
          e.kind === "main" ? (
            <InvoiceRow key={`m-${k}-${e.idx}`} li={e.li} idx={e.idx} />
          ) : (
            <TaxRow key={`t-${k}-${e.label}`} entry={e} />
          )
        )}
        {showTotalRow && totals && (
          <tr className="bg-gray-50">
            <td colSpan={3} className={cn(CELL, "text-right font-bold text-[11px] text-gray-900")}>{t("invd.grandTotal")}</td>
            <td className={cn(CELL, "text-right font-bold text-[10.5px]")}>{qtyFmt(totals.qty)}</td>
            <td className={CELL}>&nbsp;</td>
            <td className={CELL}>&nbsp;</td>
            <td className={cn(CELL, "text-right font-extrabold text-[11.5px] text-gray-900")}>₹ {money(totals.grand)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ── Bottom chrome: words + rate-wise tax + PAN/declaration/bank/sign ──

function InvoiceBottomChrome({
  invoice,
  firm,
  intra,
  items,
  page,
  total,
  footerNote,
  footerDoc,
  footerDate,
}: {
  invoice: Invoice;
  firm?: Firm;
  intra: boolean;
  items: DetailLineItem[];
  page: number;
  total: number;
  footerNote: string;
  footerDoc: string;
  footerDate: string;
}) {
  const { t } = useT();
  const billDiscAmt = Math.max(0, Number(invoice.billDiscountAmt) || 0);
  const taxTotal = Number(invoice.totalCgst) + Number(invoice.totalSgst) + Number(invoice.totalIgst);
  const gstRows = rateWise(items, intra);
  const pan = firm?.gstin && firm.gstin.length >= 12 ? firm.gstin.slice(2, 12) : "—";

  return (
    <>
      {/* Amount Chargeable (in words) */}
      <div className="border border-t-2 border-gray-800 mt-2">
        <p className="text-[8.5px] font-semibold uppercase tracking-wider text-gray-500 px-2 pt-1">{t("invd.chargeableWords")}</p>
        <div className="flex items-baseline justify-between gap-4 px-2 pb-1.5 pt-0.5">
          <p className="text-[11.5px] font-bold text-gray-900 leading-snug">{wordsINR(invoice.amountInWords, Number(invoice.grandTotal))}</p>
          <p className="text-[10px] italic text-gray-500 shrink-0">{t("invd.eoe")}</p>
        </div>
      </div>

      {/* Rate-wise tax summary + tax words (only when the bill carries GST) */}
      {taxTotal > 0 && gstRows.length > 0 && (
        <>
          <table className="w-full border-collapse text-[10px]" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
            <thead>
              <tr className="bg-gray-100">
                <th className={cn(HEAD, "text-left")}>&nbsp;</th>
                <th className={cn(HEAD, "text-right w-[86px]")}>{t("invd.colTaxable")}</th>
                {intra ? (
                  <>
                    <th className={cn(HEAD, "text-right w-12")}>CGST</th>
                    <th className={cn(HEAD, "text-right w-[70px]")}>{t("invd.colAmount")}</th>
                    <th className={cn(HEAD, "text-right w-12")}>SGST</th>
                    <th className={cn(HEAD, "text-right w-[70px]")}>{t("invd.colAmount")}</th>
                  </>
                ) : (
                  <>
                    <th className={cn(HEAD, "text-right w-12")}>IGST</th>
                    <th className={cn(HEAD, "text-right w-[70px]")}>{t("invd.colAmount")}</th>
                  </>
                )}
                <th className={cn(HEAD, "text-right w-[84px]")}>{t("invd.totalTaxAmt")}</th>
              </tr>
            </thead>
            <tbody>
              {gstRows.map((r) => (
                <tr key={r.rate}>
                  <td className={cn(CELL, "font-semibold text-gray-800")} style={{ fontFamily: "var(--font-inter), sans-serif" }}>{intra ? `GST ${pct(r.rate)}` : `IGST ${pct(r.rate)}`}</td>
                  <td className={cn(CELL, "text-right")}>{money(r.taxable)}</td>
                  {intra ? (
                    <>
                      <td className={cn(CELL, "text-right")}>{pct(r.rate / 2)}</td>
                      <td className={cn(CELL, "text-right")}>{money(r.cgst)}</td>
                      <td className={cn(CELL, "text-right")}>{pct(r.rate / 2)}</td>
                      <td className={cn(CELL, "text-right")}>{money(r.sgst)}</td>
                    </>
                  ) : (
                    <>
                      <td className={cn(CELL, "text-right")}>{pct(r.rate)}</td>
                      <td className={cn(CELL, "text-right")}>{money(r.igst)}</td>
                    </>
                  )}
                  <td className={cn(CELL, "text-right font-semibold")}>{money(intra ? r.cgst + r.sgst : r.igst)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className={cn(CELL, "text-right text-gray-900")} style={{ fontFamily: "var(--font-inter), sans-serif" }}>{t("invd.grandTotal")}:</td>
                <td className={cn(CELL, "text-right")}>{money(gstRows.reduce((s, r) => s + r.taxable, 0))}</td>
                {intra ? (
                  <>
                    <td className={CELL}>&nbsp;</td>
                    <td className={cn(CELL, "text-right")}>{money(invoice.totalCgst)}</td>
                    <td className={CELL}>&nbsp;</td>
                    <td className={cn(CELL, "text-right")}>{money(invoice.totalSgst)}</td>
                  </>
                ) : (
                  <>
                    <td className={CELL}>&nbsp;</td>
                    <td className={cn(CELL, "text-right")}>{money(invoice.totalIgst)}</td>
                  </>
                )}
                <td className={cn(CELL, "text-right")}>{money(taxTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className="border border-t-0 border-gray-800 px-2 py-1">
            <p className="text-[10.5px] text-gray-800">
              <span className="font-semibold">{t("invd.taxWords")} :</span>{" "}
              <span className="font-bold">{wordsINR(undefined, taxTotal)}</span>
            </p>
          </div>
        </>
      )}

      {/* Delivery OTP — kept from the DMK flow, slim strip under tax words */}
      {!invoice.isCounterSale && invoice.deliveryOtp ? (
        <div className="border border-dashed border-gray-500 rounded-sm px-2 py-1 mt-1.5 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-gray-600">{t("invd.otpTitle")}</p>
            <p className="text-[8px] text-gray-500 leading-snug">{t("invd.otpHint")}</p>
          </div>
          <p className="ml-auto text-[16px] font-black tracking-[0.4em] text-gray-900 shrink-0" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
            [{invoice.deliveryOtp.split("").join(" ")}]
          </p>
        </div>
      ) : null}

      {/* PAN + Declaration | Bank details + signatures */}
      <div className="border border-gray-800 mt-2">
        <div className="px-2 py-1 border-b border-gray-800">
          <p className="text-[10.5px] text-gray-900">
            <span className="font-semibold">{t("invd.pan")}</span> : <span className="font-bold" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>{pan}</span>
          </p>
        </div>
        <div className="grid grid-cols-2">
          <div className="p-2 border-r border-gray-800">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 underline underline-offset-2">{t("invd.declaration")}</p>
            <p className="text-[9.5px] text-gray-700 leading-snug mt-1">{t("invd.declarationBody")}</p>
            <p className="text-[9px] text-gray-600 mt-1">{t("invd.jurisdiction", { place: firm?.state ? firm.state : t("invd.local") })}</p>
            {billDiscAmt > 0 && (
              <p className="text-[9px] text-gray-600 mt-1">
                {t("invd.billDiscount")}: {Number(invoice.billDiscountPct) > 0 ? `${Number(invoice.billDiscountPct)}% ` : ""}− {money(billDiscAmt)}
              </p>
            )}
          </div>
          <div className="p-2 flex flex-col">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{t("invd.bankDetails")}</p>
            <div className="text-[9.5px] text-gray-800 mt-1 space-y-0.5" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
              <p>{t("invd.bankLbl")} : {firm?.bankName || "—"}</p>
              <p>{t("invd.acLbl")} : {firm?.bankAccount || "—"}</p>
              <p>{t("invd.ifscLbl")} : {firm?.ifsc || "—"}</p>
            </div>
            <p className="text-[10px] text-gray-800 mt-auto pt-3 text-right">
              {t("invd.forFirm")} <span className="font-bold">{firm?.firmName ?? "DMK Mart"}</span>
            </p>
          </div>
        </div>
        <div className="border-t border-gray-800 grid grid-cols-2 px-2 py-1.5 items-end">
          <p className="text-[9.5px] text-gray-700">{t("invd.sealSignature")}</p>
          <p className="text-[9.5px] text-gray-700 text-right">{t("invd.signatory")}</p>
        </div>
      </div>

      <p className="text-center text-[9px] uppercase tracking-wide text-gray-500 pt-1.5">{t("invd.computerGenerated")}</p>

      {/* Standard document footer — every page in the project ends with this */}
      <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={page} totalPages={total} date={footerDate} />
    </>
  );
}

// ── Row renderers ───────────────────────────────────────────────

function InvoiceRow({ li, idx }: { li: DetailLineItem; idx: number }) {
  // Effective per-line discount vs the tier base price — covers packaging
  // bulk discounts AND booked-price overrides.
  const base = Number(li.baseTierPrice) || 0;
  const unitPrice = Number(li.unitPrice) || 0;
  const effPct = base > 0 && unitPrice < base ? Math.round(((base - unitPrice) / base) * 1000) / 10 : 0;
  return (
    <tr>
      <td className={cn(CELL, "text-[10px] text-gray-700 text-center align-top")}>{idx}</td>
      <td className={cn(CELL, "text-[10.5px] text-gray-900 font-medium align-top")} style={{ fontFamily: "var(--font-inter), sans-serif" }}>
        {li.productName}
        <span className="block text-[8px] text-gray-400 leading-tight">{li.sku}</span>
      </td>
      <td className={cn(CELL, "text-[10px] text-gray-700 text-center align-top")}>{li.hsnCode}</td>
      <td className={cn(CELL, "text-[10.5px] text-gray-900 text-right align-top")}>{qtyFmt(li.quantity)}</td>
      <td className={cn(CELL, "text-[10.5px] text-gray-900 text-right align-top")}>
        {money(li.unitPrice)}
        {effPct > 0 && base > 0 && (
          <span className="block text-[8px] text-gray-400 line-through leading-tight">{money(base)}</span>
        )}
      </td>
      <td className={cn(CELL, "text-[9.5px] text-gray-600 text-center align-top")}>{li.product?.unit ?? "NOS"}</td>
      <td className={cn(CELL, "text-[10.5px] text-gray-900 text-right font-semibold align-top")}>{money(li.totalAmount)}</td>
    </tr>
  );
}

function TaxRow({ entry }: { entry: Extract<TrEntry, { kind: "tax" }> }) {
  return (
    <tr className="bg-gray-50/60">
      <td className={CELL}>&nbsp;</td>
      <td className={cn(CELL, "text-[10px] font-semibold text-gray-800 text-right italic")} style={{ fontFamily: "var(--font-inter), sans-serif" }}>{entry.label}</td>
      <td className={CELL}>&nbsp;</td>
      <td className={CELL}>&nbsp;</td>
      <td className={cn(CELL, "text-[10px] text-gray-700 text-right")}>{pct(entry.ratePct)}</td>
      <td className={CELL}>&nbsp;</td>
      <td className={cn(CELL, "text-[10.5px] text-gray-900 text-right")}>{money(entry.amount)}</td>
    </tr>
  );
}
