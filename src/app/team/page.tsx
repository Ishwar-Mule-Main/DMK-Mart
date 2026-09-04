import type { Metadata } from "next";
import { AppShell } from "@/components/erp/app-shell";

// ═══════════════════════════════════════════════════════════════
// /team — VERIFICATION TEAM PORTAL (dedicated URL)
// The team login lives at its own address; the owner ERP never
// renders here (AppShell bounces owner sessions back to "/") and
// team sessions never render on "/" (they are bounced here).
// ═══════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "DMK Verification Portal",
  robots: { index: false, follow: false },
};

export default function TeamPortalPage() {
  return <AppShell forcedDoor="team" />;
}
