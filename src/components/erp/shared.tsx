"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SHARED UI PRIMITIVES (Midnight Ledger system)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatINR, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
            <Icon className="h-5 w-5 text-dmk-orange" strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight text-dmk-text-primary truncate">{title}</h1>
          {subtitle && <p className="text-[12px] text-dmk-text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  onClick,
  drillHint,
  spark,
  sparkColor,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: "default" | "orange" | "blue" | "gold" | "success" | "danger" | "info";
  onClick?: () => void;
  drillHint?: string;
  /** Optional micro-trend series (numbers) rendered as an SVG sparkline. */
  spark?: number[];
  sparkColor?: string;
}) {
  const toneMap: Record<string, string> = {
    default: "text-dmk-text-primary",
    orange: "text-dmk-orange",
    blue: "text-dmk-blue",
    gold: "text-dmk-gold",
    success: "text-dmk-success",
    danger: "text-dmk-danger",
    info: "text-dmk-info",
  };
  const clickable = typeof onClick === "function";
  const CardInner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />}
      </div>
      <span className={cn("font-money text-[20px] font-semibold leading-none", toneMap[tone])}>{value}</span>
      {sub && <span className="text-[11px] text-dmk-text-muted">{sub}</span>}
      {spark && spark.length >= 2 && <Sparkline data={spark} color={sparkColor} />}
      {clickable && drillHint && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-dmk-blue/80">{drillHint}</span>
      )}
    </>
  );
  if (clickable) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label} — open ${drillHint ?? "details"}`}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
        className={cn("dmk-kpi dmk-kpi-clickable p-4 flex flex-col gap-2")}
      >
        {CardInner}
      </div>
    );
  }
  return <div className="dmk-kpi p-4 flex flex-col gap-2">{CardInner}</div>;
}

// ─── Sparkline (inline SVG micro-trend for KPI cards) ───────────

const SPARK_W = 100;
const SPARK_H = 22;
const SPARK_PAD = 2;

export function Sparkline({ data, color = "var(--accent-blue)", className }: { data: number[]; color?: string; className?: string }) {
  const gid = React.useId();
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = (SPARK_W - SPARK_PAD * 2) / (data.length - 1);
  const coords = data.map((v, i) => {
    const x = SPARK_PAD + i * stepX;
    const y = SPARK_PAD + (SPARK_H - SPARK_PAD * 2) * (1 - (v - min) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(" ");
  const area = `${SPARK_PAD},${SPARK_H - SPARK_PAD} ${line} ${SPARK_W - SPARK_PAD},${SPARK_H - SPARK_PAD}`;
  const last = coords[coords.length - 1].split(",");
  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      className={cn("h-[22px] w-full", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={Number(last[0])} cy={Number(last[1])} r={1.8} fill={color} />
    </svg>
  );
}

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral" | "gold";

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={`dmk-badge dmk-badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeTone> = {
    PENDING: "warning",
    CONFIRMED: "success",
    CANCELLED: "danger",
    POSTED: "success",
    RECEIVED: "success",
    Dr: "dr",
    Cr: "cr",
    ACTIVE: "success",
    INACTIVE: "neutral",
  };
  return <Badge tone={map[status] ?? "neutral"}>{status}</Badge>;
}

export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  return (
    <span className={cn("font-money tabular-nums", className)}>
      {signed && value > 0 ? "+" : ""}
      {formatINR(value)}
    </span>
  );
}

export function PartyBalanceBadge({ balance, type }: { balance: number; type: "customer" | "vendor" }) {
  if (type === "customer") {
    return balance > 0.005 ? <Badge tone="dr">Dr {formatINR(balance)}</Badge> : <Badge tone="neutral">Clear</Badge>;
  }
  return balance > 0.005 ? <Badge tone="cr">Cr {formatINR(balance)}</Badge> : <Badge tone="neutral">Clear</Badge>;
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-dmk-input-well border border-dmk-border-subtle">
        <Icon className="h-7 w-7 text-dmk-text-muted" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-[15px] font-semibold text-dmk-text-secondary">{title}</p>
        {hint && <p className="text-[12px] text-dmk-text-muted mt-1 max-w-sm">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full bg-dmk-input-well" />
      ))}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Search…"}
      className={cn("h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] dmk-input", className)}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">{label}</label>
      {children}
      {hint && <span className="text-[10.5px] text-dmk-text-muted">{hint}</span>}
    </div>
  );
}

export const inputCls =
  "h-9 bg-dmk-input-well border-dmk-border-subtle text-[13px] text-dmk-text-primary dmk-input placeholder:text-dmk-text-disabled";

export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("dmk-card overflow-hidden", className)}>
      <div className="overflow-x-auto max-h-[calc(100vh-320px)] overflow-y-auto">
        <table className="dmk-table">{children}</table>
      </div>
    </div>
  );
}

export function DateText({ d }: { d: string | Date }) {
  return <span className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(d)}</span>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] text-dmk-danger bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.25)] rounded-md px-3 py-2">
      {children}
    </p>
  );
}
