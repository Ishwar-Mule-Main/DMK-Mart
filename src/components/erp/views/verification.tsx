"use client";

// ═══════════════════════════════════════════════════════════════
// PURCHASE — PO VERIFICATION COCKPIT (owner portal)
// Flow: PO raised → team verifies goods (sellable vs damaged) →
// submission lands here → owner ACCEPTS → GRN pipeline books stock,
// vendor payable and the PURCHASE journal (Finance & Accounting).
// Owner also creates & manages every verification-team account here.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ClipboardCheck,
  ShieldCheck,
  Undo2,
  CheckCircle2,
  PackageSearch,
  PackageX,
  Users,
  UserPlus,
  KeyRound,
  Radio,
  Wifi,
  WifiOff,
  Eye,
  IndianRupee,
  AlertTriangle,
  Pencil,
  ArrowLeftRight,
  FileCheck2,
} from "lucide-react";
import { useErpStore, useActiveFirm } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useVerificationBus } from "@/hooks/use-verification-bus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  PageHeader,
  KpiCard,
  SectionGrid,
  RegisterCard,
  RegisterRow,
  AsideCard,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  Field,
  inputCls,
  ErrorText,
} from "@/components/erp/shared";
import { filterByQuery } from "@/lib/search-rank";
import { cn } from "@/lib/utils";
import { useT, type TFn } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────

interface VerifyItem {
  id: string;
  poItemId: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  orderedQty: number;
  sellableQty: number | null;
  damagedQty: number | null;
  remark: string;
}

interface VerificationRow {
  id: string;
  firmId: string;
  poId: string;
  status: "AWAITING_VERIFICATION" | "SUBMITTED" | "OWNER_ACCEPTED";
  submittedAt: string | null;
  submittedNote: string;
  acceptedAt: string | null;
  acceptedNote: string;
  acceptedValue: number;
  returnReason: string;
  createdAt: string;
  updatedAt: string;
  submittedBy: { id: string; name: string; username: string } | null;
  po: {
    id: string;
    poNumber: string;
    poDate: string;
    status: string;
    grandTotal: number;
    vendor: { id: string; vendorName: string; vendorType: string };
    items: { id: string; quantity: number; unitCost: number; totalAmount: number }[];
  };
  items: VerifyItem[];
}

interface StaffRow {
  id: string;
  firmId: string;
  name: string;
  username: string;
  phone: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  _count: { verifications: number; submissions: number };
}

function vMeta(t: TFn, status: string): { label: string; tone: "warning" | "info" | "success" | "neutral" } {
  if (status === "AWAITING_VERIFICATION") return { label: t("ver.stAtTeam"), tone: "warning" };
  if (status === "SUBMITTED") return { label: t("ver.stToReview"), tone: "info" };
  if (status === "OWNER_ACCEPTED") return { label: t("ver.stAccepted"), tone: "success" };
  return { label: status, tone: "neutral" };
}

function VerifyStatusBadge({ status, t }: { status: string; t: TFn }) {
  const v = vMeta(t, status);
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

// ─── View ─────────────────────────────────────────────────────────

export default function PurchaseVerificationView() {
  const activeFirm = useActiveFirm();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const { toast } = useToast();
  const { t } = useT();
  const { connected, tick } = useVerificationBus(activeFirmId);

  const [rows, setRows] = React.useState<VerificationRow[] | null>(null);
  const [staff, setStaff] = React.useState<StaffRow[] | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [search, setSearch] = React.useState("");
  const [reviewOf, setReviewOf] = React.useState<VerificationRow | null>(null);
  const [staffDialog, setStaffDialog] = React.useState<{ mode: "create" } | { mode: "edit"; staff: StaffRow } | { mode: "reset"; staff: StaffRow } | null>(null);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    try {
      const [list, team] = await Promise.all([
        apiGet<VerificationRow[]>("/api/v1/verification", { firmId: activeFirmId }),
        apiGet<StaffRow[]>("/api/v1/verification/staff", { firmId: activeFirmId }),
      ]);
      setRows(list ?? []);
      setStaff(team ?? []);
    } catch (e) {
      if (e instanceof ApiError) {
        toast({ variant: "destructive", title: t("ver.toastLoadFail"), description: e.message });
      }
    }
  }, [activeFirmId, toast, t]);

  React.useEffect(() => {
    load();
  }, [load]);

  // realtime tick + polling fallback → refetch
  React.useEffect(() => {
    if (!activeFirmId) return;
    if (tick > 0) load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [tick, activeFirmId, load]);

  const list = rows ?? [];
  // Status filter first, then word-wise search (PO # / vendor) — order preserved.
  const filtered = filterByQuery(
    list.filter((r) => statusFilter === "ALL" || r.status === statusFilter),
    search,
    (r) => [r.po.poNumber, r.po.vendor.vendorName]
  );

  const awaiting = list.filter((r) => r.status === "AWAITING_VERIFICATION");
  const submitted = list.filter((r) => r.status === "SUBMITTED");
  const accepted = list.filter((r) => r.status === "OWNER_ACCEPTED");
  const acceptedValue = accepted.reduce((s, r) => s + Number(r.acceptedValue || 0), 0);
  const damagedUnits = list.reduce(
    (s, r) => s + r.items.reduce((x, i) => x + (i.damagedQty ?? 0), 0),
    0
  );
  const activeStaff = (staff ?? []).filter((s) => s.isActive);

  return (
    <div className="space-y-4 dmk-enter-stagger">
      <PageHeader
        icon={ClipboardCheck}
        title={t("ver.title")}
        subtitle={t("ver.subtitle")}
        actions={
          <>
            <span
              className={cn(
                "dmk-badge h-9 px-3 gap-1.5",
                connected ? "bg-dmk-success/15 text-dmk-success" : "bg-dmk-warning/15 text-dmk-warning"
              )}
              title={connected ? t("ver.liveTitle") : t("ver.pollTitle")}
            >
              {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {connected ? t("ver.liveBadge") : t("ver.pollBadge")}
            </span>
            <Button onClick={() => setStaffDialog({ mode: "create" })} className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold">
              <UserPlus className="h-4 w-4" /> <span className="hidden sm:inline">{t("ver.addAccount")}</span>
            </Button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t("ver.kpiAtTeam")} value={String(awaiting.length)} sub={t("ver.kpiAtTeamSub")} icon={PackageSearch} />
        <KpiCard label={t("ver.kpiWaiting")} value={String(submitted.length)} sub={t("ver.kpiWaitingSub")} icon={ShieldCheck} tone="gold" />
        <KpiCard label={t("ver.kpiAccepted")} value={formatINR(acceptedValue)} sub={t("ver.kpiAcceptedSub", { n: accepted.length })} icon={IndianRupee} tone="success" />
        <KpiCard label={t("ver.kpiDamaged")} value={String(Math.round(damagedUnits))} sub={t("ver.kpiDamagedSub")} icon={PackageX} tone="danger" />
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle h-10">
          <TabsTrigger value="queue" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-[#0A0F1D]">
            <ClipboardCheck className="h-4 w-4" /> {t("ver.tabQueue")}
            {submitted.length > 0 && (
              <span className="ml-1 rounded-full bg-dmk-danger px-1.5 text-[10px] font-bold text-white">{submitted.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="team" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-[#0A0F1D]">
            <Users className="h-4 w-4" /> {t("ver.tabTeam")}
            <span className="ml-1 rounded-full bg-dmk-input-well px-1.5 text-[10px] font-bold text-dmk-text-secondary">{activeStaff.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ── QUEUE TAB ── */}
        <TabsContent value="queue" className="mt-0 space-y-4">
          <SectionGrid
            list={
              <RegisterCard
                title={t("ver.requestsTitle")}
                icon={ShieldCheck}
                count={filtered.length}
                countLabel={t("ver.countRequests")}
                filters={
                  <>
                    <SearchInput value={search} onChange={setSearch} placeholder={t("ver.searchPh")} className="flex-1" />
                    <div className="flex gap-1 overflow-x-auto pb-0.5">
                      {["ALL", "AWAITING_VERIFICATION", "SUBMITTED", "OWNER_ACCEPTED"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(s)}
                          className={cn(
                            "h-8 px-2.5 rounded-md text-[11px] font-semibold whitespace-nowrap border transition-colors",
                            statusFilter === s
                              ? "bg-dmk-yellow text-[#0A0F1D] border-dmk-yellow"
                              : "bg-dmk-input-well text-dmk-text-secondary border-dmk-border-subtle hover:bg-dmk-hover"
                          )}
                        >
                          {s === "ALL" ? t("cmn.all") : vMeta(t, s).label}
                        </button>
                      ))}
                    </div>
                  </>
                }
                footer={
                  <>
                    <span className="flex items-center gap-1.5">
                      <Radio className="h-3 w-3 text-dmk-success" /> {t("ver.footerLive")}
                    </span>
                    <span>{t("ver.footerPost")}</span>
                  </>
                }
              >
                {rows === null ? (
                  <LoadingRows />
                ) : filtered.length === 0 ? (
                  <EmptyState
                    icon={ClipboardCheck}
                    title={t("ver.emptyTitle")}
                    hint={t("ver.emptyHint")}
                  />
                ) : (
                  filtered.map((r) => (
                    <RegisterRow key={r.id} onClick={() => setReviewOf(r)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-money text-[13px] font-bold text-dmk-gold">{r.po.poNumber}</span>
                            <VerifyStatusBadge status={r.status} t={t} />
                            {r.po.status === "CANCELLED" && <Badge tone="danger">{t("ver.poCancelled")}</Badge>}
                          </div>
                          <p className="text-[12px] text-dmk-text-secondary truncate mt-0.5">
                            {r.po.vendor.vendorName} · {t("ver.rowMeta", { n: r.items.length, date: formatDate(r.po.poDate) })}
                          </p>
                          {r.status === "SUBMITTED" && (
                            <p className="text-[11px] text-dmk-info mt-0.5">
                              {t("ver.rowVerified", {
                                name: r.submittedBy?.name ?? t("ver.teamWord"),
                                s: r.items.reduce((s, i) => s + (i.sellableQty ?? 0), 0),
                                d: r.items.reduce((s, i) => s + (i.damagedQty ?? 0), 0),
                              })}
                            </p>
                          )}
                          {r.status === "AWAITING_VERIFICATION" && r.returnReason && (
                            <p className="text-[11px] text-dmk-warning mt-0.5 truncate">{t("ver.sentBack", { reason: r.returnReason })}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-money text-[13px] font-semibold text-dmk-text-primary">{formatINR(r.po.grandTotal)}</p>
                          <p className="text-[10.5px] text-dmk-text-muted flex items-center justify-end gap-1 mt-0.5">
                            <Eye className="h-3 w-3" /> {t("ver.review")}
                          </p>
                        </div>
                      </div>
                    </RegisterRow>
                  ))
                )}
              </RegisterCard>
            }
            aside={
              <>
                <AsideCard title={t("ver.gateTitle")} icon={FileCheck2} iconClass="text-dmk-yellow">
                  <ol className="space-y-2.5 text-[12px] text-dmk-text-secondary">
                    {[
                      t("ver.gate1"),
                      t("ver.gate2"),
                      t("ver.gate3"),
                      t("ver.gate4"),
                    ].map((s, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="h-5 w-5 shrink-0 rounded-full bg-dmk-yellow/15 text-dmk-yellow text-[10.5px] font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ol>
                </AsideCard>

                <AsideCard
                  title={t("ver.onDuty")}
                  icon={Users}
                  iconClass="text-dmk-blue"
                  footnote={
                    activeStaff.length === 0
                      ? t("ver.dutyFootNone")
                      : t("ver.dutyFootSignin")
                  }
                >
                  {staff === null ? (
                    <LoadingRows rows={2} />
                  ) : activeStaff.length === 0 ? (
                    <p className="text-[12px] text-dmk-warning flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {t("ver.noTeamYet")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {activeStaff.slice(0, 5).map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="truncate text-dmk-text-primary">
                            {s.name} <span className="text-dmk-text-muted">· {s.username}</span>
                          </span>
                          <Badge tone="neutral">{t("ver.checks", { n: s._count.submissions })}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </AsideCard>

                <AsideCard title={t("ver.damageWatch")} icon={PackageX} iconClass="text-dmk-danger">
                  {damagedUnits <= 0 ? (
                    <p className="text-[12px] text-dmk-text-muted">{t("ver.damageClean")}</p>
                  ) : (
                    <div className="space-y-2">
                      {list
                        .flatMap((r) => r.items.filter((i) => (i.damagedQty ?? 0) > 0).map((i) => ({ r, i })))
                        .sort((a, b) => (b.i.damagedQty ?? 0) - (a.i.damagedQty ?? 0))
                        .slice(0, 5)
                        .map(({ r, i }) => (
                          <div key={i.id} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="truncate text-dmk-text-secondary">
                              {i.productName} <span className="text-dmk-text-muted">· {r.po.poNumber}</span>
                            </span>
                            <span className="font-money text-dmk-danger shrink-0">{i.damagedQty} {i.unit}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </AsideCard>
              </>
            }
          />
        </TabsContent>

        {/* ── TEAM TAB ── */}
        <TabsContent value="team" className="mt-0">
          <RegisterCard
            title={t("ver.teamTitle")}
            icon={Users}
            count={(staff ?? []).length}
            countLabel={t("ver.countAccounts")}
            filters={
              <Button onClick={() => setStaffDialog({ mode: "create" })} className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold">
                <UserPlus className="h-4 w-4" /> {t("ver.createAccount")}
              </Button>
            }
            footer={<span>{t("ver.teamFoot")}</span>}
          >
            {staff === null ? (
              <LoadingRows />
            ) : (staff ?? []).length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("ver.teamEmptyTitle")}
                hint={t("ver.teamEmptyHint")}
                action={
                  <Button onClick={() => setStaffDialog({ mode: "create" })} className="bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-semibold">
                    <UserPlus className="h-4 w-4" /> {t("ver.firstAccount")}
                  </Button>
                }
              />
            ) : (
              (staff ?? []).map((s) => (
                <RegisterRow key={s.id}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-dmk-text-primary">{s.name}</span>
                        <Badge tone="neutral">{s.role}</Badge>
                        {s.isActive ? <Badge tone="success">{t("ver.badgeActive")}</Badge> : <Badge tone="danger">{t("ver.badgeDisabled")}</Badge>}
                      </div>
                      <p className="text-[11.5px] text-dmk-text-muted mt-0.5 truncate">
                        @{s.username} · {s.phone || t("ver.noPhone")} · {t("ver.subsAsn", { sub: s._count.submissions, asn: s._count.verifications })}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="outline" size="sm" className="h-8 text-[12px] border-dmk-border-subtle" onClick={() => setStaffDialog({ mode: "edit", staff: s })}>
                        <Pencil className="h-3.5 w-3.5" /> {t("cmn.edit")}
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 text-[12px] border-dmk-border-subtle" onClick={() => setStaffDialog({ mode: "reset", staff: s })}>
                        <KeyRound className="h-3.5 w-3.5" /> {t("ver.passwordBtn")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn("h-8 text-[12px] border-dmk-border-subtle", s.isActive ? "text-dmk-danger hover:text-dmk-danger" : "text-dmk-success hover:text-dmk-success")}
                        onClick={async () => {
                          try {
                            await apiPatch(`/api/v1/verification/staff/${s.id}`, { isActive: !s.isActive });
                            toast({ title: t(s.isActive ? "ver.toastDeactivated" : "ver.toastReactivated", { name: s.name }) });
                            load();
                          } catch (e) {
                            toast({ variant: "destructive", title: t("ver.toastUpdateFail"), description: e instanceof ApiError ? e.message : t("ver.tryAgain") });
                          }
                        }}
                      >
                        {s.isActive ? t("ver.disable") : t("ver.enable")}
                      </Button>
                    </div>
                  </div>
                </RegisterRow>
              ))
            )}
          </RegisterCard>
        </TabsContent>
      </Tabs>

      {/* Review & accept dialog */}
      {reviewOf && (
        <ReviewDialog
          row={reviewOf}
          onClose={() => setReviewOf(null)}
          onDone={() => {
            setReviewOf(null);
            load();
          }}
        />
      )}

      {/* Staff dialogs */}
      {staffDialog?.mode === "create" && <StaffDialog onClose={() => setStaffDialog(null)} onSaved={() => { setStaffDialog(null); load(); }} />}
      {staffDialog?.mode === "edit" && <StaffDialog staff={staffDialog.staff} onClose={() => setStaffDialog(null)} onSaved={() => { setStaffDialog(null); load(); }} />}
      {staffDialog?.mode === "reset" && (
        <ResetPasswordDialog
          staff={staffDialog.staff}
          onClose={() => setStaffDialog(null)}
          onSaved={() => {
            setStaffDialog(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ─── Review & Accept (the money moment) ───────────────────────────

function ReviewDialog({ row, onClose, onDone }: { row: VerificationRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const { t } = useT();
  // Owner override: unverified lines prefill to ordered qty (all good),
  // team-verified lines prefill with exactly what the team counted.
  const [items, setItems] = React.useState<VerifyItem[]>(
    row.items.map((i) => ({ ...i, sellableQty: i.sellableQty ?? i.orderedQty, damagedQty: i.damagedQty ?? 0 }))
  );
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"none" | "accept" | "reject">("none");
  const [error, setError] = React.useState<string | null>(null);
  const isSubmitted = row.status === "SUBMITTED";
  const isAccepted = row.status === "OWNER_ACCEPTED";

  function setQty(id: string, key: "sellableQty" | "damagedQty", v: number) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, [key]: v } : i)));
  }

  const totals = items.reduce(
    (acc, i) => ({
      sellable: acc.sellable + (Number(i.sellableQty) || 0),
      damaged: acc.damaged + (Number(i.damagedQty) || 0),
      ordered: acc.ordered + i.orderedQty,
    }),
    { sellable: 0, damaged: 0, ordered: 0 }
  );

  async function accept() {
    setBusy("accept");
    setError(null);
    try {
      await apiPost(`/api/v1/verification/${row.id}/accept`, {
        note,
        items: items.map((i) => ({
          verificationItemId: i.id,
          sellableQty: Number(i.sellableQty) || 0,
          damagedQty: Number(i.damagedQty) || 0,
        })),
      });
      toast({
        title: t("ver.toastAccepted", { po: row.po.poNumber }),
        description: t("ver.toastAcceptedDesc", { amt: formatINR(row.po.grandTotal) }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("ver.errAccept"));
    } finally {
      setBusy("none");
    }
  }

  async function sendBack() {
    const reason = window.prompt(t("ver.rejectPrompt"), t("ver.rejectDefault"));
    if (!reason) return;
    setBusy("reject");
    setError(null);
    try {
      await apiPost(`/api/v1/verification/${row.id}/reject`, { reason });
      toast({ title: t("ver.toastSentBack"), description: `${row.po.poNumber} — ${reason}` });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("ver.errSendBack"));
    } finally {
      setBusy("none");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
            {row.po.poNumber} <VerifyStatusBadge status={row.status} t={t} />
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {row.po.vendor.vendorName} · {t("ver.dlgMeta", { date: formatDate(row.po.poDate), amt: formatINR(row.po.grandTotal) })}
            {isSubmitted && row.submittedBy ? ` · ${t("ver.dlgVerifiedBy", { name: row.submittedBy.name })}` : isAccepted ? ` · ${t("ver.dlgBooked")}` : ` · ${t("ver.dlgNotVerified")}`}
          </DialogDescription>
        </DialogHeader>

        {isAccepted ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-dmk-success/30 bg-dmk-success/10 p-3 flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-dmk-success shrink-0 mt-0.5" />
              <div className="text-[12.5px] text-dmk-text-secondary leading-relaxed">
                {t("ver.acceptedLine", { date: row.acceptedAt ? formatDate(row.acceptedAt) : "", amt: formatINR(row.acceptedValue || row.po.grandTotal) })}
                {row.acceptedNote && <span className="block mt-1 text-dmk-text-muted">{t("ver.noteLabel", { note: row.acceptedNote })}</span>}
              </div>
            </div>
            <ItemsTable items={items} orderedFirst readonly t={t} />
          </div>
        ) : (
          <>
            <ItemsTable items={items} orderedFirst editable onQty={setQty} t={t} />
            {isSubmitted && row.submittedNote && (
              <p className="text-[11.5px] text-dmk-info bg-dmk-info/10 border border-dmk-info/25 rounded-md px-3 py-2">
                {t("ver.teamNote", { note: row.submittedNote })}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("ver.ordered")}>
                <div className="dmk-well h-9 flex items-center justify-end px-3 font-money text-[13px]">{totals.ordered}</div>
              </Field>
              <Field label={t("ver.sellableTotal")}>
                <div className="dmk-well h-9 flex items-center justify-end px-3 font-money text-[13px] text-dmk-success">{totals.sellable}</div>
              </Field>
              <Field label={t("ver.damagedTotal")}>
                <div className={cn("dmk-well h-9 flex items-center justify-end px-3 font-money text-[13px]", totals.damaged > 0 ? "text-dmk-danger" : "")}>{totals.damaged}</div>
              </Field>
            </div>
            <Field label={t("ver.grnNote")}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ver.grnNotePh")} className={inputCls} />
            </Field>
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex flex-col sm:flex-row gap-2 justify-end pt-1">
              {isSubmitted && (
                <Button variant="outline" onClick={sendBack} disabled={busy !== "none"} className="h-10 border-dmk-border-medium text-dmk-warning hover:text-dmk-warning">
                  <Undo2 className="h-4 w-4" /> {t("ver.sendBack")}
                </Button>
              )}
              <Button onClick={accept} disabled={busy !== "none"} className="h-10 bg-dmk-success text-white hover:bg-dmk-success/90 font-bold">
                <CheckCircle2 className="h-4 w-4" />
                {busy === "accept" ? t("ver.posting") : t("ver.acceptPost", { amt: formatINR(row.po.grandTotal) })}
              </Button>
            </div>
            <p className="text-[10.5px] text-dmk-text-muted leading-relaxed">
              {t("ver.grnPipeline")}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ItemsTable({
  items,
  editable,
  readonly,
  orderedFirst,
  onQty,
  t,
}: {
  items: VerifyItem[];
  editable?: boolean;
  readonly?: boolean;
  orderedFirst?: boolean;
  onQty?: (id: string, key: "sellableQty" | "damagedQty", v: number) => void;
  t: TFn;
}) {
  return (
    <div className="dmk-well overflow-x-auto [&>*]:min-w-0">
      <table className="dmk-table">
        <thead>
          <tr>
            <th>{t("cmn.product")}</th>
            <th className="text-right">{t("ver.ordered")}</th>
            <th className="text-right w-[118px]">{t("ver.colSellable")}</th>
            <th className="text-right w-[118px]">{t("ver.colDamaged")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const total = (Number(i.sellableQty) || 0) + (Number(i.damagedQty) || 0);
            const over = total > i.orderedQty + 1e-9;
            return (
              <tr key={i.id}>
                <td>
                  <p className="text-[12.5px] font-medium text-dmk-text-primary whitespace-nowrap">{i.productName}</p>
                  <p className="text-[10.5px] text-dmk-text-muted font-money">{i.sku} · {i.unit}</p>
                </td>
                <td className="num text-[13px]">{i.orderedQty}</td>
                {editable ? (
                  <>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        value={i.sellableQty ?? 0}
                        onChange={(e) => onQty?.(i.id, "sellableQty", Number(e.target.value))}
                        className="h-8 text-right font-money text-[12.5px] bg-dmk-input-well border-dmk-border-subtle"
                        aria-label={t("ver.qSellable", { name: i.productName })}
                      />
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={0}
                        value={i.damagedQty ?? 0}
                        onChange={(e) => onQty?.(i.id, "damagedQty", Number(e.target.value))}
                        className={cn(
                          "h-8 text-right font-money text-[12.5px] bg-dmk-input-well border-dmk-border-subtle",
                          over && "border-dmk-danger text-dmk-danger"
                        )}
                        aria-label={t("ver.qDamaged", { name: i.productName })}
                      />
                    </td>
                  </>
                ) : (
                  <>
                    <td className={cn("num text-[13px]", orderedFirst ? "text-dmk-success" : "")}>{i.sellableQty ?? "—"}</td>
                    <td className={cn("num text-[13px]", (i.damagedQty ?? 0) > 0 && "text-dmk-danger")}>{i.damagedQty ?? "—"}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Staff create / edit ──────────────────────────────────────────

// Portal roles — DRIVER routes the account to the delivery trip screen
// on the team portal instead of the goods-in checkpoint.
function staffRoleOptions(t: TFn): { value: string; label: string }[] {
  return [
    { value: "VERIFIER", label: t("ver.roleVerifier") },
    { value: "SUPERVISOR", label: t("ver.roleSupervisor") },
    { value: "DRIVER", label: t("ver.roleDriver") },
  ];
}

function StaffDialog({
  staff,
  onClose,
  onSaved,
}: {
  staff?: StaffRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();
  const { t } = useT();
  const [form, setForm] = React.useState({
    name: staff?.name ?? "",
    username: staff?.username ?? "",
    password: "",
    phone: staff?.phone ?? "",
    role: staff?.role ?? "VERIFIER",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!activeFirmId) return;
    setBusy(true);
    setError(null);
    try {
      if (staff) {
        await apiPatch(`/api/v1/verification/staff/${staff.id}`, {
          name: form.name,
          username: form.username,
          phone: form.phone,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        });
        toast({ title: t("ver.toastUpdated"), description: `${form.name} · @${form.username}` });
      } else {
        await apiPost("/api/v1/verification/staff", { ...form, firmId: activeFirmId });
        toast({ title: t("ver.toastCreated"), description: t("ver.toastCreatedDesc", { name: form.name, username: form.username }) });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("ver.errSave"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary">{staff ? t("ver.editAccount") : t("ver.createAccount")}</DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {staff ? t("ver.editDesc") : t("ver.createDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">{t("ver.fullName")}</Label>
            <Input value={form.name} onChange={set("name")} placeholder="Ravi Kulkarni" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">{t("ver.username")}</Label>
            <Input value={form.username} onChange={set("username")} placeholder="ravi" className={cn(inputCls, "lowercase")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">{staff ? t("ver.newPwOpt") : t("ver.password")}</Label>
            <Input type="password" value={form.password} onChange={set("password")} placeholder={staff ? t("ver.pwKeepPh") : t("ver.minChars")} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">{t("cmn.phone")}</Label>
            <Input value={form.phone} onChange={set("phone")} placeholder="+91 …" className={inputCls} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-[11px] uppercase tracking-widest text-dmk-text-muted font-semibold">{t("ver.role")}</Label>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1">
              {staffRoleOptions(t).map((r) => (
                <label key={r.value} className="flex items-center gap-2 text-[12.5px] text-dmk-text-secondary cursor-pointer">
                  <Switch checked={form.role === r.value} onCheckedChange={() => setForm((f) => ({ ...f, role: r.value }))} />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <Button
          onClick={save}
          disabled={busy || !form.name || !form.username || (!staff && form.password.length < 4)}
          className="w-full h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold"
        >
          {busy ? t("ver.saving") : staff ? t("cmn.saveChanges") : t("ver.createAccount")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ staff, onClose, onSaved }: { staff: StaffRow; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { t } = useT();
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/verification/staff/${staff.id}`, { password: pw });
      toast({ title: t("ver.toastReset"), description: t("ver.toastResetDesc", { name: staff.name }) });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("ver.errReset"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary">{t("ver.resetTitle", { name: staff.name })}</DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">{t("ver.resetDesc", { username: staff.username })}</DialogDescription>
        </DialogHeader>
        <Field label={t("ver.newPw")}>
          <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("ver.minChars")} className={inputCls} />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <Button onClick={reset} disabled={busy || pw.length < 4} className="w-full h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold">
          <KeyRound className="h-4 w-4" /> {t("ver.resetBtn")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
