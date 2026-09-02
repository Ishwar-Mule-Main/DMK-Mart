"use client";

// ═══════════════════════════════════════════════════════════════
// FINANCE — PARTY LEDGERS (R7: opening → transactions → closing)
// Customers (Dr-positive) | Vendors (Cr-positive); statement card
// with running balanceAfter and Dr/Cr suffix. Coded against
// /customers, /vendors, /ledger/party response shapes.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { BookOpenText, Building2, Download, Truck, User } from "lucide-react";

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
import { apiGet } from "@/lib/api-client";
import { downloadCSV, formatINR, toISODate } from "@/lib/format";
import { useErpStore } from "@/store/erp-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

export default function PartyLedgersView() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Party Ledgers"
        subtitle="Opening → transactions → closing statements for every customer and vendor (R7)"
        icon={BookOpenText}
      />
      <Tabs defaultValue="customers" className="gap-4">
        <TabsList className="bg-dmk-input-well border border-dmk-border-subtle">
          <TabsTrigger value="customers" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Building2 className="h-4 w-4" /> Customers
          </TabsTrigger>
          <TabsTrigger value="vendors" className="data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary">
            <Truck className="h-4 w-4" /> Vendors
          </TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-0">
          <PartyTab partyType="CUSTOMER" />
        </TabsContent>
        <TabsContent value="vendors" className="mt-0">
          <PartyTab partyType="VENDOR" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PARTY TAB — list (left) + ledger statement (right)
// ═══════════════════════════════════════════════════════════════

function PartyTab({ partyType }: { partyType: "CUSTOMER" | "VENDOR" }) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);
  const { toast } = useToast();

  const [query, setQuery] = React.useState("");
  const [parties, setParties] = React.useState<PartyMini[] | null>(null);
  const [listLoading, setListLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [ledger, setLedger] = React.useState<PartyLedgerResponse | null>(null);
  const [ledgerLoading, setLedgerLoading] = React.useState(false);
  const [ledgerError, setLedgerError] = React.useState<string | null>(null);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-start">
      {/* ── Party list ─────────────────────────────────── */}
      <div className="dmk-card p-3 flex flex-col gap-3 lg:sticky lg:top-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={isCustomer ? "Search customers…" : "Search vendors…"}
        />
        <div className="max-h-[420px] lg:max-h-[calc(100vh-330px)] overflow-y-auto space-y-1.5 pr-0.5">
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
            {/* Party header */}
            <div className="dmk-card p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
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
              <Button
                variant="outline"
                size="sm"
                onClick={exportLedger}
                className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover shrink-0"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>

            {/* Statement table */}
            <div className="dmk-card overflow-hidden">
              <div className="overflow-x-auto max-h-[calc(100vh-420px)] overflow-y-auto">
                <table className="dmk-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Voucher #</th>
                      <th>Particulars</th>
                      <th className="num text-right">Debit (₹)</th>
                      <th className="num text-right">Credit (₹)</th>
                      <th className="num text-right">Balance (₹)</th>
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
                          <span className="font-money text-dmk-orange">{formatINR(opening.amount)}</span>
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
                    </tr>
                    {ledger.entries.map((r) => {
                      const bal = balanceParts(r.balanceAfter, partyType);
                      return (
                        <tr key={r.id}>
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
                          <td className="num text-right text-dmk-orange">
                            {r.debitAmount ? formatINR(r.debitAmount) : "—"}
                          </td>
                          <td className="num text-right text-dmk-info">
                            {r.creditAmount ? formatINR(r.creditAmount) : "—"}
                          </td>
                          <td className="num text-right font-money text-dmk-text-primary">
                            {bal.suffix ? `${formatINR(bal.amount)} ${bal.suffix}` : formatINR(0)}
                          </td>
                        </tr>
                      );
                    })}
                    {ledger.entries.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-dmk-text-muted py-6">
                          No transactions posted yet — only the opening balance.
                        </td>
                      </tr>
                    )}
                    {/* Closing balance row */}
                    <tr className="bg-dmk-hover/70 border-t-2 border-dmk-border-medium">
                      <td colSpan={4} className="font-bold text-dmk-text-primary">Closing Balance</td>
                      <td className="num text-right">
                        {closing.suffix === "Dr" ? (
                          <span className="font-money font-bold text-dmk-orange">{formatINR(closing.amount)}</span>
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
                          closing.suffix === "Dr" ? "text-dmk-orange" : closing.suffix === "Cr" ? "text-dmk-info" : "text-dmk-text-primary"
                        )}
                      >
                        {closing.suffix ? `${formatINR(closing.amount)} ${closing.suffix}` : formatINR(0)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
