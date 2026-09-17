"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — LOGIN GATE (company-account sign-in)
// • Sign in: pick a company account + password (demo password 1234)
// • Create new account: provisions a BRAND-NEW company with fully
//   separate products, parties, stock pools, books & numbering.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DmkLogo } from "./dmk-logo";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useErpStore } from "@/store/erp-store";
import type { Firm } from "@/types/erp";
import { cn } from "@/lib/utils";
import {
  Building2,
  Lock,
  LogIn,
  UserPlus,
  Eye,
  EyeOff,
  ShieldCheck,
  BookLock,
  Boxes,
  Landmark,
  Loader2,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Sparkles,
} from "lucide-react";

const STATES: Array<{ code: string; name: string }> = [
  { code: "27", name: "Maharashtra (27)" },
  { code: "29", name: "Karnataka (29)" },
  { code: "36", name: "Telangana (36)" },
  { code: "33", name: "Tamil Nadu (33)" },
  { code: "24", name: "Gujarat (24)" },
  { code: "07", name: "Delhi (07)" },
  { code: "09", name: "Uttar Pradesh (09)" },
  { code: "23", name: "Madhya Pradesh (23)" },
  { code: "37", name: "Andhra Pradesh (37)" },
  { code: "32", name: "Kerala (32)" },
  { code: "19", name: "West Bengal (19)" },
  { code: "21", name: "Odisha (21)" },
  { code: "10", name: "Bihar (10)" },
  { code: "06", name: "Haryana (06)" },
  { code: "08", name: "Rajasthan (08)" },
  { code: "03", name: "Punjab (03)" },
];

interface AccountOption {
  id: string;
  firmName: string;
  firmCode: string;
  gstin: string;
  state: string;
  logoUrl?: string | null;
  createdAt: string;
}

const inputCls =
  "dmk-input h-10 w-full rounded-lg border border-dmk-border-subtle bg-dmk-input-well px-3 text-[14px] text-dmk-text-primary placeholder:text-dmk-text-disabled focus-visible:outline-none focus-visible:border-dmk-border-medium";

export function LoginGate() {
  const signIn = useErpStore((s) => s.signIn);

  // ── sign-in state ──
  const [accounts, setAccounts] = React.useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [signingIn, setSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);

  // ── register state ──
  const [reg, setReg] = React.useState({
    firmName: "",
    firmCode: "",
    firmCodeAuto: true,
    password: "1234",
    gstin: "",
    stateCode: "27",
    phone: "",
    email: "",
    address: "",
    openingCash: "",
    openingBank: "",
  });
  const [creating, setCreating] = React.useState(false);
  const [regError, setRegError] = React.useState<string | null>(null);
  const [regSuccess, setRegSuccess] = React.useState<string | null>(null);

  const loadAccounts = React.useCallback(async () => {
    setAccountsLoading(true);
    try {
      const list = await apiGet<AccountOption[]>("/api/v1/auth/accounts");
      setAccounts(list ?? []);
      if (list && list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [selectedId]);

  React.useEffect(() => {
    loadAccounts();
  }, []);

  const selected = accounts.find((a) => a.id === selectedId);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !password) {
      setSignInError("Select your company account and enter the password");
      return;
    }
    setSigningIn(true);
    setSignInError(null);
    try {
      const { firm } = await apiPost<{ firm: Firm }>("/api/v1/auth/login", {
        firmId: selectedId,
        password,
      });
      signIn(firm);
    } catch (err) {
      setSignInError(
        err instanceof ApiError ? err.message : "Sign-in failed — please try again"
      );
    } finally {
      setSigningIn(false);
    }
  };

  const suggestCode = (name: string) =>
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    setRegSuccess(null);
    if (!reg.firmName.trim() || reg.firmName.trim().length < 2) {
      setRegError("Enter the company name (min 2 characters)");
      return;
    }
    if (!/^[A-Z0-9]{2,12}$/.test(reg.firmCode)) {
      setRegError("Account code must be 2–12 letters/numbers (A-Z, 0-9)");
      return;
    }
    if (reg.password && reg.password.length < 4) {
      setRegError("Password must be at least 4 characters");
      return;
    }
    setCreating(true);
    try {
      const { firm } = await apiPost<{ firm: Firm }>("/api/v1/auth/register", {
        firmName: reg.firmName.trim(),
        firmCode: reg.firmCode,
        password: reg.password || "1234",
        gstin: reg.gstin.trim(),
        stateCode: reg.stateCode,
        state: STATES.find((s) => s.code === reg.stateCode)?.name.replace(/ \(\d+\)/, "") ?? "",
        phone: reg.phone.trim(),
        email: reg.email.trim(),
        address: reg.address.trim(),
        openingCash: reg.openingCash ? Number(reg.openingCash) : 0,
        openingBank: reg.openingBank ? Number(reg.openingBank) : 0,
      });
      setRegSuccess(`${firm.firmName} is ready — signing you in…`);
      setTimeout(() => signIn(firm), 900);
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : "Could not create the account");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-dmk-bg-primary">
      {/* ── Brand story panel ─────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col justify-between w-[460px] xl:w-[520px] shrink-0 border-r border-dmk-border-subtle bg-[#0D1527] px-10 py-10 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-dmk-gold/10 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute bottom-10 -right-20 h-64 w-64 rounded-full bg-dmk-blue/10 blur-3xl"
        />
        <div className="relative">
          <DmkLogo className="h-20 w-20" />
          <h1 className="mt-6 text-[26px] font-black tracking-tight text-dmk-text-primary">
            DMK Mart <span className="text-dmk-gold">ERP</span>
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-dmk-text-secondary max-w-[36ch]">
            AI-native trading, distribution &amp; bookkeeping platform — real-time
            double-entry books, dual-stock inventory, GST engine, B2B + B2C sales.
          </p>
        </div>

        <div className="relative space-y-3.5">
          {[
            {
              icon: BookLock,
              title: "Every account has its own books",
              body: "Each company account signs in separately — products, parties, stock, ledgers and GST are fully isolated.",
            },
            {
              icon: Landmark,
              title: "Paisa-exact double entry",
              body: "Every rupee posted through journals, trial balance, P&L and balance sheet that always tally.",
            },
            {
              icon: Boxes,
              title: "Dual-stock control",
              body: "Sellable and damaged stock never mix — quarantine, returns and write-offs built in.",
            },
          ].map((f) => (
            <div key={f.title} className="flex gap-3">
              <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-dmk-gold/12 border border-dmk-gold/25 flex items-center justify-center">
                <f.icon className="h-4 w-4 text-dmk-gold" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-[13.5px] font-semibold text-dmk-text-primary">{f.title}</p>
                <p className="text-[12.5px] text-dmk-text-muted leading-snug mt-0.5 max-w-[42ch]">
                  {f.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative text-[12px] text-dmk-text-muted">
          Σ Debits ≡ Σ Credits · Indian Rupees (₹) · FY 2025-26
        </p>
      </aside>

      {/* ── Auth panel ────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-[440px]">
          {/* Mobile brand */}
          <div className="lg:hidden flex flex-col items-center text-center mb-6">
            <DmkLogo className="h-16 w-16" />
            <p className="mt-3 text-[19px] font-black text-dmk-text-primary">
              DMK Mart <span className="text-dmk-gold">ERP</span>
            </p>
            <p className="text-[12.5px] text-dmk-text-muted mt-1">
              Company accounts · separate books per account
            </p>
          </div>

          <div className="dmk-elevated p-6 sm:p-7">
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2 h-10 bg-dmk-input-well border border-dmk-border-subtle rounded-lg p-1">
                <TabsTrigger
                  value="signin"
                  className="gap-1.5 text-[13.5px] font-semibold data-[state=active]:bg-dmk-hover data-[state=active]:text-dmk-text-primary rounded-md"
                >
                  <LogIn className="h-3.5 w-3.5" /> Sign in
                </TabsTrigger>
                <TabsTrigger
                  value="create"
                  className="gap-1.5 text-[13.5px] font-semibold data-[state=active]:bg-dmk-gold/15 data-[state=active]:text-dmk-gold rounded-md"
                >
                  <UserPlus className="h-3.5 w-3.5" /> New account
                </TabsTrigger>
              </TabsList>

              {/* ── SIGN IN ── */}
              <TabsContent value="signin" className="mt-5">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                      Company account
                    </Label>
                    <Select
                      value={selectedId}
                      onValueChange={(v) => {
                        setSelectedId(v);
                        setSignInError(null);
                      }}
                      disabled={accountsLoading}
                    >
                      <SelectTrigger className="h-10 w-full border-dmk-border-subtle bg-dmk-input-well text-[14px] text-dmk-text-primary">
                        <span className="flex items-center gap-2 min-w-0">
                          <Building2 className="h-4 w-4 text-dmk-blue shrink-0" />
                          <SelectValue
                            placeholder={accountsLoading ? "Loading accounts…" : "Select company account"}
                          />
                        </span>
                      </SelectTrigger>
                      <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium">
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id} className="text-[14px]">
                            <span className="flex flex-col">
                              <span className="font-medium">{a.firmName}</span>
                              <span className="text-[12px] text-dmk-text-muted">
                                {a.firmCode} · {a.state}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selected && (
                      <p className="text-[12px] text-dmk-text-muted">
                        {selected.state} · GSTIN {selected.gstin || "not set"}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" />
                      <input
                        type={showPw ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setSignInError(null);
                        }}
                        placeholder="Enter password"
                        autoComplete="current-password"
                        className={cn(inputCls, "pl-9 pr-10")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dmk-text-muted hover:text-dmk-text-secondary"
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-[12px] text-dmk-text-muted flex items-center gap-1.5">
                      <KeyRound className="h-3 w-3 text-dmk-gold" />
                      Demo password for every account: <span className="font-money font-semibold text-dmk-gold">1234</span>
                    </p>
                  </div>

                  {signInError && (
                    <div className="flex items-start gap-2 rounded-lg border border-dmk-danger/30 bg-dmk-danger/10 px-3 py-2.5">
                      <AlertCircle className="h-4 w-4 text-dmk-danger shrink-0 mt-0.5" />
                      <p className="text-[13px] text-dmk-danger">{signInError}</p>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={signingIn || accountsLoading || !selectedId}
                    className="w-full h-10 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-bold text-[15px] rounded-lg"
                  >
                    {signingIn ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4" /> Sign in to workspace
                      </>
                    )}
                  </Button>

                  <p className="text-center text-[12px] text-dmk-text-muted">
                    Want a separate company with its own books?{" "}
                    <span className="text-dmk-gold font-semibold">Use the New account tab</span>
                  </p>
                </form>
              </TabsContent>

              {/* ── CREATE NEW ACCOUNT ── */}
              <TabsContent value="create" className="mt-5">
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="rounded-lg border border-dmk-gold/25 bg-dmk-gold/8 px-3 py-2.5 flex gap-2">
                    <Sparkles className="h-4 w-4 text-dmk-gold shrink-0 mt-0.5" />
                    <p className="text-[12.5px] leading-snug text-dmk-text-secondary">
                      A new company account starts <span className="text-dmk-gold font-semibold">completely separate</span> —
                      its own products, customers, stock pools, chart of accounts, journals and invoice numbering.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Company name <span className="text-dmk-gold">*</span>
                      </Label>
                      <input
                        value={reg.firmName}
                        onChange={(e) => {
                          const v = e.target.value;
                          setReg((p) => ({
                            ...p,
                            firmName: v,
                            firmCode:
                              !p.firmCode || p.firmCodeAuto ? suggestCode(v) : p.firmCode,
                          }));
                          setRegError(null);
                        }}
                        placeholder="e.g. DMK Enterprises"
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Account code <span className="text-dmk-gold">*</span>
                      </Label>
                      <input
                        value={reg.firmCode}
                        onChange={(e) => {
                          setReg((p) => ({
                            ...p,
                            firmCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
                            firmCodeAuto: false,
                          }));
                          setRegError(null);
                        }}
                        placeholder="DMK2"
                        className={cn(inputCls, "font-money uppercase")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Password
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dmk-text-muted" />
                        <input
                          type={showPw ? "text" : "password"}
                          value={reg.password}
                          onChange={(e) => setReg((p) => ({ ...p, password: e.target.value }))}
                          placeholder="1234"
                          className={cn(inputCls, "pl-9")}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        State
                      </Label>
                      <Select
                        value={reg.stateCode}
                        onValueChange={(v) => setReg((p) => ({ ...p, stateCode: v }))}
                      >
                        <SelectTrigger className="h-10 w-full border-dmk-border-subtle bg-dmk-input-well text-[14px] text-dmk-text-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-dmk-bg-tertiary border-dmk-border-medium max-h-64">
                          {STATES.map((s) => (
                            <SelectItem key={s.code} value={s.code} className="text-[13.5px]">
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        GSTIN <span className="text-dmk-text-disabled normal-case">(optional)</span>
                      </Label>
                      <input
                        value={reg.gstin}
                        onChange={(e) => setReg((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                        placeholder="27ABCDE1234F1Z5"
                        className={cn(inputCls, "font-money")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Phone
                      </Label>
                      <input
                        value={reg.phone}
                        onChange={(e) => setReg((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+91 …"
                        className={inputCls}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Opening bank (₹)
                      </Label>
                      <input
                        value={reg.openingBank}
                        onChange={(e) => setReg((p) => ({ ...p, openingBank: e.target.value.replace(/[^\d.]/g, "") }))}
                        placeholder="0"
                        inputMode="decimal"
                        className={cn(inputCls, "font-money")}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[12px] uppercase tracking-wider text-dmk-text-muted font-semibold">
                        Address
                      </Label>
                      <input
                        value={reg.address}
                        onChange={(e) => setReg((p) => ({ ...p, address: e.target.value }))}
                        placeholder="Street, city, PIN"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {regError && (
                    <div className="flex items-start gap-2 rounded-lg border border-dmk-danger/30 bg-dmk-danger/10 px-3 py-2.5">
                      <AlertCircle className="h-4 w-4 text-dmk-danger shrink-0 mt-0.5" />
                      <p className="text-[13px] text-dmk-danger">{regError}</p>
                    </div>
                  )}
                  {regSuccess && (
                    <div className="flex items-start gap-2 rounded-lg border border-dmk-success/30 bg-dmk-success/10 px-3 py-2.5">
                      <CheckCircle2 className="h-4 w-4 text-dmk-success shrink-0 mt-0.5" />
                      <p className="text-[13px] text-dmk-success">{regSuccess}</p>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={creating || regSuccess !== null}
                    className="w-full h-10 bg-dmk-gold text-[#0A0F1D] hover:bg-dmk-gold/90 font-bold text-[15px] rounded-lg"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Creating company…
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" /> Create company account
                      </>
                    )}
                  </Button>

                  <p className="text-center text-[12px] text-dmk-text-muted flex items-center justify-center gap-1.5">
                    <ShieldCheck className="h-3 w-3 text-dmk-success" />
                    If password is left blank, the demo password <span className="font-money text-dmk-gold">1234</span> is set
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          <p className="mt-5 text-center text-[12px] text-dmk-text-muted">
            DMK Mart ERP · AI-Native Trading, Distribution &amp; Bookkeeping Platform
          </p>
        </div>
      </main>
    </div>
  );
}
