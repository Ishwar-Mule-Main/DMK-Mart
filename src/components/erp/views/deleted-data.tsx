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
  Route as RouteIcon,
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
import { useT } from "@/lib/i18n";
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
  | "VERIFICATION_STAFF"
  | "TRIP";

const TYPE_META: Record<TrashEntityType, { labelKey: string; folderKey: string; icon: LucideIcon }> = {
  PRODUCT: { labelKey: "del.typeProduct", folderKey: "del.folderProducts", icon: Package },
  CUSTOMER: { labelKey: "del.typeCustomer", folderKey: "del.folderCustomers", icon: Users },
  VENDOR: { labelKey: "del.typeVendor", folderKey: "del.folderVendors", icon: Truck },
  RECURRING_TEMPLATE: { labelKey: "del.typeRecurring", folderKey: "del.folderRecurring", icon: CalendarClock },
  VERIFICATION_STAFF: { labelKey: "del.typeTeam", folderKey: "del.folderTeam", icon: ShieldCheck },
  TRIP: { labelKey: "del.typeTrip", folderKey: "del.folderTrips", icon: RouteIcon },
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
  const { t } = useT();
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
          if (e instanceof ApiError) toast({ variant: "destructive", title: t("del.toastLoadFail"), description: e.message });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeFirmId, type, query, showRestored, refresh, toast, t]);

  const restoreOne = async (item: DeletedItem) => {
    if (!activeFirmId) return;
    setBusyId(item.id);
    try {
      const res = await apiPost<{ label: string; mode: string }>(`/api/v1/deleted-data/${item.id}/restore`);
      toast({
        title: t("del.toastRestored"),
        description:
          res.mode === "recreated"
            ? t("del.toastRecreated", { name: res.label })
            : t("del.toastActive", { name: res.label }),
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: t("del.toastRestoreFail"), description: e instanceof Error ? e.message : t("del.toastUnknown") });
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
        title: res.recordRemoved ? t("del.toastDeletedForever") : t("del.toastRemovedFromBin"),
        description: res.note,
      });
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: t("del.toastPurgeFail"), description: e instanceof Error ? e.message : t("del.toastUnknown") });
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
      const meta = TYPE_META[type as TrashEntityType];
      const scope =
        type === "ALL"
          ? t("del.scopeBin")
          : meta
            ? `${t(meta.folderKey)} ${t("del.folderWord")}`
            : `${type} ${t("del.folderWord")}`;
      const scopeCap = scope.charAt(0).toUpperCase() + scope.slice(1);
      if (res.attempted === 0) {
        toast({ title: action === "restore-all" ? t("del.toastNothingRestore") : t("del.toastBinEmpty"), description: t("del.toastNoItems", { scope }) });
      } else if (action === "restore-all") {
        toast({
          title: t("del.toastRestoredN", { a: res.succeeded, b: res.attempted }),
          variant: res.failed > 0 ? "destructive" : "default",
          description:
            res.failed > 0
              ? res.failures.map((f) => `${f.label}: ${f.reason}`).join(" · ").slice(0, 240)
              : t("del.toastScopeEmpty", { scope }),
        });
      } else {
        toast({
          title: t("del.toastPurgedN", { a: res.succeeded, b: res.attempted }),
          variant: res.failed > 0 ? "destructive" : "default",
          description:
            res.failed > 0
              ? res.failures.map((f) => `${f.label}: ${f.reason}`).join(" · ").slice(0, 240)
              : t("del.toastScopeEmptied", { scope: scopeCap }),
        });
      }
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({ variant: "destructive", title: t("del.toastOpFail"), description: e instanceof Error ? e.message : t("del.toastUnknown") });
    }
  };

  const items = data?.items ?? [];
  const inBinCount = data?.inBin ?? 0;
  const folderCounts = data?.summary ?? {};

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.deleted")}
        subtitle={t("del.subtitle")}
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
                  <Undo2 className="h-4 w-4" /> {t("del.restoreAll")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-dmk-text-primary">{t("del.restoreAllTitle")}</AlertDialogTitle>
                  <AlertDialogDescription className="text-dmk-text-secondary">
                    {t("del.restoreAllDesc", { n: inBinCount })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                    {t("cmn.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
                    onClick={() => runBulk("restore-all")}
                  >
                    <Undo2 className="h-4 w-4 mr-1" /> {t("del.restoreN", { n: inBinCount })}
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
                  <Trash2 className="h-4 w-4" /> {t("del.emptyBin")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-dmk-text-primary">{t("del.emptyBinTitle")}</AlertDialogTitle>
                  <AlertDialogDescription className="text-dmk-text-secondary">
                    {t("del.emptyBinDesc", { n: inBinCount })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                    {t("del.keepThem")}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                    onClick={() => runBulk("empty-bin")}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> {t("del.emptyForever")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      {/* Folder chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FolderChip active={type === "ALL"} onClick={() => setType("ALL")} icon={Trash2} label={t("del.allFolders")} count={inBinCount} />
        {(Object.keys(TYPE_META) as TrashEntityType[]).map((k) => (
          <FolderChip
            key={k}
            active={type === k}
            onClick={() => setType(k)}
            icon={TYPE_META[k].icon}
            label={t(TYPE_META[k].folderKey)}
            count={folderCounts[k] ?? 0}
          />
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={t("del.kpiInBin")} value={String(inBinCount)} sub={t("del.kpiInBinSub")} icon={Trash2} tone="danger" />
        <KpiCard label={t("del.kpiRestored")} value={String(data?.restoredCount ?? 0)} sub={t("del.kpiRestoredSub")} icon={RotateCcw} tone="success" />
        <KpiCard
          label={t("del.kpiFolders")}
          value={String(Object.values(folderCounts).filter((n) => n > 0).length)}
          sub={t("del.kpiFoldersSub")}
          icon={Package}
        />
        <KpiCard
          label={t("del.kpiOldest")}
          value={items.length > 0 ? formatDate(items[items.length - 1].createdAt) : "—"}
          sub={t("del.kpiOldestSub")}
          icon={Clock}
        />
      </div>

      {/* Search + show-restored */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder={t("del.searchPh")} className="pl-9" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted pointer-events-none" />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="show-restored" checked={showRestored} onCheckedChange={setShowRestored} />
          <Label htmlFor="show-restored" className="text-[12px] text-dmk-text-secondary cursor-pointer">
            {t("del.showRestored")}
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
              title={showRestored ? t("del.emptyTitleFiltered") : t("del.emptyTitleClean")}
              hint={
                showRestored
                  ? t("del.emptyHintFiltered")
                  : t("del.emptyHintClean")
              }
            />
          ) : (
            <table className="dmk-table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-10" aria-label={t("cmn.type")} />
                  <th>{t("del.thRecord")}</th>
                  <th>{t("del.thFolder")}</th>
                  <th>{t("del.thDetails")}</th>
                  <th>{t("del.thDeleted")}</th>
                  <th>{t("cmn.status")}</th>
                  <th className="text-right">{t("cmn.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const meta = TYPE_META[item.entityType as TrashEntityType] ?? {
                    labelKey: "",
                    folderKey: "",
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
                      <td className="text-[12.5px] text-dmk-text-secondary">{meta.folderKey ? t(meta.folderKey) : item.entityType}</td>
                      <td className="max-w-[220px] truncate text-[12px] text-dmk-text-muted" title={item.meta}>
                        {item.meta || "—"}
                      </td>
                      <td className="num text-[12.5px] text-dmk-text-secondary">{formatDate(item.createdAt)}</td>
                      <td>
                        {restored ? (
                          <Badge tone="success">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> {t("del.badgeRestored", { date: formatDate(item.restoredAt as string) })}
                          </Badge>
                        ) : (
                          <Badge tone="warning">{t("del.badgeInBin")}</Badge>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {restored ? (
                          <span className="text-[11.5px] text-dmk-text-muted">{t("del.backInUse")}</span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                              disabled={busyId === item.id}
                              onClick={() => restoreOne(item)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> {t("cmn.restore")}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 ml-1 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
                                  aria-label={t("del.purgeAria", { name: item.label })}
                                  disabled={busyId === item.id}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="dmk-card border-dmk-border-medium">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-dmk-text-primary">
                                    {t("del.purgeTitle", { name: item.label })}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription className="text-dmk-text-secondary">
                                    {t("del.purgeDesc")}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
                                    {t("cmn.cancel")}
                                  </AlertDialogCancel>
                                  <AlertDialogAction
                                    className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
                                    onClick={() => purgeOne(item)}
                                  >
                                    {t("del.deleteForever")}
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
            <span>{t("del.itemsShown", { n: items.length })}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {t("del.restoreNote")}
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
