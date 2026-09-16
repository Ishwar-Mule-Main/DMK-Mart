"use client";

// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — STANDARD A4 PAGE SYSTEM
// Every printable document in the project renders on the same
// paper frame: 210×297mm with 12mm margins (matching @page in
// globals.css) and ends with one standard footer line.
//
// Long documents are split into REAL paper pages via useA4Paginate:
// the caller renders four hidden measurement twins (full page, first
// page, continuation page, last page) and the engine measures actual
// row heights, then returns the row indices that fit on each page —
// so the on-screen preview and the printed output are identical:
//   page 1  = full letterhead + first chunk of rows
//   middle  = "(continued)" band + repeated table head + rows
//   last    = band + remaining rows + totals/declaration + footer
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { cn } from "@/lib/utils";

/** Printable inner height of an A4 page (297mm − 2×12mm) at 96dpi. */
export const A4_CONTENT_H = 1030;
/** Safety slack subtracted from every page capacity. */
export const A4_SAFETY_PX = 8;
/** Printable inner column width (210mm − 2×12mm). */
export const A4_CONTENT_W = "186mm";

/**
 * The standard A4 paper frame used by EVERY document in the project.
 * mode "paged" — fixed-height paper page (paginated documents).
 * mode "flow"  — grows on screen, browser paginates naturally in print
 *                (short operational docs). Both share identical margins.
 */
export function A4Sheet({
  mode = "paged",
  className,
  children,
}: {
  mode?: "paged" | "flow";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "print-a4 relative flex w-[210mm] flex-col bg-white p-[12mm] text-gray-900 shadow-lg",
        mode === "paged" ? "h-[297mm] overflow-hidden" : "min-h-[297mm]",
        className
      )}
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      {children}
    </div>
  );
}

/**
 * Screen wrapper for a stack of paper pages (gaps + centering).
 * In print it collapses to a plain block and every page after the
 * first starts on a fresh sheet (see globals.css).
 */
export function A4PageStack({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("dmk-page-stack", className)}>{children}</div>;
}

/**
 * The standard document footer pinned to the bottom of EVERY A4 page
 * in the project — note on the left, document label + page x/y + date
 * on the right. Part of every page's capacity budget.
 */
export function A4DocFooter({
  note,
  doc,
  page,
  totalPages,
  date,
  className,
}: {
  note?: React.ReactNode;
  doc: string;
  page?: number;
  totalPages?: number;
  date?: string;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        "flex items-end justify-between gap-6 border-t border-gray-300 text-[8.5px] leading-tight text-gray-400",
        className
      )}
    >
      <span className="min-w-0 truncate">{note}</span>
      <span
        className="shrink-0 whitespace-nowrap tabular-nums"
        style={{ fontFamily: "var(--font-jetbrains), monospace" }}
      >
        {doc}
        {page && totalPages ? ` · Page ${page}/${totalPages}` : ""}
        {date ? ` · ${date}` : ""}
      </span>
    </footer>
  );
}

/** Hidden measuring twin — same width as the printable column, never printed. */
export function A4MeasureTwin({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="no-print pointer-events-none invisible fixed left-[-10000px] top-0"
      style={{ width: A4_CONTENT_W }}
    >
      {children}
    </div>
  );
}

/** One hidden replica page — auto-height flex column at the printable width. */
export function A4Replica({
  replicaRef,
  children,
}: {
  replicaRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={replicaRef}
      className="flex flex-col"
      style={{ width: A4_CONTENT_W, fontFamily: "Inter, sans-serif" }}
    >
      {children}
    </div>
  );
}

export interface A4PaginateRefs {
  full: React.RefObject<HTMLDivElement | null>;
  first: React.RefObject<HTMLDivElement | null>;
  cont: React.RefObject<HTMLDivElement | null>;
  last: React.RefObject<HTMLDivElement | null>;
}

/**
 * Measured pagination engine.
 *
 * The caller renders four hidden replicas (A4Replica) that mirror the
 * real pages 1:1 — each replica marks its rows container with
 * `data-a4-rows`:
 *   full  → full single-page document (top + ALL rows + bottom chrome)
 *   first → page-1 skeleton with an EMPTY rows container (top + head + footer)
 *   cont  → continuation-page skeleton with an EMPTY rows container
 *   last  → last-page skeleton with an EMPTY rows container (band + head + bottom chrome)
 *
 * Returns the row indices that fit on every page, or null until the
 * first measurement lands. Row numbering offsets are the caller's job.
 *
 * `groups` (optional): sizes of atomic row clusters (e.g. an item row
 * plus its CGST/SGST sub-rows = one group). A group is NEVER split
 * across pages — it moves whole to the next page. Sum(groups) must
 * equal rowCount.
 */
export function useA4Paginate(
  rowCount: number,
  measureKey: string,
  refs: A4PaginateRefs,
  groups?: number[]
): number[][] | null {
  const [pages, setPages] = React.useState<number[][] | null>(null);
  const { full, first, cont, last } = refs;
  // Guard: an async (webfont) re-measure must never clobber a newer key.
  const lastKeyRef = React.useRef<string | null>(null);

  const measure = React.useCallback(() => {
    const fullEl = full.current;
    const firstEl = first.current;
    const contEl = cont.current;
    const lastEl = last.current;
    if (!fullEl || !firstEl || !contEl || !lastEl) return;
    if (rowCount === 0) {
      setPages([[]]);
      return;
    }
    const rowsBox = fullEl.querySelector("[data-a4-rows]");
    if (!rowsBox) return;
    const rowEls = Array.from(rowsBox.children).slice(0, rowCount) as HTMLElement[];
    if (rowEls.length < rowCount) return;
    const heights = rowEls.map((el) => el.offsetHeight || 1);
    const budget = A4_CONTENT_H - A4_SAFETY_PX;

    // Everything fits on one paper page → single page, nothing to chunk.
    if (fullEl.offsetHeight <= budget) {
      setPages([heights.map((_, i) => i)]);
      return;
    }

    // Capacity of a skeleton = budget − (its height minus its empty rows box).
    const capOf = (replica: HTMLElement) => {
      const box = replica.querySelector("[data-a4-rows]") as HTMLElement | null;
      return budget - (replica.offsetHeight - (box ? box.offsetHeight : 0));
    };
    const capFirst = capOf(firstEl);
    const capMid = capOf(contEl);
    const capLast = capOf(lastEl);

    // Group expansion: heights of atomic clusters. A cluster of size 1
    // is a plain row. With no groups every row is its own cluster.
    const sizes =
      groups && groups.length > 0 && groups.reduce((s, g) => s + g, 0) === rowCount
        ? groups
        : heights.map(() => 1);
    const clusters = sizes.map((size, gi) => ({
      size,
      h: heights.slice(cumPrev(sizes, gi), cumPrev(sizes, gi) + size).reduce((s, h) => s + h, 0),
      start: cumPrev(sizes, gi),
    }));

    const out: number[][] = [];
    // Page 1 — full letterhead, no bottom chrome.
    let i = 0;
    let used = 0;
    const p1: number[] = [];
    for (const c of clusters) {
      if (p1.length > 0 && used + c.h > capFirst) break;
      for (let k = 0; k < c.size; k++) p1.push(c.start + k);
      used += c.h;
    }
    i = p1.length;
    out.push(p1);
    // Middle / last pages.
    while (i < rowCount) {
      const restH = clusters.slice(clusterIndexOf(i, sizes)).reduce((s, c) => s + c.h, 0);
      if (restH <= capLast) {
        // Everything remaining fits the last-page skeleton (band + bottom chrome).
        out.push(Array.from({ length: rowCount - i }, (_, k) => i + k));
        i = rowCount;
        break;
      }
      const p: number[] = [];
      let u = 0;
      let gi = clusterIndexOf(i, sizes);
      while (gi < clusters.length) {
        const c = clusters[gi];
        if (p.length > 0 && u + c.h > capMid) break;
        for (let k = 0; k < c.size; k++) p.push(c.start + k);
        u += c.h;
        gi++;
      }
      out.push(p);
      i += p.length;
    }
    setPages(out);
  }, [full, first, cont, last, rowCount, groups]);

  React.useLayoutEffect(() => {
    lastKeyRef.current = measureKey;
    measure();
    let cancelled = false;
    // Re-measure once webfonts settle — metrics change row wrapping.
    document.fonts?.ready
      .then(() => {
        if (!cancelled && lastKeyRef.current === measureKey) measure();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [measure, measureKey]);

  // Stale-guard: while the data shrinks (invoice/ledger switch), last
  // render's pages may reference rows beyond the current rowCount —
  // hide the stack for that commit instead of rendering undefined rows.
  const valid =
    !!pages &&
    pages.reduce((s, p) => s + p.length, 0) === rowCount &&
    pages.every((p) => p.every((i) => i >= 0 && i < rowCount));
  return valid ? pages : null;
}

/** Prefix-sum helper: first row index of cluster gi. */
function cumPrev(sizes: number[], gi: number): number {
  let s = 0;
  for (let k = 0; k < gi; k++) s += sizes[k];
  return s;
}

/** Cluster index that owns row offset i. */
function clusterIndexOf(i: number, sizes: number[]): number {
  let acc = 0;
  for (let gi = 0; gi < sizes.length; gi++) {
    acc += sizes[gi];
    if (i < acc) return gi;
  }
  return sizes.length;
}
