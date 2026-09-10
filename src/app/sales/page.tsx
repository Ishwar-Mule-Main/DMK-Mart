import type { Metadata } from "next";
import { AppShell } from "@/components/erp/app-shell";

// ═══════════════════════════════════════════════════════════════
// /sales — DEDICATED SALES TEAM PORTAL (dedicated URL)
// The sales login lives at its own address; the owner ERP never
// renders here (AppShell bounces owner/team sessions to their own
 // portals) and sales sessions never render on "/" or "/team".
// The workspace sidebar is built dynamically from the permissions
// the owner toggled for the signed-in member.
// ═══════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: "DMK Sales Portal",
  robots: { index: false, follow: false },
};

export default function SalesPortalPage() {
  return <AppShell forcedDoor="sales" />;
}
