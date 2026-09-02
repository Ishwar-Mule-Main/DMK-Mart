// ═══════════════════════════════════════════════════════════════
// /api/v1/gstr2b — GSTR-2B IMPORT + ITC RECONCILIATION
// POST /import  — replace a period's 2B rows (CSV or JSON rows)
// GET           — 2B rows matched against CONFIRMED purchase orders
//                 (books side) by supplier GSTIN + amount proximity.
// Statuses: MATCHED · AMOUNT_MISMATCH · MISSING_IN_BOOKS ·
//           MISSING_IN_2B (books PO with no 2B row).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import {
  asRecord,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  BusinessError,
} from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";
import { db } from "@/lib/db";

// ─── CSV helpers ─────────────────────────────────────────────────

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if ((ch === "," || ch === "\t") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Indian-first date parsing: dd/mm/yyyy · dd-mm-yyyy · yyyy-mm-dd · ISO. */
function parseFlexibleDate(s: string): Date | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(v);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0); // dd/mm/yyyy
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseBoolItc(s: string): boolean {
  const v = (s ?? "").trim().toUpperCase();
  return !["NO", "N", "FALSE", "0", ""].includes(v);
}

const HEADER_ALIASES: Record<string, string> = {
  gstin: "gstin",
  gstinofsupplier: "gstin",
  suppliergstin: "gstin",
  tradename: "tradeName",
  legalname: "tradeName",
  suppliername: "tradeName",
  invoiceno: "invoiceNo",
  invoicenumber: "invoiceNo",
  "invoice no": "invoiceNo",
  "bill no": "invoiceNo",
  invoicedate: "invoiceDate",
  "invoice date": "invoiceDate",
  "bill date": "invoiceDate",
  taxablevalue: "taxableValue",
  taxable: "taxableValue",
  taxableamount: "taxableValue",
  igst: "igst",
  igstamount: "igst",
  cgst: "cgst",
  cgstamount: "cgst",
  sgst: "sgst",
  sgstamount: "sgst",
  itc: "itc",
  itcavailable: "itc",
  "itc available": "itc",
  placeofsupply: "placeOfSupply",
  pos: "placeOfSupply",
};

function num(v: string): number {
  const n = Number((v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export interface Parsed2bRow {
  gstin: string;
  tradeName: string;
  invoiceNo: string;
  invoiceDate: Date;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  itcAvailable: boolean;
  placeOfSupply: string;
}

export function parseGstr2bCsv(csv: string): Parsed2bRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) throw new BusinessError("ERR_CSV_EMPTY", "No data rows found in the CSV", 422);

  const header = splitCsvLine(lines[0]).map((h) => HEADER_ALIASES[h.toLowerCase().replace(/_/g, "")] ?? h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iGstin = idx("gstin");
  const iInvNo = idx("invoiceNo");
  if (iGstin === -1 || iInvNo === -1) {
    throw new BusinessError(
      "ERR_CSV_HEADER",
      "CSV must have at least GSTIN and InvoiceNo columns (e.g. GSTIN,TradeName,InvoiceNo,InvoiceDate,TaxableValue,IGST,CGST,SGST,ITC,PlaceOfSupply)",
      422
    );
  }
  const iTrade = idx("tradeName");
  const iDate = idx("invoiceDate");
  const iTaxable = idx("taxableValue");
  const iIgst = idx("igst");
  const iCgst = idx("cgst");
  const iSgst = idx("sgst");
  const iItc = idx("itc");
  const iPos = idx("placeOfSupply");

  const rows: Parsed2bRow[] = [];
  for (let ln = 1; ln < lines.length; ln++) {
    const cells = splitCsvLine(lines[ln]);
    const gstin = (cells[iGstin] ?? "").toUpperCase();
    const invoiceNo = cells[iInvNo] ?? "";
    if (!gstin || !invoiceNo) continue; // skip blank-ish rows
    const date = parseFlexibleDate(iDate !== -1 ? cells[iDate] : "");
    if (!date) {
      throw new BusinessError("ERR_CSV_DATE", `Row ${ln + 1}: unrecognised invoice date "${iDate !== -1 ? cells[iDate] : ""}" (use dd/mm/yyyy)`, 422);
    }
    rows.push({
      gstin,
      tradeName: iTrade !== -1 ? cells[iTrade] ?? "" : "",
      invoiceNo,
      invoiceDate: date,
      taxableValue: round2(iTaxable !== -1 ? num(cells[iTaxable]) : 0),
      igst: round2(iIgst !== -1 ? num(cells[iIgst]) : 0),
      cgst: round2(iCgst !== -1 ? num(cells[iCgst]) : 0),
      sgst: round2(iSgst !== -1 ? num(cells[iSgst]) : 0),
      itcAvailable: iItc !== -1 ? parseBoolItc(cells[iItc]) : true,
      placeOfSupply: iPos !== -1 ? cells[iPos] ?? "" : "",
    });
  }
  if (rows.length === 0) throw new BusinessError("ERR_CSV_EMPTY", "No valid rows found — check GSTIN / InvoiceNo columns", 422);
  return rows;
}

// ─── POST — import (replace) a period ────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));
    const period = getStr(body.period);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new BusinessError("ERR_VALIDATION", "period must be in YYYY-MM format (e.g. 2026-08)", 400);
    }

    let rows: Parsed2bRow[];
    if (typeof body.csv === "string" && body.csv.trim()) {
      rows = parseGstr2bCsv(body.csv);
    } else if (Array.isArray(body.rows) && body.rows.length > 0) {
      rows = body.rows.map((r: unknown, i: number) => {
        const rec = asRecord(r);
        const gstin = getStr(rec.gstin).toUpperCase();
        const invoiceNo = getStr(rec.invoiceNo);
        if (!gstin || !invoiceNo) {
          throw new BusinessError("ERR_VALIDATION", `Row ${i + 1}: gstin and invoiceNo are required`, 400);
        }
        const date = new Date(getStr(rec.invoiceDate));
        if (Number.isNaN(date.getTime())) {
          throw new BusinessError("ERR_VALIDATION", `Row ${i + 1}: invalid invoiceDate`, 400);
        }
        const n = (v: unknown) => (Number.isFinite(Number(v)) ? round2(Number(v)) : 0);
        return {
          gstin,
          tradeName: getStr(rec.tradeName),
          invoiceNo,
          invoiceDate: date,
          taxableValue: n(rec.taxableValue),
          igst: n(rec.igst),
          cgst: n(rec.cgst),
          sgst: n(rec.sgst),
          itcAvailable: rec.itcAvailable === undefined ? true : Boolean(rec.itcAvailable),
          placeOfSupply: getStr(rec.placeOfSupply),
        } satisfies Parsed2bRow;
      });
    } else {
      throw new BusinessError("ERR_VALIDATION", "Provide either `csv` (text) or `rows` (array)", 400);
    }

    const result = await db.$transaction(async (tx) => {
      await tx.gstr2bRecord.deleteMany({ where: { firmId: firm.id, period } });
      await tx.gstr2bRecord.createMany({
        data: rows.map((r) => ({ ...r, firmId: firm.id, period })),
      });
      return rows.length;
    });

    return ok({ imported: result, period, replaced: true }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── GET — period records + reconciliation vs books ──────────────

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);
    const period = getStr(sp.get("period"));
    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new BusinessError("ERR_VALIDATION", "period must be in YYYY-MM format (e.g. 2026-08)", 400);
    }

    const records = await db.gstr2bRecord.findMany({
      where: { firmId, period },
      orderBy: [{ invoiceDate: "asc" }, { invoiceNo: "asc" }],
    });

    // Books side: CONFIRMED POs whose poDate falls inside the period month
    const [y, m] = period.split("-").map(Number);
    const start = new Date(y, m - 1, 1, 0, 0, 0);
    const end = new Date(y, m, 1, 0, 0, 0);
    const pos = await db.purchaseOrder.findMany({
      where: { firmId, status: "CONFIRMED", poDate: { gte: start, lt: end } },
      include: { vendor: { select: { vendorName: true, gstin: true } } },
      orderBy: [{ poDate: "asc" }, { poNumber: "asc" }],
    });

    interface BookRow {
      poId: string;
      poNumber: string;
      vendorName: string;
      gstin: string;
      taxable: number;
      igst: number;
      cgst: number;
      sgst: number;
      grand: number;
      claimedBy: string | null;
    }
    const books: BookRow[] = pos.map((po) => ({
      poId: po.id,
      poNumber: po.poNumber,
      vendorName: po.vendor?.vendorName ?? "—",
      gstin: (po.vendor?.gstin ?? "").toUpperCase(),
      taxable: round2(po.subtotal),
      igst: round2(po.totalIgst),
      cgst: round2(po.totalCgst),
      sgst: round2(po.totalSgst),
      grand: round2(po.grandTotal),
      claimedBy: null,
    }));

    const TOL_ABS = 1.0;
    const TOL_PCT = 0.005;
    const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(TOL_ABS, TOL_PCT * Math.max(a, b));

    const gstinsInBooks = new Set(books.map((b) => b.gstin).filter(Boolean));

    interface Matched2b {
      id: string;
      gstin: string;
      tradeName: string;
      invoiceNo: string;
      invoiceDate: string;
      taxableValue: number;
      igst: number;
      cgst: number;
      sgst: number;
      itcAvailable: boolean;
      placeOfSupply: string;
      grand: number;
      status: "MATCHED" | "AMOUNT_MISMATCH" | "MISSING_IN_BOOKS";
      matchedPoNumber: string | null;
    }
    const makeRow = (rec: (typeof records)[number]): Matched2b => ({
      id: rec.id,
      gstin: rec.gstin,
      tradeName: rec.tradeName,
      invoiceNo: rec.invoiceNo,
      invoiceDate: rec.invoiceDate.toISOString(),
      taxableValue: round2(rec.taxableValue),
      igst: round2(rec.igst),
      cgst: round2(rec.cgst),
      sgst: round2(rec.sgst),
      itcAvailable: rec.itcAvailable,
      placeOfSupply: rec.placeOfSupply,
      grand: round2(rec.taxableValue + rec.igst + rec.cgst + rec.sgst),
      status: "MISSING_IN_BOOKS",
      matchedPoNumber: null,
    });

    const byId = new Map<string, Matched2b>();
    for (const rec of records) byId.set(rec.id, makeRow(rec));

    // pass 1: exact GSTIN + grand-total proximity
    for (const rec of records) {
      const row = byId.get(rec.id)!;
      const candidate = books.find((b) => !b.claimedBy && b.gstin === rec.gstin && within(b.grand, row.grand));
      if (candidate) {
        candidate.claimedBy = rec.id;
        row.status = "MATCHED";
        row.matchedPoNumber = candidate.poNumber;
      }
    }
    // pass 2: GSTIN + taxable-value proximity (tolerates freight/tax tweaks)
    for (const rec of records) {
      const row = byId.get(rec.id)!;
      if (row.status === "MATCHED") continue;
      const candidate = books.find(
        (b) => !b.claimedBy && b.gstin === rec.gstin && within(b.taxable, rec.taxableValue)
      );
      if (candidate) {
        candidate.claimedBy = rec.id;
        row.status = "MATCHED";
        row.matchedPoNumber = candidate.poNumber;
      } else if (gstinsInBooks.has(rec.gstin)) {
        row.status = "AMOUNT_MISMATCH";
      }
    }
    const matched = records.map((r) => byId.get(r.id)!);

    const unmatchedBooks = books
      .filter((b) => !b.claimedBy)
      .map((b) => ({ ...b, status: "MISSING_IN_2B" as const }));

    // ── Summary KPIs ─────────────────────────────────────────────
    const itcOf = (r: { igst: number; cgst: number; sgst: number; itcAvailable?: boolean }) =>
      r.itcAvailable === false ? 0 : round2(r.igst + r.cgst + r.sgst);

    const itc2b = round2(records.reduce((s, r) => s + itcOf(r), 0));
    const itcBooks = round2(books.reduce((s, b) => s + itcOf(b), 0));
    const matchedItc = round2(
      matched.filter((m) => m.status === "MATCHED").reduce((s, m) => s + itcOf(m), 0)
    );
    const missingItc = round2(
      matched.filter((m) => m.status !== "MATCHED").reduce((s, m) => s + itcOf(m), 0)
    );
    const extraTax = round2(unmatchedBooks.reduce((s, b) => s + itcOf(b), 0));

    return ok({
      period,
      firmName: firm.firmName,
      firmGstin: firm.gstin,
      records: matched,
      books: unmatchedBooks,
      booksTotal: books.length,
      summary: {
        records2b: records.length,
        matched: matched.filter((m) => m.status === "MATCHED").length,
        mismatches: matched.filter((m) => m.status === "AMOUNT_MISMATCH").length,
        missingInBooks: matched.filter((m) => m.status === "MISSING_IN_BOOKS").length,
        missingIn2b: unmatchedBooks.length,
        itc2b,
        itcBooks,
        matchedItc,
        missingItc,
        extraTax,
        netItcRisk: round2(missingItc - extraTax),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
