"use client";

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE — DELETED DATA (recycle bin)
// Every delete across the owner portal lands in this folder with a
// full snapshot. Restore puts the record back (reactivate or recreate
// from snapshot); purge removes it forever. Transaction-heavy rows
// that cannot be hard-deleted leave the bin but stay inactive so
// ledgers never lose their references.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Package,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Users,
  Undo2,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { PageHeader, Badge, EmptyState, LoadingRows, SearchInput, KpiCard } from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ─── entity-type folder metadata ─────────────────────────────────

type TrashEntityType =
  | "PRODUCT"
  | "CUSTOMER"
  | "VENDOR"
  | "RECURRING_TEMPLATE"
  | "VERIFICATION_STAFF";

const TYPE_META: Record<TrashEntityType, { label: string; folder: string; icon: LucideIcon }> = {
  PRODUCT: { label: "Product", folder: "Products", icon: Package },
  CUSTOMER: { label: "Customer", folder: "Customers", icon: Users },
  VENDOR: { label: "Vendor", folder: "Vendors", icon: Truck },
  RECURRING_TEMPLATE: { label: "Recurring Template", folder: "Recurring", icon: CalendarClock },
  VERIFICATION_STAFF: { label: "Team Account", folder: "Team", icon: ShieldCheck },
};

interface DeletedItem {
  id: string;
  entityType: string;
  entityId: string;
  label: string;
  meta: string;
  snapshot: string;
  restoredAt: string | null;
  createdAt: string;
}

interface DeletedDataResponse {
  items: DeletedItem[];
  summary: Record<string, number>;
  inBin: number;
  restoredCount: number;
}

interface BulkResult {
  action: string;
  attempted: number;
  succeeded: number;
  failed: number;
  failures: Array<{ label: string; reason: string }>;
}

export default function DeletedDataView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [data, setData] = React.useState<DeletedDataResponse | null>(null);
  const [type, setType] = React.useState<string>("ALL");
  const [query, setQuery] = React.useState("");
  const [showRestored, setShowRestored] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setData(null);
    (async () => {
      try {
        const res = await apiGet<DeletedDataResponse>("/api/v1/deleted-data", {
          firmId: activeFirmId,
          type: type === "ALL" ? undefined : type,
          includeRestored: showRestored || undefined,
          search: query.trim() || undefined,
        });
        if (alive) setData(res);
      } catch (e) {
        if (alive) {
          setData({ items: [], summary: {}, inBin: 0, restoredCount: 0 });
          if (e instanceof ApiError) toast({ variant: "destructive", title: "Could not load Deleted Data", description: e.message });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, type, query, showRestored, refresh, toast]);

  const restoreOne = async (item: DeletedItem) => {
    if (!activeFirmId) return;
    setBusyId(item.id);
    try {
      const res = await apiPost<{ label: string; mode: string }>(`/api/v1/deleted-data/${item.id}/restore`);
      toast({
        title: "Restored",
        description:
          res.mode === "recreated"
            ? `"${res.label}" was recreated from its snapshot.`
            : `"${res.label}" is active again.`,
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: "Restore failed", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusyId(null);
    }
  };

  const purgeOne = async (item: DeletedItem) => {
    if (!activeFirmId) return;
    setBusyId(item.id);
    try {
      const res = await apiDelete<{ recordRemoved: boolean; note: string }>(`/api/v1/deleted-data/${item.id}`);
      toast({
        title: res.recordRemoved ? "Deleted forever" : "Removed from bin",
        description: res.note,
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: "Purge failed", description: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      setBusyId(null);
    }
  };

  const runBulk = async (action: "restore-all" | "empty-bin") => {
    if (!activeFirmId) return;
    try {
      const res = await apiPost<BulkResult>("/api/v1/deleted-data/bulk", {
        firmId: activeFirmId,
        action,
        entityType: type === "ALL" ? undefined : type,
      });
      const scope = type === "ALL" ? "bin" : `${TYPE_META[type as TrashEntityType]?.folder ?? type} folder`;
      if (res.attempted === 0) {
        toast({ title: action === "restore-all" ? "Nothing to restore" : "Bin already empty", description: `The ${scope} had no items.` });
      } else if (action === "restore-all") {
        toast({
          title: `Restored ${res.succeeded} of ${res.attempted}`,
          variant: res.failed > 0 ? "destructive" : "default",
          description:
            res.failed > 0
              ? res.failures.map((f) => `${f.label}: ${f.reason}`).join(" · ").slice(0, 240)
              : `The ${scope} is now empty.`,
        });
      } else {
        toast({
          title: `Purged ${res.succeeded} of ${res.attempted}`,
          variant: res.failed > 0 ? "destructive" : "default",
          description:
            res.failed > 0
              ? res.failures.map((f) => `${f.label}: ${f.reason}`).join(" · ").slice(0, 240)
              : `${scope[0].toUpperCase()}${scope.slice(1)} emptied forever.`,
        });
      }
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: "Operation failed", description: e instanceof Error ? e.message : "Unknown error" });
    }
  };

  const items = data?.items ?? [];
  const inBinCount = data?.inBin ?? 0;
  const folderCounts = data?.summary ?? {};

  return (
    <div className="space-y-4">
      <PageHeader
        title="Deleted Data"
        subtitle="Recycle bin for the whole workspace — every deletion is snapshotted here and can be restored"
        icon={Trash2}
        actions={
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                  disabled={inBinCount === 0}
                >
                  <Undo2 className="h-4 w-4" /> Restore All
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-dmk-text-primary">Restore everything in the bin?</AlertDialogTitle>
                  <AlertDialogDescription className="text-dmk-text-secondary">
                    {inBinCount} item{inBinCount === 1 ? "" : "s"} will be put back — soft-deleted records reactivated,
                    hard-deleted ones recreated from their snapshots. Items that now conflict (duplicate SKU, deleted
                    customer…) are skipped and reported.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
                    onClick={() => runBulk("restore-all")}
                  >
                    <Undo2 className="h-4 w-4 mr-1" /> Restore {inBinCount}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-dmk-danger/40 text-dmk-danger hover:bg-dmk-danger/10"
                  disabled={inBinCount === 0}
                >
                  <Trash2 className="h-4 w-4" /> Empty Bin
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-dmk-text-primary">Empty the Deleted Data bin?</AlertDialogTitle>
                  <AlertDialogDescription className="text-dmk-text-secondary">
                    {inBinCount} item{inBinCount === 1 ? "" : "s"} will be purged forever. Records with transaction
                    history leave the bin but stay inactive so ledgers keep their references — everything else is
                    destroyed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                    Keep them
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                    onClick={() => runBulk("empty-bin")}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Empty forever
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      {/* Folder chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FolderChip active={type === "ALL"} onClick={() => setType("ALL")} icon={Trash2} label="All folders" count={inBinCount} />
        {(Object.keys(TYPE_META) as TrashEntityType[]).map((t) => (
          <FolderChip
            key={t}
            active={type === t}
            onClick={() => setType(t)}
            icon={TYPE_META[t].icon}
            label={TYPE_META[t].folder}
            count={folderCounts[t] ?? 0}
          />
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="In Bin" value={String(inBinCount)} sub="waiting for a decision" icon={Trash2} tone="danger" />
        <KpiCard label="Restored (all time)" value={String(data?.restoredCount ?? 0)} sub="brought back successfully" icon={RotateCcw} tone="success" />
        <KpiCard
          label="Folders"
          value={String(Object.values(folderCounts).filter((n) => n > 0).length)}
          sub="with items inside"
          icon={Package}
        />
        <KpiCard
          label="Oldest Item"
          value={items.length > 0 ? formatDate(items[items.length - 1].createdAt) : "—"}
          sub="deleted on"
          icon={Clock}
        />
      </div>

      {/* Search + show-restored */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Search deleted items by name, SKU, phone…" className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-restored" checked={showRestored} onCheckedChange={setShowRestored} />
          <Label htmlFor="show-restored" className="text-[12px] text-dmk-text-secondary cursor-pointer">
            Show restored history
          </Label>
        </div>
      </div>

      {/* Items table */}
      <div className="dmk-card overflow-hidden">
        <div className="overflow-x-auto">
          {data === null ? (
            <LoadingRows rows={6} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title={showRestored ? "Nothing here yet" : "Bin is clean"}
              hint={
                showRestored
                  ? "No deleted records match this filter. Delete something from Products, Customers, Vendors, Recurring Billing or Team Accounts and it will appear here."
                  : "Deleted products, customers, vendors, recurring templates and team accounts land here first — restore them anytime, or purge forever."
              }
            />
          ) : (
            <table className="dmk-table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-10" aria-label="Type" />
                  <th>Record</th>
                  <th>Folder</th>
                  <th>Details</th>
                  <th>Deleted</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const meta = TYPE_META[item.entityType as TrashEntityType] ?? {
                    label: item.entityType,
                    folder: item.entityType,
                    icon: Trash2,
                  };
                  const Icon = meta.icon;
                  const restored = item.restoredAt !== null;
                  return (
                    <tr key={item.id} className={cn(restored && "opacity-60")}>
                      <td>
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-dmk-input-well border border-dmk-border-subtle">
                          <Icon className="h-4 w-4 text-dmk-text-muted" strokeWidth={1.75} />
                        </div>
                      </td>
                      <td className="max-w-[260px] truncate text-[13px] font-medium" title={item.label}>
                        {item.label}
                      </td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{meta.folder}</td>
                      <td className="max-w-[220px] truncate text-[12px] text-dmk-text-muted" title={item.meta}>
                        {item.meta || "—"}
                      </td>
                      <td className="num text-[12.5px] text-dmk-text-secondary">{formatDate(item.createdAt)}</td>
                      <td>
                        {restored ? (
                          <Badge tone="success">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> Restored {formatDate(item.restoredAt as string)}
                          </Badge>
                        ) : (
                          <Badge tone="warning">In bin</Badge>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {restored ? (
                          <span className="text-[11.5px] text-dmk-text-muted">Back in use</span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                              disabled={busyId === item.id}
                              onClick={() => restoreOne(item)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Restore
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                                  aria-label={`Delete ${item.label} forever`}
                                  disabled={busyId === item.id}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-dmk-text-primary">
                                    Delete “{item.label}” forever?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="text-dmk-text-secondary">
                                    The snapshot will be destroyed and this record can never be restored again. If it has
                                    transaction history, only its bin entry is removed — the inactive row stays for
                                    ledger integrity.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                                    Cancel
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                                    onClick={() => purgeOne(item)}
                                  >
                                    Delete forever
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {items.length > 0 && (
          <div className="border-t border-dmk-border-subtle px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-dmk-text-muted">
            <span>{items.length} item{items.length === 1 ? "" : "s"} shown</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Restores re-activate the original record — invoice &amp; ledger history stays untouched
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── folder chip ─────────────────────────────────────────────────

function FolderChip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-medium transition-colors",
        active
          ? "border-dmk-yellow/40 bg-dmk-yellow/10 text-dmk-yellow"
          : "border-dmk-border-subtle bg-dmk-input-well/60 text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
      <span
        className={cn(
          "ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold leading-4",
          active ? "bg-dmk-yellow/20 text-dmk-yellow" : "bg-dmk-hover text-dmk-text-muted"
        )}
      >
        {count}
      </span>
    </button>
  );
}
