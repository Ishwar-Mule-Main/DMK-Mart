"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — PARTY LEDGERS (R7: opening → transactions → closing)
// Customers (Dr-positive) | Vendors (Cr-positive); statement card
// with running balanceAfter and Dr/Cr suffix. Coded against
// /customers, /vendors, /ledger/party response shapes.
// Cycle 15: A4 statement print pipeline + settle-from-row context
// (SALES/PURCHASE rows deep-link into pre-filled settlement dialogs).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { ArrowRight, BookOpenText, Building2, Download, HandCoins, Layers, Link2, Loader2, Printer, Truck, User, X } from "lucide-react";

import {
  Badge,
  DateText,
  EmptyState,
  ErrorText,
  LoadingRows,
  PageHeader,
  SearchInput,
} from "../shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGet } from "@/lib/api-client";
import { amountInWords, downloadCSV, formatINR, formatDate, fyLabel, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { A4PrintPortal, printA4 } from "@/components/erp/print-portal";
import { consumePendingLedgerParty, requestSettleCustomer, requestSettleVendor } from "@/lib/settle-bus";
import type { Firm } from "@/types/erp";

type BadgeTone = "success" | "warning" | "danger" | "info" | "dr" | "cr" | "neutral";

interface PartyMini {
  id: string;
  name: string;
  sub: string;
  balance: number; // Dr-positive for customers, Cr-positive for vendors
  gstin?: string;
  phone?: string;
  paymentTerms?: string;
}

interface LedgerEntryRow {
  id: string;
  entryDate: string;
  voucherType: string;
  voucherNo: string;
  particulars: string;
  debitAmount: number;
  creditAmount: number;
  balanceAfter: number;
}

/** One settled document inside a receipt/payment (cycle 21 drill-down). */
interface SettlementLine {
  docNumber: string;
  docDate: string;
  docTotal: number;
  allocated: number;
}

/** Full allocation context behind a RECEIPT / PAYMENT ledger row. */
interface SettlementDetail {
  id: string;
  date: string;
  amount: number;
  mode: string;
  ref: string;
  notes: string;
  lines: SettlementLine[];
  allocatedTotal: number;
  unapplied: number;
}

interface PartyLedgerResponse {
  partyType: "CUSTOMER" | "VENDOR";
  party: {
    id: string;
    name: string;
    stateCode: string;
    customerType?: string;
    vendorType?: string;
    brand?: string;
    creditLimit?: number;
    creditDays?: number;
    paymentTerms?: string;
    gstin?: string;
    phone?: string;
  };
  opening: number;
  entries: LedgerEntryRow[];
  closing: number;
  /** voucherNo → settlement detail (RECEIPT/PAYMENT rows only). */
  settlements?: Record<string, SettlementDetail>;
}

const VOUCHER_TONE: Record<string, BadgeTone> = {
  SALES: "success",
  RECEIPT: "dr",
  CREDIT_NOTE: "warning",
  PURCHASE: "info",
  PAYMENT: "cr",
  DEBIT_NOTE: "warning",
  OPENING: "neutral",
};

/** Balance suffix per party polarity: customer Dr-positive, vendor Cr-positive. */
function balanceParts(bal: number, partyType: "CUSTOMER" | "VENDOR"): { amount: number; suffix: string | null } {
  if (Math.abs(bal) < 0.005) return { amount: 0, suffix: null };
  const positive = bal > 0;
  const suffix = partyType === "CUSTOMER" ? (positive ? "Dr" : "Cr") : positive ? "Cr" : "Dr";
  return { amount: Math.abs(bal), suffix };
}

/** Voucher rows that can be settled directly from the statement (deep-link). */
const SETTLEABLE = new Set(["SALES", "PURCHASE"]);

export default function PartyLedgersView() {
  // Controlled tabs so cross-view deep links (aging rows) can preset the tab + party.
  const [tab, setTab] = React.useState<"customers" | "vendors">("customers");
  const [preset, setPreset] = React.useState<{ partyType: "CUSTOMER" | "VENDOR"; partyId: string } | null>(null);

  React.useEffect(() => {
    const pending = consumePendingLedgerParty();
    if (pending) {
      setPreset(pending);
      setTab(pending.partyType === "CUSTOMER" ? "customers" : "vendors");
    }
    const onPreset = (e: Event) => {
      const d = (e as CustomEvent<{ partyType: "CUSTOMER" | "VENDOR"; partyId: string }>).detail;
      if (d?.partyId) {
        setPreset(d);
        setTab(d.partyType === "CUSTOMER" ? "customers" : "vendors");
      }
    };
    window.addEventListener("dmk:ledger-party", onPreset);
    return () => window.removeEventListener("dmk:ledger-party", onPreset);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Party Ledgers"
        subtitle="Opening → transactions → closing statements for every customer and vendor (R7)"
        icon={BookOpenText}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "customers" | "vendors")} className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="customers" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Building2 className="h-4 w-4" /> Customers
          </TabsTrigger>
          <TabsTrigger value="vendors" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Truck className="h-4 w-4" /> Vendors
          </TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-0">
          <PartyTab partyType="CUSTOMER" presetPartyId={tab === "customers" ? preset?.partyId ?? null : null} onPresetConsumed={() => setPreset(null)} />
        </TabsContent>
        <TabsContent value="vendors" className="mt-0">
          <PartyTab partyType="VENDOR" presetPartyId={tab === "vendors" ? preset?.partyId ?? null : null} onPresetConsumed={() => setPreset(null)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARTY TAB — list (left) + ledger statement (right)
// ═══════════════════════════════════════════════════════════════

function PartyTab({
  partyType,
  presetPartyId,
  onPresetConsumed,
}: {
  partyType: "CUSTOMER" | "VENDOR";
  presetPartyId?: string | null;
  onPresetConsumed?: () => void;
}) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const activeFirm = useErpStore((s) => s.firms.find((f) => f.id === s.activeFirmId));
  const setView = useErpStore((s) => s.setView);
  const { toast } = useToast();

  const [query, setQuery] = React.useState("");
  const [parties, setParties] = React.useState<PartyMini[] | null>(null);
  const [listLoading, setListLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [ledger, setLedger] = React.useState<PartyLedgerResponse | null>(null);
  const [ledgerLoading, setLedgerLoading] = React.useState(false);
  const [ledgerError, setLedgerError] = React.useState<string | null>(null);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchLoading, setBatchLoading] = React.useState(false);
  const [batchProgress, setBatchProgress] = React.useState(0);
  const [batchSheets, setBatchSheets] = React.useState<Array<{ ledger: PartyLedgerResponse; closingWords: string | null }>>([]);
  const [settlementOf, setSettlementOf] = React.useState<SettlementDetail | null>(null);

  // Party directory (debounced server search)
  React.useEffect(() => {
    if (!activeFirmId) return;
    let alive = true;
    const t = setTimeout(async () => {
      setListLoading(true);
      try {
        if (partyType === "CUSTOMER") {
          const res = await apiGet<
            Array<{ id: string; partyName: string; city?: string; customerType: string; closingBalance: number; gstin?: string; phone?: string }>
          >("/api/v1/customers", { firmId: activeFirmId, search: query.trim() || undefined });
          if (alive) {
            setParties(
              res.map((c) => ({
                id: c.id,
                name: c.partyName,
                sub: c.customerType === "B2C_COUNTER" ? "Counter buyer" : (c.city || "B2B"),
                balance: c.closingBalance,
                gstin: c.gstin,
                phone: c.phone,
              }))
            );
          }
        } else {
          const res = await apiGet<
            Array<{ id: string; vendorName: string; vendorType: string; brand?: string; closingBalance: number; gstin?: string; phone?: string; paymentTerms?: string }>
          >("/api/v1/vendors", { firmId: activeFirmId, search: query.trim() || undefined });
          if (alive) {
            setParties(
              res.map((v) => ({
                id: v.id,
                name: v.vendorName,
                sub: v.vendorType === "MANUFACTURER" ? (v.brand || "Manufacturer") : "Distributor",
                balance: v.closingBalance,
                gstin: v.gstin,
                phone: v.phone,
                paymentTerms: v.paymentTerms,
              }))
            );
          }
        }
      } catch {
        if (alive) setParties([]);
      } finally {
        if (alive) setListLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [activeFirmId, partyType, query]);

  // Reset selection on firm / tab change
  React.useEffect(() => {
    setSelectedId(null);
    setLedger(null);
  }, [activeFirmId, partyType]);

  // Deep-link: auto-select the preset party once the directory arrives
  React.useEffect(() => {
    if (!presetPartyId || listLoading || !parties) return;
    if (parties.some((p) => p.id === presetPartyId)) {
      setSelectedId(presetPartyId);
    }
    onPresetConsumed?.();
  }, [presetPartyId, listLoading]);

  // Ledger statement fetch
  React.useEffect(() => {
    if (!activeFirmId || !selectedId) return;
    let alive = true;
    setLedgerLoading(true);
    setLedgerError(null);
    apiGet<PartyLedgerResponse>("/api/v1/ledger/party", {
      firmId: activeFirmId,
      partyType,
      partyId: selectedId,
    })
      .then((res) => {
        if (alive) setLedger(res);
      })
      .catch((e) => {
        if (alive) {
          setLedgerError(e instanceof Error ? e.message : "Failed to load ledger");
          setLedger(null);
        }
      })
      .finally(() => {
        if (alive) setLedgerLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeFirmId, partyType, selectedId]);

  function exportLedger() {
    if (!ledger) return;
    const out: (string | number)[][] = [
      ["Party Statement", ledger.party.name],
      [`Opening (${partyType === "CUSTOMER" ? "Dr" : "Cr"}-positive)`, ledger.opening],
      [],
      ["Date", "Voucher Type", "Voucher #", "Particulars", "Debit", "Credit", "Balance After"],
    ];
    for (const r of ledger.entries) {
      out.push([
        toISODate(r.entryDate),
        r.voucherType,
        r.voucherNo,
        r.particulars,
        r.debitAmount,
        r.creditAmount,
        r.balanceAfter,
      ]);
    }
    out.push([], ["Closing", ledger.closing]);
    downloadCSV(`ledger-${ledger.party.name.replace(/\s+/g, "-").toLowerCase()}.csv`, out);
    toast({ title: "Exported", description: "Party statement downloaded as CSV." });
  }

  const isCustomer = partyType === "CUSTOMER";
  const selectedParty = parties?.find((p) => p.id === selectedId) ?? null;
  const opening = balanceParts(ledger?.opening ?? 0, partyType);
  const closing = balanceParts(ledger?.closing ?? 0, partyType);

  /** Deep-link into the pre-filled settlement dialog on the right module. */
  function settleFromRow(row: LedgerEntryRow) {
    if (!selectedId) return;
    const isSales = row.voucherType === "SALES";
    if (isSales) requestSettleCustomer(selectedId);
    else requestSettleVendor(selectedId);
    setView(isSales ? "sales/receipts" : "purchase/payments");
    toast({
      title: isSales ? "Opening receipt dialog" : "Opening payment dialog",
      description: `${row.voucherNo || "Document"} pre-selected — confirm the settlement there.`,
    });
  }

  const closingWords = ledger && Math.abs(ledger.closing) > 0.005 ? amountInWords(Math.abs(ledger.closing)) : null;

  /**
   * Batch print: fetch ledgers for every party with an open balance
   * (oldest-first, capped for print sanity) and stack them as A4
   * sheets in one chrome-free print run — one page per party.
   */
  async function printAllStatements() {
    if (!activeFirmId || !parties || batchLoading) return;
    const withBalance = parties
      .filter((p) => Math.abs(p.balance) > 0.005)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
      .slice(0, 24);
    if (withBalance.length === 0) {
      toast({ title: "Nothing to print", description: "Every party in this book is fully settled." });
      return;
    }
    setBatchLoading(true);
    setBatchProgress(0);
    const sheets: Array<{ ledger: PartyLedgerResponse; closingWords: string | null }> = [];
    let failed = 0;
    for (const p of withBalance) {
      try {
        const res = await apiGet<PartyLedgerResponse>("/api/v1/ledger/party", {
          firmId: activeFirmId,
          partyType,
          partyId: p.id,
        });
        sheets.push({
          ledger: res,
          closingWords: Math.abs(res.closing) > 0.005 ? amountInWords(Math.abs(res.closing)) : null,
        });
      } catch {
        failed += 1;
      }
      setBatchProgress(sheets.length + failed);
    }
    setBatchLoading(false);
    if (sheets.length === 0) {
      toast({ variant: "destructive", title: "Could not load statements", description: "No ledgers could be fetched for printing." });
      return;
    }
    setBatchSheets(sheets);
    setBatchOpen(true);
    toast({
      title: `${sheets.length} statement${sheets.length === 1 ? "" : "s"} ready`,
      description: failed > 0 ? `${failed} ledger${failed === 1 ? "" : "s"} could not be loaded and were skipped.` : "Review the list, then print the whole batch.",
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
      {/* ── Party list ─────────────────────────────────── */}
      <div className="dmk-card p-3 flex flex-col gap-3 lg:sticky lg:top-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={isCustomer ? "Search customers…" : "Search vendors…"}
        />
        <button
          type="button"
          onClick={() => void printAllStatements()}
          disabled={batchLoading || listLoading || !parties}
          className={cn(
            "group flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
            "border-dmk-gold/35 bg-dmk-gold/5 hover:bg-dmk-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dmk-gold/50",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {batchLoading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-dmk-gold" />
            ) : (
              <Layers className="h-3.5 w-3.5 shrink-0 text-dmk-gold" />
            )}
            <span className="text-[12px] font-semibold text-dmk-text-primary truncate">
              {batchLoading ? `Preparing ${batchProgress}…` : "Print all statements"}
            </span>
          </span>
          <span className="dmk-badge bg-dmk-gold/15 text-dmk-gold shrink-0">
            {parties?.filter((p) => Math.abs(p.balance) > 0.005).length ?? 0} open
          </span>
        </button>
        <div className="max-h-[420px] lg:max-h-[calc(100vh-378px)] overflow-y-auto space-y-1.5 pr-0.5">
          {listLoading && !parties ? (
            <LoadingRows rows={5} />
          ) : !parties || parties.length === 0 ? (
            <p className="text-[12px] text-dmk-text-muted py-6 text-center">
              No parties found{query ? ` for “${query}”` : ""}.
            </p>
          ) : (
            parties.map((p) => {
              const bal = balanceParts(p.balance, partyType);
              const active = selectedId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                    active
                      ? "border-dmk-border-medium bg-dmk-hover"
                      : "border-dmk-border-subtle bg-dmk-input-well hover:bg-dmk-hover/60"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      {isCustomer ? (
                        <User className="h-3.5 w-3.5 text-dmk-text-muted shrink-0" />
                      ) : (
                        <Truck className="h-3.5 w-3.5 text-dmk-text-muted shrink-0" />
                      )}
                      <span className="text-[13px] font-medium text-dmk-text-primary truncate">{p.name}</span>
                    </span>
                    {bal.suffix ? (
                      <Badge tone={bal.suffix === "Dr" ? "dr" : "cr"}>
                        {bal.suffix} {formatINR(bal.amount)}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Clear</Badge>
                    )}
                  </span>
                  <span className="block text-[11px] text-dmk-text-muted mt-0.5 pl-5">{p.sub}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Ledger statement ───────────────────────────── */}
      <div className="space-y-4 min-w-0">
        {!selectedId ? (
          <EmptyState
            icon={BookOpenText}
            title="Select a party"
            hint="Pick a customer or vendor from the list to view their full ledger statement."
          />
        ) : ledgerLoading && !ledger ? (
          <LoadingRows rows={7} />
        ) : ledgerError ? (
          <ErrorText>{ledgerError}</ErrorText>
        ) : ledger ? (
          <>
            {/* Party header — letterhead-style with gold accent */}
            <div className="dmk-card p-4 relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-dmk-gold via-dmk-yellow to-transparent" />
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-bold text-dmk-text-primary truncate">{ledger.party.name}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <Badge tone={isCustomer ? "info" : "warning"}>
                      {isCustomer
                        ? (ledger.party.customerType === "B2C_COUNTER" ? "B2C COUNTER" : "B2B CUSTOMER")
                        : (ledger.party.vendorType ?? "VENDOR")}
                    </Badge>
                    <span className="text-[11.5px] text-dmk-text-muted">
                      State code {ledger.party.stateCode || "—"}
                    </span>
                    {isCustomer && (ledger.party.creditLimit ?? 0) > 0 && (
                      <span className="text-[11.5px] text-dmk-text-muted">
                        Credit limit {formatINR(ledger.party.creditLimit ?? 0)} · {ledger.party.creditDays ?? 0} days
                      </span>
                    )}
                    {!isCustomer && ledger.party.brand && (
                      <span className="text-[11.5px] text-dmk-text-muted">Brand: {ledger.party.brand}</span>
                    )}
                    {selectedParty?.gstin && (
                      <span className="text-[11.5px] text-dmk-text-muted font-money">GSTIN {selectedParty.gstin}</span>
                    )}
                    {selectedParty?.phone && (
                      <span className="text-[11.5px] text-dmk-text-muted">☎ {selectedParty.phone}</span>
                    )}
                    {!isCustomer && selectedParty?.paymentTerms && (
                      <span className="text-[11.5px] text-dmk-text-muted">Terms: {selectedParty.paymentTerms}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPrintOpen(true)}
                    className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
                  >
                    <Printer className="h-3.5 w-3.5" /> Print Statement
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportLedger}
                    className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
                  >
                    <Download className="h-3.5 w-3.5" /> Export CSV
                  </Button>
                </div>
              </div>

              {/* Balance flow: Opening → activity → Closing */}
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-dmk-border-subtle bg-dmk-input-well/60 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">Opening</span>
                  {opening.suffix ? (
                    <Badge tone={opening.suffix === "Dr" ? "dr" : "cr"}>{formatINR(opening.amount)} {opening.suffix}</Badge>
                  ) : (
                    <Badge tone="neutral">NIL</Badge>
                  )}
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-dmk-text-disabled" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">
                    {ledger.entries.length} txn{ledger.entries.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-[11px] text-dmk-text-muted">
                    Dr {formatINR(ledger.entries.reduce((s, r) => s + r.debitAmount, 0))} · Cr {formatINR(ledger.entries.reduce((s, r) => s + r.creditAmount, 0))}
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-dmk-text-disabled" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-dmk-text-muted">Closing</span>
                  {closing.suffix ? (
                    <Badge tone={closing.suffix === "Dr" ? "dr" : "cr"}>{formatINR(closing.amount)} {closing.suffix}</Badge>
                  ) : (
                    <Badge tone="success">SETTLED</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Statement table */}
            <div className="dmk-card overflow-hidden">
              <div className="overflow-x-auto max-h-[calc(100vh-480px)] overflow-y-auto">
                <table className="dmk-table">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Voucher #</th>
                      <th>Particulars</th>
                      <th className="num text-right">Debit (₹)</th>
                      <th className="num text-right">Credit (₹)</th>
                      <th className="num text-right">Balance (₹)</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening balance row */}
                    <tr className="bg-dmk-input-well/70">
                      <td colSpan={4} className="font-semibold text-dmk-text-secondary">
                        Opening Balance
                      </td>
                      <td className="num text-right">
                        {opening.suffix === "Dr" ? (
                          <span className="font-money text-dmk-yellow">{formatINR(opening.amount)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">—</span>
                        )}
                      </td>
                      <td className="num text-right">
                        {opening.suffix === "Cr" ? (
                          <span className="font-money text-dmk-info">{formatINR(opening.amount)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">—</span>
                        )}
                      </td>
                      <td className="num text-right font-money font-semibold text-dmk-text-primary">
                        {opening.suffix
                          ? `${formatINR(opening.amount)} ${opening.suffix}`
                          : formatINR(0)}
                      </td>
                      <td />
                    </tr>
                    {ledger.entries.map((r, idx) => {
                      const bal = balanceParts(r.balanceAfter, partyType);
                      const settleable = SETTLEABLE.has(r.voucherType) && Math.abs(r.balanceAfter) > 0.005;
                      return (
                        <tr
                          key={r.id}
                          className={cn(
                            "group/row transition-colors",
                            idx % 2 === 1 && "bg-dmk-input-well/30",
                            "hover:bg-dmk-hover/70"
                          )}
                        >
                          <td><DateText d={r.entryDate} /></td>
                          <td>
                            <Badge tone={VOUCHER_TONE[r.voucherType] ?? "neutral"}>{r.voucherType}</Badge>
                          </td>
                          <td className="font-money text-[12px] text-dmk-text-secondary whitespace-nowrap">
                            {r.voucherNo || "—"}
                          </td>
                          <td className="max-w-[240px]">
                            <span className="block truncate text-[12.5px] text-dmk-text-secondary" title={r.particulars}>
                              {r.particulars || "—"}
                            </span>
                          </td>
                          <td className="num text-right text-dmk-yellow">
                            {r.debitAmount ? formatINR(r.debitAmount) : "—"}
                          </td>
                          <td className="num text-right text-dmk-info">
                            {r.creditAmount ? formatINR(r.creditAmount) : "—"}
                          </td>
                          <td className="num text-right font-money text-dmk-text-primary">
                            {bal.suffix ? `${formatINR(bal.amount)} ${bal.suffix}` : formatINR(0)}
                          </td>
                          <td className="text-right pr-3">
                            {(() => {
                              const st = (r.voucherType === "RECEIPT" || r.voucherType === "PAYMENT") && r.voucherNo
                                ? ledger?.settlements?.[r.voucherNo]
                                : undefined;
                              if (st && st.lines.length > 0) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSettlementOf(st)}
                                    title={
                                      r.voucherType === "RECEIPT"
                                        ? `Settles ${st.lines.length} invoice${st.lines.length !== 1 ? "s" : ""} — open allocation breakdown`
                                        : `Settles ${st.lines.length} bill${st.lines.length !== 1 ? "s" : ""} — open allocation breakdown`
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-dmk-border-medium bg-dmk-input-well px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-dmk-text-secondary transition-all hover:bg-dmk-hover hover:text-dmk-text-primary focus:text-dmk-text-primary"
                                  >
                                    <Link2 className="h-3 w-3" />
                                    {st.lines.length}
                                  </button>
                                );
                              }
                              if (settleable) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => settleFromRow(r)}
                                    title={
                                      r.voucherType === "SALES"
                                        ? `Record a receipt against ${r.voucherNo || "this invoice"}`
                                        : `Record a payment against ${r.voucherNo || "this bill"}`
                                    }
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide",
                                      "opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-all",
                                      "border-dmk-border-medium bg-dmk-input-well hover:bg-dmk-hover",
                                      r.voucherType === "SALES"
                                        ? "text-dmk-success hover:border-dmk-success/40"
                                        : "text-dmk-info hover:border-dmk-info/40"
                                    )}
                                  >
                                    <HandCoins className="h-3 w-3" />
                                    {r.voucherType === "SALES" ? "Settle" : "Pay"}
                                  </button>
                                );
                              }
                              return null;
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                    {ledger.entries.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center text-dmk-text-muted py-6">
                          No transactions posted yet — only the opening balance.
                        </td>
                      </tr>
                    )}
                    {/* Closing balance row */}
                    <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                      <td colSpan={4} className="font-bold text-dmk-text-primary">Closing Balance</td>
                      <td className="num text-right">
                        {closing.suffix === "Dr" ? (
                          <span className="font-money font-bold text-dmk-yellow">{formatINR(closing.amount)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">—</span>
                        )}
                      </td>
                      <td className="num text-right">
                        {closing.suffix === "Cr" ? (
                          <span className="font-money font-bold text-dmk-info">{formatINR(closing.amount)}</span>
                        ) : (
                          <span className="text-dmk-text-muted">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "num text-right font-money font-bold",
                          closing.suffix === "Dr" ? "text-dmk-yellow" : closing.suffix === "Cr" ? "text-dmk-info" : "text-dmk-text-primary"
                        )}
                      >
                        {closing.suffix ? `${formatINR(closing.amount)} ${closing.suffix}` : formatINR(0)}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* A4 statement print preview */}
            <StatementPrintDialog
              open={printOpen}
              onOpenChange={setPrintOpen}
              ledger={ledger}
              partyType={partyType}
              firm={activeFirm}
              openingWords={
                opening.suffix && Math.abs(opening.amount) > 0.005 ? amountInWords(opening.amount) : null
              }
              closingWords={closingWords}
            />

            {/* Receipt / payment allocation drill-down (cycle 21) */}
            <SettlementDialog
              settlement={settlementOf}
              onClose={() => setSettlementOf(null)}
              partyType={partyType}
              partyName={ledger?.party.name ?? ""}
            />
          </>
        ) : null}
      </div>

      {/* Batch statement print — always mounted so it can open regardless of selection */}
      <BatchPrintDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        sheets={batchSheets}
        partyType={partyType}
        firm={activeFirm}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SETTLEMENT DRILL-DOWN — what did this receipt / payment close?
// RECEIPT rows → per-invoice allocations (ReceiptAllocation)
// PAYMENT rows → per-PO allocations (PaymentAllocation)
// ═══════════════════════════════════════════════════════════════

function SettlementDialog({
  settlement,
  onClose,
  partyType,
  partyName,
}: {
  settlement: SettlementDetail | null;
  onClose: () => void;
  partyType: "CUSTOMER" | "VENDOR";
  partyName: string;
}) {
  const isReceipt = partyType === "CUSTOMER";
  const open = !!settlement;
  const docLabel = isReceipt ? "Invoice" : "PO";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dmk-card max-h-[85vh] overflow-y-auto [&>*]:min-w-0">
        {settlement && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[16px] text-dmk-text-primary">
                <Link2 className={cn("h-4 w-4", isReceipt ? "text-dmk-yellow" : "text-dmk-info")} />
                {isReceipt ? "Receipt" : "Payment"} allocation
              </DialogTitle>
              <DialogDescription className="text-[12px] text-dmk-text-muted">
                {isReceipt ? "Receipt from" : "Payment to"} <span className="font-medium text-dmk-text-secondary">{partyName}</span> · {formatDate(settlement.date)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* header wells */}
              <div className="grid grid-cols-3 gap-2">
                <div className="dmk-well px-3 py-2">
                  <p className="text-[9.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">Total</p>
                  <p className="mt-0.5 font-money text-[13px] font-semibold text-dmk-text-primary">{formatINR(settlement.amount)}</p>
                </div>
                <div className="dmk-well px-3 py-2">
                  <p className="text-[9.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">Allocated</p>
                  <p className="mt-0.5 font-money text-[13px] font-semibold text-dmk-gold">{formatINR(settlement.allocatedTotal)}</p>
                </div>
                <div className="dmk-well px-3 py-2">
                  <p className="text-[9.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">Unapplied</p>
                  <p className={cn("mt-0.5 font-money text-[13px] font-semibold", settlement.unapplied > 0 ? "text-dmk-info" : "text-dmk-text-muted")}>
                    {formatINR(settlement.unapplied)}
                  </p>
                </div>
              </div>

              {/* meta chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={isReceipt ? "dr" : "cr"}>{settlement.mode}</Badge>
                {settlement.ref && (
                  <span className="rounded-md bg-dmk-input-well px-2 py-1 font-mono text-[10.5px] text-dmk-text-secondary">
                    ref {settlement.ref}
                  </span>
                )}
                {settlement.unapplied > 0 && (
                  <span className="rounded-md bg-dmk-info/10 px-2 py-1 text-[10.5px] font-semibold text-dmk-info">
                    on-account — awaiting allocation
                  </span>
                )}
              </div>

              {/* allocation table */}
              <div className="min-w-0 overflow-x-auto rounded-lg border border-dmk-border-subtle">
                <table className="dmk-table w-full min-w-[430px]">
                  <thead>
                    <tr>
                      <th>{docLabel}</th>
                      <th>Date</th>
                      <th className="text-right">Doc total</th>
                      <th className="text-right">Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlement.lines.map((l, i) => (
                      <tr key={`${l.docNumber}-${i}`}>
                        <td className="font-money text-[12px] font-semibold text-dmk-gold">{l.docNumber}</td>
                        <td><DateText d={l.docDate} /></td>
                        <td className="num text-right font-money text-dmk-text-secondary">{formatINR(l.docTotal)}</td>
                        <td className="num text-right font-money font-semibold text-dmk-text-primary">{formatINR(l.allocated)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-dmk-border-medium bg-dmk-hover/40">
                      <td colSpan={3} className="text-right text-[11px] font-semibold uppercase tracking-wide text-dmk-text-muted">
                        Settled
                      </td>
                      <td className="num text-right font-money font-semibold text-dmk-gold">
                        {formatINR(settlement.allocatedTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {settlement.notes && (
                <p className="rounded-md border border-dmk-border-subtle bg-dmk-input-well/50 px-3 py-2 text-[11.5px] text-dmk-text-secondary">
                  {settlement.notes}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// A4 STATEMENT OF ACCOUNT — print preview + chrome-free printing
// ═══════════════════════════════════════════════════════════════

function StatementSheet({
  ledger,
  partyType,
  firm,
  openingWords,
  closingWords,
}: {
  ledger: PartyLedgerResponse;
  partyType: "CUSTOMER" | "VENDOR";
  firm?: Firm;
  openingWords: string | null;
  closingWords: string | null;
}) {
  const isCustomer = partyType === "CUSTOMER";
  const opening = balanceParts(ledger.opening, partyType);
  const closing = balanceParts(ledger.closing, partyType);
  const totalDr = ledger.entries.reduce((s, r) => s + r.debitAmount, 0);
  const totalCr = ledger.entries.reduce((s, r) => s + r.creditAmount, 0);
  const mono = { fontFamily: "var(--font-jetbrains), monospace" };

  return (
    <div
      className="print-a4 bg-white text-gray-900 w-[794px] min-h-[1123px] px-10 py-8 flex flex-col shadow-lg"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
        <div className="min-w-0 flex">
          {firm?.logoUrl ? (
            <img src={firm.logoUrl} alt="" className="h-12 w-12 rounded object-cover mr-3 shrink-0" />
          ) : (
            <div className="h-12 w-12 rounded bg-gray-900 text-white flex items-center justify-center text-lg font-bold mr-3 shrink-0">
              {(firm?.firmName ?? "DMK").slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold leading-tight text-gray-900">{firm?.firmName ?? "DMK Mart"}</h2>
            <p className="text-[10.5px] text-gray-600 mt-0.5 whitespace-pre-line leading-snug">{firm?.address ?? ""}</p>
            <div className="text-[10.5px] text-gray-700 mt-1 space-x-3">
              <span>
                GSTIN:{" "}
                <span className="font-semibold" style={mono}>
                  {firm?.gstin ?? "—"}
                </span>
              </span>
              {firm?.phone && <span>Ph: {firm.phone}</span>}
              {firm?.email && <span>{firm.email}</span>}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[18px] font-extrabold tracking-wide text-gray-900 uppercase">Statement of Account</p>
          <p className="text-[10.5px] text-gray-500 mt-1">
            Financial Year {firm?.financialYear ?? fyLabel(new Date())} · as of {formatDate(new Date())}
          </p>
          <span className="inline-block mt-2 text-[9.5px] font-bold uppercase tracking-wider text-gray-700 border border-gray-400 rounded px-2 py-0.5">
            {isCustomer ? "Receivable Statement" : "Payable Statement"}
          </span>
        </div>
      </div>

      {/* Party + summary */}
      <div className="grid grid-cols-2 gap-6 border-b border-gray-300 py-3">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            {isCustomer ? "Bill To" : "Supplier"}
          </p>
          <p className="text-[13.5px] font-bold text-gray-900 leading-snug">{ledger.party.name}</p>
          <p className="text-[10.5px] text-gray-700 mt-1">
            GSTIN:{" "}
            <span className="font-semibold" style={mono}>
              {ledger.party.gstin || "URP / Unregistered"}
            </span>
          </p>
          <p className="text-[10.5px] text-gray-600 mt-0.5">
            State code {ledger.party.stateCode || "—"}
            {ledger.party.phone ? ` · ☎ ${ledger.party.phone}` : ""}
          </p>
          {isCustomer && (ledger.party.creditLimit ?? 0) > 0 && (
            <p className="text-[10.5px] text-gray-600">
              Credit limit ₹{Number(ledger.party.creditLimit).toFixed(2)} · {ledger.party.creditDays ?? 0} days
            </p>
          )}
          {!isCustomer && ledger.party.paymentTerms && (
            <p className="text-[10.5px] text-gray-600">Payment terms: {ledger.party.paymentTerms}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] content-start" style={mono}>
          <span className="text-gray-500">Opening balance:</span>
          <span className="font-semibold text-right">
            {opening.suffix ? `${opening.suffix} ₹${opening.amount.toFixed(2)}` : "NIL"}
          </span>
          <span className="text-gray-500">Transactions:</span>
          <span className="font-semibold text-right">{ledger.entries.length}</span>
          <span className="text-gray-500">Total debits:</span>
          <span className="font-semibold text-right">₹{totalDr.toFixed(2)}</span>
          <span className="text-gray-500">Total credits:</span>
          <span className="font-semibold text-right">₹{totalCr.toFixed(2)}</span>
        </div>
      </div>

      {/* Entries */}
      <table className="w-full border-collapse mt-3 text-[10.5px]" style={mono}>
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-left w-[72px]">Date</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-left w-[64px]">Voucher</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-left w-[92px]">Number</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-left">Particulars</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-right w-[72px]">Debit ₹</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-right w-[72px]">Credit ₹</th>
            <th className="border border-gray-300 px-1.5 py-1.5 text-[9.5px] font-bold uppercase text-gray-700 text-right w-[88px]">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-300 px-1.5 py-1 font-semibold" colSpan={6}>
              Opening Balance
            </td>
            <td className="border border-gray-300 px-1.5 py-1 text-right font-semibold">
              {opening.suffix ? `${opening.suffix} ${opening.amount.toFixed(2)}` : "0.00"}
            </td>
          </tr>
          {ledger.entries.map((r) => {
            const bal = balanceParts(r.balanceAfter, partyType);
            return (
              <tr key={r.id}>
                <td className="border border-gray-300 px-1.5 py-1 whitespace-nowrap">{formatDate(r.entryDate)}</td>
                <td className="border border-gray-300 px-1.5 py-1">{r.voucherType.replace("_", " ")}</td>
                <td className="border border-gray-300 px-1.5 py-1">{r.voucherNo || "—"}</td>
                <td className="border border-gray-300 px-1.5 py-1 truncate max-w-[220px]">{r.particulars || "—"}</td>
                <td className="border border-gray-300 px-1.5 py-1 text-right">{r.debitAmount ? r.debitAmount.toFixed(2) : "—"}</td>
                <td className="border border-gray-300 px-1.5 py-1 text-right">{r.creditAmount ? r.creditAmount.toFixed(2) : "—"}</td>
                <td className="border border-gray-300 px-1.5 py-1 text-right font-semibold">
                  {bal.suffix ? `${bal.suffix} ${bal.amount.toFixed(2)}` : "0.00"}
                </td>
              </tr>
            );
          })}
          <tr className="bg-gray-100 font-bold">
            <td className="border border-gray-300 px-1.5 py-1.5" colSpan={4}>
              Totals
            </td>
            <td className="border border-gray-300 px-1.5 py-1.5 text-right">{totalDr.toFixed(2)}</td>
            <td className="border border-gray-300 px-1.5 py-1.5 text-right">{totalCr.toFixed(2)}</td>
            <td className="border border-gray-300 px-1.5 py-1.5 text-right">
              {closing.suffix ? `${closing.suffix} ${closing.amount.toFixed(2)}` : "0.00"}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Closing balance block */}
      <div className="mt-3 border border-gray-300 rounded p-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-500">
            Closing balance {closing.suffix ? `(${closing.suffix})` : "(Settled)"}
          </p>
          <p className="text-[15px] font-extrabold text-gray-900 mt-0.5" style={mono}>
            ₹{(closing.suffix ? closing.amount : 0).toFixed(2)} {closing.suffix ?? ""}
          </p>
          {closingWords && (
            <p className="text-[10.5px] text-gray-600 mt-1 leading-snug">
              <span className="font-semibold text-gray-700">In words:</span> {closingWords}
            </p>
          )}
          {openingWords && (
            <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">
              Opening was {openingWords} {opening.suffix ?? ""}
            </p>
          )}
        </div>
        <div className="text-center shrink-0 pt-2">
          <div className="w-40 border-t border-gray-400 pt-1 text-[9.5px] text-gray-500">
            For {firm?.firmName ?? "DMK Mart"} — Authorised Signatory
          </div>
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-gray-200 text-[9px] text-gray-400 flex items-center justify-between">
        <span>
          System-generated statement · DMK Mart ERP · {isCustomer ? "subject to credit policy" : "subject to agreed vendor terms"}
        </span>
        <span style={mono}>Page 1 · {new Date().toLocaleDateString("en-IN")}</span>
      </div>
    </div>
  );
}

function StatementPrintDialog({
  open,
  onOpenChange,
  ledger,
  partyType,
  firm,
  openingWords,
  closingWords,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ledger: PartyLedgerResponse;
  partyType: "CUSTOMER" | "VENDOR";
  firm?: Firm;
  openingWords: string | null;
  closingWords: string | null;
}) {
  const SCALE = 0.66;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="no-print max-h-[92vh] overflow-hidden flex flex-col border-dmk-border-medium dmk-elevated">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary">Statement of account — A4 preview</DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              Letterhead statement for {ledger.party.name} — print via the system dialog (chrome-free output).
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto dmk-well rounded-lg p-3 flex justify-center">
            <div
              className="overflow-hidden rounded-md border border-dmk-border-subtle shrink-0"
              style={{ width: 794 * SCALE, height: 1123 * SCALE }}
            >
              <div style={{ transform: `scale(${SCALE})`, transformOrigin: "top left", width: 794 }}>
                <StatementSheet
                  ledger={ledger}
                  partyType={partyType}
                  firm={firm}
                  openingWords={openingWords}
                  closingWords={closingWords}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
            >
              <X className="h-4 w-4" /> Close
            </Button>
            <Button onClick={printA4} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
              <Printer className="h-4 w-4" /> Print statement
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {open && (
        <A4PrintPortal>
          <StatementSheet
            ledger={ledger}
            partyType={partyType}
            firm={firm}
            openingWords={openingWords}
            closingWords={closingWords}
          />
        </A4PrintPortal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// BATCH STATEMENT PRINT — one A4 page per open-balance party,
// stacked into a single chrome-free print run (cycle 18).
// ═══════════════════════════════════════════════════════════════

function BatchPrintDialog({
  open,
  onOpenChange,
  sheets,
  partyType,
  firm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sheets: Array<{ ledger: PartyLedgerResponse; closingWords: string | null }>;
  partyType: "CUSTOMER" | "VENDOR";
  firm?: Firm;
}) {
  const totalDue = sheets.reduce((s, sh) => {
    const parts = balanceParts(sh.ledger.closing, partyType);
    return s + (parts.suffix === (partyType === "CUSTOMER" ? "Dr" : "Cr") ? parts.amount : 0);
  }, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="no-print max-h-[86vh] overflow-hidden flex flex-col border-dmk-border-medium dmk-elevated">
          <DialogHeader>
            <DialogTitle className="text-dmk-text-primary flex items-center gap-2">
              <Layers className="h-4 w-4 text-dmk-gold" />
              Batch statement print — {sheets.length} page{sheets.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription className="text-dmk-text-muted">
              One A4 statement per party with an open balance, largest first. Print runs chrome-free.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto dmk-well rounded-lg p-2 space-y-1">
            {sheets.map(({ ledger }) => {
              const bal = balanceParts(ledger.closing, partyType);
              return (
                <div
                  key={ledger.party.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-dmk-border-subtle bg-dmk-input-well px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium text-dmk-text-primary truncate">{ledger.party.name}</span>
                    <span className="block text-[10.5px] text-dmk-text-muted">
                      {ledger.entries.length} entr{ledger.entries.length === 1 ? "y" : "ies"}
                    </span>
                  </span>
                  {bal.suffix ? (
                    <Badge tone={bal.suffix === "Dr" ? "dr" : "cr"}>
                      {bal.suffix} {formatINR(bal.amount)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Clear</Badge>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11.5px] text-dmk-text-muted font-money">
              {partyType === "CUSTOMER" ? "Receivables" : "Payables"} in batch: {formatINR(totalDue)}
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-dmk-border-medium text-dmk-text-secondary hover:bg-dmk-hover"
              >
                <X className="h-4 w-4" /> Close
              </Button>
              <Button onClick={printA4} className="bg-dmk-yellow text-white hover:bg-dmk-yellow/90">
                <Printer className="h-4 w-4" /> Print {sheets.length} pages
              </Button>
            </span>
          </div>
        </DialogContent>
      </Dialog>
      {open && (
        <A4PrintPortal>
          <div className="dmk-batch-root">
            {sheets.map(({ ledger, closingWords }) => (
              <StatementSheet
                key={ledger.party.id}
                ledger={ledger}
                partyType={partyType}
                firm={firm}
                openingWords={null}
                closingWords={closingWords}
              />
            ))}
          </div>
        </A4PrintPortal>
      )}
    </>
  );
}
