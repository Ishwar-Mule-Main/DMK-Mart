"use client";

// ═══════════════════════════════════════════════════════════════
// SETTINGS — AUTOMATION CARD
// Heartbeat surface for the in-process recurring auto-post
// scheduler (src/lib/scheduler.ts): liveness, cadence, pass
// history, per-firm auto-posting template census and a manual
// "run a pass now" affordance for QA / demos.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Activity, Bot, CheckCircle2, Loader2, PlayCircle, Timer, Zap } from "lucide-react";

import { Badge, ErrorText } from "../shared";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import type { RecurringTemplate } from "@/types/erp";
import { cn } from "@/lib/utils";

/** Local HH:MM:SS label for heartbeat stamps (format lib has no time formatter). */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

interface AutoPostRecord {
  templateName: string;
  invoiceNumber: string;
  grandTotal: number;
}

interface SchedulerPass {
  at: string;
  firmsChecked: number;
  generated: number;
  failed: number;
  skipped: number;
  autoPosted: AutoPostRecord[];
  errors: string[];
  durationMs: number;
}

interface SchedulerStatus {
  alive: boolean;
  startedAt: string | null;
  lastHeartbeat: string | null;
  intervalMinutes: number;
  passes: number;
  running: boolean;
  lastError: string | null;
  recent: SchedulerPass[];
}

export function AutomationCard() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const [status, setStatus] = React.useState<SchedulerStatus | null>(null);
  const [templates, setTemplates] = React.useState<RecurringTemplate[] | null>(null);
  const [running, setRunning] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await apiGet<{ status: SchedulerStatus }>("/api/v1/recurring/scheduler");
      setStatus(res.status);
    } catch {
      setStatus(null);
    }
  }, []);

  React.useEffect(() => {
    void load();
    // gentle heartbeat refresh while Settings is open
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<RecurringTemplate[]>("/api/v1/recurring", { firmId: activeFirmId })
      .then((rows) => {
        if (alive) setTemplates(rows ?? []);
      })
      .catch(() => {
        if (alive) setTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  async function runNow() {
    setRunning(true);
    try {
      const res = await apiPost<{ pass: SchedulerPass }>("/api/v1/recurring/scheduler", { action: "run-now" });
      await load();
      toast({
        title: "Scheduler pass complete",
        description: `${res.pass.generated} invoice(s) auto-posted · ${res.pass.failed} failed · ${res.pass.skipped} skipped.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Pass failed",
        description: e instanceof ApiError ? e.message : "Could not run the scheduler pass.",
      });
    } finally {
      setRunning(false);
    }
  }

  const autoTemplates = (templates ?? []).filter((t) => t.autoPost !== false && t.isActive);
  const last = status?.recent?.[0];
  const lastError = status?.lastError;

  return (
    <div className="dmk-card p-5 dmk-enter" data-testid="automation-card">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <Bot className="h-4 w-4 text-dmk-success" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">Automation — Recurring Auto-Post</h2>
        {status?.alive ? (
          <Badge tone="success">
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-dmk-success align-middle" />
            SCHEDULER ALIVE
          </Badge>
        ) : (
          <Badge tone="warning">SCHEDULER IDLE</Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runNow()}
          disabled={running}
          className="ml-auto h-8 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12px] hover:bg-dmk-hover"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          Run a pass now
        </Button>
      </div>

      {/* status wells */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">
            <Activity className="h-3 w-3" /> Heartbeat
          </div>
          <p className="mt-1 font-money text-[12.5px] font-semibold text-dmk-text-primary">
            {status?.lastHeartbeat ? formatTime(status.lastHeartbeat) : "—"}
          </p>
          <p className="text-[10px] text-dmk-text-muted">
            {status?.lastHeartbeat ? formatDate(status.lastHeartbeat) : "no pass yet"}
          </p>
        </div>
        <div className="dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">
            <Timer className="h-3 w-3" /> Cadence
          </div>
          <p className="mt-1 font-money text-[12.5px] font-semibold text-dmk-text-primary">
            every {status?.intervalMinutes ?? 5} min
          </p>
          <p className="text-[10px] text-dmk-text-muted">{status?.passes ?? 0} passes this boot</p>
        </div>
        <div className="dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">
            <Zap className="h-3 w-3" /> Auto-posting here
          </div>
          <p className="mt-1 font-money text-[12.5px] font-semibold text-dmk-text-primary">
            {templates ? `${autoTemplates.length} template${autoTemplates.length === 1 ? "" : "s"}` : "…"}
          </p>
          <p className="text-[10px] text-dmk-text-muted">active · AUTO flag on</p>
        </div>
        <div className="dmk-well px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">
            <CheckCircle2 className="h-3 w-3" /> Last pass
          </div>
          <p
            className={cn(
              "mt-1 font-money text-[12.5px] font-semibold",
              last ? (last.failed > 0 ? "text-dmk-warning" : "text-dmk-success") : "text-dmk-text-primary"
            )}
          >
            {last ? `${last.generated} billed` : "—"}
          </p>
          <p className="text-[10px] text-dmk-text-muted">
            {last ? `${last.failed} failed · ${last.skipped} skipped` : "awaiting first pass"}
          </p>
        </div>
      </div>

      {lastError && (
        <div className="mt-3">
          <ErrorText>Last scheduler error: {lastError}</ErrorText>
        </div>
      )}

      {/* recent auto-posted invoices */}
      <div className="mt-4">
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">
          Recently auto-posted invoices
        </p>
        {last && last.autoPosted.length > 0 ? (
          <ul className="space-y-1.5">
            {last.autoPosted.map((a, i) => (
              <li
                key={`${a.invoiceNumber}-${i}`}
                className="flex items-center justify-between gap-3 rounded-md border border-dmk-border-subtle/70 bg-dmk-input-well/50 px-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Zap className="h-3 w-3 shrink-0 text-dmk-success" />
                  <span className="truncate font-money text-[12px] font-semibold text-dmk-gold">{a.invoiceNumber}</span>
                  <span className="truncate text-[11.5px] text-dmk-text-secondary">{a.templateName}</span>
                </span>
                <span className="shrink-0 font-money text-[12px] text-dmk-text-primary">{formatINR(a.grandTotal)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-dmk-border-subtle px-3 py-3 text-[11.5px] text-dmk-text-muted">
            {last
              ? last.failed > 0
                ? "Nothing auto-posted in the last pass — check the error above."
                : "Nothing was due in the last pass — templates bill on their own schedule."
              : "The scheduler posts invoices automatically when a template's cycle falls due — stamped invoices appear here."}
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-dmk-text-muted">
        Due templates with <span className="font-semibold text-dmk-text-secondary">Auto-post on schedule</span> enabled
        are billed by the platform itself — tier pricing, GST split, credit control, stock draw and the balanced journal
        all run through the same invoice engine as manual billing (R6, R12, R13). Every posted invoice is stamped with
        its template and visible in the subscription ledger under Recurring Billing.
      </p>
    </div>
  );
}
