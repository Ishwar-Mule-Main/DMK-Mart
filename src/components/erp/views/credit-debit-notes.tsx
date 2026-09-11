"use client";

// ═══════════════════════════════════════════════════════════════
// DOCS — CREDIT & DEBIT NOTES
// Credit Notes  = sales returns  (customer A/R ↓, DAMAGED stock ↑)
// Debit Notes   = purchase returns (vendor payable ↓, DAMAGED ↓)
// Both tabs fetch their own list; view dialogs show item detail.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Eye, FilePlus2, FileMinus2 } from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import type { Product } from "@/types/erp";
import { PageHeader, Badge, EmptyState, LoadingRows } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useT, type TFn } from "@/lib/i18n";

// ─── Credit notes (sales returns) ──────────────────────────────
interface CnItemRow {
  id: string;
  productId: string;
  damagedQty: number;
  unitPrice: number;
  gstRate: number;
  totalAmount: number;
  defectType: string;
  product?: { id: string; sku: string; name: string } | null;
}
interface CreditNoteRow {
  id: string;
  creditNoteNo: string;
  invoiceRef: string;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  customer?: { id: string; partyName: string } | null;
  items: CnItemRow[];
}

// ─── Debit notes (purchase returns) ────────────────────────────
interface DnItemRow {
  id: string;
  productId: string;
  damagedQty: number;
  unitCost: number;
  gstRate: number;
  totalAmount: number;
  reason: string;
}
interface DebitNoteRow {
  id: string;
  debitNoteNo: string;
  poRef: string;
  returnDate: string;
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  notes: string;
  vendor?: { id: string; vendorName: string } | null;
  items: DnItemRow[];
}

/** Display label for a defect type (the value itself is the API enum). */
function defectLabel(t: TFn, d: string): string {
  if (d === "Damaged") return t("sret.dfnDamaged");
  if (d === "Broken") return t("sret.dfnBroken");
  if (d === "Defective") return t("sret.dfnDefective");
  if (d === "Wrong Item") return t("sret.dfnWrong");
  return d;
}

export default function CreditDebitNotesView() {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <PageHeader
        title={t("cdn.title")}
        subtitle={t("cdn.subtitle")}
        icon={FilePlus2}
      />
      <Tabs defaultValue="credit" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="credit" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <FilePlus2 className="h-4 w-4" /> {t("cdn.tabCredit")}
          </TabsTrigger>
          <TabsTrigger value="debit" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <FileMinus2 className="h-4 w-4" /> {t("cdn.tabDebit")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="credit" className="mt-0"><CreditNotesTab /></TabsContent>
        <TabsContent value="debit" className="mt-0"><DebitNotesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Credit notes tab
// ═══════════════════════════════════════════════════════════════
function CreditNotesTab() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [rows, setRows] = React.useState<CreditNoteRow[] | null>(null);
  const [view, setView] = React.useState<CreditNoteRow | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<CreditNoteRow[]>("/api/v1/sales-returns", { firmId: activeFirmId })
      .then((res) => alive && setRows(res))
      .catch((e) => {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: t("cdn.errCnLoad"), description: e.message });
        }
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, toast, t]);

  return (
    <div className="dmk-card overflow-hidden">
      <div className="overflow-x-auto">
        {rows === null ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={FilePlus2} title={t("cdn.cnEmpty")} hint={t("cdn.cnEmptyHint")} />
        ) : (
          <table className="dmk-table min-w-[820px]">
            <thead>
              <tr>
                <th>{t("cdn.colNote")}</th>
                <th>{t("cmn.date")}</th>
                <th>{t("cdn.colParty")}</th>
                <th>{t("cdn.colRef")}</th>
                <th className="text-right">{t("cdn.colItems")}</th>
                <th className="text-right">{t("cdn.colTaxable")}</th>
                <th className="text-right">{t("cdn.colTax")}</th>
                <th className="text-right">{t("cmn.total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-money text-[12.5px] text-dmk-text-primary">{r.creditNoteNo}</td>
                  <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.returnDate)}</td>
                  <td className="max-w-[220px] truncate text-[13px]">{r.customer?.partyName ?? "—"}</td>
                  <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.invoiceRef || "—"}</td>
                  <td className="num text-[12.5px]">{r.items.length}</td>
                  <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.subtotal))}</td>
                  <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.totalTax))}</td>
                  <td className="num text-[13px] font-semibold">{formatINR(Number(r.grandTotal))}</td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setView(r)}>
                      <Eye className="h-3.5 w-3.5" /> {t("cdn.view")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{view?.creditNoteNo}</span>
              <Badge tone="warning">{t("sale.creditNote")}</Badge>
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {view ? `${formatDate(view.returnDate)} · ${view.customer?.partyName ?? "—"}${view.invoiceRef ? ` · ${t("sale.refShort", { no: view.invoiceRef })}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-3">
              <div className="dmk-well overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>{t("cmn.sku")}</th>
                        <th>{t("cmn.product")}</th>
                        <th className="text-right">{t("sale.qty")}</th>
                        <th>{t("cdn.colDefect")}</th>
                        <th className="text-right">{t("cmn.rate")}</th>
                        <th className="text-right">{t("cmn.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((it) => (
                        <tr key={it.id}>
                          <td className="font-money text-[11.5px] text-dmk-text-secondary">{it.product?.sku ?? "—"}</td>
                          <td className="max-w-[180px] truncate text-[12.5px]">{it.product?.name ?? "—"}</td>
                          <td className="num text-[12px]">{it.damagedQty}</td>
                          <td><Badge tone="warning">{defectLabel(t, it.defectType)}</Badge></td>
                          <td className="num text-[12px]">{formatINR(Number(it.unitPrice))}</td>
                          <td className="num text-[12px]">{formatINR(Number(it.totalAmount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center dmk-well px-3 py-2.5">
                <span className="text-[12px] text-dmk-text-muted">{t("cdn.taxSum", { t: formatINR(Number(view.subtotal)), x: formatINR(Number(view.totalTax)) })}</span>
                <span className="font-money text-[16px] text-dmk-yellow">{formatINR(Number(view.grandTotal))}</span>
              </div>
              {view.notes && <p className="text-[12px] text-dmk-text-muted px-1">{view.notes}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">{t("cmn.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Debit notes tab
// ═══════════════════════════════════════════════════════════════
function DebitNotesTab() {
  const { toast } = useToast();
  const { t } = useT();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [rows, setRows] = React.useState<DebitNoteRow[] | null>(null);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [view, setView] = React.useState<DebitNoteRow | null>(null);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<DebitNoteRow[]>("/api/v1/purchase-returns", { firmId: activeFirmId })
      .then((res) => alive && setRows(res))
      .catch((e) => {
        if (alive) {
          setRows([]);
          if (e instanceof ApiError) toast({ variant: "destructive", title: t("cdn.errDnLoad"), description: e.message });
        }
      });
    apiGet<Product[] | { products: Product[] }>("/api/v1/products", { firmId: activeFirmId })
      .then((res) => alive && setProducts(Array.isArray(res) ? res : (res.products ?? [])))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [activeFirmId, toast, t]);

  const productMap = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  return (
    <div className="dmk-card overflow-hidden">
      <div className="overflow-x-auto">
        {rows === null ? (
          <LoadingRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileMinus2} title={t("cdn.dnEmpty")} hint={t("cdn.dnEmptyHint")} />
        ) : (
          <table className="dmk-table min-w-[820px]">
            <thead>
              <tr>
                <th>{t("cdn.colNote")}</th>
                <th>{t("cmn.date")}</th>
                <th>{t("cdn.colParty")}</th>
                <th>{t("cdn.colRef")}</th>
                <th className="text-right">{t("cdn.colItems")}</th>
                <th className="text-right">{t("cdn.colTaxable")}</th>
                <th className="text-right">{t("cdn.colTax")}</th>
                <th className="text-right">{t("cmn.total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-money text-[12.5px] text-dmk-text-primary">{r.debitNoteNo}</td>
                  <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(r.returnDate)}</td>
                  <td className="max-w-[220px] truncate text-[13px]">{r.vendor?.vendorName ?? "—"}</td>
                  <td className="font-money text-[11.5px] text-dmk-text-secondary">{r.poRef || "—"}</td>
                  <td className="num text-[12.5px]">{r.items.length}</td>
                  <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.subtotal))}</td>
                  <td className="num text-[12.5px] text-dmk-text-secondary">{formatINR(Number(r.totalTax))}</td>
                  <td className="num text-[13px] font-semibold">{formatINR(Number(r.grandTotal))}</td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setView(r)}>
                      <Eye className="h-3.5 w-3.5" /> {t("cdn.view")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="dmk-elevated border-dmk-border-medium">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{view?.debitNoteNo}</span>
              <Badge tone="info">{t("sale.debitNote")}</Badge>
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {view ? `${formatDate(view.returnDate)} · ${view.vendor?.vendorName ?? "—"}${view.poRef ? ` · ${t("sale.refShort", { no: view.poRef })}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          {view && (
            <div className="space-y-3">
              <div className="dmk-well overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="dmk-table">
                    <thead>
                      <tr>
                        <th>{t("cmn.sku")}</th>
                        <th>{t("cmn.product")}</th>
                        <th className="text-right">{t("sale.qty")}</th>
                        <th>{t("cdn.colReason")}</th>
                        <th className="text-right">{t("cdn.colCost")}</th>
                        <th className="text-right">{t("cmn.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.items.map((it) => {
                        const p = productMap.get(it.productId);
                        return (
                          <tr key={it.id}>
                            <td className="font-money text-[11.5px] text-dmk-text-secondary">{p?.sku ?? "—"}</td>
                            <td className="max-w-[180px] truncate text-[12.5px]">{p?.name ?? "—"}</td>
                            <td className="num text-[12px]">{it.damagedQty}</td>
                            <td><Badge tone="info">{it.reason}</Badge></td>
                            <td className="num text-[12px]">{formatINR(Number(it.unitCost))}</td>
                            <td className="num text-[12px]">{formatINR(Number(it.totalAmount))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-between items-center dmk-well px-3 py-2.5">
                <span className="text-[12px] text-dmk-text-muted">{t("cdn.taxSum", { t: formatINR(Number(view.subtotal)), x: formatINR(Number(view.totalTax)) })}</span>
                <span className="font-money text-[16px] text-dmk-blue">{formatINR(Number(view.grandTotal))}</span>
              </div>
              {view.notes && <p className="text-[12px] text-dmk-text-muted px-1">{view.notes}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setView(null)} className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover">{t("cmn.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
