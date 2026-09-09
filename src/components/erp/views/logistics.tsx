"use client";

// ═══════════════════════════════════════════════════════════════
// LOGISTICS — UNASSIGNED ORDERS · TRIP PLANNER · TRIPS & SETTLEMENT
// Owner-side delivery module:
//   A. Unassigned Orders — billed orders waiting for a truck, with
//      live pool totals and multi-select handoff to the planner.
//   B. Trip Planner — route picker (+ route CRUD), order selection,
//      stop sequencing, driver/vehicle, dispatch → print pack
//      (Loading Sheet · Run-Sheet · Bills + OTP) via A4PrintPortal.
//   C. Trips Register — status register with stop-progress, live
//      detail polling (15s while on the road), OTP proof timeline,
//      cash/UPI settlement and trip completion posting.
// API: /api/v1/logistics/* (contract-shaped local types — backend
// built in parallel; shapes documented in worklog Task 5-b).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Banknote,
  Boxes,
  CheckCircle2,
  Circle,
  IndianRupee,
  Loader2,
  MapPinned,
  Package,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Route as RouteIcon,
  Scale,
  Send,
  Smartphone,
  StickyNote,
  Truck,
  Users,
} from "lucide-react";
import { useErpStore } from "@/store/erp-store";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/api-client";
import { formatINR, formatDate } from "@/lib/format";
import {
  PageHeader,
  KpiCard,
  Badge,
  EmptyState,
  LoadingRows,
  SearchInput,
  RegisterRow,
  Money,
} from "@/components/erp/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { A4PrintPortal, printA4 } from "@/components/erp/print-portal";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════
// API CONTRACT TYPES (/api/v1/logistics/*)
// ═══════════════════════════════════════════════════════════════

export interface LogisticsRoute {
  id: string;
  name: string;
  /** Comma-separated town list, e.g. "Wagholi, Shikrapur, Shirur". */
  towns: string;
  startFrom: string;
  endTo: string;
  isActive: boolean;
  tripCount: number;
}

export interface UnassignedOrder {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string | null;
  shopName: string;
  town: string;
  address: string;
  phone: string;
  amount: number;
  paymentMode: string;
  boxes: number;
  loosePieces: number;
  weightKg: number;
  itemCount: number;
}

export interface UnassignedTotals {
  shops: number;
  boxes: number;
  loosePieces: number;
  weightKg: number;
  amount: number;
  expectedCash: number;
  expectedUpi: number;
}

export interface UnassignedResponse {
  route?: { id: string; name: string; towns: string };
  orders: UnassignedOrder[];
  totals: UnassignedTotals;
}

export type TripStatus =
  | "PLANNED"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CLOSED"
  | "CANCELLED";

export interface TripStopItem {
  sku: string;
  productName: string;
  quantity: number;
  boxes: number;
  loosePieces: number;
  weightKg: number;
}

export interface TripStop {
  id: string;
  invoiceId: string;
  /** Bill number — provided on trip detail by the backend (optional, defensive). */
  invoiceNumber?: string;
  sequence: number;
  shopName: string;
  town: string;
  address: string;
  phone: string;
  boxes: number;
  loosePieces: number;
  weightKg: number;
  amount: number;
  expectedMode: string;
  status: "PENDING" | "DELIVERED";
  /** "OTP" | "SIGNATURE" | "" — bill-misplaced fallback proof. */
  deliveryProof: string;
  collectedMode: string;
  collectedAmount: number;
  otpAttempts: number;
  deliveredAt: string | null;
  /** Populated on trip detail only. */
  items?: TripStopItem[];
  /** Delivery OTP — backend may nest it under invoice or flatten it. */
  invoice?: { deliveryOtp?: string | null } | null;
  invoiceDeliveryOtp?: string | null;
}

export interface LogisticsTrip {
  id: string;
  tripNumber: string;
  routeId: string;
  routeName: string;
  driverId: string | null;
  driverName: string;
  vehicleNumber: string;
  status: TripStatus;
  totalStops: number;
  totalBoxes: number;
  totalLoosePieces: number;
  totalWeightKg: number;
  totalAmount: number;
  expectedCash: number;
  expectedUpi: number;
  collectedCash: number;
  collectedUpi: number;
  dispatchedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  stops: TripStop[];
  /** Provided by the trips list endpoint. */
  deliveredStops?: number;
}

/** VerificationStaff row (GET /api/v1/verification/staff — hashes stripped). */
export interface LogisticsStaff {
  id: string;
  name: string;
  username: string;
  role: string;
  isActive: boolean;
}

type Tone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral" | "gold";
type PrintTab = "loading" | "runsheet" | "bills";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const EMPTY_TOTALS: UnassignedTotals = {
  shops: 0,
  boxes: 0,
  loosePieces: 0,
  weightKg: 0,
  amount: 0,
  expectedCash: 0,
  expectedUpi: 0,
};

const STATUS_FILTERS: Array<{ value: "ALL" | TripStatus; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "PLANNED", label: "Planned" },
  { value: "DISPATCHED", label: "Dispatched" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CLOSED", label: "Closed" },
];

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function fmtKg(n: number): string {
  return `${(Math.round(n * 10) / 10).toLocaleString("en-IN")} kg`;
}

function fmtDateTime(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tripTone(status: TripStatus): Tone {
  switch (status) {
    case "PLANNED":
      return "neutral";
    case "DISPATCHED":
      return "warning"; // amber — on the road
    case "IN_PROGRESS":
      return "dr"; // brand yellow — deliveries happening
    case "COMPLETED":
    case "CLOSED":
      return "success";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

function isActiveTrip(status: TripStatus): boolean {
  return status === "DISPATCHED" || status === "IN_PROGRESS";
}

function modeBadge(mode: string) {
  switch (mode) {
    case "CREDIT":
      return <Badge tone="warning">CREDIT</Badge>;
    case "CASH":
      return <Badge tone="success">CASH</Badge>;
    case "UPI":
      return <Badge tone="info">UPI</Badge>;
    case "NEFT":
      return <Badge tone="info">NEFT</Badge>;
    default:
      return <Badge tone="neutral">{mode || "—"}</Badge>;
  }
}

function stopOtp(stop: TripStop): string | null {
  const nested = stop.invoice?.deliveryOtp;
  return nested || stop.invoiceDeliveryOtp || (stop as { deliveryOtp?: string }).deliveryOtp || null;
}

function spacedOtp(otp: string | null): string {
  if (!otp) return "[ — — — — ]";
  return `[ ${otp.split("").join(" ")} ]`;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors",
        active
          ? "border-transparent bg-dmk-yellow font-semibold text-[#0A0F1D]"
          : "border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
      )}
    >
      {children}
    </button>
  );
}

function SplitChips({ cash, upi }: { cash: number; upi: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="dmk-badge dmk-badge-success inline-flex items-center gap-1">
        <Banknote className="h-3 w-3" /> Cash {formatINR(cash)}
      </span>
      <span className="dmk-badge dmk-badge-info inline-flex items-center gap-1">
        <Smartphone className="h-3 w-3" /> UPI {formatINR(upi)}
      </span>
    </div>
  );
}

function refreshIconBtn(onClick: () => void, label: string) {
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={label}
      className="h-9 w-9 p-0 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
      onClick={onClick}
    >
      <RefreshCw className="h-4 w-4" />
    </Button>
  );
}

// ═══════════════════════════════════════════════════════════════
// VIEW A — UNASSIGNED ORDERS (logistics/unassigned)
// ═══════════════════════════════════════════════════════════════

export function LogisticsUnassignedView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const setView = useErpStore((s) => s.setView);
  const seedPlanner = useErpStore((s) => s.seedPlanner);

  const [routes, setRoutes] = React.useState<LogisticsRoute[]>([]);
  const [routeId, setRouteId] = React.useState<string>(""); // "" = all towns
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [data, setData] = React.useState<UnassignedResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(t);
  }, [query]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<{ routes: LogisticsRoute[] }>("/api/v1/logistics/routes", { firmId: activeFirmId })
      .then((r) => {
        if (alive) setRoutes(r.routes ?? []);
      })
      .catch(() => {
        if (alive) setRoutes([]);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    setLoading(true);
    apiGet<UnassignedResponse>("/api/v1/logistics/unassigned-orders", {
      firmId: activeFirmId,
      routeId: routeId || undefined,
      search: debounced.trim() || undefined,
    })
      .then((r) => {
        if (alive) {
          setData(r);
          setSelected(new Set());
        }
      })
      .catch((e) => {
        if (alive) {
          setData({ orders: [], totals: EMPTY_TOTALS });
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load unassigned orders", description: e.message });
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, routeId, debounced, refresh, toast]);

  const orders = data?.orders ?? [];
  const totals: UnassignedTotals = { ...EMPTY_TOTALS, ...(data?.totals ?? {}) };
  const allVisibleSelected = orders.length > 0 && orders.every((o) => selected.has(o.invoiceId));

  function toggleRow(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleAll() {
    setSelected(allVisibleSelected ? new Set() : new Set(orders.map((o) => o.invoiceId)));
  }

  function planTrip() {
    const ids = orders.filter((o) => selected.has(o.invoiceId)).map((o) => o.invoiceId);
    if (ids.length === 0) return;
    const amount = orders
      .filter((o) => selected.has(o.invoiceId))
      .reduce((s, o) => s + o.amount, 0);
    seedPlanner(ids);
    setView("logistics/planner");
    toast({
      title: `${ids.length} order${ids.length === 1 ? "" : "s"} handed to the Trip Planner`,
      description: `${formatINR(amount)} to collect — pick a driver and dispatch.`,
    });
  }

  const selectedAmount = orders
    .filter((o) => selected.has(o.invoiceId))
    .reduce((s, o) => s + o.amount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Unassigned Orders"
        subtitle="Billed orders waiting to be loaded on a delivery trip"
        icon={MapPinned}
        actions={refreshIconBtn(() => setRefresh((r) => r + 1), "Refresh unassigned orders")}
      />

      {/* Sticky totals strip — 6 stat cards, wraps on mobile */}
      <div className="sticky top-14 z-20 -mx-3 border-b border-dmk-border-subtle bg-dmk-bg-primary/95 px-3 py-2.5 backdrop-blur-sm sm:-mx-5 sm:px-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Shops" value={fmtInt(totals.shops)} icon={Users} />
          <KpiCard label="Boxes" value={fmtInt(totals.boxes)} icon={Boxes} />
          <KpiCard label="Loose pcs" value={fmtInt(totals.loosePieces)} icon={Package} />
          <KpiCard label="Weight (kg)" value={fmtKg(totals.weightKg)} icon={Scale} />
          <KpiCard label="Amount to collect" value={formatINR(totals.amount)} icon={IndianRupee} tone="yellow" />
          <div className="dmk-kpi flex flex-col gap-2 p-4">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
              Cash / UPI split
            </span>
            <SplitChips cash={totals.expectedCash} upi={totals.expectedUpi} />
          </div>
        </div>
      </div>

      {/* Route chips + search */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by route">
          <Chip active={routeId === ""} onClick={() => setRouteId("")}>
            All towns
          </Chip>
          {routes.map((r) => (
            <Chip key={r.id} active={routeId === r.id} onClick={() => setRouteId(r.id)}>
              {r.name}
              {!r.isActive && <span className="ml-1 opacity-60">·</span>}
            </Chip>
          ))}
        </div>
        <div className="relative lg:w-72">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search shop, town, invoice…"
            className="pl-9"
          />
          <SearchLens />
        </div>
      </div>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="dmk-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-dmk-text-secondary">
            <span className="font-bold text-dmk-text-primary">{selected.size}</span> order
            {selected.size === 1 ? "" : "s"} selected ·{" "}
            <span className="font-money font-semibold text-dmk-yellow">{formatINR(selectedAmount)}</span> to
            collect
          </p>
          <Button
            className="h-11 bg-dmk-yellow px-4 text-[13px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/90"
            onClick={planTrip}
          >
            Plan trip with {selected.size} order{selected.size === 1 ? "" : "s"} →
          </Button>
        </div>
      )}

      {/* Orders table */}
      <div className="dmk-card overflow-hidden">
        {loading ? (
          <LoadingRows rows={8} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="No unassigned orders"
            hint="Every billed order is already on a trip — new invoices appear here the moment they are posted."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="dmk-table min-w-[980px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <Checkbox
                      aria-label="Select all visible orders"
                      checked={allVisibleSelected}
                      onCheckedChange={toggleAll}
                      className="border-dmk-border-medium data-[state=checked]:bg-dmk-yellow data-[state=checked]:text-[#0A0F1D] data-[state=checked]:border-dmk-yellow"
                    />
                  </th>
                  <th>Invoice</th>
                  <th>Shop</th>
                  <th>Town</th>
                  <th>Mode</th>
                  <th className="text-right">Boxes</th>
                  <th className="text-right">Loose</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const checked = selected.has(o.invoiceId);
                  return (
                    <tr
                      key={o.invoiceId}
                      role="button"
                      tabIndex={0}
                      aria-pressed={checked}
                      onClick={() => toggleRow(o.invoiceId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleRow(o.invoiceId);
                        }
                      }}
                      className={cn(
                        "cursor-pointer transition-colors",
                        checked ? "bg-dmk-hover" : "hover:bg-dmk-hover/60"
                      )}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${o.invoiceNumber}`}
                          checked={checked}
                          onCheckedChange={() => toggleRow(o.invoiceId)}
                          className="h-[18px] w-[18px] border-dmk-border-medium data-[state=checked]:border-dmk-yellow data-[state=checked]:bg-dmk-yellow data-[state=checked]:text-[#0A0F1D]"
                        />
                      </td>
                      <td>
                        <p className="font-money text-[13px] font-semibold">{o.invoiceNumber}</p>
                        <p className="text-[11px] text-dmk-text-muted">{formatDate(o.invoiceDate)}</p>
                      </td>
                      <td className="max-w-[220px] truncate text-[13px] font-medium">{o.shopName}</td>
                      <td className="text-[12.5px] text-dmk-text-secondary">{o.town || "—"}</td>
                      <td>{modeBadge(o.paymentMode)}</td>
                      <td className="num text-[12.5px]">{fmtInt(o.boxes)}</td>
                      <td className="num text-[12.5px]">{fmtInt(o.loosePieces)}</td>
                      <td className="num text-[12.5px] text-dmk-text-secondary">{fmtKg(o.weightKg)}</td>
                      <td className="num text-[13px] font-semibold text-dmk-yellow">{formatINR(o.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchLens() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dmk-text-muted"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// VIEW B — TRIP PLANNER (logistics/planner)
// ═══════════════════════════════════════════════════════════════

export function LogisticsTripPlannerView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const seedPlanner = useErpStore((s) => s.seedPlanner);
  const seedRef = React.useRef<string[]>([]);

  const [routes, setRoutes] = React.useState<LogisticsRoute[] | null>(null);
  const [routeId, setRouteId] = React.useState("");
  const [data, setData] = React.useState<UnassignedResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [seqOrder, setSeqOrder] = React.useState<string[]>([]);
  const [staff, setStaff] = React.useState<LogisticsStaff[]>([]);
  const [driverId, setDriverId] = React.useState("");
  const [vehicle, setVehicle] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [routesOpen, setRoutesOpen] = React.useState(false);
  const [dispatching, setDispatching] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [printPack, setPrintPack] = React.useState<{ tripId: string } | null>(null);

  // Consume the cross-view handoff once (Unassigned Orders → Planner).
  React.useEffect(() => {
    const seed = useErpStore.getState().plannerSeedInvoiceIds;
    if (seed.length > 0) {
      seedRef.current = seed;
      seedPlanner([]);
    }
  }, [seedPlanner]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<{ routes: LogisticsRoute[] }>("/api/v1/logistics/routes", { firmId: activeFirmId })
      .then((r) => {
        if (!alive) return;
        const list = r.routes ?? [];
        setRoutes(list);
        setRouteId((cur) => cur || list.find((x) => x.isActive)?.id || list[0]?.id || "");
      })
      .catch((e) => {
        if (alive) {
          setRoutes([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load routes", description: e.message });
        }
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, refresh, toast]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<LogisticsStaff[]>("/api/v1/verification/staff", { firmId: activeFirmId })
      .then((s) => {
        if (alive) setStaff(Array.isArray(s) ? s : []);
      })
      .catch(() => {
        if (alive) setStaff([]);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId]);

  React.useEffect(() => {
    if (!activeFirmId || !routeId) return;
    let alive = true;
    setLoading(true);
    apiGet<UnassignedResponse>("/api/v1/logistics/unassigned-orders", {
      firmId: activeFirmId,
      routeId,
    })
      .then((r) => {
        if (!alive) return;
        setData(r);
        const present = new Set((r.orders ?? []).map((o) => o.invoiceId));
        // Prune stale selections, then apply the cross-view seed.
        setSelected((prev) => new Set([...prev].filter((id) => present.has(id))));
        setSeqOrder((prev) => prev.filter((id) => present.has(id)));
        const seed = seedRef.current;
        if (seed.length > 0) {
          seedRef.current = [];
          const usable = seed.filter((id) => present.has(id));
          if (usable.length < seed.length) {
            toast({
              title: "Some orders are on other routes",
              description: `${seed.length - usable.length} of ${seed.length} picked order(s) do not belong to this route — plan them separately.`,
            });
          }
          setSelected(new Set(usable));
          setSeqOrder(usable);
        }
      })
      .catch((e) => {
        if (alive) {
          setData({ orders: [], totals: EMPTY_TOTALS });
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load orders for this route", description: e.message });
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, routeId, refresh, toast]);

  const orders = data?.orders ?? [];
  const byId = React.useMemo(
    () => new Map(orders.map((o) => [o.invoiceId, o])),
    [orders]
  );
  const sequenced = seqOrder
    .map((id) => byId.get(id))
    .filter((o): o is UnassignedOrder => Boolean(o));

  // Driver dropdown — real drivers first; fall back to all active staff.
  const drivers = React.useMemo(() => {
    const drv = staff.filter((s) => s.isActive && s.role === "DRIVER");
    return drv.length > 0 ? drv : staff.filter((s) => s.isActive);
  }, [staff]);

  const totals = React.useMemo(() => {
    let shops = 0;
    let boxes = 0;
    let loose = 0;
    let weight = 0;
    let amount = 0;
    let cash = 0;
    let upi = 0;
    for (const o of orders) {
      if (!selected.has(o.invoiceId)) continue;
      shops += 1;
      boxes += o.boxes;
      loose += o.loosePieces;
      weight += o.weightKg;
      amount += o.amount;
      if (o.paymentMode === "CASH") cash += o.amount;
      if (o.paymentMode === "UPI") upi += o.amount;
    }
    return { shops, boxes, loose, weight, amount, cash, upi };
  }, [orders, selected]);

  function toggleSelect(id: string) {
    if (selected.has(id)) {
      const n = new Set(selected);
      n.delete(id);
      setSelected(n);
      setSeqOrder(seqOrder.filter((x) => x !== id));
    } else {
      const n = new Set(selected);
      n.add(id);
      setSelected(n);
      setSeqOrder([...seqOrder, id]);
    }
  }

  function changeRoute(v: string) {
    setRouteId(v);
    setSelected(new Set());
    setSeqOrder([]);
  }

  function moveStop(id: string, dir: -1 | 1) {
    const idx = seqOrder.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= seqOrder.length) return;
    const arr = [...seqOrder];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setSeqOrder(arr);
  }

  async function dispatchTrip() {
    if (!activeFirmId || !routeId) return;
    if (!driverId || !vehicle.trim() || sequenced.length === 0) return;
    setDispatching(true);
    try {
      const driver = staff.find((s) => s.id === driverId);
      const stops = sequenced.map((o, i) => ({ invoiceId: o.invoiceId, sequence: i + 1 }));
      const res = await apiPost<{ trip: LogisticsTrip }>("/api/v1/logistics/trips", {
        firmId: activeFirmId,
        routeId,
        driverId,
        driverName: driver?.name ?? "",
        vehicleNumber: vehicle.trim(),
        notes: notes.trim() || undefined,
        stops,
      });
      const trip = res.trip;
      await apiPost<{ trip?: LogisticsTrip }>(`/api/v1/logistics/trips/${trip.id}/dispatch`, {
        firmId: activeFirmId,
      });
      toast({
        title: "Trip dispatched",
        description: `${trip.tripNumber} is on the road — ${stops.length} stops · ${formatINR(totals.amount)} to collect.`,
      });
      setPrintPack({ tripId: trip.id });
      setSelected(new Set());
      setSeqOrder([]);
      setNotes("");
      setVehicle("");
      setDriverId("");
      setRefresh((r) => r + 1);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Dispatch failed",
        description:
          e instanceof ApiError
            ? e.message
            : "Could not dispatch this trip — check the Trips register for a stuck PLANNED trip.",
      });
      setRefresh((r) => r + 1);
    } finally {
      setDispatching(false);
    }
  }

  const canDispatch = Boolean(routeId && driverId && vehicle.trim()) && sequenced.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trip Planner"
        subtitle="Pick orders, sequence the stops, dispatch and print the pack"
        icon={RouteIcon}
        actions={
          <>
            {refreshIconBtn(() => setRefresh((r) => r + 1), "Refresh planner")}
            <Button
              size="sm"
              variant="outline"
              className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
              onClick={() => setRoutesOpen(true)}
            >
              <Truck className="h-4 w-4" /> Manage routes
            </Button>
          </>
        }
      />

      {routes !== null && routes.length === 0 ? (
        <EmptyState
          icon={RouteIcon}
          title="No delivery routes yet"
          hint="Create your first route — name it and list the towns it covers, e.g. “Nagar Route: Wagholi, Shikrapur, Shirur”."
          action={
            <Button
              className="h-10 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90"
              onClick={() => setRoutesOpen(true)}
            >
              <Plus className="h-4 w-4" /> Manage routes
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          {/* LEFT — route bar + orders table */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="dmk-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <RouteIcon className="h-4 w-4 shrink-0 text-dmk-yellow" strokeWidth={1.75} />
                <Select value={routeId || undefined} onValueChange={changeRoute}>
                  <SelectTrigger className="h-9 w-full min-w-[220px] border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary sm:w-[280px]">
                    <SelectValue placeholder="Choose a route" />
                  </SelectTrigger>
                  <SelectContent className="border-dmk-border-subtle bg-[#111c32] text-dmk-text-primary">
                    {(routes ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                        {r.towns ? ` — ${r.towns.split(",").length} towns` : ""}
                        {!r.isActive ? " (inactive)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {data?.route?.towns ? (
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-dmk-text-muted">
                  Towns: {data.route.towns}
                </p>
              ) : null}
            </div>

            <div className="dmk-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-dmk-border-subtle px-4 py-2.5">
                <h2 className="text-[13px] font-bold text-dmk-text-primary">Unassigned orders</h2>
                <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
                  {selected.size} selected
                </span>
              </div>
              {loading ? (
                <LoadingRows rows={6} />
              ) : orders.length === 0 ? (
                <EmptyState
                  icon={PackageOpen}
                  title="Nothing waiting on this route"
                  hint="Every billed order for this route is already on a trip. Switch routes or check the Trips register."
                />
              ) : (
                <div className="max-h-[calc(100vh-420px)] overflow-y-auto overflow-x-auto">
                  <table className="dmk-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th className="w-10" />
                        <th>Invoice</th>
                        <th>Shop</th>
                        <th>Town</th>
                        <th>Mode</th>
                        <th className="text-right">Boxes</th>
                        <th className="text-right">Weight</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const checked = selected.has(o.invoiceId);
                        return (
                          <tr
                            key={o.invoiceId}
                            className={cn(
                              "cursor-pointer transition-colors",
                              checked ? "bg-dmk-hover" : "hover:bg-dmk-hover/60"
                            )}
                            onClick={() => toggleSelect(o.invoiceId)}
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                aria-label={`Select ${o.invoiceNumber}`}
                                checked={checked}
                                onCheckedChange={() => toggleSelect(o.invoiceId)}
                                className="h-[18px] w-[18px] border-dmk-border-medium data-[state=checked]:border-dmk-yellow data-[state=checked]:bg-dmk-yellow data-[state=checked]:text-[#0A0F1D]"
                              />
                            </td>
                            <td>
                              <p className="font-money text-[12.5px] font-semibold">{o.invoiceNumber}</p>
                              <p className="text-[10.5px] text-dmk-text-muted">{formatDate(o.invoiceDate)}</p>
                            </td>
                            <td className="max-w-[200px] truncate text-[12.5px] font-medium">{o.shopName}</td>
                            <td className="text-[12px] text-dmk-text-secondary">{o.town || "—"}</td>
                            <td>{modeBadge(o.paymentMode)}</td>
                            <td className="num text-[12.5px]">
                              {fmtInt(o.boxes)}
                              {o.loosePieces > 0 ? (
                                <span className="text-dmk-text-muted"> +{fmtInt(o.loosePieces)} loose</span>
                              ) : null}
                            </td>
                            <td className="num text-[12px] text-dmk-text-secondary">{fmtKg(o.weightKg)}</td>
                            <td className="num text-[12.5px] font-semibold">{formatINR(o.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — dispatch panel */}
          <aside className="flex min-w-0 flex-col gap-4">
            {/* Live totals */}
            <section className="dmk-card p-4" aria-label="Selected order totals">
              <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                Trip totals — selected
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
                <TotalRow label="Shops" value={fmtInt(totals.shops)} />
                <TotalRow label="Boxes" value={fmtInt(totals.boxes)} />
                <TotalRow label="Loose pcs" value={fmtInt(totals.loose)} />
                <TotalRow label="Weight" value={fmtKg(totals.weight)} />
                <div className="col-span-2 border-t border-dmk-border-subtle pt-2.5">
                  <TotalRow label="Amount to collect" value={formatINR(totals.amount)} strong />
                </div>
                <div className="col-span-2">
                  <SplitChips cash={totals.cash} upi={totals.upi} />
                </div>
              </div>
            </section>

            {/* Driver / vehicle / notes */}
            <section className="dmk-card space-y-3 p-4" aria-label="Trip assignment">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                Driver & vehicle
              </h3>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                  Driver
                </label>
                <Select
                  value={driverId || undefined}
                  onValueChange={(v) => setDriverId(v)}
                >
                  <SelectTrigger className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary">
                    <SelectValue placeholder={drivers.length === 0 ? "No staff yet — add in Settings" : "Select driver"} />
                  </SelectTrigger>
                  <SelectContent className="border-dmk-border-subtle bg-[#111c32] text-dmk-text-primary">
                    {drivers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.role !== "DRIVER" ? ` (${s.role.toLowerCase()})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                  Vehicle number
                </label>
                <Input
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                  placeholder="MH-12 AB 1234"
                  className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                  <StickyNote className="h-3 w-3" /> Trip notes (optional)
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Collect empty crates from Shirur"
                  className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
                />
              </div>
            </section>

            {/* Stop sequence */}
            <section className="dmk-card p-4" aria-label="Stop sequence">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                  Stop sequence
                </h3>
                <span className="text-[11px] text-dmk-text-muted">{sequenced.length} stops</span>
              </div>
              {sequenced.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-dmk-text-muted">
                  Tick orders on the left — they appear here in drop order.
                </p>
              ) : (
                <ol className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
                  {sequenced.map((o, idx) => (
                    <li
                      key={o.invoiceId}
                      className="flex items-center gap-2 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-2.5 py-2"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-yellow text-[11px] font-bold text-[#0A0F1D]">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-dmk-text-primary">{o.shopName}</p>
                        <p className="truncate text-[10.5px] text-dmk-text-muted">
                          {o.town || "—"} · {o.invoiceNumber}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${o.shopName} up`}
                          disabled={idx === 0}
                          className="flex h-11 w-11 items-center justify-center rounded-md text-dmk-text-secondary transition-colors hover:bg-dmk-hover hover:text-dmk-text-primary disabled:opacity-30"
                          onClick={() => moveStop(o.invoiceId, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${o.shopName} down`}
                          disabled={idx === sequenced.length - 1}
                          className="flex h-11 w-11 items-center justify-center rounded-md text-dmk-text-secondary transition-colors hover:bg-dmk-hover hover:text-dmk-text-primary disabled:opacity-30"
                          onClick={() => moveStop(o.invoiceId, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <Button
              className="h-11 bg-dmk-yellow text-[14px] font-bold text-[#0A0F1D] hover:bg-dmk-yellow/90"
              disabled={!canDispatch || dispatching}
              onClick={dispatchTrip}
            >
              {dispatching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {dispatching ? "Dispatching…" : "Dispatch Trip"}
            </Button>
          </aside>
        </div>
      )}

      <ManageRoutesDialog open={routesOpen} onOpenChange={setRoutesOpen} routes={routes ?? []} onChanged={() => setRefresh((r) => r + 1)} />

      {printPack && (
        <TripPrintPackDialog
          tripId={printPack.tripId}
          open={Boolean(printPack)}
          onOpenChange={(v) => {
            if (!v) setPrintPack(null);
          }}
        />
      )}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dmk-text-muted">{label}</span>
      <span
        className={cn(
          "font-money tabular-nums",
          strong ? "text-[15px] font-bold text-dmk-yellow" : "font-semibold text-dmk-text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MANAGE ROUTES DIALOG (CRUD)
// ═══════════════════════════════════════════════════════════════

function ManageRoutesDialog({
  open,
  onOpenChange,
  routes,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  routes: LogisticsRoute[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editOf, setEditOf] = React.useState<LogisticsRoute | null>(null);
  const [name, setName] = React.useState("");
  const [towns, setTowns] = React.useState("");
  const [startFrom, setStartFrom] = React.useState("");
  const [endTo, setEndTo] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [deleteOf, setDeleteOf] = React.useState<LogisticsRoute | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  function openNew() {
    setEditOf(null);
    setName("");
    setTowns("");
    setStartFrom("");
    setEndTo("");
    setIsActive(true);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(r: LogisticsRoute) {
    setEditOf(r);
    setName(r.name);
    setTowns(r.towns ?? "");
    setStartFrom(r.startFrom ?? "");
    setEndTo(r.endTo ?? "");
    setIsActive(r.isActive);
    setFormError(null);
    setFormOpen(true);
  }

  async function saveRoute() {
    if (!activeFirmId) return;
    if (!name.trim()) {
      setFormError("Route name is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      firmId: activeFirmId,
      name: name.trim(),
      towns: towns
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(", "),
      startFrom: startFrom.trim(),
      endTo: endTo.trim(),
      isActive,
    };
    try {
      if (editOf) {
        await apiPatch<LogisticsRoute>(`/api/v1/logistics/routes/${editOf.id}?firmId=${activeFirmId}`, payload);
        toast({ title: "Route updated", description: `“${payload.name}” saved.` });
      } else {
        await apiPost<LogisticsRoute>("/api/v1/logistics/routes", payload);
        toast({ title: "Route created", description: `“${payload.name}” is ready for trip planning.` });
      }
      setFormOpen(false);
      onChanged();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not save this route.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteOf || !activeFirmId) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/v1/logistics/routes/${deleteOf.id}?firmId=${activeFirmId}`);
      toast({
        title: "Route deleted",
        description: `“${deleteOf.name}” removed. Trips already planned on it are untouched.`,
      });
      setDeleteOf(null);
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof ApiError ? e.message : "Could not delete this route.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary">Delivery routes</DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              Routes group towns into a truck run — orders are planned per route.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {routes.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-dmk-text-muted">No routes yet.</p>
            ) : (
              routes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-dmk-text-primary">
                      {r.name}
                      <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                    </p>
                    <p className="truncate text-[11px] text-dmk-text-muted">
                      {r.towns || "No towns listed"}
                      {r.startFrom ? ` · ${r.startFrom} → ${r.endTo || "—"}` : ""}
                      {` · ${r.tripCount} trip${r.tripCount === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                    onClick={() => openEdit(r)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 border-dmk-border-subtle text-dmk-danger/80 hover:bg-dmk-hover hover:text-dmk-danger"
                    onClick={() => setDeleteOf(r)}
                  >
                    Delete
                  </Button>
                </div>
              ))
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" onClick={openNew}>
              <Plus className="h-4 w-4" /> New route
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / edit form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary">{editOf ? "Edit route" : "New route"}</DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              List the towns in delivery order — the planner shows unassigned orders per route.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                Route name *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nagar Route"
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                Towns (comma separated)
              </label>
              <Textarea
                value={towns}
                onChange={(e) => setTowns(e.target.value)}
                placeholder="Wagholi, Shikrapur, Shirur, Ahmednagar"
                rows={3}
                className="border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                  Start from
                </label>
                <Input
                  value={startFrom}
                  onChange={(e) => setStartFrom(e.target.value)}
                  placeholder="Warehouse, Pune"
                  className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                  End at
                </label>
                <Input
                  value={endTo}
                  onChange={(e) => setEndTo(e.target.value)}
                  placeholder="Back at warehouse"
                  className="h-9 border-dmk-border-subtle bg-dmk-input-well text-[13px] text-dmk-text-primary dmk-input"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5">
              <div>
                <p className="text-[12.5px] font-medium text-dmk-text-primary">Active</p>
                <p className="text-[10.5px] text-dmk-text-muted">Inactive routes stay out of the planner dropdown default.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            {formError && (
              <p className="rounded-md border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-dmk-danger">
                {formError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button className="h-9 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90" disabled={saving} onClick={saveRoute}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editOf ? "Save changes" : "Create route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={Boolean(deleteOf)} onOpenChange={(v) => !v && setDeleteOf(null)}>
        <AlertDialogContent className="border-dmk-border-subtle bg-[#111c32]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Delete “{deleteOf?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              Trips already planned on this route are not affected. Orders on future runs will need another route.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Delete route
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// VIEW C — TRIPS REGISTER (logistics/trips)
// ═══════════════════════════════════════════════════════════════

export function LogisticsTripsRegisterView() {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [trips, setTrips] = React.useState<LogisticsTrip[] | null>(null);
  const [status, setStatus] = React.useState<"ALL" | TripStatus>("ALL");
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [printPack, setPrintPack] = React.useState<{ tripId: string } | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(t);
  }, [query]);

  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    apiGet<{ trips: LogisticsTrip[] }>("/api/v1/logistics/trips", {
      firmId: activeFirmId,
      status: status === "ALL" ? undefined : status,
      search: debounced.trim() || undefined,
    })
      .then((r) => {
        if (alive) setTrips(r.trips ?? []);
      })
      .catch((e) => {
        if (alive) {
          setTrips([]);
          if (e instanceof ApiError)
            toast({ variant: "destructive", title: "Could not load trips", description: e.message });
        }
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, status, debounced, refresh, toast]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trips & Settlement"
        subtitle="Live delivery trips, proof of delivery and cash settlement"
        icon={Truck}
        actions={refreshIconBtn(() => setRefresh((r) => r + 1), "Refresh trips")}
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by trip status">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.value} active={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="relative lg:w-72">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search trip #, route, driver, vehicle…"
            className="pl-9"
          />
          <SearchLens />
        </div>
      </div>

      <div className="dmk-card overflow-hidden">
        {trips === null ? (
          <LoadingRows rows={7} />
        ) : trips.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No trips here yet"
            hint="Plan a trip from the Trip Planner — pick unassigned orders, add a driver and dispatch."
          />
        ) : (
          <div className="divide-y divide-dmk-border-subtle">
            {trips.map((t) => {
              const delivered = t.deliveredStops ?? t.stops.filter((s) => s.status === "DELIVERED").length;
              const pct = t.totalStops > 0 ? Math.round((delivered / t.totalStops) * 100) : 0;
              return (
                <RegisterRow key={t.id} onClick={() => setDetailId(t.id)}>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="min-w-[130px]">
                      <p className="font-money text-[13.5px] font-bold text-dmk-text-primary">{t.tripNumber}</p>
                      <p className="truncate text-[11px] text-dmk-text-muted">{t.routeName}</p>
                    </div>
                    <div className="min-w-[130px]">
                      <p className="truncate text-[12.5px] text-dmk-text-secondary">{t.driverName || "—"}</p>
                      <p className="truncate text-[11px] text-dmk-text-muted">{t.vehicleNumber || "No vehicle"}</p>
                    </div>
                    <div className="min-w-[150px] max-w-[210px] flex-1">
                      <div className="flex items-center justify-between text-[11px] text-dmk-text-muted">
                        <span>
                          {delivered}/{t.totalStops} delivered
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <Progress
                        value={pct}
                        aria-label={`${delivered} of ${t.totalStops} stops delivered`}
                        className="mt-1 h-1.5 bg-dmk-input-well [&>[data-slot=progress-indicator]]:bg-dmk-yellow"
                      />
                    </div>
                    <Badge tone={tripTone(t.status)}>{t.status}</Badge>
                    <div className="ml-auto flex items-center gap-4">
                      <Money value={t.totalAmount} className="text-[13px] font-semibold text-dmk-yellow" />
                      <span className="w-[110px] text-right text-[11px] text-dmk-text-muted">
                        {t.dispatchedAt ? `Disp. ${fmtDateTime(t.dispatchedAt)}` : `Created ${formatDate(t.createdAt)}`}
                      </span>
                    </div>
                  </div>
                </RegisterRow>
              );
            })}
          </div>
        )}
      </div>

      {detailId && (
        <TripDetailDialog
          tripId={detailId}
          open={Boolean(detailId)}
          onOpenChange={(v) => {
            if (!v) setDetailId(null);
          }}
          onChanged={() => setRefresh((r) => r + 1)}
          onOpenPrintPack={(tripId) => setPrintPack({ tripId })}
        />
      )}

      {printPack && (
        <TripPrintPackDialog
          tripId={printPack.tripId}
          open={Boolean(printPack)}
          onOpenChange={(v) => {
            if (!v) setPrintPack(null);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRIP DETAIL DIALOG (timeline + polling + settlement + actions)
// ═══════════════════════════════════════════════════════════════

function TripDetailDialog({
  tripId,
  open,
  onOpenChange,
  onChanged,
  onOpenPrintPack,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  onOpenPrintPack: (tripId: string) => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [trip, setTrip] = React.useState<LogisticsTrip | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [staff, setStaff] = React.useState<LogisticsStaff[]>([]);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editDriverId, setEditDriverId] = React.useState("");
  const [editVehicle, setEditVehicle] = React.useState("");
  const [savingEdit, setSavingEdit] = React.useState(false);

  const [dispatching, setDispatching] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);

  const load = React.useCallback(
    async (silent: boolean) => {
      if (!activeFirmId || !tripId) return;
      if (!silent) setLoading(true);
      try {
        const r = await apiGet<{ trip: LogisticsTrip }>(`/api/v1/logistics/trips/${tripId}`, {
          firmId: activeFirmId,
        });
        setTrip(r.trip);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load this trip.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeFirmId, tripId]
  );

  React.useEffect(() => {
    if (open) load(false);
  }, [open, load]);

  // Reset transient state when the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setTrip(null);
      setError(null);
      setEditOpen(false);
    }
  }, [open]);

  // Driver directory for the PLANNED-trip edit form.
  React.useEffect(() => {
    if (!open || !activeFirmId) return;
    let alive = true;
    apiGet<LogisticsStaff[]>("/api/v1/verification/staff", { firmId: activeFirmId })
      .then((s) => {
        if (alive) setStaff(Array.isArray(s) ? s : []);
      })
      .catch(() => {
        if (alive) setStaff([]);
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId]);

  // Auto-poll every 15s while the trip is on the road.
  React.useEffect(() => {
    if (!open || !trip || !isActiveTrip(trip.status)) return;
    const iv = setInterval(() => {
      load(true);
    }, 15000);
    return () => clearInterval(iv);
  }, [open, trip, load]);

  const drivers = React.useMemo(() => {
    const drv = staff.filter((s) => s.isActive && s.role === "DRIVER");
    return drv.length > 0 ? drv : staff.filter((s) => s.isActive);
  }, [staff]);

  const isPlanned = trip?.status === "PLANNED";
  const allDelivered = Boolean(trip && trip.stops.length > 0 && trip.stops.every((s) => s.status === "DELIVERED"));
  const settleVisible = Boolean(
    trip && (allDelivered || trip.status === "COMPLETED" || trip.status === "CLOSED") && trip.status !== "CANCELLED"
  );
  const canComplete = Boolean(
    trip && (allDelivered || trip.status === "COMPLETED") && trip.status !== "CLOSED" && trip.status !== "CANCELLED"
  );

  async function dispatchNow() {
    if (!activeFirmId || !trip) return;
    setDispatching(true);
    try {
      await apiPost<{ trip?: LogisticsTrip }>(`/api/v1/logistics/trips/${trip.id}/dispatch`, {
        firmId: activeFirmId,
      });
      toast({ title: "Trip dispatched", description: `${trip.tripNumber} is on the road.` });
      await load(true);
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Dispatch failed",
        description: e instanceof ApiError ? e.message : "Could not dispatch this trip.",
      });
    } finally {
      setDispatching(false);
    }
  }

  async function saveEdit() {
    if (!activeFirmId || !trip) return;
    const driver = staff.find((s) => s.id === editDriverId);
    setSavingEdit(true);
    try {
      await apiPatch<LogisticsTrip>(`/api/v1/logistics/trips/${trip.id}?firmId=${activeFirmId}`, {
        firmId: activeFirmId,
        driverId: editDriverId || undefined,
        driverName: driver?.name ?? undefined,
        vehicleNumber: editVehicle.trim() || undefined,
      });
      toast({ title: "Trip updated", description: "Driver and vehicle saved." });
      setEditOpen(false);
      await load(true);
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof ApiError ? e.message : "Could not update this trip.",
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function cancelTrip() {
    if (!activeFirmId || !trip) return;
    setCancelling(true);
    try {
      await apiDelete(`/api/v1/logistics/trips/${trip.id}?firmId=${activeFirmId}`);
      toast({
        title: "Trip cancelled",
        description: `${trip.totalStops} order${trip.totalStops === 1 ? "" : "s"} returned to the unassigned pool.`,
      });
      setCancelOpen(false);
      onOpenChange(false);
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Cancel failed",
        description: e instanceof ApiError ? e.message : "Could not cancel this trip.",
      });
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  }

  async function completeTrip() {
    if (!activeFirmId || !trip) return;
    setCompleting(true);
    try {
      const res = await apiPost<{ trip?: LogisticsTrip }>(`/api/v1/logistics/trips/${trip.id}/complete`, {
        firmId: activeFirmId,
      });
      const cash = res.trip?.collectedCash ?? trip.collectedCash;
      toast({ title: `Trip closed — ${formatINR(cash)} posted to cash book` });
      setCompleteOpen(false);
      await load(true);
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not close the trip",
        description: e instanceof ApiError ? e.message : "Settlement failed — try again.",
      });
      setCompleteOpen(false);
    } finally {
      setCompleting(false);
    }
  }

  const variance = trip ? trip.collectedCash + trip.collectedUpi - (trip.expectedCash + trip.expectedUpi) : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-dmk-text-primary">
              <span className="font-money">{trip?.tripNumber ?? "Trip"}</span>
              {trip && <Badge tone={tripTone(trip.status)}>{trip.status}</Badge>}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {trip
                ? `${trip.routeName} · ${trip.driverName || "No driver"} · ${trip.vehicleNumber || "No vehicle"}`
                : "Loading trip…"}
              {trip && isActiveTrip(trip.status) && (
                <span className="ml-1 inline-flex items-center gap-1 text-dmk-yellow">
                  <Loader2 className="h-3 w-3 animate-spin" /> live — refreshing every 15s
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {loading && !trip ? (
            <LoadingRows rows={5} />
          ) : error ? (
            <p className="rounded-md border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-dmk-danger">
              {error}
            </p>
          ) : trip ? (
            <div className="space-y-4">
              {/* Stop timeline */}
              <ol className="space-y-1.5" aria-label="Delivery stops">
                {trip.stops.map((s) => {
                  const delivered = s.status === "DELIVERED";
                  return (
                    <li
                      key={s.id}
                      className="flex items-start gap-3 rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5"
                    >
                      <div className="flex flex-col items-center gap-1 pt-0.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-hover text-[11px] font-bold text-dmk-text-secondary">
                          {s.sequence}
                        </span>
                        {delivered ? (
                          <CheckCircle2 className="h-4 w-4 text-dmk-success" aria-label="Delivered" />
                        ) : (
                          <Circle className="h-4 w-4 text-dmk-text-disabled" aria-label="Pending" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-dmk-text-primary">
                          {s.shopName}
                          {s.deliveryProof === "OTP" && <Badge tone="info">OTP</Badge>}
                          {s.deliveryProof === "SIGNATURE" && <Badge tone="neutral">SIGNATURE</Badge>}
                        </p>
                        <p className="text-[11.5px] text-dmk-text-muted">
                          {s.town || "—"}
                          {s.address ? ` · ${s.address}` : ""}
                          {s.phone ? ` · ${s.phone}` : ""}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-dmk-text-secondary">
                          {s.boxes} boxes · {s.loosePieces} loose · {fmtKg(s.weightKg)} ·{" "}
                          <span className="font-money font-semibold text-dmk-yellow">{formatINR(s.amount)}</span>{" "}
                          <span className="text-dmk-text-muted">({s.expectedMode})</span>
                        </p>
                        {delivered && (
                          <p className="mt-0.5 text-[11px] text-dmk-success">
                            Delivered {fmtDateTime(s.deliveredAt)}
                            {s.collectedAmount > 0
                              ? ` · collected ${formatINR(s.collectedAmount)}${s.collectedMode ? ` via ${s.collectedMode}` : ""}`
                              : ""}
                            {s.otpAttempts > 0 ? ` · ${s.otpAttempts} OTP attempt${s.otpAttempts === 1 ? "" : "s"}` : ""}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Settlement panel */}
              {settleVisible && (
                <section className="dmk-well rounded-lg border border-dmk-border-subtle p-4" aria-label="Cash settlement">
                  <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-dmk-text-muted">
                    Settlement
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <SettleRow
                      label="Cash"
                      expected={trip.expectedCash}
                      collected={trip.collectedCash}
                      icon={<Banknote className="h-3.5 w-3.5" />}
                    />
                    <SettleRow
                      label="UPI"
                      expected={trip.expectedUpi}
                      collected={trip.collectedUpi}
                      icon={<Smartphone className="h-3.5 w-3.5" />}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-dmk-border-subtle pt-2.5 text-[12.5px]">
                    <span className="text-dmk-text-muted">Total variance</span>
                    <span
                      className={cn(
                        "font-money font-bold",
                        Math.abs(variance) < 0.005 ? "text-dmk-success" : variance > 0 ? "text-dmk-success" : "text-dmk-danger"
                      )}
                    >
                      {variance > 0.005 ? "+" : ""}
                      {formatINR(variance)}
                    </span>
                  </div>
                  {trip.status === "CLOSED" && (
                    <p className="mt-2 text-[11.5px] text-dmk-success">
                      Trip closed {fmtDateTime(trip.closedAt)} — cash posted to the books.
                    </p>
                  )}
                  {canComplete && (
                    <Button
                      className="mt-3 h-11 w-full bg-dmk-yellow text-[13.5px] font-bold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                      disabled={completing}
                      onClick={() => setCompleteOpen(true)}
                    >
                      {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Complete Trip &amp; Post Cash
                    </Button>
                  )}
                </section>
              )}

              {/* Trip-level footer stats */}
              <div className="dmk-well flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg px-4 py-2.5 text-[11.5px] text-dmk-text-muted">
                <span>{trip.totalStops} stops</span>
                <span>{fmtInt(trip.totalBoxes)} boxes</span>
                <span>{fmtInt(trip.totalLoosePieces)} loose</span>
                <span>{fmtKg(trip.totalWeightKg)}</span>
                <span className="font-money text-dmk-text-secondary">{formatINR(trip.totalAmount)} total</span>
                {trip.dispatchedAt && <span>Dispatched {fmtDateTime(trip.dispatchedAt)}</span>}
              </div>

              {/* PLANNED actions */}
              {isPlanned && (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {!editOpen ? (
                    <Button
                      variant="outline"
                      className="h-11 flex-1 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                      onClick={() => {
                        setEditDriverId(trip.driverId ?? "");
                        setEditVehicle(trip.vehicleNumber ?? "");
                        setEditOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" /> Edit driver / vehicle
                    </Button>
                  ) : (
                    <div className="flex-1 space-y-2 rounded-lg border border-dmk-border-subtle bg-dmk-input-well p-3">
                      <Select value={editDriverId || undefined} onValueChange={setEditDriverId}>
                        <SelectTrigger className="h-9 border-dmk-border-subtle bg-transparent text-[13px] text-dmk-text-primary">
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                        <SelectContent className="border-dmk-border-subtle bg-[#111c32] text-dmk-text-primary">
                          {drivers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                              {s.role !== "DRIVER" ? ` (${s.role.toLowerCase()})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={editVehicle}
                        onChange={(e) => setEditVehicle(e.target.value.toUpperCase())}
                        placeholder="Vehicle number"
                        className="h-9 border-dmk-border-subtle bg-transparent text-[13px] text-dmk-text-primary dmk-input"
                      />
                      <div className="flex gap-2">
                        <Button
                          className="h-9 flex-1 bg-dmk-yellow text-[12.5px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                          disabled={savingEdit}
                          onClick={saveEdit}
                        >
                          {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />} Save
                        </Button>
                        <Button
                          variant="outline"
                          className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                          onClick={() => setEditOpen(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  <Button
                    className="h-11 flex-1 bg-dmk-yellow text-[13px] font-bold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                    disabled={dispatching}
                    onClick={dispatchNow}
                  >
                    {dispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Dispatch now
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 flex-1 border-dmk-border-subtle text-dmk-danger/90 hover:bg-dmk-hover hover:text-dmk-danger"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-4 w-4" /> Cancel trip
                  </Button>
                </div>
              )}

              {/* Print pack — reopen for active/completed trips */}
              {isActiveTrip(trip.status) && (
                <Button
                  variant="outline"
                  className="h-11 w-full border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                  onClick={() => onOpenPrintPack(trip.id)}
                >
                  <Printer className="h-4 w-4" /> Open print pack (loading sheet · run-sheet · bills + OTP)
                </Button>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="border-dmk-border-subtle bg-[#111c32]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Cancel {trip?.tripNumber}?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              All {trip?.totalStops ?? 0} order(s) on this trip return to the unassigned pool and can be planned
              again. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Keep trip
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-dmk-danger text-white hover:bg-dmk-danger/90"
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault();
                cancelTrip();
              }}
            >
              {cancelling && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Cancel trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete confirm */}
      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent className="border-dmk-border-subtle bg-[#111c32]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-dmk-text-primary">Close {trip?.tripNumber} and post cash?</AlertDialogTitle>
            <AlertDialogDescription className="text-dmk-text-muted">
              Collected cash {formatINR(trip?.collectedCash ?? 0)} posts to the cash book and UPI{" "}
              {formatINR(trip?.collectedUpi ?? 0)} to the bank. Expected was{" "}
              {formatINR((trip?.expectedCash ?? 0) + (trip?.expectedUpi ?? 0))}. This settles the trip permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-dmk-border-subtle bg-transparent text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary">
              Not yet
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-dmk-yellow font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/90"
              disabled={completing}
              onClick={(e) => {
                e.preventDefault();
                completeTrip();
              }}
            >
              {completing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Complete Trip &amp; Post Cash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SettleRow({
  label,
  expected,
  collected,
  icon,
}: {
  label: string;
  expected: number;
  collected: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">
        {icon} {label}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-dmk-text-muted">Expected {formatINR(expected)}</span>
        <span className="font-money text-[14px] font-bold text-dmk-text-primary">{formatINR(collected)}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PRINT PACK — Loading Sheet · Run-Sheet · Bills + OTP
// ═══════════════════════════════════════════════════════════════

interface RollupRow {
  key: string;
  sku: string;
  productName: string;
  boxes: number;
  loose: number;
  qty: number;
  weightKg: number;
}

function TripPrintPackDialog({
  tripId,
  open,
  onOpenChange,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [trip, setTrip] = React.useState<LogisticsTrip | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<PrintTab>("loading");
  const [singleStopId, setSingleStopId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !activeFirmId || !tripId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setTrip(null);
    apiGet<{ trip: LogisticsTrip }>(`/api/v1/logistics/trips/${tripId}`, { firmId: activeFirmId })
      .then((r) => {
        if (alive) setTrip(r.trip);
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load the print pack.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, activeFirmId, tripId]);

  React.useEffect(() => {
    if (!open) {
      setTrip(null);
      setError(null);
      setTab("loading");
      setSingleStopId(null);
    }
  }, [open]);

  const rollup = React.useMemo<RollupRow[]>(() => {
    const map = new Map<string, RollupRow>();
    for (const stop of trip?.stops ?? []) {
      for (const it of stop.items ?? []) {
        const key = `${it.sku}||${it.productName}`;
        const row =
          map.get(key) ?? { key, sku: it.sku, productName: it.productName, boxes: 0, loose: 0, qty: 0, weightKg: 0 };
        row.boxes += it.boxes;
        row.loose += it.loosePieces;
        row.qty += it.quantity;
        row.weightKg += it.weightKg;
        map.set(key, row);
      }
    }
    return [...map.values()];
  }, [trip]);

  function printSingleBill(stopId: string) {
    setSingleStopId(stopId);
    window.setTimeout(() => {
      printA4();
      setSingleStopId(null);
    }, 120);
  }

  const singleStop = singleStopId ? trip?.stops.find((s) => s.id === singleStopId) ?? null : null;
  const tabLabel = tab === "loading" ? "Loading Sheet" : tab === "runsheet" ? "Run-Sheet" : "Bills + OTP";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-dmk-text-primary">
              <Printer className="h-4 w-4 text-dmk-yellow" /> Print pack
              {trip && <span className="font-money text-[13px] text-dmk-text-muted">{trip.tripNumber}</span>}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              {trip
                ? `${trip.routeName} · ${trip.driverName || "No driver"} · ${trip.vehicleNumber || "No vehicle"}`
                : "Loading trip…"}
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as PrintTab);
              setSingleStopId(null);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dmk-border-subtle pb-3">
              <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
                <TabsTrigger
                  value="loading"
                  className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary"
                >
                  <Boxes className="h-4 w-4" /> Loading Sheet
                </TabsTrigger>
                <TabsTrigger
                  value="runsheet"
                  className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary"
                >
                  <RouteIcon className="h-4 w-4" /> Run-Sheet
                </TabsTrigger>
                <TabsTrigger
                  value="bills"
                  className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary"
                >
                  <StickyNote className="h-4 w-4" /> Bills + OTP
                </TabsTrigger>
              </TabsList>
              <Button
                size="sm"
                className="h-9 bg-dmk-yellow text-[12.5px] font-semibold text-[#0A0F1D] hover:bg-dmk-yellow/90"
                disabled={!trip || loading}
                onClick={printA4}
              >
                <Printer className="h-4 w-4" /> Print {tabLabel}
              </Button>
            </div>

            <div className="max-h-[58vh] overflow-auto rounded-lg bg-dmk-input-well p-3">
              {loading ? (
                <LoadingRows rows={6} />
              ) : error ? (
                <p className="rounded-md border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[12px] text-dmk-danger">
                  {error}
                </p>
              ) : !trip ? null : tab === "loading" ? (
                <div className="overflow-x-auto">
                  <LoadingSheetSheet trip={trip} rollup={rollup} />
                </div>
              ) : tab === "runsheet" ? (
                <div className="overflow-x-auto">
                  <RunSheetSheet trip={trip} />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {trip.stops.length === 0 && (
                    <p className="py-6 text-center text-[12.5px] text-dmk-text-muted">No stops on this trip.</p>
                  )}
                  {trip.stops.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-dmk-border-subtle bg-[#111c32] px-3 py-2.5"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dmk-hover text-[11px] font-bold text-dmk-text-secondary">
                        {s.sequence}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-dmk-text-primary">
                          {s.invoiceNumber ?? s.invoiceId} · {s.shopName}
                        </p>
                        <p className="text-[11px] text-dmk-text-muted">
                          {s.town || "—"} · {(s.items ?? []).length} item{(s.items ?? []).length === 1 ? "" : "s"} ·{" "}
                          {formatINR(s.amount)} to collect
                        </p>
                      </div>
                      <span className="dmk-badge dmk-badge-gold font-money">OTP {spacedOtp(stopOtp(s))}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover"
                        onClick={() => printSingleBill(s.id)}
                      >
                        <Printer className="h-3.5 w-3.5" /> Print bill
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Chrome-free print copy — exactly one document tree mounted at a time */}
      <A4PrintPortal>
        {singleStop && trip ? (
          <BillSheet trip={trip} stop={singleStop} />
        ) : trip && tab === "loading" ? (
          <LoadingSheetSheet trip={trip} rollup={rollup} />
        ) : trip && tab === "runsheet" ? (
          <RunSheetSheet trip={trip} />
        ) : trip && tab === "bills" ? (
          <div className="dmk-batch-root">
            {trip.stops.map((s) => (
              <BillSheet key={s.id} trip={trip} stop={s} />
            ))}
          </div>
        ) : null}
      </A4PrintPortal>
    </>
  );
}

// ── A4 print sheets (white paper, monochrome, print friendly) ──

function SheetHeader({
  title,
  subtitle,
  meta,
}: {
  title: string;
  subtitle?: string;
  meta: string[];
}) {
  return (
    <div className="mb-4 border-b-2 border-gray-900 pb-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[20px] font-extrabold tracking-tight">DMK MART</p>
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-gray-600">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11px] text-gray-600">{subtitle}</p>}
        </div>
        <div className="text-right text-[10.5px] leading-relaxed text-gray-700">
          {meta.map((m, i) => (
            <p key={i} className="font-semibold">
              {m}
            </p>
          ))}
          <p className="text-gray-500">
            Printed{" "}
            {new Date().toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingSheetSheet({ trip, rollup }: { trip: LogisticsTrip; rollup: RollupRow[] }) {
  const totBoxes = rollup.reduce((s, r) => s + r.boxes, 0);
  const totLoose = rollup.reduce((s, r) => s + r.loose, 0);
  const totQty = rollup.reduce((s, r) => s + r.qty, 0);
  const totWeight = rollup.reduce((s, r) => s + r.weightKg, 0);
  return (
    <div
      className="print-a4 flex min-h-[1123px] w-[794px] flex-col bg-white px-10 py-8 text-gray-900"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <SheetHeader
        title="Warehouse Loading Sheet"
        subtitle={`${trip.totalStops} stops · ${trip.routeName}`}
        meta={[
          `Trip: ${trip.tripNumber}`,
          `Vehicle: ${trip.vehicleNumber || "—"}`,
          `Driver: ${trip.driverName || "—"}`,
        ]}
      />
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b-2 border-gray-800 text-left">
            <th className="w-8 py-1.5 pr-2">#</th>
            <th className="pr-2">SKU</th>
            <th className="pr-2">Product</th>
            <th className="pr-2 text-right">Boxes</th>
            <th className="pr-2 text-right">Loose</th>
            <th className="pr-2 text-right">Total Qty</th>
            <th className="pr-2 text-right">Weight</th>
            <th className="w-14 text-center">Loaded</th>
          </tr>
        </thead>
        <tbody>
          {rollup.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-6 text-center text-gray-500">
                No item lines on this trip.
              </td>
            </tr>
          ) : (
            rollup.map((r, i) => (
              <tr key={r.key} className="border-b border-gray-200">
                <td className="py-2 pr-2">{i + 1}</td>
                <td className="pr-2 font-mono text-[11px]">{r.sku}</td>
                <td className="pr-2">{r.productName}</td>
                <td className="pr-2 text-right">{fmtInt(r.boxes)}</td>
                <td className="pr-2 text-right">{fmtInt(r.loose)}</td>
                <td className="pr-2 text-right font-semibold">{fmtInt(r.qty)}</td>
                <td className="pr-2 text-right">{(Math.round(r.weightKg * 10) / 10).toLocaleString("en-IN")} kg</td>
                <td className="text-center">
                  <span className="inline-block h-4 w-4 border border-gray-500" aria-hidden="true" />
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-800 font-bold">
            <td colSpan={3} className="py-2">
              Total
            </td>
            <td className="pr-2 text-right">{fmtInt(totBoxes)}</td>
            <td className="pr-2 text-right">{fmtInt(totLoose)}</td>
            <td className="pr-2 text-right">{fmtInt(totQty)}</td>
            <td className="pr-2 text-right">{(Math.round(totWeight * 10) / 10).toLocaleString("en-IN")} kg</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="mt-auto pt-8 text-[10.5px] text-gray-500">
        Tick items as loaded. Report any shortage to the warehouse supervisor before the truck leaves — the loading
        sheet must match the run-sheet totals.
      </p>
    </div>
  );
}

function RunSheetSheet({ trip }: { trip: LogisticsTrip }) {
  const total = trip.stops.reduce((s, x) => s + x.amount, 0);
  return (
    <div
      className="print-a4 flex min-h-[1123px] w-[794px] flex-col bg-white px-10 py-8 text-gray-900"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <SheetHeader
        title="Delivery Run-Sheet"
        subtitle={`${trip.stops.length} stops in drop order · collect on delivery`}
        meta={[
          `Trip: ${trip.tripNumber}`,
          `Route: ${trip.routeName}`,
          `Driver: ${trip.driverName || "—"}`,
          `Vehicle: ${trip.vehicleNumber || "—"}`,
        ]}
      />
      <div className="space-y-3">
        {trip.stops.length === 0 && (
          <p className="py-6 text-center text-[12px] text-gray-500">No stops on this trip.</p>
        )}
        {trip.stops.map((s) => (
          <div key={s.id} className="flex gap-3 rounded-md border border-gray-300 p-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[13px] font-bold text-white">
              {s.sequence}
            </div>
            <div className="min-w-0 flex-1 text-[12px]">
              <p className="text-[13.5px] font-bold">{s.shopName}</p>
              <p className="text-gray-700">
                {s.town || "—"}
                {s.address ? ` · ${s.address}` : ""}
              </p>
              <p className="text-gray-700">Phone: {s.phone || "—"}</p>
              <p className="mt-1 text-gray-800">
                {fmtInt(s.boxes)} boxes · {fmtInt(s.loosePieces)} loose ·{" "}
                {(Math.round(s.weightKg * 10) / 10).toLocaleString("en-IN")} kg
              </p>
              <p className="font-bold">
                Collect: {formatINR(s.amount)}{" "}
                <span className="font-normal text-gray-600">({s.expectedMode})</span>
              </p>
            </div>
            <div className="w-[150px] shrink-0">
              <div className="h-[150px] rounded-md border-2 border-gray-400" aria-hidden="true" />
              <p className="mt-1 text-center text-[10px] text-gray-500">Signature</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-between border-t-2 border-gray-800 pt-2 text-[13.5px] font-bold">
        <span>Total to collect — {trip.stops.length} stops</span>
        <span className="font-money">{formatINR(total)}</span>
      </div>
    </div>
  );
}

function BillSheet({ trip, stop }: { trip: LogisticsTrip; stop: TripStop }) {
  const otp = stopOtp(stop);
  const items = stop.items ?? [];
  return (
    <div
      className="print-a4 flex min-h-[1123px] w-[794px] flex-col bg-white px-10 py-8 text-gray-900"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <div className="flex items-start justify-between border-b-2 border-gray-900 pb-3">
        <div>
          <p className="text-[20px] font-extrabold tracking-tight">DMK MART</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-600">Delivery Bill Cover</p>
        </div>
        <div className="text-right text-[11px] leading-relaxed">
          <p className="font-bold">{stop.invoiceNumber ?? stop.invoiceId}</p>
          <p className="text-gray-600">
            Trip {trip.tripNumber} · Stop {stop.sequence}
          </p>
          <p className="text-gray-600">{trip.vehicleNumber || "—"}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[16px] font-bold">{stop.shopName}</p>
        <p className="text-[12px] text-gray-700">
          {stop.town || "—"}
          {stop.address ? ` · ${stop.address}` : ""}
          {stop.phone ? ` · Ph: ${stop.phone}` : ""}
        </p>
      </div>

      <table className="mt-4 w-full text-[12px]">
        <thead>
          <tr className="border-b-2 border-gray-800 text-left">
            <th className="py-1.5 pr-2">#</th>
            <th className="pr-2">SKU</th>
            <th className="pr-2">Product</th>
            <th className="pr-2 text-right">Qty</th>
            <th className="pr-2 text-right">Boxes</th>
            <th className="pr-2 text-right">Loose</th>
            <th className="text-right">Weight</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-5 text-center text-gray-500">
                Item detail unavailable for this stop.
              </td>
            </tr>
          ) : (
            items.map((it, i) => (
              <tr key={`${it.sku}-${i}`} className="border-b border-gray-200">
                <td className="py-1.5 pr-2">{i + 1}</td>
                <td className="pr-2 font-mono text-[11px]">{it.sku}</td>
                <td className="pr-2">{it.productName}</td>
                <td className="pr-2 text-right">{fmtInt(it.quantity)}</td>
                <td className="pr-2 text-right">{fmtInt(it.boxes)}</td>
                <td className="pr-2 text-right">{fmtInt(it.loosePieces)}</td>
                <td className="text-right">{(Math.round(it.weightKg * 10) / 10).toLocaleString("en-IN")} kg</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between border-t-2 border-gray-800 pt-2 text-[14px] font-bold">
        <span>Amount to collect ({stop.expectedMode})</span>
        <span className="font-money">{formatINR(stop.amount)}</span>
      </div>

      <div className="mt-auto rounded-md border-4 border-gray-900 p-5 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.2em]">Delivery Verification OTP</p>
        <p className="my-3 text-[36px] font-black leading-none tracking-[0.35em]">{spacedOtp(otp)}</p>
        <p className="text-[11.5px] text-gray-700">
          Check your goods and share this code with the driver upon delivery.
        </p>
      </div>

      <p className="pt-4 text-[10px] text-gray-500">
        Driver keeps this cover until the stop is verified in the DMK Mart portal. Proof: OTP (fallback: signature).
      </p>
    </div>
  );
}
