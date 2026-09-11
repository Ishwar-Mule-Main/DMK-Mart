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
import { useT, type TFn } from "@/lib/i18n";
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

const CLASS_HINT: Record<string, (t: TFn) => string> = {
  ASSET: (t) => t("coa.hintAsset"),
  LIABILITY: (t) => t("coa.hintLiability"),
  EQUITY: (t) => t("coa.hintEquity"),
  REVENUE: (t) => t("coa.hintRevenue"),
  EXPENSE: (t) => t("coa.hintExpense"),
};

function classHint(t: TFn, cls: string): string {
  return CLASS_HINT[cls]?.(t) ?? "";
}

export default function ChartOfAccountsView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { t } = useT();
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
          setError(e instanceof Error ? e.message : t("coa.errLoad"));
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
        title={t("coa.title")}
        subtitle={t("coa.subtitle")}
        icon={Landmark}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> {t("cmn.refresh")}
          </Button>
        }
      />

      {/* Info note */}
      <div className="dmk-well px-3 py-2.5 flex items-start gap-2.5">
        <Sprout className="h-4 w-4 text-dmk-success mt-0.5 shrink-0" />
        <p className="text-[12px] text-dmk-text-secondary">
          {t("coa.seedNote")}
        </p>
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading && !data ? (
        <LoadingRows rows={8} />
      ) : !data ? (
        <EmptyState icon={Landmark} title={t("coa.unavailable")} hint={t("coa.tryRefresh")} />
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
                <span className="text-dmk-text-muted">{t("coa.accounts")}</span>
              </span>
            ))}
            <span className="dmk-well inline-flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <Badge tone={data.balanced ? "success" : "danger"}>
                {data.balanced ? t("coa.booksBalanced") : t("coa.outOfBalance")}
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
                        {classHint(t, cls)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 text-[11.5px] shrink-0">
                      <span className="text-dmk-text-muted">{t("coa.acctsCount", { n: rows.length })}</span>
                      <span className="font-money text-dmk-yellow hidden md:inline">Dr {formatINR(classDr)}</span>
                      <span className="font-money text-dmk-info hidden md:inline">Cr {formatINR(classCr)}</span>
                    </span>
                  </button>

                  {!isCollapsed &&
                    (rows.length === 0 ? (
                      <p className="px-4 pb-4 text-[12px] text-dmk-text-muted">{t("coa.noAccountsInClass")}</p>
                    ) : (
                      <div className="overflow-x-auto border-t border-dmk-border-subtle">
                        <table className="dmk-table">
                          <thead>
                            <tr>
                              <th className="w-24">{t("coa.code")}</th>
                              <th>{t("coa.accountName")}</th>
                              <th className="hidden md:table-cell">{t("coa.group")}</th>
                              <th className="num text-right w-44">{t("coa.balance")}</th>
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
