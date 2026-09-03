"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — A4 PRINT PIPELINE (R16)
// Portal-based printing: the print copy is mounted as a direct
// child of <body> and ONLY rendered while body carries the
// `printing-a4` class. printA4() toggles the class around
// window.print(), so every printed page contains exactly the
// .print-a4 document — no app chrome, no dialogs, no scrollbars.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { createPortal } from "react-dom";

/** Trigger a chrome-free print of the currently mounted A4 print portal. */
export function printA4(): void {
  if (typeof window === "undefined") return;
  const body = document.body;
  if (body.classList.contains("printing-a4")) return; // re-entrancy guard
  body.classList.add("printing-a4");
  const done = () => body.classList.remove("printing-a4");
  window.addEventListener("afterprint", done, { once: true });
  // Safety net for browsers that never fire afterprint (or cancel dialogs).
  window.setTimeout(done, 3000);
  window.print();
}

/**
 * Renders `children` (an .print-a4 sheet) into a portal on <body>.
 * Invisible on screen; only materializes in print media while
 * printA4() is driving. Mount it whenever the document is ready.
 */
export function A4PrintPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return createPortal(
    <div className="dmk-print-root">{children}</div>,
    document.body
  );
}
