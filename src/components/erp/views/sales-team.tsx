"use client";

// ═══════════════════════════════════════════════════════════════
// OWNER VIEW: Sales Team Management
// The owner creates /sales portal accounts here, issues passwords,
// maps members to delivery routes, and toggles which sidebar
// sections each member sees (8 permission switches).
// Members sign in at /sales with the username + password set here.
// APIs: /api/v1/sales-team/members · /api/v1/logistics/routes ·
//       /api/v1/sales-orders
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  UsersRound,
  UserPlus,
  Pencil,
  ClipboardList,
  IndianRupee,
  Coins,
  RefreshCw,
  Ban,
  RotateCcw,
  Trash2,
  ShieldCheck,
  ScrollText,
  Loader2,
} from "lucide-react";
import { useErpStore, DEFAULT_SALES_PERMS, type SalesPermissions } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { filterByQuery } from "@/lib/search-rank";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Badge,
  PageHeader,
  KpiCard,
  DataTable,
  EmptyState,
  LoadingRows,
  SearchInput,
  ErrorText,
  inputCls,
} from "@/components/erp/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── API contract types ───────────────────────────────────────────

interface SalesMemberRow {
  id: string;
  fullName: string;
  phone: string;
  username: string;
  isActive: boolean;
  assignedRouteId: string | null;
  assignedRoute: { id: string; name: string } | null;
  canB2BBilling: boolean;
  canB2CPos: boolean;
  canSalesOrders: boolean;
  canManageCustomers: boolean;
  canViewStock: boolean;
  canViewInvoices: boolean;
  canRecordReceipts: boolean;
  canOverridePrice: boolean;
  createdAt: string;
  _count: { invoices: number; salesOrders: number; receipts: number; customersCreated: number };
  totalBilled: number;
  invoiceCount: number;
  todayBilled: number;
}

interface RouteRow {
  id: string;
  name: string;
  towns: string;
  startFrom: string;
  endTo: string;
  isActive: boolean;
}

interface SalesOrderRow {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: "BOOKED" | "CONVERTED" | "CANCELLED";
  estimatedTotal: number;
  notes: string;
  customerId: string | null;
  customer: { id: string; partyName: string; phone: string; city: string } | null;
  salesMember: { id: string; fullName: string; username: string } | null;
  _count: { items: number };
}

interface OrderTotals {
  count: number;
  booked: number;
  estimatedAmount: number;
}

const EMPTY_TOTALS: OrderTotals = { count: 0, booked: 0, estimatedAmount: 0 };

// ─── Permission switchboard metadata ─────────────────────────────

type PermKey = keyof SalesPermissions;

const PERM_SECTIONS: ReadonlyArray<{ key: PermKey; label: string; desc: string }> = [
  { key: "canB2BBilling", label: "B2B Fast Billing", desc: "Wholesale invoices with customer tier pricing" },
  { key: "canB2CPos", label: "B2C Counter POS", desc: "Walk-in retail billing, Cash / UPI / Card" },
  { key: "canSalesOrders", label: "Sales Orders — SO Booking", desc: "Record phone / PDF orders for delivery" },
  { key: "canManageCustomers", label: "Customer Master", desc: "Add / edit shops, phones, addresses" },
  { key: "canViewStock", label: "Stock Lookup", desc: "Sellable quantities only — purchase costs hidden" },
  { key: "canViewInvoices", label: "Invoice Register", desc: "View & reprint bills" },
  { key: "canRecordReceipts", label: "Customer Payment Receipts", desc: "Record collections (optional trust)" },
  { key: "canOverridePrice", label: "Price & Discount Overrides", desc: "Manual discounts beyond tier pricing" },
];

function permsOf(m: SalesMemberRow): SalesPermissions {
  return {
    canB2BBilling: m.canB2BBilling,
    canB2CPos: m.canB2CPos,
    canSalesOrders: m.canSalesOrders,
    canManageCustomers: m.canManageCustomers,
    canViewStock: m.canViewStock,
    canViewInvoices: m.canViewInvoices,
    canRecordReceipts: m.canRecordReceipts,
    canOverridePrice: m.canOverridePrice,
  };
}

function permCount(p: SalesPermissions): number {
  return PERM_SECTIONS.filter((s) => p[s.key]).length;
}

const SO_STATUS_TONE: Record<SalesOrderRow["status"], "info" | "success" | "danger"> = {
  BOOKED: "info",
  CONVERTED: "success",
  CANCELLED: "danger",
};

// ─── View ─────────────────────────────────────────────────────────

export default function SalesTeamView() {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();

  const [tab, setTab] = React.useState<"members" | "orders">("members");

  // Members + routes + KPI totals
  const [members, setMembers] = React.useState<SalesMemberRow[] | null>(null);
  const [routes, setRoutes] = React.useState<RouteRow[]>([]);
  const [kpiTotals, setKpiTotals] = React.useState<OrderTotals>(EMPTY_TOTALS);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Order book (own filters)
  const [orders, setOrders] = React.useState<SalesOrderRow[] | null>(null);
  const [orderTotals, setOrderTotals] = React.useState<OrderTotals>(EMPTY_TOTALS);
  const [orderStatus, setOrderStatus] = React.useState<string>("ALL");
  const [orderQuery, setOrderQuery] = React.useState("");
  const [orderSearch, setOrderSearch] = React.useState("");
  const [ordersError, setOrdersError] = React.useState<string | null>(null);
  const [ordersLoading, setOrdersLoading] = React.useState(false);

  // Debounced searches
  const [memberQuery, setMemberQuery] = React.useState("");
  const [memberSearch, setMemberSearch] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setMemberSearch(memberQuery), 220);
    return () => clearTimeout(t);
  }, [memberQuery]);
  React.useEffect(() => {
    const t = setTimeout(() => setOrderSearch(orderQuery), 220);
    return () => clearTimeout(t);
  }, [orderQuery]);

  // Dialogs & confirms
  const [dialog, setDialog] = React.useState<{ mode: "create" } | { mode: "edit"; member: SalesMemberRow } | null>(null);
  const [toggleOf, setToggleOf] = React.useState<{ member: SalesMemberRow; next: boolean } | null>(null);
  const [removeOf, setRemoveOf] = React.useState<SalesMemberRow | null>(null);
  const [cancelOf, setCancelOf] = React.useState<SalesOrderRow | null>(null);
  const [toggling, setToggling] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!activeFirmId) return;
    setLoadError(null);
    try {
      const [m, r, o] = await Promise.all([
        apiGet<{ members: SalesMemberRow[] }>("/api/v1/sales-team/members", { firmId: activeFirmId }),
        apiGet<{ routes: RouteRow[] }>("/api/v1/logistics/routes", { firmId: activeFirmId }),
        apiGet<{ orders: SalesOrderRow[]; totals: OrderTotals }>("/api/v1/sales-orders", { firmId: activeFirmId }),
      ]);
      setMembers(m.members ?? []);
      setRoutes(r.routes ?? []);
      setKpiTotals(o.totals ?? EMPTY_TOTALS);
    } catch (e) {
      setMembers([]);
      setRoutes([]);
      setKpiTotals(EMPTY_TOTALS);
      setLoadError(e instanceof ApiError ? e.message : "Could not load the sales team.");
    }
  }, [activeFirmId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const loadOrders = React.useCallback(async () => {
    if (!activeFirmId) return;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await apiGet<{ orders: SalesOrderRow[]; totals: OrderTotals }>("/api/v1/sales-orders", {
        firmId: activeFirmId,
        status: orderStatus === "ALL" ? undefined : orderStatus,
        search: orderSearch.trim() || undefined,
      });
      setOrders(res.orders ?? []);
      setOrderTotals(res.totals ?? EMPTY_TOTALS);
    } catch (e) {
      setOrders([]);
      setOrderTotals(EMPTY_TOTALS);
      setOrdersError(e instanceof ApiError ? e.message : "Could not load the order book.");
    } finally {
      setOrdersLoading(false);
    }
  }, [activeFirmId, orderStatus, orderSearch]);

  React.useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const memberList = members ?? [];
  const activeCount = memberList.filter((m) => m.isActive).length;
  const totalBilled = memberList.reduce((s, m) => s + Number(m.totalBilled || 0), 0);
  const todayBilled = memberList.reduce((s, m) => s + Number(m.todayBilled || 0), 0);

  const filteredMembers = React.useMemo(
    () => filterByQuery(memberList, memberSearch, (m) => [m.fullName, m.username, m.phone]),
    [memberList, memberSearch]
  );

  async function toggleActive() {
    if (!toggleOf) return;
    setToggling(true);
    try {
      await apiPatch(`/api/v1/sales-team/members/${toggleOf.member.id}`, { isActive: toggleOf.next });
      toast({
        title: toggleOf.next ? `${toggleOf.member.fullName} activated` : `${toggleOf.member.fullName} suspended`,
        description: toggleOf.next
          ? "They can sign in at /sales again — allowed sections reappear on their next screen."
          : "Their sign-in stops immediately — the sidebar disappears on their next screen.",
      });
      setToggleOf(null);
      load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof ApiError ? e.message : "Try again.",
      });
    } finally {
      setToggling(false);
    }
  }

  async function removeMember() {
    if (!removeOf) return;
    setRemoving(true);
    try {
      await apiDelete(`/api/v1/sales-team/members/${removeOf.id}`);
      toast({
        title: `${removeOf.fullName} removed`,
        description: "Account suspended and archived — restorable from Deleted Data anytime.",
      });
      setRemoveOf(null);
      load();
    } catch (e) {
      setRemoveOf(null);
      toast({
        variant: "destructive",
        title: "Could not remove this member",
        description: e instanceof ApiError ? e.message : "Try again.",
      });
    } finally {
      setRemoving(false);
    }
  }

  async function cancelOrder() {
    if (!cancelOf) return;
    setCancelling(true);
    try {
      await apiPatch(`/api/v1/sales-orders/${cancelOf.id}`, { status: "CANCELLED" });
      toast({
        title: `${cancelOf.orderNumber} cancelled`,
        description: "The estimate is released — the order is marked CANCELLED in the book.",
      });
      setCancelOf(null);
      loadOrders();
      load();
    } catch (e) {
      setCancelOf(null);
      toast({
        variant: "destructive",
        title: "Could not cancel this order",
        description: e instanceof ApiError ? e.message : "Only booked orders can be cancelled.",
      });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-4 dmk-enter-stagger">
      <PageHeader
        icon={UsersRound}
        title="Sales Team Management"
        subtitle="Members sign in at /sales with the username + password you set here — sidebar sections appear only for the permissions you toggle"
        actions={
          <Button
            variant="outline"
            onClick={() => load()}
            className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Active members" value={String(activeCount)} sub={`${memberList.length} accounts total`} icon={UsersRound} />
        <KpiCard label="Total billed" value={formatINR(totalBilled)} sub="lifetime by sales team" icon={IndianRupee} tone="gold" />
        <KpiCard label="Billed today" value={formatINR(todayBilled)} sub="since midnight" icon={Coins} tone="success" />
        <KpiCard label="Sales orders booked" value={String(kpiTotals.booked)} sub={`${kpiTotals.count} in the order book`} icon={ClipboardList} tone="info" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v === "orders" ? "orders" : "members")} className="space-y-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle h-10">
          <TabsTrigger value="members" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-dmk-bg-primary">
            <UsersRound className="h-4 w-4" /> Members
            <span className="ml-1 rounded-full bg-dmk-input-well px-1.5 text-[10px] font-bold text-dmk-text-secondary">{memberList.length}</span>
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-[12.5px] gap-1.5 data-[state=active]:bg-dmk-yellow data-[state=active]:text-dmk-bg-primary">
            <ScrollText className="h-4 w-4" /> Order Book (SO)
            {kpiTotals.booked > 0 && (
              <span className="ml-1 rounded-full bg-dmk-gold/20 px-1.5 text-[10px] font-bold text-dmk-gold">{kpiTotals.booked}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── MEMBERS TAB ── */}
        <TabsContent value="members" className="mt-0 space-y-3">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <SearchInput
              value={memberQuery}
              onChange={setMemberQuery}
              placeholder="Search name, username or phone…"
              className="flex-1"
            />
            <Button
              onClick={() => setDialog({ mode: "create" })}
              className="h-9 shrink-0 bg-dmk-yellow text-dmk-bg-primary hover:bg-dmk-yellow/90 font-semibold"
            >
              <UserPlus className="h-4 w-4" /> Add Sales Member
            </Button>
          </div>

          {loadError && <ErrorText>{loadError}</ErrorText>}

          {members === null ? (
            <div className="dmk-card">
              <LoadingRows />
            </div>
          ) : filteredMembers.length === 0 ? (
            <div className="dmk-card">
              <EmptyState
                icon={UsersRound}
                title={memberList.length === 0 ? "No sales members yet" : "No members match your search"}
                hint={
                  memberList.length === 0
                    ? "Create one account per salesperson — they sign in at /sales with the username + password you set, and see only the sections you allow."
                    : "Try a different name, username or phone."
                }
                action={
                  memberList.length === 0 ? (
                    <Button
                      onClick={() => setDialog({ mode: "create" })}
                      className="h-10 bg-dmk-yellow text-dmk-bg-primary hover:bg-dmk-yellow/90 font-semibold"
                    >
                      <UserPlus className="h-4 w-4" /> Create the first account
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Route</th>
                  <th>Permissions</th>
                  <th className="text-right">Billed</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <p className="text-[13px] font-semibold text-dmk-text-primary whitespace-nowrap">{m.fullName}</p>
                      <p className="text-[10.5px] text-dmk-text-muted whitespace-nowrap">{m.phone || "no phone"}</p>
                    </td>
                    <td>
                      <span className="dmk-badge dmk-badge-neutral font-mono">@{m.username}</span>
                    </td>
                    <td>
                      {m.assignedRoute ? (
                        <span className="dmk-badge dmk-badge-neutral whitespace-nowrap">{m.assignedRoute.name}</span>
                      ) : (
                        <span className="text-[12.5px] text-dmk-text-disabled">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-col gap-1">
                        <span className="text-[12px] font-semibold text-dmk-text-secondary whitespace-nowrap">
                          {permCount(permsOf(m))}/8 sections
                        </span>
                        {(m.canRecordReceipts || m.canOverridePrice) && (
                          <div className="flex gap-1">
                            {m.canRecordReceipts && <Badge tone="warning">+receipts</Badge>}
                            {m.canOverridePrice && <Badge tone="gold">+override</Badge>}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <p className="font-money text-[13px] font-semibold text-dmk-text-primary whitespace-nowrap">{formatINR(Number(m.totalBilled || 0))}</p>
                      <p className="text-[10.5px] text-dmk-text-muted font-money whitespace-nowrap">{formatINR(Number(m.todayBilled || 0))} today</p>
                    </td>
                    <td>
                      {m.isActive ? <Badge tone="success">ACTIVE</Badge> : <Badge tone="warning">SUSPENDED</Badge>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-dmk-border-subtle text-[12px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                          onClick={() => setDialog({ mode: "edit", member: m })}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 border-dmk-border-subtle text-[12px]",
                            m.isActive
                              ? "text-dmk-warning hover:bg-dmk-hover hover:text-dmk-warning"
                              : "text-dmk-success hover:bg-dmk-hover hover:text-dmk-success"
                          )}
                          onClick={() => setToggleOf({ member: m, next: !m.isActive })}
                        >
                          {m.isActive ? <Ban className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          {m.isActive ? "Suspend" : "Activate"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-dmk-border-subtle text-[12px] text-dmk-danger/80 hover:bg-dmk-hover hover:text-dmk-danger"
                          onClick={() => setRemoveOf(m)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}

          <p className="text-[11px] text-dmk-text-muted">
            Suspended members keep their billing history and attribution — only their /sales sign-in and sidebar access stop. Removed accounts are restorable from Deleted Data.
          </p>
        </TabsContent>

        {/* ── ORDER BOOK TAB ── */}
        <TabsContent value="orders" className="mt-0 space-y-3">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Select value={orderStatus} onValueChange={setOrderStatus}>
              <SelectTrigger className="h-9 w-full sm:w-[170px] shrink-0 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="BOOKED">Booked</SelectItem>
                <SelectItem value="CONVERTED">Converted</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <SearchInput
              value={orderQuery}
              onChange={setOrderQuery}
              placeholder="Search order #, customer or notes…"
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() => loadOrders()}
              className="h-9 shrink-0 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", ordersLoading && "animate-spin")} /> Refresh
            </Button>
          </div>

          {ordersError && <ErrorText>{ordersError}</ErrorText>}

          {orders === null || ordersLoading ? (
            <div className="dmk-card">
              <LoadingRows />
            </div>
          ) : orders.length === 0 ? (
            <div className="dmk-card">
              <EmptyState
                icon={ClipboardList}
                title="No sales orders here"
                hint="Sales members with the Sales Orders section book phone / PDF orders at /sales — they land here for the office to convert into invoices."
              />
            </div>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Estimated</th>
                  <th>Booked by</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-[12px] text-dmk-gold whitespace-nowrap">{o.orderNumber}</td>
                    <td className="text-[12.5px] text-dmk-text-secondary whitespace-nowrap">{formatDate(o.orderDate)}</td>
                    <td>
                      <p className="text-[12.5px] font-medium text-dmk-text-primary whitespace-nowrap">
                        {o.customer?.partyName ?? "—"}
                      </p>
                      <p className="text-[10.5px] text-dmk-text-muted whitespace-nowrap">
                        {o.customer ? [o.customer.city, o.customer.phone].filter(Boolean).join(" · ") || "—" : o.notes ? o.notes : "—"}
                      </p>
                    </td>
                    <td className="num text-[13px]">{o._count.items}</td>
                    <td className="text-right font-money text-[13px] font-semibold text-dmk-text-primary whitespace-nowrap">
                      {formatINR(Number(o.estimatedTotal || 0))}
                    </td>
                    <td>
                      <span className="dmk-badge dmk-badge-neutral whitespace-nowrap">{o.salesMember?.fullName ?? "Office"}</span>
                    </td>
                    <td>
                      <Badge tone={SO_STATUS_TONE[o.status] ?? "neutral"}>{o.status}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center justify-end">
                        {o.status === "BOOKED" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-dmk-border-subtle text-[12px] text-dmk-danger/80 hover:bg-dmk-hover hover:text-dmk-danger"
                            onClick={() => setCancelOf(o)}
                          >
                            <Ban className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        ) : (
                          <span className="text-[11.5px] text-dmk-text-disabled">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}

          {/* Totals strip */}
          <div className="dmk-well px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-dmk-text-muted">
            <span>
              <span className="font-semibold text-dmk-text-secondary">{orderTotals.count}</span> orders
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-semibold text-dmk-text-secondary">{orderTotals.booked}</span> booked
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-money text-dmk-text-secondary">{formatINR(orderTotals.estimatedAmount)} estimated</span>
            <span className="ml-auto hidden sm:inline">Only BOOKED orders can be cancelled — converted orders are locked to the books.</span>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add / edit dialog */}
      {dialog && (
        <MemberDialog
          key={dialog.mode === "edit" ? dialog.member.id : "create"}
          member={dialog.mode === "edit" ? dialog.member : undefined}
          routes={routes}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      )}

      {/* Suspend / activate confirm */}
      <AlertDialog open={Boolean(toggleOf)} onOpenChange={(v) => !v && setToggleOf(null)}>
        <AlertDialogContent className="border-dmk-border-subtle bg-dmk-bg-secondary">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">
              {toggleOf?.next ? "Activate" : "Suspend"} {toggleOf?.member.fullName}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              {toggleOf?.next
                ? "They can sign in at /sales again — the sidebar sections you've allowed reappear on their next screen. History stays intact."
                : "Their /sales sign-in stops immediately and the sidebar disappears on their next screen. Billing history and attribution stay intact — activate anytime."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={toggleOf?.next ? "bg-dmk-success text-white hover:bg-dmk-success/90" : "bg-dmk-warning text-dmk-bg-primary hover:bg-dmk-warning/90"}
              disabled={toggling}
              onClick={(e) => {
                e.preventDefault();
                toggleActive();
              }}
            >
              {toggling && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {toggleOf?.next ? "Activate member" : "Suspend member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove confirm */}
      <AlertDialog open={Boolean(removeOf)} onOpenChange={(v) => !v && setRemoveOf(null)}>
        <AlertDialogContent className="border-dmk-border-subtle bg-dmk-bg-secondary">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Remove {removeOf?.fullName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              The account is suspended and archived in Deleted Data — restorable from Deleted Data anytime. Invoices, sales orders
              and receipts they created keep their attribution history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                removeMember();
              }}
            >
              {removing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel order confirm */}
      <AlertDialog open={Boolean(cancelOf)} onOpenChange={(v) => !v && setCancelOf(null)}>
        <AlertDialogContent className="border-dmk-border-subtle bg-dmk-bg-secondary">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Cancel {cancelOf?.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              The estimated {cancelOf ? formatINR(Number(cancelOf.estimatedTotal || 0)) : ""} for{" "}
              {cancelOf?.customer?.partyName ?? "this customer"} is released and the order is marked CANCELLED. Only booked orders
              can be cancelled — once converted to an invoice this is no longer possible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Keep order
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault();
                cancelOrder();
              }}
            >
              {cancelling && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Add / edit member dialog ─────────────────────────────────────

function MemberDialog({
  member,
  routes,
  onClose,
  onSaved,
}: {
  member?: SalesMemberRow;
  routes: RouteRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();

  const [form, setForm] = React.useState({
    fullName: member?.fullName ?? "",
    phone: member?.phone ?? "",
    username: member?.username ?? "",
    password: "",
    assignedRouteId: member?.assignedRouteId ?? "NONE",
    isActive: member?.isActive ?? true,
  });
  // New members: first 6 sections ON, receipts + override OFF (DEFAULT_SALES_PERMS).
  const [perms, setPerms] = React.useState<SalesPermissions>(member ? permsOf(member) : { ...DEFAULT_SALES_PERMS });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const enabledCount = permCount(perms);

  function setPerm(key: PermKey, v: boolean) {
    setPerms((p) => ({ ...p, [key]: v }));
  }

  async function save() {
    if (!activeFirmId) return;
    if (!form.fullName.trim() || !form.username.trim()) {
      setError("Full name and username are required.");
      return;
    }
    if (form.password && form.password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const username = form.username.trim().toLowerCase();
    const payload: Record<string, unknown> = {
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      username,
      assignedRouteId: form.assignedRouteId === "NONE" ? "" : form.assignedRouteId,
      ...perms,
    };
    if (member) {
      payload.isActive = form.isActive;
      if (form.password) payload.password = form.password;
    } else {
      payload.firmId = activeFirmId;
      payload.password = form.password;
    }
    try {
      if (member) {
        await apiPatch(`/api/v1/sales-team/members/${member.id}`, payload);
        toast({
          title: "Sales member updated",
          description: `@${username} — changes apply on their next screen at /sales.`,
        });
      } else {
        await apiPost("/api/v1/sales-team/members", payload);
        toast({
          title: "Sales member created",
          description: `${form.fullName.trim()} can now sign in at /sales with @${username} and the password you set.`,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-dmk-text-primary">
            {member ? "Edit sales member" : "Add sales member"}
          </DialogTitle>
          <DialogDescription className="text-[12px] text-dmk-text-muted">
            {member
              ? `@${member.username} signs in at /sales — changes apply on their next screen.`
              : "They sign in at /sales with this username + password, and see only the portal sections you switch on below."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Full name *</label>
            <Input
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="e.g. Kirti Patil"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Phone</label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="e.g. 98765 43210"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Username *</label>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))}
              placeholder="e.g. kirti"
              className={cn(inputCls, "lowercase font-mono")}
            />
            <p className="text-[10.5px] text-dmk-text-muted">lowercase — used to sign in at /sales</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
              {member ? "Set new password" : "Password *"}
            </label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={member ? "leave blank to keep current" : "min 4 chars"}
              className={inputCls}
            />
            <p className="text-[10.5px] text-dmk-text-muted">share securely — members change it nowhere</p>
          </div>
          <div className={cn("space-y-1.5", !member && "sm:col-span-2")}>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Assigned route</label>
            <Select value={form.assignedRouteId} onValueChange={(v) => setForm((f) => ({ ...f, assignedRouteId: v }))}>
              <SelectTrigger className="h-9 w-full border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary">
                <SelectValue placeholder="No territory" />
              </SelectTrigger>
              <SelectContent className="border-dmk-border-subtle bg-dmk-bg-secondary text-dmk-text-primary">
                <SelectItem value="NONE">No territory (all routes)</SelectItem>
                {routes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {!r.isActive ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10.5px] text-dmk-text-muted">optional — delivery territory from Trip Planner routes</p>
          </div>
          {member && (
            <div className="flex items-center justify-between rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5 self-end">
              <div>
                <p className="text-[12.5px] font-medium text-dmk-text-primary">Active</p>
                <p className="text-[10.5px] text-dmk-text-muted">Suspended members cannot sign in at /sales.</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                aria-label="Account active"
              />
            </div>
          )}
        </div>

        {/* Section permissions switchboard */}
        <div className="space-y-2 rounded-lg border border-dmk-border-subtle bg-dmk-bg-primary/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">Section permissions</p>
            <span className="dmk-badge dmk-badge-neutral">{enabledCount}/8 sections</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PERM_SECTIONS.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-dmk-text-primary">
                    {p.label}
                    {p.key === "canOverridePrice" && <Badge tone="warning">protected</Badge>}
                  </p>
                  <p className="text-[10.5px] text-dmk-text-muted mt-0.5 leading-snug">{p.desc}</p>
                </div>
                <Switch checked={perms[p.key]} onCheckedChange={(v) => setPerm(p.key, v)} aria-label={p.label} />
              </div>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-dmk-info">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Always hidden from sales: purchases, P&amp;L, bank/CC, GSTR-2B, journals, settings &amp; backups.
          </p>
        </div>

        {error && <ErrorText>{error}</ErrorText>}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            className="h-10 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={busy || !form.fullName.trim() || !form.username.trim() || (!member && form.password.length < 4)}
            className="h-10 bg-dmk-yellow text-dmk-bg-primary hover:bg-dmk-yellow/90 font-bold"
          >
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {busy ? "Saving…" : member ? "Save changes" : "Create member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
