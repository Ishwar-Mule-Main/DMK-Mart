"use client";

// ═══════════════════════════════════════════════════════════════
// ESTIMATES — GST-free quotation slips on the shared A4 page system
// Left: estimate register. Right: the A4 slip — firm name on top,
// buyer block, Particulars | Nos | Rate | Amount table, grand total
// (numeric + in words) and a thank-you note. NO GST, NO stock, NO
// ledger impact — a plain printed slip for walk-in quotations.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Calculator, Minus, Plus, Printer, Search, Trash2 } from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate, amountInWords } from "@/lib/format";
import type { Estimate, EstimateListRow, EstimateItemRow, Firm } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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

const ZOOMS = [0.8, 1, 1.25] as const;

const UNITS = ["NOS", "PCS", "SET", "KGS", "LTR", "BOX", "PKT", "DOZ", "MTR", "BAG"];

/** Plain Indian-grouped number for A4 document cells (no ₹ symbol). */
const money = (n: number | null | undefined) => formatINR(Number(n ?? 0), false);

/** Indian-grouped quantity with 2 decimals (slip style: 50.00 / 6.00). */
const qtyFmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "… Rupees Only" → "INR … Only" — same words style the tax invoice prints. */
const wordsINR = (amt: number) =>
  `INR ${amountInWords(amt).replace(/\s*Rupees? Only\.?$/i, "").trim()} Only`;

interface DraftRow {
  key: string;
  productName: string;
  unit: string;
  quantity: string;
  rate: string;
}

const emptyRow = (): DraftRow => ({ key: Math.random().toString(36).slice(2), productName: "", unit: "NOS", quantity: "", rate: "" });

export default function EstimatesView() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const firm = useActiveFirm();

  const [query, setQuery] = React.useState("");
  const [list, setList] = React.useState<EstimateListRow[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [estimate, setEstimate] = React.useState<Estimate | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [zoom, setZoom] = React.useState<(typeof ZOOMS)[number]>(1);
  const [pageCount, setPageCount] = React.useState<number | null>(null);

  // Create dialog state
  const [openNew, setOpenNew] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [partyName, setPartyName] = React.useState("");
  const [partyPhone, setPartyPhone] = React.useState("");
  const [partyCity, setPartyCity] = React.useState("");
  const [estDate, setEstDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");
  const [rows, setRows] = React.useState<DraftRow[]>([emptyRow()]);

  // Delete state
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const loadList = React.useCallback(async () => {
    if (!activeFirmId) return;
    try {
      const res = await apiGet<{ estimates: EstimateListRow[] }>("/api/v1/estimates", { firmId: activeFirmId, search: query.trim() });
      setList(res.estimates);
      setSelectedId((cur) => cur ?? res.estimates[0]?.id ?? null);
    } catch (e) {
      setList([]);
      if (e instanceof ApiError) toast({ variant: "destructive", title: t("est.toastFailed"), description: e.message });
    }
  }, [activeFirmId, query, toast, t]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    const timer = setTimeout(loadList, 220);
    return () => clearTimeout(timer);
  }, [activeFirmId, query, loadList]);

  React.useEffect(() => {
    if (!selectedId) {
      setEstimate(null);
      setPageCount(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    apiGet<{ estimate: Estimate }>(`/api/v1/estimates/${selectedId}`)
      .then((res) => {
        if (alive) {
          setEstimate(res.estimate);
          setPageCount(null);
        }
      })
      .catch((e) => {
        if (alive) {
          setEstimate(null);
          toast({ variant: "destructive", title: t("est.toastFailed"), description: e instanceof ApiError ? e.message : t("invr.errUnknown") });
        }
      })
      .finally(() => alive && setDetailLoading(false));
    return () => {
      alive = false;
    };
  }, [selectedId, toast, t]);

  const draftItems: EstimateItemRow[] = rows
    .filter((r) => r.productName.trim() !== "" && Number(r.quantity) > 0)
    .map((r) => ({
      productName: r.productName.trim(),
      unit: r.unit,
      quantity: Number(r.quantity),
      rate: Number(r.rate) || 0,
      amount: Math.round(Number(r.quantity) * (Number(r.rate) || 0) * 100) / 100,
    }));
  const draftTotal = draftItems.reduce((s, it) => s + it.amount, 0);
  const draftQty = draftItems.reduce((s, it) => s + it.quantity, 0);

  const resetForm = () => {
    setPartyName("");
    setPartyPhone("");
    setPartyCity("");
    setEstDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setRows([emptyRow()]);
  };

  const handleCreate = async () => {
    if (!activeFirmId) return;
    if (!partyName.trim()) {
      toast({ variant: "destructive", title: t("est.toastFailed"), description: t("est.partyRequired") });
      return;
    }
    if (draftItems.length === 0) {
      toast({ variant: "destructive", title: t("est.toastFailed"), description: t("est.itemsRequired") });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ estimate: Estimate }>("/api/v1/estimates", {
        firmId: activeFirmId,
        partyName: partyName.trim(),
        partyPhone: partyPhone.trim(),
        partyCity: partyCity.trim(),
        estimateDate: new Date(`${estDate}T00:00:00`).toISOString(),
        notes: notes.trim(),
        items: draftItems,
      });
      toast({ title: t("est.toastCreated", { no: res.estimate.estimateNumber }) });
      setOpenNew(false);
      resetForm();
      await loadList();
      setSelectedId(res.estimate.id);
    } catch (e) {
      toast({ variant: "destructive", title: t("est.toastFailed"), description: e instanceof ApiError ? e.message : t("invr.errUnknown") });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!estimate) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/estimates/${estimate.id}`);
      toast({ title: t("est.toastDeleted") });
      setConfirmDelete(false);
      const remaining = (list ?? []).filter((r) => r.id !== estimate.id);
      setList(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setEstimate(null);
    } catch (e) {
      toast({ variant: "destructive", title: t("est.toastFailed"), description: e instanceof ApiError ? e.message : t("invr.errUnknown") });
    } finally {
      setDeleting(false);
    }
  };

  const handlePageCount = React.useCallback((n: number) => setPageCount(n), []);

  if (!activeFirmId) {
    return <EmptyState icon={Calculator} title={t("sale.noFirm")} hint={t("sale.noFirmHint")} />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar (no-print) */}
      <div className="no-print space-y-4">
        <PageHeader
          title={t("est.title")}
          subtitle={t("est.subtitle")}
          icon={Calculator}
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
              <Button size="sm" className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={() => setOpenNew(true)}>
                <Plus className="h-4 w-4" /> {t("est.new")}
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* ═══ LEFT — estimate register (no-print) ═══ */}
        <div className="no-print dmk-card overflow-hidden lg:sticky lg:top-20">
          <div className="p-3 border-b border-dmk-border-subtle">
            <div className="relative">
              <SearchInput value={query} onChange={setQuery} placeholder={t("est.searchPh")} className="pl-9" />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {list === null ? (
              <LoadingRows rows={6} />
            ) : list.length === 0 ? (
              <EmptyState icon={Calculator} title={t("est.empty")} hint={t("est.emptyHint")} />
            ) : (
              list.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    "w-full text-left px-3.5 py-2.5 border-b border-dmk-border-subtle transition-colors",
                    selectedId === e.id ? "bg-dmk-hover" : "hover:bg-dmk-hover/60"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-money text-[12.5px] text-dmk-text-primary">{e.estimateNumber}</span>
                    <span className="font-money text-[12px] text-dmk-yellow">{formatINR(Number(e.totalAmount))}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-dmk-text-muted truncate">{e.partyName}</span>
                    <span className="text-[11px] text-dmk-text-muted whitespace-nowrap">{formatDate(e.estimateDate)}</span>
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
          ) : !estimate ? (
            <div className="dmk-card">
              <EmptyState icon={Calculator} title={t("est.select")} hint={t("est.selectHint")} />
            </div>
          ) : (
            <>
              <div className="no-print flex items-center justify-between px-1 pb-2">
                <div className="flex items-center gap-2">
                  <Badge tone="warning">{t("est.badge")}</Badge>
                  <span className="text-[11.5px] text-dmk-text-muted">{t("est.pagesExact", { n: pageCount ?? 1 })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="sm:hidden flex items-center gap-1 dmk-well p-1">
                    <button aria-label={t("invd.zoomOut")} onClick={() => setZoom((z) => (z === 1.25 ? 1 : 0.8))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Minus className="h-3.5 w-3.5" /></button>
                    <span className="text-[11px] font-money px-1">{Math.round(zoom * 100)}%</span>
                    <button aria-label={t("invd.zoomIn")} onClick={() => setZoom((z) => (z === 0.8 ? 1 : 1.25))} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-dmk-text-primary"><Plus className="h-3.5 w-3.5" /></button>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> {t("est.delete")}
                  </Button>
                  <Button size="sm" className="h-8 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={printA4}>
                    <Printer className="h-3.5 w-3.5" /> {t("cmn.print")}
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto pb-4">
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }} className="print:transform-none inline-block">
                  <A4EstimateSlip estimate={estimate} firm={firm} onPageCount={handlePageCount} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ New Estimate dialog ═══ */}
      <Dialog open={openNew} onOpenChange={(v) => !saving && setOpenNew(v)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("est.newTitle")}</DialogTitle>
            <DialogDescription>{t("est.newDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="est-party">{t("est.partyName")} *</Label>
              <Input id="est-party" value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder={t("est.partyNamePh")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="est-phone">{t("est.partyPhone")}</Label>
              <Input id="est-phone" value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} inputMode="tel" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="est-city">{t("est.partyCity")}</Label>
              <Input id="est-city" value={partyCity} onChange={(e) => setPartyCity(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="est-date">{t("est.estDate")}</Label>
              <Input id="est-date" type="date" value={estDate} onChange={(e) => setEstDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("est.rowsTotalLabel")}</Label>
              <div className="h-9 px-3 inline-flex items-center rounded-md border border-dmk-border-subtle bg-dmk-well text-[12.5px] font-money w-full">
                {t("est.rowsTotal", { n: draftItems.length, q: qtyFmt(draftQty), a: formatINR(draftTotal) })}
              </div>
            </div>
          </div>

          {/* Item rows editor */}
          <div className="space-y-1.5">
            <Label>{t("est.items")} *</Label>
            <div className="max-h-64 overflow-y-auto rounded-md border border-dmk-border-subtle divide-y divide-dmk-border-subtle">
              {rows.map((r, i) => {
                const amount = Number(r.quantity) > 0 ? Math.round(Number(r.quantity) * (Number(r.rate) || 0) * 100) / 100 : 0;
                return (
                  <div key={r.key} className="flex items-center gap-1.5 p-2">
                    <span className="text-[11px] text-dmk-text-muted w-5 text-right shrink-0 font-money">{i + 1}</span>
                    <Input
                      value={r.productName}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, productName: e.target.value } : x)))}
                      placeholder={t("est.itemNamePh")}
                      className="h-8 flex-1 min-w-0"
                      aria-label={t("est.itemName")}
                    />
                    <select
                      value={r.unit}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, unit: e.target.value } : x)))}
                      aria-label={t("est.colNos")}
                      className="h-8 w-[70px] shrink-0 rounded-md border border-dmk-border-subtle bg-background px-1 text-[12px]"
                    >
                      {UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={r.quantity}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, quantity: e.target.value } : x)))}
                      placeholder="0"
                      className="h-8 w-16 shrink-0 text-right font-money"
                      aria-label={t("est.qty")}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={r.rate}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, rate: e.target.value } : x)))}
                      placeholder="0"
                      className="h-8 w-20 shrink-0 text-right font-money"
                      aria-label={t("est.colRate")}
                    />
                    <span className="w-20 text-right text-[12px] font-money shrink-0 hidden sm:block">{formatINR(amount)}</span>
                    <button
                      onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                      aria-label={t("est.remove")}
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-dmk-text-muted hover:text-red-400 hover:bg-red-500/10"
                      disabled={rows.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              <Plus className="h-3.5 w-3.5" /> {t("est.addRow")}
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="est-notes">{t("est.notes")}</Label>
            <Textarea id="est-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNew(false)} disabled={saving}>{t("est.cancel")}</Button>
            <Button className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={handleCreate} disabled={saving || !partyName.trim() || draftItems.length === 0}>
              {saving ? t("est.creating") : t("est.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete confirm ═══ */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("est.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("est.deleteDesc", { no: estimate?.estimateNumber ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("est.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? t("est.deleting") : t("est.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Chrome-free print copy — the ONLY thing that reaches paper */}
      {estimate && (
        <A4PrintPortal>
          <A4EstimateSlip estimate={estimate} firm={firm} />
        </A4PrintPortal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// A4 estimate slip — real paper pages via the shared A4 page system.
// ═══════════════════════════════════════════════════════════════
function A4EstimateSlip({
  estimate,
  firm,
  onPageCount,
}: {
  estimate: Estimate;
  firm?: Firm;
  onPageCount?: (n: number) => void;
}) {
  const { t } = useT();
  const lang = useErpStore((s) => s.language);
  const items = estimate.items;

  const fullRef = React.useRef<HTMLDivElement>(null);
  const firstRef = React.useRef<HTMLDivElement>(null);
  const contRef = React.useRef<HTMLDivElement>(null);
  const lastRef = React.useRef<HTMLDivElement>(null);
  const refs: A4PaginateRefs = React.useMemo(
    () => ({ full: fullRef, first: firstRef, cont: contRef, last: lastRef }),
    []
  );
  const pages = useA4Paginate(items.length, `${estimate.id}:${items.length}:${lang}`, refs);

  React.useEffect(() => {
    if (pages) onPageCount?.(pages.length);
  }, [pages, onPageCount]);

  const total = pages?.length ?? 1;
  const footerNote = t("est.footerNote");
  const footerDoc = `${t("est.badge")} · ${estimate.estimateNumber}`;
  const footerDate = formatDate(estimate.estimateDate);
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  return (
    <>
      <A4MeasureTwin>
        <A4Replica replicaRef={fullRef}>
          <EstTopChrome estimate={estimate} firm={firm} />
          <EstItemsTable items={items} totals={{ qty: totalQty, grand: Number(estimate.totalAmount) }} showTotalRow />
          <EstBottomChrome estimate={estimate} firm={firm} page={1} total={1} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={firstRef}>
          <EstTopChrome estimate={estimate} firm={firm} />
          <EstItemsTable items={[]} />
          <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={1} totalPages={1} date={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={contRef}>
          <EstContHeader estimate={estimate} firm={firm} page={1} total={1} />
          <EstItemsTable items={[]} />
          <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={1} totalPages={1} date={footerDate} />
        </A4Replica>
        <A4Replica replicaRef={lastRef}>
          <EstContHeader estimate={estimate} firm={firm} page={1} total={1} />
          <EstItemsTable items={[]} totals={{ qty: totalQty, grand: Number(estimate.totalAmount) }} showTotalRow />
          <EstBottomChrome estimate={estimate} firm={firm} page={1} total={1} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
        </A4Replica>
      </A4MeasureTwin>

      {pages && (
        <A4PageStack>
          {pages.map((idxs, p) => {
            const isLast = p === pages.length - 1;
            const chunk = idxs.map((i) => items[i]);
            return (
              <A4Sheet key={`${estimate.id}:${p}`}>
                {p === 0 ? (
                  <EstTopChrome estimate={estimate} firm={firm} />
                ) : (
                  <EstContHeader estimate={estimate} firm={firm} page={p + 1} total={pages.length} />
                )}
                <EstItemsTable
                  items={chunk}
                  offset={idxs.length ? idxs[0] : 0}
                  totals={isLast ? { qty: totalQty, grand: Number(estimate.totalAmount) } : undefined}
                  showTotalRow={isLast}
                />
                {isLast ? (
                  <EstBottomChrome estimate={estimate} firm={firm} page={p + 1} total={pages.length} footerNote={footerNote} footerDoc={footerDoc} footerDate={footerDate} />
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

// ── Page 1 chrome: company name + buyer ─────────────────────────

const EST_CELL = "border border-gray-400 px-1.5 py-1";
const EST_HEAD = "border border-gray-500 px-1.5 py-1 text-[9.5px] font-bold uppercase text-gray-800 tracking-wide";

function EstTopChrome({ estimate, firm }: { estimate: Estimate; firm?: Firm }) {
  const { t } = useT();

  const metaPairs: Array<[string, string, boolean?]> = [
    [t("est.estimateNo"), estimate.estimateNumber, true],
    [t("est.date"), formatDate(estimate.estimateDate), true],
    [t("invd.deliveryNote"), "—"],
    [t("invd.modeTerms"), "—"],
    [t("invd.refNoDate"), "—"],
    [t("invd.otherRefs"), "—"],
    [t("invd.buyerOrderNo"), "—"],
    [t("invd.dated"), "—"],
    [t("invd.dispatchDoc"), "—"],
    [t("invd.dnDate"), "—"],
    [t("invd.dispatchThrough"), "—"],
    [t("invd.destination"), estimate.partyCity || "—", estimate.partyCity !== ""],
  ];

  return (
    <>
      {/* Title band — identical geometry to the tax invoice (QR slot left empty) */}
      <div className="relative flex items-start justify-between pb-2">
        <div className="w-24 shrink-0" />
        <div className="text-center">
          <h2 className="text-[18px] font-extrabold uppercase tracking-[0.08em] text-gray-900">{t("est.docTitle")}</h2>
          <p className="text-[9.5px] text-gray-500 mt-0.5">{t("est.docSubtitle")}</p>
        </div>
        <div className="w-24 shrink-0" />
      </div>

      {/* Seller / Ship-to / Bill-to | estimate meta — the same bordered grid as the tax invoice */}
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
            <p className="text-[12px] font-bold leading-snug mt-0.5">{estimate.partyName}</p>
            {estimate.partyCity && <p className="text-[10px] text-gray-700">{estimate.partyCity}</p>}
            {estimate.partyPhone && <p className="text-[9.5px] text-gray-700 mt-0.5">Ph : {estimate.partyPhone}</p>}
          </div>
          <div className="p-2.5 border-t border-gray-500">
            <p className="text-[8.5px] font-bold uppercase tracking-wider text-gray-500">{t("invd.buyer")}</p>
            <p className="text-[12px] font-bold leading-snug mt-0.5">{estimate.partyName}</p>
            {estimate.partyCity && <p className="text-[10px] text-gray-700">{estimate.partyCity}</p>}
            {estimate.partyPhone && <p className="text-[9.5px] text-gray-700 mt-0.5">Ph : {estimate.partyPhone}</p>}
          </div>
        </div>

        {/* RIGHT — estimate meta cells (same grid as the invoice) */}
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

// ── Continuation band ───────────────────────────────────────────

function EstContHeader({ estimate, firm, page, total }: { estimate: Estimate; firm?: Firm; page: number; total: number }) {
  const { t } = useT();
  return (
    <div className="flex items-end justify-between gap-6 border-b-2 border-gray-800 pb-2">
      <div className="min-w-0">
        <p className="text-[15px] font-extrabold uppercase tracking-wide text-gray-900">
          {t("est.docTitle")} <span className="font-semibold text-gray-500 normal-case">— {t("est.contd")}</span>
        </p>
        <p className="mt-0.5 text-[10.5px] text-gray-600 truncate">
          {firm?.firmName ?? "DMK Mart"} · {t("est.buyer")} {estimate.partyName} · {formatDate(estimate.estimateDate)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11.5px] font-bold text-gray-800" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
          {estimate.estimateNumber}
        </p>
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-gray-500">{t("invd.pageOf", { a: page, b: total })}</p>
      </div>
    </div>
  );
}

// ── Items table: Sl | Description of Goods | Quantity | Rate | per | Amount
// (the tax invoice's table minus HSN/SAC and minus every GST row)

function EstItemsTable({
  items,
  offset = 0,
  totals,
  showTotalRow,
}: {
  items: EstimateItemRow[];
  offset?: number;
  totals?: { qty: number; grand: number };
  showTotalRow?: boolean;
}) {
  const { t } = useT();
  return (
    <table className="mt-2 w-full border-collapse" style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
      <thead>
        <tr className="bg-gray-100">
          <th className={cn(EST_HEAD, "text-left w-8")}>{t("invd.slNo")}</th>
          <th className={cn(EST_HEAD, "text-left")}>{t("invd.descGoods")}</th>
          <th className={cn(EST_HEAD, "text-right w-16")}>{t("invd.quantityCol")}</th>
          <th className={cn(EST_HEAD, "text-right w-16")}>{t("est.colRate")}</th>
          <th className={cn(EST_HEAD, "text-center w-10")}>{t("invd.per")}</th>
          <th className={cn(EST_HEAD, "text-right w-[84px]")}>{t("est.colAmount")}</th>
        </tr>
      </thead>
      <tbody data-a4-rows>
        {items.length === 0 && !showTotalRow && (
          <tr>
            <td colSpan={6} className="border border-gray-400 px-2 py-4 text-center text-[11px] text-gray-500" style={{ fontFamily: "var(--font-inter), sans-serif" }}>{t("est.noLines")}</td>
          </tr>
        )}
        {items.map((it, k) => (
          <tr key={it.id ?? `row-${offset + k}`}>
            <td className={cn(EST_CELL, "text-[10px] text-gray-700 text-center align-top")}>{offset + k + 1}</td>
            <td className={cn(EST_CELL, "text-[10.5px] text-gray-900 font-medium align-top")} style={{ fontFamily: "var(--font-inter), sans-serif" }}>
              {it.productName}
            </td>
            <td className={cn(EST_CELL, "text-[10.5px] text-gray-900 text-right align-top")}>{qtyFmt(it.quantity)}</td>
            <td className={cn(EST_CELL, "text-[10.5px] text-gray-900 text-right align-top")}>{money(it.rate)}</td>
            <td className={cn(EST_CELL, "text-[9.5px] text-gray-600 text-center align-top")}>{it.unit}</td>
            <td className={cn(EST_CELL, "text-[10.5px] text-gray-900 text-right font-semibold align-top")}>{money(it.amount)}</td>
          </tr>
        ))}
        {showTotalRow && totals && (
          <tr className="bg-gray-50">
            <td colSpan={2} className={cn(EST_CELL, "text-right font-bold text-[11px] text-gray-900")}>{t("invd.grandTotal")}</td>
            <td className={cn(EST_CELL, "text-right font-bold text-[10.5px]")}>{qtyFmt(totals.qty)}</td>
            <td className={EST_CELL}>&nbsp;</td>
            <td className={EST_CELL}>&nbsp;</td>
            <td className={cn(EST_CELL, "text-right font-extrabold text-[11.5px] text-gray-900")}>₹ {money(totals.grand)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ── Bottom chrome: total in words + declaration/bank + thank you ──

function EstBottomChrome({
  estimate,
  firm,
  page,
  total,
  footerNote,
  footerDoc,
  footerDate,
}: {
  estimate: Estimate;
  firm?: Firm;
  page: number;
  total: number;
  footerNote: string;
  footerDoc: string;
  footerDate: string;
}) {
  const { t } = useT();
  return (
    <>
      {/* Total (in words) — the invoice's chargeable-words band, GST-free number */}
      <div className="border border-t-2 border-gray-800 mt-2">
        <p className="text-[8.5px] font-semibold uppercase tracking-wider text-gray-500 px-2 pt-1">{t("est.totalWords")}</p>
        <div className="flex items-baseline justify-between gap-4 px-2 pb-1.5 pt-0.5">
          <p className="text-[11.5px] font-bold text-gray-900 leading-snug">{wordsINR(Number(estimate.totalAmount))}</p>
          <p className="text-[10px] italic text-gray-500 shrink-0">{t("invd.eoe")}</p>
        </div>
      </div>

      {/* Notes — the auto-generated origin stamp lands here */}
      {estimate.notes && (
        <div className="border border-gray-400 px-2 py-1.5 mt-1.5">
          <p className="text-[8.5px] font-semibold uppercase tracking-wider text-gray-500">{t("est.notes")}</p>
          <p className="text-[10px] text-gray-700 leading-snug mt-0.5 whitespace-pre-line">{estimate.notes}</p>
        </div>
      )}

      {/* Declaration | Bank details + signatures — invoice's block, minus PAN (no tax identity) */}
      <div className="border border-gray-800 mt-2">
        <div className="grid grid-cols-2">
          <div className="p-2 border-r border-gray-800">
            <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 underline underline-offset-2">{t("invd.declaration")}</p>
            <p className="text-[9.5px] text-gray-700 leading-snug mt-1">{t("est.declarationBody")}</p>
            <p className="text-[9px] text-gray-600 mt-1">{t("invd.jurisdiction", { place: firm?.state ? firm.state : t("invd.local") })}</p>
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

      {/* Thank-you note */}
      <div className="flex-1 flex items-center justify-center py-4">
        <p className="inline-block border-y-2 border-gray-800 px-6 py-1 text-[13px] font-extrabold uppercase tracking-[0.18em] text-gray-900" style={{ fontFamily: "var(--font-inter), sans-serif" }}>
          {t("est.thanks")}
        </p>
      </div>

      <p className="text-center text-[9px] uppercase tracking-wide text-gray-500 pb-0.5">{t("est.computerGenerated")}</p>

      {/* Standard document footer */}
      <A4DocFooter className="mt-auto pt-2" note={footerNote} doc={footerDoc} page={page} totalPages={total} date={footerDate} />
    </>
  );
}
