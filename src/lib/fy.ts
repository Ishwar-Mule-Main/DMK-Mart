// ═══════════════════════════════════════════════════════════════
// FINANCIAL YEAR HELPERS (client-safe — no server imports)
// Indian book years run 1 April → 31 March. Label format "2025-26".
// ═══════════════════════════════════════════════════════════════

/** Indian FY label ("2026-27") for a date — Apr 1 – Mar 31. */
export function fyLabelForDate(d: Date): string {
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Current financial-year label, derived from the system clock. */
export function currentFyLabel(): string {
  return fyLabelForDate(new Date());
}

/** Next financial-year label: "2025-26" → "2026-27". */
export function nextFyLabel(label: string): string {
  const y = parseInt(label.slice(0, 4), 10);
  if (!Number.isFinite(y)) return label;
  return `${y + 1}-${String((y + 2) % 100).padStart(2, "0")}`;
}

export function isValidFyLabel(label: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(label)) return false;
  const y = parseInt(label.slice(0, 4), 10);
  return y >= 2000 && y <= 2099 && label === fyLabelForDate(new Date(`${y}-06-01T00:00:00+05:30`));
}

/** Calendar window of a FY label (startDate inclusive, endDate exclusive-safe). */
export function fyDateRange(label: string): { startDate: Date; endDate: Date } {
  const y = parseInt(label.slice(0, 4), 10);
  return {
    startDate: new Date(`${y}-04-01T00:00:00+05:30`),
    endDate: new Date(`${y + 1}-03-31T23:59:59+05:30`),
  };
}

/** "1 Apr 2025 – 31 Mar 2026" for gate/subtitle display. */
export function formatFyRange(label: string): string {
  const { startDate, endDate } = fyDateRange(label);
  const fmt = (d: Date) =>
    `${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" })} ${d.getFullYear()}`;
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}
