"use client";

// ═══════════════════════════════════════════════════════════════
// DRIVER TRIP VIEW — the delivery driver's own screen in the /team
// portal. Drivers sign in with the same team username/password; the
// portal routes them here instead of the goods-in checkpoint.
//
// What a driver sees:
// · their ONE active dispatched trip (polled every 15s — cheap phones,
//   patchy outdoor data, so no websocket here),
// · every stop in drop order with a one-tap Call button,
// · delivery = the 4-digit OTP the customer reads off the printed bill
//   (drivers NEVER see OTPs) + what they collected (CASH / UPI with a
//   pay-to-firm QR the customer scans from THIS phone / CREDIT =
//   on-account drop, nothing collected),
// · a paper-signature fallback when the customer lost the bill or the
//   OTP got locked after 5 wrong tries.
//
// Money note: this screen shows ONLY the amount to collect on each stop
// — the same number the customer's bill shows. No books, no totals.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import QRCode from "react-qr-code";
import {
  Truck,
  Phone,
  MapPin,
  CheckCircle2,
  RefreshCw,
  LogOut,
  WifiOff,
  Banknote,
  Smartphone,
  NotebookPen,
  Copy,
  PenLine,
  PartyPopper,
  Loader2,
  AlertTriangle,
  ScanLine,
  ShieldCheck,
  PackageOpen,
} from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { formatINR } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EmptyState } from "@/components/erp/shared";
import { cn } from "@/lib/utils";

// ─── API contracts (parallel logistics service) ───────────────────

interface DriverStopItem {
  sku: string;
  productName: string;
  quantity: number;
  boxes: number;
  loosePieces: number;
  weightKg: number;
}

interface DriverStop {
  id: string;
  sequence: number;
  shopName: string;
  town: string;
  address: string;
  phone: string;
  boxes: number;
  loosePieces: number;
  weightKg: number;
  amount: number;
  expectedMode: string; // CASH | UPI | CREDIT (from the bill's payment mode)
  status: "PENDING" | "DELIVERED";
  deliveryProof: string | null; // "OTP" | "SIGNATURE" ("" on pending)
  collectedMode: string | null; // CASH | UPI | CREDIT once delivered
  collectedAmount: number | null;
  otpAttempts: number;
  deliveredAt: string | null;
  items?: DriverStopItem[]; // pending cards render it; history/completed stops omit it
}

interface DriverTrip {
  id: string;
  tripNumber: string;
  routeName: string;
  vehicleNumber: string;
  driverName: string;
  status: "DISPATCHED" | "IN_PROGRESS" | "COMPLETED";
  totalStops: number;
  stops: DriverStop[];
}

interface DriverStaff {
  id: string;
  name: string;
  username: string;
  role: string;
}

/** Firm identity shown on the driver's UPI screen (pay from THIS phone). */
interface PaymentInfo {
  payeeName: string;
  upiId: string;
  upiQrUrl?: string | null; // owner-uploaded scanner photo — shown instead of the generated QR when present
  phone: string;
}

interface DriverFirm {
  id: string;
  firmName: string;
}

/** Success shape of verify-otp / signature: the updated stop + trip progress. */
interface StopActionResult {
  stop: DriverStop;
  trip: { status: string; totalStops: number; deliveredStops: number };
}

// ─── Stop action calls (raw fetch — the driver needs `attemptsLeft`
// from the 422 envelope, which the generic api-client drops) ───────

type StopActionOutcome =
  | { ok: true; data: StopActionResult }
  | { ok: false; code: string; message: string; attemptsLeft?: number };

async function postStopAction(path: string, body: Record<string, unknown>): Promise<StopActionOutcome> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && json.ok !== false) {
      return { ok: true, data: json.data as StopActionResult };
    }
    const message = typeof json.error === "string" && json.error ? json.error : `Request failed (${res.status})`;
    return {
      ok: false,
      code: typeof json.code === "string" ? json.code : "ERR_UNKNOWN",
      message,
      attemptsLeft: readAttemptsLeft(json, message),
    };
  } catch {
    return { ok: false, code: "ERR_NETWORK", message: "Network problem — check your internet and try again." };
  }
}

function readAttemptsLeft(json: Record<string, unknown>, message: string): number | undefined {
  if (typeof json.attemptsLeft === "number") return json.attemptsLeft;
  const m = /(\d+)\s*attempt/i.exec(message);
  return m ? Number(m[1]) : undefined;
}

// ─── Small formatters ─────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** "2 boxes + 3 loose" / "3 loose" / "" — the box/loose split for one product line. */
function qtyBreakdown(it: DriverStopItem): string {
  const parts: string[] = [];
  if (it.boxes > 0) parts.push(`${it.boxes} box${it.boxes === 1 ? "" : "es"}`);
  if (it.loosePieces > 0) parts.push(`${it.loosePieces} loose`);
  return parts.join(" + ");
}

// ─── Main view ────────────────────────────────────────────────────

export function DriverTripView({
  staff,
  firm,
  onLogout,
}: {
  staff: DriverStaff;
  firm: DriverFirm;
  onLogout: () => void;
}) {
  const { toast } = useToast();
  const [trip, setTrip] = React.useState<DriverTrip | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [offline, setOffline] = React.useState(false);
  const [activeStop, setActiveStop] = React.useState<DriverStop | null>(null);
  const [payInfo, setPayInfo] = React.useState<PaymentInfo | null>(null);

  const load = React.useCallback(async () => {
    if (!staff.id) {
      setInitialLoading(false);
      return;
    }
    setRefreshing(true);
    try {
      const data = await apiGet<{ trip: DriverTrip | null; paymentInfo?: PaymentInfo | null }>(
        "/api/v1/logistics/driver/active-trip",
        { staffId: staff.id }
      );
      if (data?.paymentInfo) setPayInfo(data.paymentInfo);
      if (data?.trip) {
        setTrip(data.trip);
      } else {
        // No DISPATCHED/IN_PROGRESS trip — keep a COMPLETED-but-not-yet-settled
        // run on screen (with the "return to warehouse" banner) until the
        // office closes it. Once CLOSED it drops off to the empty state.
        const hist = await apiGet<{ trips: DriverTrip[]; paymentInfo?: PaymentInfo | null }>(
          "/api/v1/logistics/driver/history",
          { staffId: staff.id }
        ).catch(() => null);
        if (hist?.paymentInfo) setPayInfo(hist.paymentInfo);
        const completed = hist?.trips?.find((t) => t.status === "COMPLETED");
        setTrip(
          completed
            ? {
                ...completed,
                stops: (completed.stops ?? []).map((s) => ({ ...s, items: s.items ?? [] })),
              }
            : null
        );
      }
      setOffline(false);
    } catch {
      // Keep the last known trip on screen — banner announces the gap and
      // the 15s poll keeps retrying on its own.
      setOffline(true);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [staff.id]);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const stops = React.useMemo(() => [...(trip?.stops ?? [])].sort((a, b) => a.sequence - b.sequence), [trip]);
  const delivered = stops.filter((s) => s.status === "DELIVERED").length;
  const total = trip ? Math.max(trip.totalStops || 0, stops.length) : 0;
  const allDone = total > 0 && delivered >= total;

  function afterDelivery(shopName: string) {
    setActiveStop(null);
    toast({
      title: "Delivery recorded",
      description: `${shopName} is done — the trip progress updates now.`,
    });
    load(); // refetch after every action
  }

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      {/* Scoped animation — the OTP shake on a wrong code */}
      <style>{`
        @keyframes dmkOtpShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-7px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        .dmk-shake { animation: dmkOtpShake 0.45s cubic-bezier(.36,.07,.19,.97) both; }
      `}</style>

      {/* Portal header — same chrome as the verifier checkpoint */}
      <header className="fixed top-0 inset-x-0 z-50 h-14 bg-[#0D1527]/95 backdrop-blur border-b-2 border-dmk-yellow/60">
        <div className="h-full px-3 sm:px-5 flex items-center gap-3">
          <img src="/dmk-logo.png" alt="DMK Mart logo" width={34} height={34} className="rounded-full" />
          <div className="leading-tight min-w-0">
            <p className="text-[13.5px] font-black text-dmk-text-primary truncate">DMK Verification Portal</p>
            <p className="text-[9.5px] uppercase tracking-[0.18em] text-dmk-yellow truncate">
              {firm.firmName} · delivery trips
            </p>
          </div>
          <div className="flex-1" />
          {offline && (
            <span
              className="dmk-badge h-8 px-2.5 gap-1.5 bg-dmk-warning/15 text-dmk-warning"
              title="Connection problem — retrying automatically every 15 seconds"
            >
              <WifiOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">RECONNECTING</span>
            </span>
          )}
          <div className="h-8 px-2.5 rounded-lg bg-dmk-input-well border border-dmk-border-subtle hidden sm:flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-dmk-success/25 border border-dmk-success/50 flex items-center justify-center text-[11px] font-bold text-dmk-success">
              {(staff.name || "?").slice(0, 1)}
            </span>
            <span className="text-[12px] font-semibold text-dmk-text-primary">{staff.name}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="h-9 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50"
          >
            <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 mt-14 px-3 sm:px-5 py-4 max-w-[640px] w-full mx-auto space-y-4">
        {initialLoading ? (
          <div className="dmk-card p-10 flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-dmk-yellow" />
            <p className="text-[13px] text-dmk-text-muted">Checking for your trip…</p>
          </div>
        ) : !trip ? (
          <NoTripCard refreshing={refreshing} onRefresh={load} onLogout={onLogout} />
        ) : (
          <>
            <TripHeaderCard trip={trip} delivered={delivered} total={total} onRefresh={load} refreshing={refreshing} />

            {offline && (
              <div
                className="rounded-lg border border-dmk-warning/30 bg-dmk-warning/10 px-3 py-2.5 flex items-center gap-2 text-[12px] text-dmk-warning"
                role="status"
              >
                <WifiOff className="h-4 w-4 shrink-0" />
                You seem to be offline — retrying automatically every 15 seconds.
              </div>
            )}

            {allDone && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-900/20 px-4 py-3.5 flex items-start gap-3 dmk-enter">
                <PartyPopper className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[14px] font-bold text-emerald-300">All deliveries done!</p>
                  <p className="text-[12.5px] text-dmk-text-secondary mt-0.5">
                    Return to the warehouse for cash settlement.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {stops.map((s) =>
                s.status === "DELIVERED" ? (
                  <DeliveredStopCard key={s.id} stop={s} />
                ) : (
                  <PendingStopCard key={s.id} stop={s} onDeliver={() => setActiveStop(s)} />
                )
              )}
            </div>
          </>
        )}
      </main>

      <footer className="mt-auto border-t border-dmk-border-subtle bg-[#0D1527]/60">
        <div className="max-w-[640px] mx-auto px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-1.5">
          <p className="text-[11px] text-dmk-text-muted">DMK Verification Portal · delivery trips</p>
          <p className="text-[11px] text-dmk-text-muted flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3" /> live sync every 15s
          </p>
        </div>
      </footer>

      {activeStop && trip && (
        <DeliveryDialog
          key={activeStop.id}
          trip={trip}
          stop={activeStop}
          staffId={staff.id}
          payInfo={payInfo}
          onClose={() => setActiveStop(null)}
          onDone={(shopName) => afterDelivery(shopName)}
        />
      )}
    </div>
  );
}

// ─── No active trip ───────────────────────────────────────────────

function NoTripCard({
  refreshing,
  onRefresh,
  onLogout,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="dmk-card p-6 dmk-enter">
      <EmptyState
        icon={Truck}
        title="No active trip yet"
        hint="Your trip appears here the moment the office dispatches it."
        action={
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 w-full sm:w-auto">
            <Button
              onClick={onRefresh}
              disabled={refreshing}
              className="w-full sm:w-auto h-12 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
            </Button>
            <Button
              variant="outline"
              onClick={onLogout}
              className="w-full sm:w-auto h-12 border-dmk-border-medium text-dmk-text-secondary hover:text-dmk-danger hover:border-dmk-danger/50"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        }
      />
    </div>
  );
}

// ─── Trip header — number, route, vehicle, progress ──────────────

function TripHeaderCard({
  trip,
  delivered,
  total,
  onRefresh,
  refreshing,
}: {
  trip: DriverTrip;
  delivered: number;
  total: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
  return (
    <section className="dmk-card p-4 dmk-enter">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Truck className="h-5 w-5 text-dmk-yellow shrink-0" />
            <h1 className="font-money text-[16px] font-black text-dmk-text-primary">Trip {trip.tripNumber}</h1>
          </div>
          <p className="text-[12.5px] text-dmk-text-secondary mt-0.5 truncate">{trip.routeName}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {trip.vehicleNumber && (
            <span className="dmk-badge bg-dmk-yellow/15 text-dmk-yellow" title="Vehicle">
              <Truck className="h-3 w-3" /> {trip.vehicleNumber}
            </span>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh trip"
            className="h-9 w-9 border-dmk-border-subtle text-dmk-text-secondary hover:text-dmk-text-primary"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-end justify-between gap-3">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted">Progress</p>
          <p className="font-money text-[22px] font-bold text-dmk-text-primary leading-none">
            {delivered} <span className="text-[13px] text-dmk-text-muted font-semibold">of {total} delivered</span>
          </p>
        </div>
        <div
          className="mt-2 h-2 rounded-full bg-dmk-input-well overflow-hidden"
          role="progressbar"
          aria-valuenow={delivered}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${delivered} of ${total} stops delivered`}
        >
          <div
            className="h-full rounded-full bg-dmk-success transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </section>
  );
}

// ─── Pending stop — the big touch card ────────────────────────────

function PendingStopCard({ stop, onDeliver }: { stop: DriverStop; onDeliver: () => void }) {
  return (
    <section className="dmk-card p-4 dmk-enter">
      <div className="flex items-start gap-3">
        <span className="h-11 w-11 shrink-0 rounded-full border-2 border-dmk-yellow/60 bg-dmk-yellow/10 flex items-center justify-center font-money text-[16px] font-black text-dmk-yellow">
          {stop.sequence}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16.5px] font-bold text-dmk-text-primary leading-snug">{stop.shopName}</h2>
          <p className="text-[12.5px] text-dmk-text-secondary mt-0.5 flex items-start gap-1">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-dmk-text-muted" />
            <span>
              {stop.town}
              {stop.address ? ` · ${stop.address}` : ""}
            </span>
          </p>
        </div>
      </div>

      {(stop.boxes > 0 || stop.loosePieces > 0 || stop.weightKg > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stop.boxes > 0 && (
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
              <PackageOpen className="h-3 w-3" /> {stop.boxes} box{stop.boxes === 1 ? "" : "es"}
            </span>
          )}
          {stop.loosePieces > 0 && (
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">{stop.loosePieces} loose</span>
          )}
          {stop.weightKg > 0 && (
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">{trimNum(stop.weightKg)} kg</span>
          )}
        </div>
      )}

      {stop.phone && (
        <Button
          asChild
          variant="outline"
          className="mt-3 w-full h-12 border-dmk-border-medium text-[14px] font-semibold text-dmk-text-primary hover:border-dmk-success/60 hover:text-dmk-success"
        >
          <a href={`tel:${stop.phone}`} aria-label={`Call ${stop.shopName} at ${stop.phone}`}>
            <Phone className="h-4 w-4" /> Call {stop.shopName}
          </a>
        </Button>
      )}

      {/* What to hand over — product names + counts only */}
      <div className="mt-3 rounded-lg border border-dmk-border-subtle overflow-hidden">
        <ul className="divide-y divide-dmk-border-subtle">
          {(stop.items ?? []).map((it, ix) => {
            const breakdown = qtyBreakdown(it);
            return (
              <li key={`${it.sku}-${ix}`} className="px-3 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-dmk-text-primary leading-snug">{it.productName}</p>
                  <p className="text-[11px] text-dmk-text-muted font-money mt-0.5">
                    {it.sku}
                    {it.weightKg > 0 ? ` · ${trimNum(it.weightKg)} kg` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-money text-[13.5px] font-bold text-dmk-text-primary">×{it.quantity}</p>
                  {breakdown && <p className="text-[10.5px] text-dmk-text-muted mt-0.5">{breakdown}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Money to collect — the biggest number on the card */}
      <div className="mt-3 rounded-lg border border-dmk-success/30 bg-dmk-success/5 px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">
            Collect on delivery
          </p>
          <p className="font-money text-[26px] font-black text-dmk-success leading-none mt-1">
            {formatINR(stop.amount)}
          </p>
        </div>
        <span
          className={cn(
            "dmk-badge h-8 px-2.5 gap-1 shrink-0",
            stop.expectedMode === "CASH"
              ? "bg-dmk-warning/15 text-dmk-warning"
              : stop.expectedMode === "UPI"
                ? "bg-dmk-success/15 text-dmk-success"
                : "bg-dmk-input-well text-dmk-text-secondary"
          )}
          title={stop.expectedMode === "CREDIT" ? "Billed on credit — collect or mark on account" : "Expected payment mode"}
        >
          {stop.expectedMode === "CASH" ? (
            <Banknote className="h-3.5 w-3.5" />
          ) : stop.expectedMode === "UPI" ? (
            <Smartphone className="h-3.5 w-3.5" />
          ) : (
            <NotebookPen className="h-3.5 w-3.5" />
          )}
          {stop.expectedMode}
        </span>
      </div>

      <Button
        onClick={onDeliver}
        className="mt-3 w-full h-12 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold text-[15px]"
      >
        <ScanLine className="h-5 w-5" /> Enter Bill OTP &amp; Deliver
      </Button>
    </section>
  );
}

// ─── Delivered stop — the receipt card ────────────────────────────

function DeliveredStopCard({ stop }: { stop: DriverStop }) {
  return (
    <section className="rounded-xl border border-emerald-500/40 bg-emerald-900/20 p-4 dmk-enter">
      <div className="flex items-start gap-3">
        <span className="h-11 w-11 shrink-0 rounded-full border-2 border-emerald-500/50 bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-bold text-dmk-text-primary truncate">{stop.shopName}</h2>
            <span className="dmk-badge bg-emerald-500/15 text-emerald-400">DELIVERED</span>
          </div>
          <p className="text-[12px] text-dmk-text-secondary mt-0.5">
            Stop {stop.sequence} · Delivered at {fmtTime(stop.deliveredAt)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
              {stop.deliveryProof === "SIGNATURE" ? (
                <PenLine className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {stop.deliveryProof === "SIGNATURE" ? "Paper signature" : "OTP verified"}
            </span>
            <span className="dmk-badge bg-dmk-input-well text-dmk-text-secondary">
              {formatINR(stop.collectedAmount ?? 0)} · {stop.collectedMode || "—"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Delivery dialog — OTP first, paper-signature fallback ───────

type DialogMode = "otp" | "locked" | "signature";

function DeliveryDialog({
  trip,
  stop,
  staffId,
  payInfo,
  onClose,
  onDone,
}: {
  trip: DriverTrip;
  stop: DriverStop;
  staffId: string;
  payInfo: PaymentInfo | null;
  onClose: () => void;
  onDone: (shopName: string) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = React.useState<DialogMode>("otp");
  const [returnTo, setReturnTo] = React.useState<DialogMode>("otp");
  const [code, setCode] = React.useState("");
  // Default the collection mode from the bill: UPI-billed → UPI,
  // credit-billed → CREDIT (on account), everything else → CASH.
  // Drivers record what the shopkeeper actually pays; the API accepts
  // CASH | UPI | CREDIT and forces CREDIT to ₹0.
  const [payMode, setPayMode] = React.useState<"CASH" | "UPI" | "CREDIT">(
    stop.expectedMode === "UPI" ? "UPI" : stop.expectedMode === "CREDIT" ? "CREDIT" : "CASH"
  );
  const [amount, setAmount] = React.useState(() =>
    stop.expectedMode === "CREDIT" ? "0" : String(stop.amount ?? 0)
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shaking, setShaking] = React.useState(false);

  const amountNum = payMode === "CREDIT" ? 0 : Number(amount);
  const amountValid =
    payMode === "CREDIT" || (amount.trim() !== "" && Number.isFinite(amountNum) && amountNum >= 0);
  const canConfirm = amountValid && !busy && (mode !== "otp" || code.length === 4);

  async function submit(otpPath: boolean) {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    const res = await postStopAction(
      `/api/v1/logistics/trips/${trip.id}/stops/${stop.id}/${otpPath ? "verify-otp" : "signature"}`,
      otpPath
        ? { otp: code, collectedMode: payMode, collectedAmount: amountNum, staffId }
        : { collectedMode: payMode, collectedAmount: amountNum, staffId }
    );
    setBusy(false);

    if (res.ok) {
      onDone(stop.shopName);
      return;
    }
    if (res.code === "ERR_OTP_LOCKED") {
      // 5 wrong tries — OTP path is closed for this stop; offer the paper fallback.
      setMode("locked");
      setError(null);
      return;
    }
    if (res.code === "ERR_OTP_MISMATCH") {
      setShaking(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(180);
      setError(
        typeof res.attemptsLeft === "number"
          ? `Wrong code — ${res.attemptsLeft} attempts left`
          : "Wrong code — try again"
      );
      return;
    }
    setError(res.message);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="dmk-card sm:max-w-[440px]">
        {mode === "otp" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
                <ScanLine className="h-5 w-5 text-dmk-yellow shrink-0" /> Delivery verification — {stop.shopName}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-dmk-text-muted">
                Ask the customer for the 4-digit code printed on their bill.
              </DialogDescription>
            </DialogHeader>

            <div
              className={cn("flex justify-center py-1", shaking && "dmk-shake")}
              onAnimationEnd={() => setShaking(false)}
            >
              <InputOTP maxLength={4} value={code} onChange={setCode} disabled={busy} autoFocus aria-label="4-digit bill OTP">
                <InputOTPGroup className="gap-2.5">
                  {[0, 1, 2, 3].map((i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="h-14 w-12 text-[22px] font-bold bg-dmk-input-well border-dmk-border-medium text-dmk-text-primary first:rounded-l-lg last:rounded-r-lg"
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <PayFields
              tripNumber={trip.tripNumber}
              stopSequence={stop.sequence}
              payInfo={payInfo}
              payMode={payMode}
              setPayMode={setPayMode}
              amount={amount}
              setAmount={setAmount}
              stopAmount={stop.amount}
              disabled={busy}
            />

            {error && (
              <p role="alert" className="text-[12.5px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button
              onClick={() => submit(true)}
              disabled={!canConfirm}
              className="w-full h-12 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold text-[14.5px]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {payMode === "CREDIT" ? "Confirm Delivery (On Account)" : "Confirm Delivery"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setReturnTo("otp");
                setMode("signature");
                setError(null);
              }}
              className="w-full text-[12px] font-semibold text-dmk-text-muted hover:text-dmk-yellow py-1 transition-colors"
            >
              Customer lost the bill? Use paper signature
            </button>
          </>
        )}

        {mode === "locked" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
                <AlertTriangle className="h-5 w-5 text-dmk-warning shrink-0" /> Too many wrong attempts
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-dmk-text-muted">
                The bill OTP for {stop.shopName} is locked after 5 wrong tries. You can still record this delivery with
                the customer&apos;s paper signature.
              </DialogDescription>
            </DialogHeader>

            <PayFields
              tripNumber={trip.tripNumber}
              stopSequence={stop.sequence}
              payInfo={payInfo}
              payMode={payMode}
              setPayMode={setPayMode}
              amount={amount}
              setAmount={setAmount}
              stopAmount={stop.amount}
              disabled={busy}
            />

            <Button
              onClick={() => {
                setReturnTo("locked");
                setMode("signature");
              }}
              className="w-full h-12 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold text-[14px]"
            >
              <PenLine className="h-4 w-4" /> Bill misplaced? Confirm with paper signature
            </Button>
          </>
        )}

        {mode === "signature" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-dmk-text-primary">
                <PenLine className="h-5 w-5 text-dmk-yellow shrink-0" /> Paper signature — {stop.shopName}
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-dmk-text-muted">
                The customer can&apos;t show the bill code. The delivery is confirmed with a signature on the paper bill
                instead — collect the money as usual.
              </DialogDescription>
            </DialogHeader>

            <PayFields
              tripNumber={trip.tripNumber}
              stopSequence={stop.sequence}
              payInfo={payInfo}
              payMode={payMode}
              setPayMode={setPayMode}
              amount={amount}
              setAmount={setAmount}
              stopAmount={stop.amount}
              disabled={busy}
            />

            {error && (
              <p role="alert" className="text-[12.5px] text-dmk-danger bg-dmk-danger/10 border border-dmk-danger/25 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button
              onClick={() => submit(false)}
              disabled={!canConfirm}
              className="w-full h-12 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/90 font-bold text-[14.5px]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Confirm with paper signature
            </Button>

            {returnTo === "otp" && (
              <button
                type="button"
                onClick={() => {
                  setMode("otp");
                  setError(null);
                }}
                className="w-full text-[12px] font-semibold text-dmk-text-muted hover:text-dmk-yellow py-1 transition-colors"
              >
                Back to OTP code
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Shared money fields — CASH/UPI/CREDIT toggle + UPI QR + amount ──

type PayMode = "CASH" | "UPI" | "CREDIT";

const PAY_MODE_META: Array<{
  value: PayMode;
  label: string;
  icon: React.ReactNode;
  activeCls: string;
}> = [
  {
    value: "CASH",
    label: "Cash",
    icon: <Banknote className="h-4 w-4" />,
    activeCls: "bg-dmk-warning text-[#0A0F1D] border-dmk-warning",
  },
  {
    value: "UPI",
    label: "UPI",
    icon: <Smartphone className="h-4 w-4" />,
    activeCls: "bg-dmk-success text-[#0A0F1D] border-dmk-success",
  },
  {
    value: "CREDIT",
    label: "Credit",
    icon: <NotebookPen className="h-4 w-4" />,
    activeCls: "bg-dmk-input-well text-dmk-text-primary border-dmk-text-muted",
  },
];

/** UPI deep link — every GPay/PhonePe/Paytm/BHIM scanner understands it. */
function upiIntent(payInfo: PaymentInfo, amount: number, note: string): string {
  const params = new URLSearchParams({
    pa: payInfo.upiId,
    pn: payInfo.payeeName || "DMK Mart",
    am: amount.toFixed(2),
    cu: "INR",
    tn: note.slice(0, 48),
  });
  return `upi://pay?${params.toString()}`;
}

function PayFields({
  tripNumber,
  stopSequence,
  payInfo,
  payMode,
  setPayMode,
  amount,
  setAmount,
  stopAmount,
  disabled,
}: {
  tripNumber: string;
  stopSequence: number;
  payInfo: PaymentInfo | null;
  payMode: PayMode;
  setPayMode: (m: PayMode) => void;
  amount: string;
  setAmount: (v: string) => void;
  stopAmount: number;
  disabled: boolean;
}) {
  const { toast } = useToast();
  const amountNum = Number(amount) || 0;
  const hasUpi = Boolean(payInfo?.upiId && payInfo.upiId.trim() !== "");

  function copyText(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: `${what} copied` }),
      () => toast({ variant: "destructive", title: "Copy failed — long-press to copy" })
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Mode picker — what the shopkeeper is actually paying with */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Payment mode collected">
        {PAY_MODE_META.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setPayMode(m.value)}
            aria-pressed={payMode === m.value}
            disabled={disabled}
            className={cn(
              "h-12 rounded-lg border font-bold text-[13px] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50",
              payMode === m.value
                ? m.activeCls
                : "bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:border-dmk-border-medium"
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {payMode === "CREDIT" && (
        <p className="rounded-md border border-dmk-border-medium bg-dmk-input-well px-3 py-2 text-[12px] text-dmk-text-secondary">
          On account — the shop pays later. Nothing is collected now and the bill stays receivable.
        </p>
      )}

      {payMode === "UPI" && (
        <div className="rounded-lg border border-dmk-success/30 bg-dmk-success/5 p-3">
          {hasUpi && payInfo ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                {payInfo.upiQrUrl
                  ? "Office payment QR — the customer scans it and enters the amount"
                  : "Show this to the customer — they scan it from their phone"}
              </p>
              <div className="mt-2 flex justify-center rounded-lg bg-white p-2.5 w-fit mx-auto">
                {payInfo.upiQrUrl ? (
                  // Owner-uploaded scanner (bank/GPay QR photo) — exact authority of the owner portal.
                  <img
                    src={payInfo.upiQrUrl}
                    alt={`Office payment QR for ${payInfo.payeeName}`}
                    className="h-44 w-44 object-contain"
                  />
                ) : (
                  <QRCode
                    value={upiIntent(payInfo, amountNum > 0 ? amountNum : stopAmount, `${tripNumber} Stop ${stopSequence}`)}
                    size={148}
                    bgColor="#FFFFFF"
                    fgColor="#0A0F1D"
                    aria-label={`UPI QR code for ${payInfo.payeeName}`}
                  />
                )}
              </div>
              <p className="mt-2 text-center font-money text-[15px] font-black text-dmk-success">
                {formatINR(amountNum > 0 ? amountNum : stopAmount)} → {payInfo.payeeName}
              </p>
              <div className="mt-2 space-y-1.5">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => copyText(payInfo.upiId, "UPI ID")}
                  className="w-full flex items-center justify-between gap-2 rounded-md bg-dmk-input-well border border-dmk-border-subtle px-2.5 py-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block text-[9.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">UPI ID</span>
                    <span className="block text-[12.5px] font-semibold text-dmk-text-primary truncate font-money">{payInfo.upiId}</span>
                  </span>
                  <Copy className="h-4 w-4 shrink-0 text-dmk-text-muted" />
                </button>
                {payInfo.phone && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => copyText(payInfo.phone, "Phone number")}
                    className="w-full flex items-center justify-between gap-2 rounded-md bg-dmk-input-well border border-dmk-border-subtle px-2.5 py-2 text-left disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-[9.5px] uppercase tracking-wider font-semibold text-dmk-text-muted">Pay to phone</span>
                      <span className="block text-[12.5px] font-semibold text-dmk-text-primary truncate font-money">{payInfo.phone}</span>
                    </span>
                    <Copy className="h-4 w-4 shrink-0 text-dmk-text-muted" />
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-dmk-text-muted leading-snug">
                Customer can also type the UPI ID / phone number manually in their payment app. Confirm below only after
                the money arrives.
              </p>
            </>
          ) : (
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-dmk-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-[12.5px] font-semibold text-dmk-warning">Office UPI ID not set yet</p>
                <p className="text-[11.5px] text-dmk-text-secondary mt-0.5">
                  {payInfo?.phone
                    ? `Customer can pay to ${payInfo.phone} if it is UPI-linked, or collect cash and call the office.`
                    : "Collect cash for now and ask the office to add the UPI ID in Settings."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {payMode !== "CREDIT" && (
        <div className="space-y-1.5">
          <label
            htmlFor="driver-collected-amount"
            className="text-[11px] uppercase tracking-wider font-semibold text-dmk-text-muted block"
          >
            Amount collected (₹)
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="driver-collected-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled}
              className="h-12 font-money text-[17px] bg-dmk-input-well border-dmk-border-subtle text-dmk-text-primary"
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled || amount === String(stopAmount)}
              onClick={() => setAmount(String(stopAmount))}
              className="h-12 shrink-0 border-dmk-border-medium text-[12px] font-semibold text-dmk-text-secondary hover:text-dmk-text-primary"
            >
              Full {formatINR(stopAmount)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
