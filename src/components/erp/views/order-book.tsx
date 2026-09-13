"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — ORDER BOOK (UNBILLED) — sales orders awaiting billing
// READ-ONLY register over GET /api/v1/finance/booked-orders.
// Invoicing stays manual by design: the GL only sees each order
// when it is billed (trip auto-bill or the Sales Orders action).
// This view gives Finance visibility of the committed pipeline.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { ClipboardList, RefreshCw, Search, Truck } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";

interface BookedOrder {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  customerName: string;
  town: string;
  phone: string;
  itemCount: number;
  estimatedTotal: number;
  billDiscountPct: number;
  billDiscountAmt: number;
  stockReserved: boolean;
  salesMemberName: string;
  notes: string;
}

interface BookedOrdersResponse {
  orders: BookedOrder[];
  totals: {
    count: number;
    booked: number;
    confirmed: number;
    estimatedAmount: number;
  };
}

const STATUS_TONE: Record<string, "info" | "success"> = {
  BOOKED: "info",
  CONFIRMED: "success",
};

function KpiCard({ label, value, tone, money }: { label: string; value: number; tone: string; money?: boolean }) {
  return (
    <div className="dmk-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-dmk-text-muted font-semibold">{label}</p>
      <p className={cn("font-money text-[17px] font-bold tabular-nums mt-1 truncate", tone)} title={money ? formatINR(value) : String(value)}>
        {money ? formatINR(value) : value}
      </p>
    </div>
  );
}

export default function OrderBookView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { t } = useT();
  const [data, setData] = React.useState<BookedOrdersResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<BookedOrdersResponse>("/api/v1/finance/booked-orders", { firmId: activeFirmId })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : t("ob.errLoad"));
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, refreshTick]);

  // Word-wise client filter over [order no, shop, town, phone, sales member, notes]
  const rows = React.useMemo(() => {
    const list = data?.orders ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
    return list.filter((o) => {
      const hay = [o.orderNumber, o.customerName, o.town, o.phone, o.salesMemberName, o.notes]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data, search]);

  const filteredTotal = React.useMemo(() => rows.reduce((s, o) => s + o.estimatedTotal, 0), [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("ob.title")}
        subtitle={t("ob.subtitle")}
        icon={ClipboardList}
        actions={
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dmk-text-muted pointer-events-none" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("ob.searchPh")}
                className={cn("h-9 w-44 sm:w-56 pl-8 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] dmk-input")}
                aria-label={t("ob.searchAria")}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setRefreshTick((v) => v + 1)}
              className="h-9 w-9 border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover"
              aria-label={t("ob.refreshAria")}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={ClipboardList} title={t("ob.title")} hint={t("ob.errLoad")} />
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label={t("ob.kpiOpen")} value={data.totals.count} tone="text-dmk-text-primary" />
            <KpiCard label={t("ob.kpiBooked")} value={data.totals.booked} tone="text-dmk-info" />
            <KpiCard label={t("ob.kpiConfirmed")} value={data.totals.confirmed} tone="text-dmk-success" />
            <KpiCard label={t("ob.kpiValue")} value={data.totals.estimatedAmount} tone="text-dmk-gold" money />
          </div>

          {/* Order table (scrollable — production order books get long) */}
          {data.totals.count === 0 ? (
            <EmptyState icon={ClipboardList} title={t("ob.empty")} hint={t("ob.emptyHint")} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Search} title={t("ob.noMatch")} hint={t("ob.searchPh")} />
          ) : (
            <div className="dmk-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-dmk-border-subtle bg-dmk-input-well/50">
                <span className="text-[12px] text-dmk-text-muted">
                  {t("ob.showing", { n: rows.length, m: data.totals.count })}
                </span>
                <span className="font-money text-[12.5px] text-dmk-gold font-semibold">
                  Σ {formatINR(filteredTotal)}
                </span>
              </div>
              <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table className="dmk-table">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>{t("ob.colOrder")}</th>
                      <th>{t("ob.colDate")}</th>
                      <th>{t("ob.colCustomer")}</th>
                      <th>{t("ob.colTown")}</th>
                      <th className="num text-right">{t("ob.colItems")}</th>
                      <th className="num text-right">{t("ob.colDiscount")}</th>
                      <th className="num text-right">{t("ob.colTotal")}</th>
                      <th>{t("ob.colStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id}>
                        <td className="font-money text-[12.5px] whitespace-nowrap">{o.orderNumber}</td>
                        <td>
                          <span className="text-[12px] text-dmk-text-muted whitespace-nowrap">
                            {new Date(o.orderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                          </span>
                        </td>
                        <td className="max-w-[220px]">
                          <span className="block truncate text-[12.5px] text-dmk-text-primary" title={o.customerName}>
                            {o.customerName}
                          </span>
                          {o.salesMemberName && (
                            <span className="block text-[10.5px] text-dmk-text-muted truncate">{o.salesMemberName}</span>
                          )}
                        </td>
                        <td>
                          <span className="text-[12px] text-dmk-text-secondary whitespace-nowrap">{o.town || "—"}</span>
                        </td>
                        <td className="num text-right text-[12px] text-dmk-text-secondary">{o.itemCount}</td>
                        <td className="num text-right text-[12px] text-dmk-text-secondary whitespace-nowrap">
                          {o.billDiscountPct > 0
                            ? `${o.billDiscountPct}%`
                            : o.billDiscountAmt > 0
                              ? formatINR(o.billDiscountAmt)
                              : "—"}
                        </td>
                        <td className="num text-right font-money text-[12.5px] font-semibold text-dmk-yellow whitespace-nowrap">
                          {formatINR(o.estimatedTotal)}
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>
                              {o.status === "CONFIRMED" ? t("ob.stConfirmed") : t("ob.stBooked")}
                            </Badge>
                            {o.status === "CONFIRMED" && (
                              <Truck className="h-3.5 w-3.5 text-dmk-success" aria-label={t("ob.footerPool")} />
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Manual-billing note */}
          <div className="dmk-card p-3">
            <p className="text-[11.5px] leading-relaxed text-dmk-text-muted">
              <span className="font-semibold text-dmk-text-secondary">{t("ob.footerGl")}</span>{" "}
              {t("ob.footerPool")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
