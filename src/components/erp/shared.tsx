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
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: "default" | "orange" | "blue" | "gold" | "success" | "danger" | "info";
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
  return (
    <div className="dmk-kpi p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />}
      </div>
      <span className={cn("font-money text-[20px] font-semibold leading-none", toneMap[tone])}>{value}</span>
      {sub && <span className="text-[11px] text-dmk-text-muted">{sub}</span>}
    </div>
  );
}

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

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
