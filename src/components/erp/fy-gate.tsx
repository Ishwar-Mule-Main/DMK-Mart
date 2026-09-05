"use client";

// ═══════════════════════════════════════════════════════════════
// FY GATE — financial-year availability control
//
// · useFinancialYears(firmId): shared hook — the registry list plus
//   createYear() (idempotent POST).
// · FyGate: wraps the owner shell.
//     1. On boot, when "Auto-create next financial year on 1 April"
//        is ON (default), the current year's account is opened
//        automatically the first time the app runs on/after 1 April.
//     2. When auto-create is OFF (or fails) and the current year's
//        account does not exist, EVERY section stays locked behind
//        this gate until the owner opens the new year's books —
//        then all tabs unlock immediately.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { CalendarRange, Lock, Loader2, CheckCircle2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { currentFyLabel, formatFyRange, fyDateRange } from "@/lib/fy";
import type { FinancialYear, Firm } from "@/types/erp";

export function useFinancialYears(firmId: string | null) {
  const [years, setYears] = React.useState<FinancialYear[]>([]);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    if (!firmId) {
      setYears([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiGet<{ years: FinancialYear[] }>(`/api/v1/firms/${firmId}/financial-years`);
      setYears(res?.years ?? []);
    } catch {
      setYears([]);
    } finally {
      setLoading(false);
    }
  }, [firmId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const createYear = React.useCallback(
    async (label: string, opts?: { auto?: boolean; activate?: boolean }) => {
      if (!firmId) throw new ApiError("ERR_NO_FIRM", "No active company", 400);
      const res = await apiPost<{ year: FinancialYear; created: boolean }>(
        `/api/v1/firms/${firmId}/financial-years`,
        { label, auto: opts?.auto ?? false, activate: opts?.activate ?? false }
      );
      await reload();
      return res;
    },
    [firmId, reload]
  );

  return { years, loading, reload, createYear };
}

export function FyGate({ children }: { children: React.ReactNode }) {
  const { firms, activeFirmId, financialYear, setFinancialYear } = useErpStore();
  const { toast } = useToast();
  const firm = firms.find((f) => f.id === activeFirmId);
  const { years, loading, reload, createYear } = useFinancialYears(activeFirmId);
  const autoTried = React.useRef<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const todayFy = currentFyLabel();
  const currentYearOpen = years.some((y) => y.label === todayFy);
  const autoCreate = firm?.autoCreateFy ?? true;

  // ── 1-Apr auto-open: open the current year's books automatically ──
  React.useEffect(() => {
    if (!activeFirmId || loading || !autoCreate || currentYearOpen) return;
    if (autoTried.current === `${activeFirmId}:${todayFy}`) return;
    autoTried.current = `${activeFirmId}:${todayFy}`;
    (async () => {
      try {
        const res = await createYear(todayFy, { auto: true, activate: true });
        if (res.created) {
          toast({
            title: `Financial year ${todayFy} opened`,
            description: "The new year's books were created automatically on 1 April.",
          });
        }
        // roll the workspace forward if the selected year has ended
        const sel = years.find((y) => y.label === financialYear);
        if (financialYear !== todayFy && sel && new Date(sel.endDate) < new Date()) {
          setFinancialYear(todayFy);
        } else if (financialYear !== todayFy && !sel) {
          setFinancialYear(todayFy);
        }
      } catch {
        /* the gate below offers a manual retry */
      }
    })();
  }, [activeFirmId, loading, autoCreate, currentYearOpen, todayFy, years, financialYear, createYear, setFinancialYear]);

  const locked = !loading && !currentYearOpen && !autoCreate;

  async function openBooks() {
    setCreating(true);
    setCreateError(null);
    try {
      await createYear(todayFy, { activate: true });
      setFinancialYear(todayFy);
      toast({
        title: `FY ${todayFy} unlocked`,
        description: "The new year's books are open — every section is available again.",
      });
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Could not open the new year");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-dmk-bg-primary">
        <Loader2 className="h-5 w-5 animate-spin text-dmk-yellow" />
        <p className="text-[12px] text-dmk-text-muted">Checking financial years…</p>
      </div>
    );
  }

  if (locked) {
    const latestOpen = years[years.length - 1];
    const latestEnded = latestOpen ? new Date(latestOpen.endDate) < new Date() : true;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-dmk-bg-primary">
        <div className="dmk-card p-6 sm:p-8 max-w-md w-full text-center relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-dmk-yellow via-dmk-gold to-dmk-yellow" />
          <div className="mx-auto h-14 w-14 rounded-2xl bg-dmk-yellow/10 border border-dmk-yellow/30 flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-dmk-yellow" strokeWidth={1.75} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-dmk-text-muted">Books locked</p>
          <h1 className="mt-1.5 text-[18px] font-bold text-dmk-text-primary">
            FY {todayFy} is not opened yet
          </h1>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-dmk-text-secondary">
            {latestEnded && latestOpen
              ? `The ${latestOpen.label} books ended on 31 March. Every section stays locked until you open the ${todayFy} account (${formatFyRange(todayFy)}).`
              : `Every section stays locked until the ${todayFy} account (${formatFyRange(todayFy)}) is opened for this company.`}
          </p>
          <Button
            onClick={() => void openBooks()}
            disabled={creating}
            className="mt-5 w-full h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold text-[13px]"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
            Open FY {todayFy} books
          </Button>
          {createError && <p className="mt-2 text-[11px] text-dmk-danger">{createError}</p>}
          <div className="mt-4 pt-3 border-t border-dmk-border-subtle flex items-start gap-2 text-left">
            <Settings2 className="h-3.5 w-3.5 text-dmk-text-muted mt-0.5 shrink-0" />
            <p className="text-[10.5px] leading-relaxed text-dmk-text-muted">
              Auto-open on 1 April is currently <span className="text-dmk-text-secondary font-semibold">OFF</span> —
              change it any time under Company menu → Company details. When it is ON, the new year opens itself and
              this screen never appears.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Small inline "years ready" indicator used by the header switcher. */
export function FyBadge({ year }: { year?: FinancialYear | null }) {
  if (!year) return null;
  if (year.autoCreated) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-dmk-blue/10 border border-dmk-blue/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-dmk-blue">
        <CheckCircle2 className="h-2.5 w-2.5" /> auto
      </span>
    );
  }
  return null;
}

export function fyEnded(label: string): boolean {
  return new Date(fyDateRange(label).endDate) < new Date();
}
