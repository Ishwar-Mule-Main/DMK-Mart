// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — FORMATTERS (INR, Indian numbering, words)
// ═══════════════════════════════════════════════════════════════

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (h > 0) out = ONES[h] + " Hundred";
  if (rest > 0) out += (out ? " " : "") + twoDigits(rest);
  return out;
}

/** Convert a number to Indian-system words (Crore / Lakh / Thousand). */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(threeDigits(crore) + " Crore");
  if (lakh > 0) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand > 0) parts.push(threeDigits(thousand) + " Thousand");
  if (hundred > 0) parts.push(threeDigits(hundred));

  let words = parts.join(" ").trim();
  words += (rupees === 1 ? " Rupee" : " Rupees");
  if (paise > 0) words += " and " + twoDigits(paise) + " Paise";
  return words + " Only";
}

/** ₹ 1,23,456.78 — Indian grouping. */
export function formatINR(amount: number, showSymbol: boolean = true): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const [intPart, decPart] = abs.toFixed(2).split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3
    : last3;
  const out = `${grouped}.${decPart}`;
  return `${neg ? "-" : ""}${showSymbol ? "₹" : ""}${out}`;
}

/** Plain number formatting for table cells (no symbol). */
export function formatNum(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

export function formatDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function toISODate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** Financial year label from a date (Apr–Mar). */
export function fyLabel(date: Date | string): string {
  const dt = typeof date === "string" ? new Date(date) : date;
  const year = dt.getFullYear();
  const month = dt.getMonth(); // 0-indexed
  if (month >= 3) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

/** CSV escape + formula-injection guard. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`; // prevent formula injection
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
