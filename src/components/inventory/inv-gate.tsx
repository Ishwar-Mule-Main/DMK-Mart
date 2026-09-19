"use client";

// ═══════════════════════════════════════════════════════════════
// INVGATE — Universal Inventory login.
// ID "Kunal" + portal password (verified against a pbkdf2-hashed
// hash server-side; the plain password never touches storage).
// Wrong password gets a gentle shake + message — no hints leaked.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invPost, type InvSessionInfo } from "@/components/inventory/inv-api";
import { Boxes, Loader2, Lock, ShieldCheck, CircleUser, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function InvGate({ onSignedIn }: { onSignedIn: (s: InvSessionInfo) => void }) {
  const [username, setUsername] = React.useState("Kunal");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await invPost<InvSessionInfo & { success?: boolean; reason?: string }>("/api/v1/inventory/auth/login", {
        username: username.trim(),
        password,
      });
      if (res.success === false || !res.username) {
        setError("Invalid ID or password. Try again.");
        return;
      }
      onSignedIn(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-dmk-bg-primary">
      <div className="flex-1 flex items-center justify-center px-4 py-10 relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[720px] rounded-full blur-3xl bg-dmk-yellow/10" />
        <div className="w-full max-w-[420px] dmk-card p-7 relative dmk-enter">
          <a href="/" className="inline-flex items-center gap-1.5 text-[11.5px] text-dmk-text-muted hover:text-dmk-text-secondary mb-4 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to DMK Mart ERP
          </a>
          <div className="flex flex-col items-center text-center gap-3">
            <div className="h-[72px] w-[72px] rounded-full bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center">
              <Boxes className="h-9 w-9 text-dmk-yellow" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-[19px] font-black tracking-tight text-dmk-text-primary">DMK Universal Inventory</p>
              <p className="text-[11.5px] text-dmk-text-muted mt-0.5">
                One catalog · every platform — ERP · B2B store · Franchise &amp; B2C
              </p>
            </div>
            <span className="dmk-badge h-7 px-3 gap-1.5 bg-dmk-yellow/15 text-dmk-yellow">
              <ShieldCheck className="h-3.5 w-3.5" />
              Password stored pbkdf2-hashed
            </span>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4" aria-label="Inventory portal sign-in">
            <div className="space-y-1.5">
              <Label htmlFor="inv-user" className="text-[11.5px] text-dmk-text-muted flex items-center gap-1.5">
                <CircleUser className="h-3.5 w-3.5" /> User ID
              </Label>
              <Input
                id="inv-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="h-11 bg-dmk-input-well border-dmk-border-subtle"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-pass" className="text-[11.5px] text-dmk-text-muted flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> Password
              </Label>
              <Input
                id="inv-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••"
                className="h-11 bg-dmk-input-well border-dmk-border-subtle"
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || !username.trim() || !password}
              className="w-full h-11 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {busy ? "Verifying…" : "Sign in to Inventory"}
            </Button>
          </form>

          <p className="mt-5 text-center text-[10.5px] leading-relaxed text-dmk-text-muted">
            This portal is the single source of truth for products, images and warehouse stock.
            Other DMK platforms see totals only — warehouse placement stays here.
          </p>
        </div>
      </div>
      <footer className="mt-auto border-t border-dmk-border-subtle px-6 py-4 text-center">
        <p className="text-[10.5px] text-dmk-text-muted">DMK Universal Inventory · Warehouse placement is portal-private · Totals sync everywhere</p>
      </footer>
    </div>
  );
}
