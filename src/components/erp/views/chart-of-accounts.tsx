"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — CHART OF ACCOUNTS (read-only, seeded per firm)
// Grouped by accountClass; live balances mapped from trial-balance
// rows by accountCode (Dr orange / Cr info).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Landmark,
  RefreshCw,
  Sprout,
} from "lucide-react";

import { Badge, EmptyState, ErrorText, LoadingRows, PageHeader } from "../shared";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { cn } from "@/lib/utils";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

interface TbRowShape {
  accountCode: string;
  accountName: string;
  accountGroup: string;
  accountClass: string;
  debit: number;
  credit: number;
}

interface TbResponse {
  rows: TbRowShape[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

interface CoaRow {
  accountCode: string;
  accountName: string;
  accountGroup: string;
  accountClass: string;
  debit: number;
  credit: number;
}

const CLASS_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const CLASS_TONE: Record<string, BadgeTone> = {
  ASSET: "info",
  LIABILITY: "warning",
  EQUITY: "dr",
  REVENUE: "success",
  EXPENSE: "danger",
};

const CLASS_HINT: Record<string, string> = {
  ASSET: "Debit-natural — what the firm owns",
  LIABILITY: "Credit-natural — what the firm owes",
  EQUITY: "Owner capital + retained profits",
  REVENUE: "Credit-natural — sales & other income",
  EXPENSE: "Debit-natural — costs incurred",
};

export default function ChartOfAccountsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [data, setData] = React.useState<TbResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<TbResponse>("/api/v1/ledger/trial-balance", { firmId: activeFirmId })
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load chart of accounts");
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, refreshKey]);

  const groups = React.useMemo(() => {
    const byClass = new Map<string, CoaRow[]>();
    for (const row of data?.rows ?? []) {
      const list = byClass.get(row.accountClass) ?? [];
      list.push(row);
      byClass.set(row.accountClass, list);
    }
    return CLASS_ORDER.map((cls) => ({ cls, rows: byClass.get(cls) ?? [] }));
  }, [data]);

  function toggle(cls: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chart of Accounts"
        subtitle="Standard trading-ledger accounts seeded automatically at firm creation"
        icon={Landmark}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* Info note */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <Sprout className="h-4 w-4 text-dmk-success mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          Accounts are seeded automatically at firm creation and follow the standard
          trading-ledger layout (Cash &rarr; Bank &rarr; Debtors &rarr; Stock &rarr; ITC &rarr; Creditors &rarr; GST &rarr; Capital &rarr; Income &rarr; Expenses).
          This register is read-only — balances update live from posted vouchers.
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <EmptyState icon={Landmark} title="Chart of accounts unavailable" hint="Try refreshing once the firm is loaded." />
      ) : (
        <>
          {/* ── Class summary chips ──────────────────────── */}
          <div className="flex flex-wrap gap-2">
            {groups.map(({ cls, rows }) => (
              <span
                key={cls}
                className="dmk-well inline-flex items-center gap-2 px-3 py-1.5 text-[12px]"
              >
                <Badge tone={CLASS_TONE[cls] ?? "neutral"}>{cls}</Badge>
                <span className="font-semibold text-dmk-text-primary">{rows.length}</span>
                <span className="text-dmk-text-muted">accounts</span>
              </span>
            ))}
            <span className="dmk-well inline-flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <Badge tone={data.balanced ? "success" : "danger"}>
                {data.balanced ? "BOOKS BALANCED" : "OUT OF BALANCE"}
              </Badge>
              <span className="text-dmk-text-muted font-money">
                Σ {formatINR(data.totalDebit)}
              </span>
            </span>
          </div>

          {/* ── Class sections ───────────────────────────── */}
          <div className="space-y-3">
            {groups.map(({ cls, rows }) => {
              const isCollapsed = collapsed.has(cls);
              const classDr = rows.reduce((s, r) => s + r.debit, 0);
              const classCr = rows.reduce((s, r) => s + r.credit, 0);
              return (
                <div key={cls} className="dmk-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggle(cls)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-dmk-hover transition-colors text-left"
                    aria-expanded={!isCollapsed}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-dmk-text-muted shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-dmk-text-muted shrink-0" />
                      )}
                      <Badge tone={CLASS_TONE[cls] ?? "neutral"}>{cls}</Badge>
                      <span className="text-[12px] text-dmk-text-muted truncate hidden sm:inline">
                        {CLASS_HINT[cls]}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-[11.5px] shrink-0">
                      <span className="text-dmk-text-muted">{rows.length} accts</span>
                      <span className="font-money text-dmk-yellow hidden md:inline">Dr {formatINR(classDr)}</span>
                      <span className="font-money text-dmk-info hidden md:inline">Cr {formatINR(classCr)}</span>
                    </span>
                  </button>

                  {!isCollapsed &&
                    (rows.length === 0 ? (
                      <p className="px-4 pb-4 text-[12px] text-dmk-text-muted">No accounts with balances in this class.</p>
                    ) : (
                      <div className="overflow-x-auto border-t border-dmk-border-subtle">
                        <table className="dmk-table">
                          <thead>
                            <tr>
                              <th className="w-24">Code</th>
                              <th>Account Name</th>
                              <th className="hidden md:table-cell">Group</th>
                              <th className="num text-right w-44">Balance (₹)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const hasDr = r.debit > 0.005;
                              const hasCr = r.credit > 0.005;
                              return (
                                <tr key={r.accountCode}>
                                  <td className="font-money text-[12.5px] text-dmk-text-secondary">{r.accountCode}</td>
                                  <td className="font-medium">{r.accountName}</td>
                                  <td className="hidden md:table-cell text-dmk-text-muted text-[12px]">
                                    {r.accountGroup || "—"}
                                  </td>
                                  <td className="num text-right">
                                    {hasDr ? (
                                      <span className="font-money text-dmk-yellow">{formatINR(r.debit)} Dr</span>
                                    ) : hasCr ? (
                                      <span className="font-money text-dmk-info">{formatINR(r.credit)} Cr</span>
                                    ) : (
                                      <span className="text-dmk-text-muted">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
