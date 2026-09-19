"use client";

// ═══════════════════════════════════════════════════════════════
// INVAPP — root of the Universal Inventory portal.
// Session probe (signed httpOnly cookie) → login gate or shell.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { invGet, type InvSessionInfo } from "@/components/inventory/inv-api";
import { InvGate } from "@/components/inventory/inv-gate";
import { InvShell } from "@/components/inventory/inv-shell";
import { Loader2 } from "lucide-react";

export function InvApp() {
  const [session, setSession] = React.useState<InvSessionInfo | null>(null);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    invGet<InvSessionInfo>("/api/v1/inventory/auth/me")
      .then((s) => { if (alive) setSession(s); })
      .catch(() => { if (alive) setSession(null); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dmk-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-dmk-yellow" aria-hidden />
          <p className="text-[12.5px] text-dmk-text-muted">Opening Universal Inventory…</p>
        </div>
      </div>
    );
  }

  return session ? <InvShell session={session} onSignOut={() => setSession(null)} /> : <InvGate onSignedIn={(s) => setSession(s)} />;
}
