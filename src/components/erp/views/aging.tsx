"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — RECEIVABLES / PAYABLES AGING (R13 credit control)
// Oldest-first bucket allocation from /ledger/aging (AR | AP).
// Buckets: 0-30 (blue) · 31-60 (warning) · 61-90 (gold) · 90+ (danger)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Download, Hourglass, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, formatDate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

interface AgingRowShape {
  partyId: string;
  partyName: string;
  stateCode: string;
  balance: number;
  buckets: AgingBuckets;
  oldestDocDate: string | null;
  oldestDocNo: string;
}

interface AgingResponse {
  type: "AR" | "AP";
  rows: AgingRowShape[];
  totals: AgingBuckets & { total: number };
}

const BUCKETS: Array<{ key: keyof AgingBuckets; label: string; cls: string }> = [
  { key: "d0_30", label: "0–30 days", cls: "text-dmk-blue" },
  { key: "d31_60", label: "31–60 days", cls: "text-dmk-warning" },
  { key: "d61_90", label: "61–90 days", cls: "text-dmk-gold" },
  { key: "d90plus", label: "90+ days", cls: "text-dmk-danger" },
];

export default function AgingView() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Receivables & Payables Aging"
        subtitle="Outstanding balances bucketed by document age (oldest-first allocation)"
        icon={Hourglass}
      />
      <Tabs defaultValue="ar" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="ar" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            Receivables (AR)
          </TabsTrigger>
          <TabsTrigger value="ap" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            Payables (AP)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ar" className="mt-0"><AgingTab type="AR" /></TabsContent>
        <TabsContent value="ap" className="mt-0"><AgingTab type="AP" /></TabsContent>
      </Tabs>
    </div>
  );
}

function AgingTab({ type }: { type: "AR" | "AP" }) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const [data, setData] = React.useState<AgingResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<AgingResponse>("/api/v1/ledger/aging", { firmId: activeFirmId, type, asOf: new Date().toISOString().slice(0, 10) })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : `Failed to load ${type} aging`);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, type, refreshKey]);

  function exportCsv() {
    if (!data) return;
    const out: (string | number)[][] = [
      [`${type === "AR" ? "Receivables" : "Payables"} Aging`, `As of ${new Date().toISOString().slice(0, 10)}`],
      ["Party", "State", "0-30", "31-60", "61-90", "90+", "Total", "Oldest Doc", "Oldest Doc Date"],
    ];
    for (const r of data.rows) {
      out.push([
        r.partyName,
        r.stateCode,
        r.buckets.d0_30,
        r.buckets.d31_60,
        r.buckets.d61_90,
        r.buckets.d90plus,
        r.balance,
        r.oldestDocNo,
        r.oldestDocDate ? r.oldestDocDate.slice(0, 10) : "",
      ]);
    }
    out.push([
      "TOTAL",
      "",
      data.totals.d0_30,
      data.totals.d31_60,
      data.totals.d61_90,
      data.totals.d90plus,
      data.totals.total,
      "",
      "",
    ]);
    downloadCSV(`aging-${type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, out);
    toast({ title: "Exported", description: `${type} aging downloaded as CSV.` });
  }

  const isAR = type === "AR";

  return (
    <div className="space-y-4">
      {/* Credit-control note (R13) */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-dmk-warning mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          <span className="font-semibold text-dmk-text-primary">Credit control:</span>{" "}
          blocks B2B sales when overdue + limit exceeded — parties sitting in the 90+ bucket are
          auto-locked at billing. {isAR ? "Aged against posted credit invoices." : "Aged against confirmed purchase orders."}
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={7} />
      ) : !data ? (
        <EmptyState icon={Hourglass} title="Aging unavailable" hint="Refresh once the firm data is loaded." />
      ) : data.rows.length === 0 ? (
        <EmptyState
          icon={Hourglass}
          title={isAR ? "No receivables outstanding" : "No payables outstanding"}
          hint={isAR ? "Every customer is fully settled — nice." : "All vendor dues are cleared."}
        />
      ) : (
        <>
          {/* Bucket summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {BUCKETS.map((b) => (
              <div key={b.key} className="dmk-kpi p-4">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">{b.label}</span>
                <span className={cn("font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums", b.cls)}>
                  {formatINR(data.totals[b.key])}
                </span>
                <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                  {data.totals.total > 0 ? `${((data.totals[b.key] / data.totals.total) * 100).toFixed(0)}% of total` : "—"}
                </span>
              </div>
            ))}
            <div className="dmk-kpi p-4">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block">
                {isAR ? "Total Receivable" : "Total Payable"}
              </span>
              <span className="font-money text-[19px] font-semibold leading-none mt-2 block tabular-nums text-dmk-text-primary">
                {formatINR(data.totals.total)}
              </span>
              <span className="text-[10.5px] text-dmk-text-muted mt-1.5 block">
                {data.rows.length} part{data.rows.length !== 1 ? "ies" : "y"}
              </span>
            </div>
          </div>

          {/* Aging table */}
          <div className="dmk-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-dmk-border-subtle">
              <span className="text-[12px] text-dmk-text-muted">
                Rows highlighted in red carry 90+ day balances
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
            <div className="overflow-x-auto max-h-[calc(100vh-520px)] overflow-y-auto">
              <table className="dmk-table">
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="num text-right">0–30 (₹)</th>
                    <th className="num text-right">31–60 (₹)</th>
                    <th className="num text-right">61–90 (₹)</th>
                    <th className="num text-right">90+ (₹)</th>
                    <th className="num text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const severe = r.buckets.d90plus > 0.005;
                    return (
                      <tr key={r.partyId} className={cn(severe && "bg-[rgba(239,68,68,0.05)]")}>
                        <td className="min-w-[220px]">
                          <div className="flex items-center gap-2">
                            {severe && <span className="h-1.5 w-1.5 rounded-full bg-dmk-danger shrink-0" aria-label="90+ overdue" />}
                            <div className="min-w-0">
                              <p className={cn("text-[13px] font-medium truncate", severe ? "text-dmk-danger" : "text-dmk-text-primary")}>
                                {r.partyName}
                              </p>
                              <p className="text-[10.5px] text-dmk-text-muted truncate">
                                State {r.stateCode || "—"}
                                {r.oldestDocNo && ` · oldest ${r.oldestDocNo}`}
                                {r.oldestDocDate && ` (${formatDate(r.oldestDocDate)})`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="num text-right text-dmk-blue">{r.buckets.d0_30 ? formatINR(r.buckets.d0_30) : "—"}</td>
                        <td className="num text-right text-dmk-warning">{r.buckets.d31_60 ? formatINR(r.buckets.d31_60) : "—"}</td>
                        <td className="num text-right text-dmk-gold">{r.buckets.d61_90 ? formatINR(r.buckets.d61_90) : "—"}</td>
                        <td className={cn("num text-right", severe ? "font-bold" : "")}>
                          <span className={severe ? "text-dmk-danger" : "text-dmk-text-muted"}>
                            {r.buckets.d90plus ? formatINR(r.buckets.d90plus) : "—"}
                          </span>
                        </td>
                        <td className="num text-right font-money font-semibold text-dmk-text-primary">
                          {formatINR(r.balance)}
                          {severe && (
                            <span className="ml-2">
                              <Badge tone="danger">90+</Badge>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                    <td className="font-bold text-dmk-text-primary">TOTAL</td>
                    <td className="num text-right font-money font-bold text-dmk-blue">{formatINR(data.totals.d0_30)}</td>
                    <td className="num text-right font-money font-bold text-dmk-warning">{formatINR(data.totals.d31_60)}</td>
                    <td className="num text-right font-money font-bold text-dmk-gold">{formatINR(data.totals.d61_90)}</td>
                    <td className="num text-right font-money font-bold text-dmk-danger">{formatINR(data.totals.d90plus)}</td>
                    <td className="num text-right font-money font-bold text-dmk-text-primary">{formatINR(data.totals.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="h-8 gap-1.5 text-[12px] text-dmk-text-muted hover:text-dmk-text-primary hover:bg-dmk-hover"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Recalculate as of today
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
