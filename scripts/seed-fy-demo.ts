// ═══════════════════════════════════════════════════════════════
// FY demo-history seeder — two complete book years
//
//   FY 2025-26 (1 Apr 2025 → 31 Mar 2026): the "establishment year"
//   FY 2026-27 (1 Apr 2026 → today):       the "scale-up year",
//                                          different mix, bigger,
//                                          more inter-state
//
// Everything is inserted with the SAME journal/ledger shapes the
// posting engines use, but DIRECTLY (the engines block billing at
// zero stock, and the user asked for 0 stock "for now"):
//   • every journal balances to the paisa (asserted per entry)
//   • demo GRNs book Purchases (5100) — NOT Inventory (1200) — so
//     the Inventory GL stays ₹0.00 and agrees with the empty shelves
//   • demo sales book NO COGS line (nothing to relieve)
//   • party ledgers are recomputed chronologically at the end and
//     closing balances re-derived (GL 1100 = Σ debtors, 2000 = Σ
//     creditors)
//   • document/voucher numbers carry the FY of their own date:
//     DMK/2025-26/INV/0001… ; existing 2026-27 sequences continue
//
// The opening-capital journal is re-dated to 1 Apr 2025 so the books
// open at the start of FY 2025-26.
//
// Idempotent: skips everything if any invoice already exists in
// FY 2025-26. Run: bunx tsx scripts/seed-fy-demo.ts
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";
import { round2, calculateGST, roundOffDelta } from "../src/lib/gst";
import { amountInWords } from "../src/lib/format";

const db = new PrismaClient();

// ─── time helpers ─────────────────────────────────────────────────
function d(iso: string, hour = 11): Date {
  const dt = new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00+05:30`);
  return dt;
}
function fyOf(date: Date): string {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

// ─── COA codes (mirror src/lib/journal.ts) ────────────────────────
const ACC = {
  CASH: "1000", BANK: "1010", UPI: "1020", AR: "1100", INVENTORY: "1200",
  ITC: "1300", VC: "1400", AP: "2000", CGST: "2100", SGST: "2110", IGST: "2120",
  CAPITAL: "3000", RETAINED: "3100", SALES: "4000", SR: "4100", COGS: "5000",
  PUR: "5100", FREIGHT: "5200", OPEX: "5300", RO: "5400", DAMAGE: "5500",
} as const;
const T3: Record<string, string> = {
  SALES: "SAL", PURCHASE: "PUR", RECEIPT: "REC", PAYMENT: "PAY", JOURNAL: "JOU",
  CONTRA: "CON", CREDIT_NOTE: "CRE", DEBIT_NOTE: "DEB", OPENING: "OPE",
};

let FIRM: { id: string; invoicePrefix: string; stateCode: string } | null = null;
let accounts = new Map<string, { id: string; accountName: string }>();

async function loadContext() {
  const firm = await db.firm.findFirst({ orderBy: { createdAt: "asc" } });
  if (!firm) throw new Error("No firm found");
  FIRM = { id: firm.id, invoicePrefix: firm.invoicePrefix, stateCode: firm.stateCode };
  const coa = await db.chartOfAccount.findMany({ where: { firmId: firm.id } });
  accounts = new Map(coa.map((a) => [a.accountCode, { id: a.id, accountName: a.accountName }]));
}

// ─── numbering: continue existing per-FY sequences ────────────────
async function nextDocSeq(family: "INV" | "PO" | "CN" | "DN", fy: string): Promise<number> {
  const prefix = `${FIRM!.invoicePrefix}/${fy}/${family}/`;
  let nums: string[] = [];
  if (family === "INV") nums = (await db.invoice.findMany({ where: { firmId: FIRM!.id, invoiceNumber: { startsWith: prefix } }, select: { invoiceNumber: true } })).map((r) => r.invoiceNumber);
  else if (family === "PO") nums = (await db.purchaseOrder.findMany({ where: { firmId: FIRM!.id, poNumber: { startsWith: prefix } }, select: { poNumber: true } })).map((r) => r.poNumber);
  else if (family === "CN") nums = (await db.salesReturn.findMany({ where: { firmId: FIRM!.id, creditNoteNo: { startsWith: prefix } }, select: { creditNoteNo: true } })).map((r) => r.creditNoteNo);
  else nums = (await db.purchaseReturn.findMany({ where: { firmId: FIRM!.id, debitNoteNo: { startsWith: prefix } }, select: { debitNoteNo: true } })).map((r) => r.debitNoteNo);
  return nums.reduce((m, n) => Math.max(m, parseInt(n.split("/")[3] ?? "0", 10) || 0), 0) + 1;
}

async function nextVoucherSeq(fy: string, voucherType: string): Promise<number> {
  const prefix = `${FIRM!.invoicePrefix}/${fy}/${T3[voucherType]}/`;
  const rows = await db.journalEntry.findMany({
    where: { firmId: FIRM!.id, voucherNumber: { startsWith: prefix } },
    select: { voucherNumber: true },
  });
  return rows.reduce((m, r) => Math.max(m, parseInt(r.voucherNumber.split("/")[3] ?? "0", 10) || 0), 0) + 1;
}

// ─── balanced direct journal (mirrors postJournal shapes) ─────────
interface JLine { code: string; side: "DEBIT" | "CREDIT"; amount: number; narration?: string }
async function postDemoJournal(voucherType: string, postingDate: Date, narration: string, lines: JLine[], referenceDocId = "") {
  const clean = lines.filter((l) => round2(l.amount) !== 0).map((l) => ({ ...l, amount: round2(l.amount) }));
  const dr = round2(clean.filter((l) => l.side === "DEBIT").reduce((s, l) => s + l.amount, 0));
  const cr = round2(clean.filter((l) => l.side === "CREDIT").reduce((s, l) => s + l.amount, 0));
  if (clean.length < 2 || Math.abs(dr - cr) > 0.001) {
    throw new Error(`Unbalanced demo journal (${narration}): Dr ${dr} vs Cr ${cr}`);
  }
  const fy = fyOf(postingDate);
  const seq = await nextVoucherSeq(fy, voucherType);
  const voucherNumber = `${FIRM!.invoicePrefix}/${fy}/${T3[voucherType]}/${String(seq).padStart(4, "0")}`;
  await db.journalEntry.create({
    data: {
      firmId: FIRM!.id, voucherNumber, voucherType, postingDate, referenceDocId, narration,
      totalDebit: dr, totalCredit: cr,
      createdAt: postingDate,
      lines: {
        create: clean.map((l) => {
          const acc = accounts.get(l.code);
          if (!acc) throw new Error(`Account ${l.code} missing`);
          return {
            accountId: acc.id, accountName: acc.accountName, entrySide: l.side,
            debitAmount: l.side === "DEBIT" ? l.amount : 0,
            creditAmount: l.side === "CREDIT" ? l.amount : 0,
            narration: l.narration ?? narration,
          };
        }),
      },
    },
  });
}

// ─── party ledger rows (balances recomputed at the end) ───────────
async function partyLedger(partyType: "CUSTOMER" | "VENDOR", partyId: string, entryDate: Date, voucherType: string, voucherNo: string, particulars: string, debit: number, credit: number) {
  await db.ledgerEntry.create({
    data: {
      firmId: FIRM!.id, partyType,
      ...(partyType === "CUSTOMER" ? { customerId: partyId } : { vendorId: partyId }),
      entryDate, voucherType, voucherNo, particulars,
      debitAmount: round2(debit), creditAmount: round2(credit), balanceAfter: 0,
      createdAt: entryDate,
    },
  });
}

// ═════════════════════════════════════════════════════════════════
// 1. INVOICES (B2B credit + B2C counter) — mirrors createInvoice
// ═════════════════════════════════════════════════════════════════
type TierKey = "tier1Distributor" | "tier2Wholesale" | "tier3SemiWholesale" | "tier4Retailer";
const TIER_FIELD: Record<string, TierKey> = {
  tier1Distributor: "tier1Distributor", tier2Wholesale: "tier2Wholesale",
  tier3SemiWholesale: "tier3SemiWholesale", tier4Retailer: "tier4Retailer",
};

interface LineSpec { sku: string; qty: number; pct?: number }
interface InvSpec {
  key?: string; date: string; customer: string; counter?: boolean;
  mode?: string; lines: LineSpec[];
}
const INV_2526: InvSpec[] = [
  { key: "L1", date: "2025-04-22", customer: "Latur", lines: [{ sku: "DMK-CH-001", qty: 30, pct: 15 }, { sku: "DMK-BK-103", qty: 40, pct: 20 }] },
  { key: "S1", date: "2025-05-14", customer: "Solapur", lines: [{ sku: "DMK-CH-001", qty: 50, pct: 20 }, { sku: "DMK-BK-101", qty: 60, pct: 20 }] },
  { key: "P1", date: "2025-06-05", customer: "Pune", lines: [{ sku: "DMK-CH-004", qty: 40 }, { sku: "DMK-BK-104", qty: 30, pct: 15 }] },
  { key: "N1", date: "2025-06-26", customer: "Nanded", lines: [{ sku: "DMK-ST-012", qty: 50 }, { sku: "DMK-DB-201", qty: 20 }] },
  { key: "M1", date: "2025-07-22", customer: "Mumbai", lines: [{ sku: "DMK-CH-002", qty: 60, pct: 15 }, { sku: "DMK-CR-302", qty: 40 }] },
  { key: "L2", date: "2025-08-12", customer: "Latur", lines: [{ sku: "DMK-CR-301", qty: 45, pct: 20 }, { sku: "DMK-BK-102", qty: 25 }] },
  { key: "H1", date: "2025-08-28", customer: "Hyderabad", lines: [{ sku: "DMK-CR-301", qty: 60, pct: 15 }] },
  { key: "NS1", date: "2025-09-18", customer: "Nashik", lines: [{ sku: "DMK-SB-403", qty: 60 }, { sku: "DMK-KW-501", qty: 20 }] },
  { key: "S2", date: "2025-10-08", customer: "Solapur", lines: [{ sku: "DMK-CH-003", qty: 5 }, { sku: "DMK-BK-101", qty: 50, pct: 20 }] },
  { key: "P2", date: "2025-10-27", customer: "Pune", lines: [{ sku: "DMK-ST-010", qty: 30 }, { sku: "DMK-DB-203", qty: 5 }] },
  { key: "M2", date: "2025-11-15", customer: "Mumbai", lines: [{ sku: "DMK-CH-001", qty: 60, pct: 15 }, { sku: "DMK-ST-011", qty: 20 }] },
  { key: "HB1", date: "2025-12-03", customer: "Hubli", lines: [{ sku: "DMK-CR-302", qty: 80, pct: 15 }, { sku: "DMK-BK-103", qty: 60, pct: 20 }] },
  { key: "N2", date: "2026-01-09", customer: "Nanded", lines: [{ sku: "DMK-SB-401", qty: 30 }, { sku: "DMK-DB-201", qty: 25 }] },
  { key: "L3", date: "2026-01-28", customer: "Latur", lines: [{ sku: "DMK-CH-002", qty: 80, pct: 20 }, { sku: "DMK-CR-304", qty: 25 }] },
  { key: "S3", date: "2026-02-17", customer: "Solapur", lines: [{ sku: "DMK-CH-001", qty: 70, pct: 15 }, { sku: "DMK-SB-402", qty: 15 }] },
  { key: "H2", date: "2026-03-12", customer: "Hyderabad", lines: [{ sku: "DMK-CR-303", qty: 8, pct: 15 }, { sku: "DMK-KW-503", qty: 20 }] },
  // B2C counter
  { date: "2025-04-10", customer: "Anjali Patil", counter: true, mode: "CASH", lines: [{ sku: "DMK-BK-103", qty: 2 }, { sku: "DMK-CH-004", qty: 1 }] },
  { date: "2025-05-06", customer: "Rahul Deshmukh", counter: true, mode: "UPI", lines: [{ sku: "DMK-ST-012", qty: 1 }, { sku: "DMK-SB-403", qty: 2 }] },
  { date: "2025-06-18", customer: "Sunita Kale", counter: true, mode: "CASH", lines: [{ sku: "DMK-BK-104", qty: 2 }] },
  { date: "2025-07-09", customer: "Anjali Patil", counter: true, mode: "UPI", lines: [{ sku: "DMK-KW-502", qty: 1 }, { sku: "DMK-DB-201", qty: 1 }] },
  { date: "2025-08-20", customer: "Ganesh More", counter: true, mode: "CASH", lines: [{ sku: "DMK-CH-001", qty: 2 }] },
  { date: "2025-09-25", customer: "Rahul Deshmukh", counter: true, mode: "CASH", lines: [{ sku: "DMK-ST-010", qty: 1 }, { sku: "DMK-BK-101", qty: 1 }] },
  { date: "2025-10-18", customer: "Sunita Kale", counter: true, mode: "UPI", lines: [{ sku: "DMK-SB-401", qty: 1 }, { sku: "DMK-KW-501", qty: 1 }] },
  { date: "2025-11-24", customer: "Anjali Patil", counter: true, mode: "CASH", lines: [{ sku: "DMK-DB-202", qty: 1 }, { sku: "DMK-BK-102", qty: 1 }] },
  { date: "2025-12-30", customer: "Ganesh More", counter: true, mode: "UPI", lines: [{ sku: "DMK-CH-004", qty: 2 }, { sku: "DMK-ST-012", qty: 2 }] },
  { date: "2026-01-20", customer: "Rahul Deshmukh", counter: true, mode: "CASH", lines: [{ sku: "DMK-CR-302", qty: 2 }] },
  { date: "2026-02-22", customer: "Sunita Kale", counter: true, mode: "CASH", lines: [{ sku: "DMK-KW-503", qty: 1 }, { sku: "DMK-SB-402", qty: 1 }] },
  { date: "2026-03-19", customer: "Anjali Patil", counter: true, mode: "UPI", lines: [{ sku: "DMK-CH-001", qty: 1 }, { sku: "DMK-BK-103", qty: 1 }, { sku: "DMK-KW-502", qty: 1 }] },
];
const INV_2627: InvSpec[] = [
  { key: "M3", date: "2026-04-20", customer: "Mumbai", lines: [{ sku: "DMK-CR-304", qty: 30, pct: 15 }, { sku: "DMK-SB-402", qty: 20 }] },
  { key: "H3", date: "2026-05-08", customer: "Hyderabad", lines: [{ sku: "DMK-CR-301", qty: 70, pct: 20 }] },
  { key: "L4", date: "2026-05-26", customer: "Latur", lines: [{ sku: "DMK-CH-001", qty: 50, pct: 20 }, { sku: "DMK-DB-201", qty: 30 }] },
  { key: "HB2", date: "2026-06-15", customer: "Hubli", lines: [{ sku: "DMK-CR-302", qty: 60, pct: 15 }, { sku: "DMK-ST-011", qty: 25 }] },
  { key: "S4", date: "2026-06-28", customer: "Solapur", lines: [{ sku: "DMK-CH-003", qty: 8 }, { sku: "DMK-SB-401", qty: 25 }] },
  { key: "N3", date: "2026-07-14", customer: "Nanded", lines: [{ sku: "DMK-KW-501", qty: 30 }, { sku: "DMK-SB-403", qty: 40 }] },
  { key: "P3", date: "2026-07-28", customer: "Pune", lines: [{ sku: "DMK-ST-012", qty: 60, pct: 15 }, { sku: "DMK-DB-202", qty: 15 }] },
  { key: "NS2", date: "2026-08-10", customer: "Nashik", lines: [{ sku: "DMK-CR-301", qty: 35 }, { sku: "DMK-BK-102", qty: 30 }] },
  { key: "M4", date: "2026-08-18", customer: "Mumbai", lines: [{ sku: "DMK-CH-002", qty: 70, pct: 20 }, { sku: "DMK-ST-010", qty: 40 }] },
  { key: "H4", date: "2026-08-24", customer: "Hyderabad", lines: [{ sku: "DMK-CR-303", qty: 6 }, { sku: "DMK-KW-503", qty: 25 }] },
  // B2C counter
  { date: "2026-04-14", customer: "Ganesh More", counter: true, mode: "CASH", lines: [{ sku: "DMK-BK-103", qty: 1 }, { sku: "DMK-CH-004", qty: 2 }] },
  { date: "2026-05-02", customer: "Anjali Patil", counter: true, mode: "UPI", lines: [{ sku: "DMK-ST-011", qty: 1 }] },
  { date: "2026-05-21", customer: "Rahul Deshmukh", counter: true, mode: "CASH", lines: [{ sku: "DMK-SB-403", qty: 2 }, { sku: "DMK-BK-104", qty: 1 }] },
  { date: "2026-06-08", customer: "Sunita Kale", counter: true, mode: "UPI", lines: [{ sku: "DMK-KW-502", qty: 1 }, { sku: "DMK-DB-201", qty: 1 }] },
  { date: "2026-06-24", customer: "Anjali Patil", counter: true, mode: "CASH", lines: [{ sku: "DMK-ST-010", qty: 2 }] },
  { date: "2026-07-11", customer: "Ganesh More", counter: true, mode: "UPI", lines: [{ sku: "DMK-CR-302", qty: 1 }, { sku: "DMK-BK-101", qty: 2 }] },
  { date: "2026-07-30", customer: "Rahul Deshmukh", counter: true, mode: "CASH", lines: [{ sku: "DMK-SB-401", qty: 1 }, { sku: "DMK-CH-004", qty: 1 }] },
  { date: "2026-08-21", customer: "Sunita Kale", counter: true, mode: "UPI", lines: [{ sku: "DMK-KW-501", qty: 1 }, { sku: "DMK-ST-012", qty: 1 }] },
];

async function seedInvoices(specs: InvSpec[], productMap: Map<string, ProductRow>, customerMap: Map<string, CustomerRow>, fy: string) {
  const out = new Map<string, { id: string; number: string; grand: number; customerId: string | null }>();
  for (const spec of specs) {
    // drop zero-qty lines (guard against spec typos)
    const lines = spec.lines.filter((l) => l.qty > 0);
    const customer = customerMap.get(spec.customer)!;
    const isCounter = !!spec.counter;
    const mode = spec.mode ?? "CREDIT";
    const tierKey = TIER_FIELD[customer.assignedTier] ?? "tier4Retailer";
    const buyerState = isCounter ? FIRM!.stateCode : customer.stateCode;

    let subtotal = 0; let cg = 0; let sg = 0; let ig = 0; let discount = 0;
    const computed = lines.map((l) => {
      const p = productMap.get(l.sku)!;
      const base = (p[tierKey] as number) || p.tier4Retailer;
      const pct = l.pct ?? 0;
      const unitPrice = round2(base * (1 - pct / 100));
      const taxable = round2(unitPrice * l.qty);
      const gst = calculateGST(taxable, p.gstRate, FIRM!.stateCode, buyerState);
      subtotal = round2(subtotal + taxable);
      cg = round2(cg + gst.cgst); sg = round2(sg + gst.sgst); ig = round2(ig + gst.igst);
      discount = round2(discount + (base - unitPrice) * l.qty);
      return { p, unitPrice, taxable, gst, pct, qty: l.qty };
    });
    const { grand, roundOff } = roundOffDelta(subtotal + cg + sg + ig);
    if (grand <= 0 || subtotal <= 0) {
      throw new Error(`Invoice spec ${spec.customer} ${spec.date} computed ₹0 — check product tier prices`);
    }
    const date = d(spec.date, isCounter ? 17 : 12);
    const seq = await nextDocSeq("INV", fy);
    const invoiceNumber = `${FIRM!.invoicePrefix}/${fy}/INV/${String(seq).padStart(4, "0")}`;

    const inv = await db.invoice.create({
      data: {
        firmId: FIRM!.id, invoiceNumber, invoiceDate: date,
        customerId: customer.id, isCounterSale: isCounter,
        subtotal, discountTotal: discount, totalCgst: cg, totalSgst: sg, totalIgst: ig,
        roundOff, grandTotal: grand, amountInWords: amountInWords(grand), paymentMode: mode, status: "POSTED",
        createdAt: date, updatedAt: date,
        lineItems: {
          create: computed.map((c) => ({
            productId: c.p.id, sku: c.p.sku, productName: c.p.name, hsnCode: c.p.hsnCode,
            selectedTier: tierKey, packagingFormat: "PIECE", baseTierPrice: (c.p[tierKey] as number) || c.p.tier4Retailer,
            bulkDiscountPct: c.pct, unitPrice: c.unitPrice, quantity: c.qty,
            taxableAmount: c.taxable, gstRate: c.p.gstRate,
            cgstAmount: c.gst.cgst, sgstAmount: c.gst.sgst, igstAmount: c.gst.igst,
            totalAmount: round2(c.taxable + c.gst.cgst + c.gst.sgst + c.gst.igst),
          })),
        },
      },
    });

    // party ledger + counters (mirror engine)
    if (isCounter) {
      await db.customer.update({ where: { id: customer.id }, data: { visitCount: { increment: 1 }, lifetimeSpend: { increment: grand } } });
      await partyLedger("CUSTOMER", customer.id, date, "SALES", invoiceNumber, `Sales — invoice ${invoiceNumber}`, grand, 0);
      await partyLedger("CUSTOMER", customer.id, date, "RECEIPT", invoiceNumber, `Paid by ${mode} against invoice ${invoiceNumber}`, 0, grand);
    } else {
      await partyLedger("CUSTOMER", customer.id, date, "SALES", invoiceNumber, `Credit sales — invoice ${invoiceNumber}`, grand, 0);
    }

    // SALES journal (no COGS line — nothing to relieve at 0 stock)
    const debitCode = mode === "CREDIT" ? ACC.AR : mode === "CASH" ? ACC.CASH : mode === "UPI" ? ACC.UPI : ACC.BANK;
    const jl: JLine[] = [
      { code: debitCode, side: "DEBIT", amount: grand, narration: mode === "CREDIT" ? "Accounts Receivable" : `Received via ${mode}` },
      { code: ACC.SALES, side: "CREDIT", amount: subtotal, narration: "Domestic sales taxable value" },
    ];
    if (cg > 0) jl.push({ code: ACC.CGST, side: "CREDIT", amount: cg });
    if (sg > 0) jl.push({ code: ACC.SGST, side: "CREDIT", amount: sg });
    if (ig > 0) jl.push({ code: ACC.IGST, side: "CREDIT", amount: ig });
    if (roundOff > 0) jl.push({ code: ACC.RO, side: "CREDIT", amount: roundOff });
    else if (roundOff < 0) jl.push({ code: ACC.RO, side: "DEBIT", amount: Math.abs(roundOff) });
    await postDemoJournal("SALES", date, `Invoice ${invoiceNumber} — ${customer.partyName}`, jl, inv.id);

    if (spec.key) out.set(spec.key, { id: inv.id, number: invoiceNumber, grand, customerId: customer.id });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════
// 2. PURCHASE ORDERS — confirmed POs book Purchases (periodic-style)
// ═════════════════════════════════════════════════════════════════
interface PoSpec { date: string; vendor: string; confirmed: boolean; bill?: string; lines: { sku: string; qty: number; cost: number }[] }
const PO_2526: PoSpec[] = [
  { date: "2025-04-08", vendor: "DMK Polymers Pvt Ltd", confirmed: true, bill: "DMP/2425/0118", lines: [{ sku: "DMK-CH-001", qty: 120, cost: 160 }, { sku: "DMK-BK-103", qty: 150, cost: 80 }, { sku: "DMK-CR-301", qty: 50, cost: 190 }] },
  { date: "2025-06-12", vendor: "Shree Ganesh Distributors", confirmed: true, bill: "SGD/1922", lines: [{ sku: "DMK-ST-010", qty: 80, cost: 105 }, { sku: "DMK-DB-201", qty: 60, cost: 120 }] },
  { date: "2025-07-18", vendor: "Supreme Polymers Industries", confirmed: true, bill: "SPI/5431", lines: [{ sku: "DMK-CH-003", qty: 10, cost: 1150 }, { sku: "DMK-BK-101", qty: 100, cost: 85 }] },
  { date: "2025-09-09", vendor: "Sri Balaji Plastic Traders", confirmed: true, bill: "SBT/88104", lines: [{ sku: "DMK-SB-402", qty: 25, cost: 420 }, { sku: "DMK-KW-503", qty: 30, cost: 330 }] },
  { date: "2025-10-15", vendor: "DMK Polymers Pvt Ltd", confirmed: true, bill: "DMP/2526/0043", lines: [{ sku: "DMK-CH-002", qty: 100, cost: 140 }, { sku: "DMK-BK-104", qty: 120, cost: 80 }, { sku: "DMK-CR-302", qty: 60, cost: 130 }] },
  { date: "2025-12-10", vendor: "Shree Ganesh Distributors", confirmed: false, lines: [{ sku: "DMK-ST-011", qty: 40, cost: 200 }, { sku: "DMK-DB-202", qty: 50, cost: 150 }] },
  { date: "2026-02-06", vendor: "Supreme Polymers Industries", confirmed: true, bill: "SPI/6120", lines: [{ sku: "DMK-SB-401", qty: 40, cost: 175 }, { sku: "DMK-ST-012", qty: 80, cost: 80 }] },
  { date: "2026-03-14", vendor: "DMK Polymers Pvt Ltd", confirmed: false, lines: [{ sku: "DMK-CR-303", qty: 10, cost: 1500 }, { sku: "DMK-CH-001", qty: 80, cost: 160 }] },
  { date: "2026-03-24", vendor: "Sri Balaji Plastic Traders", confirmed: false, lines: [{ sku: "DMK-KW-502", qty: 40, cost: 150 }, { sku: "DMK-SB-403", qty: 50, cost: 85 }] },
];
const PO_2627: PoSpec[] = [
  { date: "2026-04-14", vendor: "DMK Polymers Pvt Ltd", confirmed: true, bill: "DMP/2627/0012", lines: [{ sku: "DMK-CH-001", qty: 150, cost: 160 }, { sku: "DMK-CH-002", qty: 80, cost: 140 }, { sku: "DMK-CR-302", qty: 70, cost: 130 }] },
  { date: "2026-05-12", vendor: "Sri Balaji Plastic Traders", confirmed: true, bill: "SBT/90451", lines: [{ sku: "DMK-SB-402", qty: 40, cost: 420 }, { sku: "DMK-KW-503", qty: 40, cost: 330 }] },
  { date: "2026-06-09", vendor: "Supreme Polymers Industries", confirmed: true, bill: "SPI/7088", lines: [{ sku: "DMK-SB-404", qty: 20, cost: 450 }, { sku: "DMK-CH-003", qty: 12, cost: 1150 }, { sku: "DMK-ST-013", qty: 30, cost: 130 }] },
  { date: "2026-07-08", vendor: "Shree Ganesh Distributors", confirmed: false, lines: [{ sku: "DMK-DB-204", qty: 15, cost: 520 }, { sku: "DMK-DB-203", qty: 20, cost: 380 }] },
  { date: "2026-08-06", vendor: "DMK Polymers Pvt Ltd", confirmed: true, bill: "DMP/2627/0051", lines: [{ sku: "DMK-CR-303", qty: 12, cost: 1500 }, { sku: "DMK-CR-301", qty: 50, cost: 190 }] },
  { date: "2026-08-20", vendor: "Sri Balaji Plastic Traders", confirmed: false, lines: [{ sku: "DMK-KW-502", qty: 50, cost: 150 }, { sku: "DMK-SB-401", qty: 30, cost: 175 }] },
];

async function seedPurchaseOrders(specs: PoSpec[], productMap: Map<string, ProductRow>, vendorMap: Map<string, VendorRow>, fy: string) {
  const out = new Map<string, { id: string; number: string; grand: number; vendorId: string; outstanding: number }>();
  for (const spec of specs) {
    const vendor = vendorMap.get(spec.vendor)!;
    const date = d(spec.date, 10);
    let subtotal = 0; let cg = 0; let sg = 0; let ig = 0;
    const computed = spec.lines.map((l) => {
      const p = productMap.get(l.sku)!;
      const taxable = round2(l.cost * l.qty);
      const gst = calculateGST(taxable, p.gstRate, FIRM!.stateCode, vendor.stateCode);
      subtotal = round2(subtotal + taxable);
      cg = round2(cg + gst.cgst); sg = round2(sg + gst.sgst); ig = round2(ig + gst.igst);
      return { p, ...l, taxable, gst };
    });
    const grand = round2(subtotal + cg + sg + ig);
    const seq = await nextDocSeq("PO", fy);
    const poNumber = `${FIRM!.invoicePrefix}/${fy}/PO/${String(seq).padStart(4, "0")}`;
    const po = await db.purchaseOrder.create({
      data: {
        firmId: FIRM!.id, vendorId: vendor.id, poNumber, poDate: date,
        status: spec.confirmed ? "CONFIRMED" : "PENDING",
        subtotal, totalCgst: cg, totalSgst: sg, totalIgst: ig, grandTotal: grand,
        receivedNote: spec.confirmed ? "Goods received and verified in full — demo history" : "",
        vendorBillNo: spec.bill ?? "", notes: "Demo history — FY " + fy,
        createdAt: date, updatedAt: date,
        items: {
          create: computed.map((c) => ({
            productId: c.p.id, sku: c.p.sku, productName: c.p.name, hsnCode: c.p.hsnCode,
            quantity: c.qty, receivedQty: spec.confirmed ? c.qty : 0, unitCost: c.cost,
            taxableAmount: c.taxable, gstRate: c.p.gstRate,
            cgstAmount: c.gst.cgst, sgstAmount: c.gst.sgst, igstAmount: c.gst.igst,
            totalAmount: round2(c.taxable + c.gst.cgst + c.gst.sgst + c.gst.igst),
          })),
        },
      },
    });
    if (spec.confirmed) {
      // PURCHASE journal — Dr Purchases + Dr ITC / Cr AP (periodic-style;
      // Inventory stays ₹0 to agree with the empty shelves)
      const jl: JLine[] = [
        { code: ACC.PUR, side: "DEBIT", amount: subtotal, narration: "Purchases taxable value" },
        { code: ACC.ITC, side: "DEBIT", amount: round2(cg + sg + ig), narration: "Input GST credit" },
        { code: ACC.AP, side: "CREDIT", amount: grand, narration: "Sundry Creditors" },
      ];
      await postDemoJournal("PURCHASE", date, `PO ${poNumber} — ${vendor.vendorName} goods received`, jl, po.id);
      await partyLedger("VENDOR", vendor.id, date, "PURCHASE", poNumber, `Goods received — PO ${poNumber}`, 0, grand);
    }
    out.set(spec.date, { id: po.id, number: poNumber, grand, vendorId: vendor.id, outstanding: grand });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════
// 3. RECEIPTS + PAYMENTS (with allocations)
// ═════════════════════════════════════════════════════════════════
interface RcptSpec { date: string; customer: string; amount: number; mode: string; utr: string; alloc?: { inv: string; amount: number | "FULL" }[] }
const RCPT_2526: RcptSpec[] = [
  { date: "2025-05-20", customer: "Latur", amount: 5000, mode: "NEFT", utr: "ICICR2505112" },
  { date: "2025-06-30", customer: "Solapur", amount: 10000, mode: "NEFT", utr: "HDFCN2506218", alloc: [{ inv: "S1", amount: 10000 }] },
  { date: "2025-07-15", customer: "Latur", amount: 6000, mode: "NEFT", utr: "ICICR2507190" },
  { date: "2025-08-20", customer: "Pune", amount: 8000, mode: "UPI", utr: "UPI882341902", alloc: [{ inv: "P1", amount: 8000 }] },
  { date: "2025-09-30", customer: "Mumbai", amount: 12000, mode: "NEFT", utr: "HDFCN2509433", alloc: [{ inv: "M1", amount: 12000 }] },
  { date: "2025-10-25", customer: "Latur", amount: 11602, mode: "NEFT", utr: "ICICR2510227", alloc: [{ inv: "L1", amount: "FULL" }] },
  { date: "2025-11-08", customer: "Hyderabad", amount: 14443, mode: "NEFT", utr: "YESBN2511044", alloc: [{ inv: "H1", amount: "FULL" }] },
  { date: "2025-12-15", customer: "Solapur", amount: 6142, mode: "NEFT", utr: "HDFCN2512551", alloc: [{ inv: "S1", amount: "FULL" }] },
  { date: "2026-01-20", customer: "Nanded", amount: 6136, mode: "UPI", utr: "UPI551092347", alloc: [{ inv: "N1", amount: 6136 }] },
  { date: "2026-02-25", customer: "Mumbai", amount: 8927, mode: "NEFT", utr: "HDFCN2602120", alloc: [{ inv: "M1", amount: "FULL" }] },
  { date: "2026-03-18", customer: "Pune", amount: 3890, mode: "NEFT", utr: "ICICR2603136", alloc: [{ inv: "P1", amount: "FULL" }] },
];
const RCPT_2627: RcptSpec[] = [
  { date: "2026-04-28", customer: "Mumbai", amount: 10000, mode: "NEFT", utr: "HDFCN2604310", alloc: [{ inv: "M3", amount: 10000 }] },
  { date: "2026-05-30", customer: "Hyderabad", amount: 15859, mode: "NEFT", utr: "YESBN2605122", alloc: [{ inv: "H3", amount: "FULL" }] },
  { date: "2026-06-20", customer: "Latur", amount: 8000, mode: "UPI", utr: "UPI771203485", alloc: [{ inv: "L4", amount: 8000 }] },
  { date: "2026-07-10", customer: "Hubli", amount: 10000, mode: "NEFT", utr: "KKBKN2607180", alloc: [{ inv: "HB2", amount: 10000 }] },
  { date: "2026-07-22", customer: "Solapur", amount: 15000, mode: "NEFT", utr: "HDFCN2607241", alloc: [{ inv: "S4", amount: 15000 }] },
  { date: "2026-08-12", customer: "Nanded", amount: 13806, mode: "NEFT", utr: "ICICR2608019", alloc: [{ inv: "N3", amount: "FULL" }] },
  { date: "2026-08-20", customer: "Pune", amount: 8000, mode: "UPI", utr: "UPI623819044", alloc: [{ inv: "P3", amount: 8000 }] },
  { date: "2026-08-26", customer: "Mumbai", amount: 10908, mode: "NEFT", utr: "HDFCN2608287", alloc: [{ inv: "M3", amount: "FULL" }] },
  { date: "2026-08-29", customer: "Latur", amount: 15453, mode: "NEFT", utr: "ICICR2608301", alloc: [{ inv: "L3", amount: 15453 }] },
];

async function seedReceipts(specs: RcptSpec[], invoiceIndex: Map<string, { id: string; number: string; grand: number; customerId: string | null; outstanding: number }>, customerMap: Map<string, CustomerRow>) {
  for (const spec of specs) {
    const customer = customerMap.get(spec.customer)!;
    const date = d(spec.date, 13);
    const amount = round2(spec.amount);
    const rcpt = await db.customerReceipt.create({
      data: { firmId: FIRM!.id, customerId: customer.id, receiptDate: date, amount, mode: spec.mode, utrRef: spec.utr, notes: "Demo history receipt", createdAt: date },
    });
    for (const a of spec.alloc ?? []) {
      const inv = invoiceIndex.get(a.inv);
      if (!inv) throw new Error(`Receipt alloc references unknown invoice key ${a.inv}`);
      const target = a.amount === "FULL" ? inv.outstanding : Math.min(round2(a.amount), inv.outstanding);
      if (target <= 0) continue;
      await db.receiptAllocation.create({ data: { firmId: FIRM!.id, receiptId: rcpt.id, invoiceId: inv.id, amount: target, createdAt: date } });
      inv.outstanding = round2(inv.outstanding - target);
    }
    const cashAcc = spec.mode === "CASH" ? ACC.CASH : ACC.BANK;
    await postDemoJournal("RECEIPT", date, `Receipt from ${customer.partyName} — Ref ${spec.utr}`, [
      { code: cashAcc, side: "DEBIT", amount },
      { code: ACC.AR, side: "CREDIT", amount, narration: "Sundry Debtors settled" },
    ], rcpt.id);
    await partyLedger("CUSTOMER", customer.id, date, "RECEIPT", spec.utr, `Receipt by ${spec.mode} (Ref ${spec.utr})`, 0, amount);
  }
}

interface PaySpec { date: string; vendor: string; amount: number; mode: string; utr: string; alloc?: { po: string; amount: number | "FULL" }[] }
const PAY_2526: PaySpec[] = [
  { date: "2025-05-05", vendor: "DMK Polymers Pvt Ltd", amount: 25000, mode: "NEFT", utr: "HDFCN5202501", alloc: [{ po: "2025-04-08", amount: 25000 }] },
  { date: "2025-07-25", vendor: "Shree Ganesh Distributors", amount: 18408, mode: "NEFT", utr: "HDFCN5202807", alloc: [{ po: "2025-06-12", amount: "FULL" }] },
  { date: "2025-08-30", vendor: "Supreme Polymers Industries", amount: 15000, mode: "NEFT", utr: "HDFCN5203311", alloc: [{ po: "2025-07-18", amount: 15000 }] },
  { date: "2025-10-12", vendor: "Sri Balaji Plastic Traders", amount: 10000, mode: "NEFT", utr: "HDFCN5204019", alloc: [{ po: "2025-09-09", amount: 10000 }] },
  { date: "2026-01-15", vendor: "Supreme Polymers Industries", amount: 8600, mode: "NEFT", utr: "HDFCN5210104", alloc: [{ po: "2025-07-18", amount: "FULL" }] },
  { date: "2026-02-28", vendor: "DMK Polymers Pvt Ltd", amount: 37052, mode: "NEFT", utr: "HDFCN5210225", alloc: [{ po: "2025-10-15", amount: "FULL" }] },
];
const PAY_2627: PaySpec[] = [
  { date: "2026-05-20", vendor: "DMK Polymers Pvt Ltd", amount: 30000, mode: "NEFT", utr: "HDFCN5211210", alloc: [{ po: "2026-04-14", amount: 30000 }] },
  { date: "2026-06-25", vendor: "Sri Balaji Plastic Traders", amount: 20000, mode: "NEFT", utr: "HDFCN5211502", alloc: [{ po: "2026-05-12", amount: 20000 }] },
  { date: "2026-07-18", vendor: "Supreme Polymers Industries", amount: 31506, mode: "NEFT", utr: "HDFCN5211788", alloc: [{ po: "2026-06-09", amount: "FULL" }] },
  { date: "2026-08-15", vendor: "DMK Polymers Pvt Ltd", amount: 22274, mode: "NEFT", utr: "HDFCN5211960", alloc: [{ po: "2026-04-14", amount: "FULL" }] },
  { date: "2026-08-28", vendor: "Sri Balaji Plastic Traders", amount: 15400, mode: "NEFT", utr: "HDFCN5212044", alloc: [{ po: "2026-05-12", amount: "FULL" }] },
];

async function seedPayments(specs: PaySpec[], poIndex: Map<string, { id: string; number: string; grand: number; vendorId: string; outstanding: number }>, vendorMap: Map<string, VendorRow>) {
  for (const spec of specs) {
    const vendor = vendorMap.get(spec.vendor)!;
    const date = d(spec.date, 16);
    const amount = round2(spec.amount);
    const pay = await db.vendorPayment.create({
      data: { firmId: FIRM!.id, vendorId: vendor.id, paymentDate: date, amount, mode: spec.mode, utrRef: spec.utr, notes: "Demo history payment", createdAt: date },
    });
    for (const a of spec.alloc ?? []) {
      const po = poIndex.get(a.po);
      if (!po) throw new Error(`Payment alloc references unknown PO key ${a.po}`);
      const target = a.amount === "FULL" ? po.outstanding : Math.min(round2(a.amount), po.outstanding);
      if (target <= 0) continue;
      await db.paymentAllocation.create({ data: { firmId: FIRM!.id, paymentId: pay.id, purchaseOrderId: po.id, amount: target, createdAt: date } });
      po.outstanding = round2(po.outstanding - target);
    }
    const cashAcc = spec.mode === "CASH" ? ACC.CASH : ACC.BANK;
    await postDemoJournal("PAYMENT", date, `Payment to ${vendor.vendorName} — Ref ${spec.utr}`, [
      { code: ACC.AP, side: "DEBIT", amount, narration: "Sundry Creditors settled" },
      { code: cashAcc, side: "CREDIT", amount },
    ], pay.id);
    await partyLedger("VENDOR", vendor.id, date, "PAYMENT", spec.utr, `Payment by ${spec.mode} (Ref ${spec.utr})`, amount, 0);
  }
}

// ═════════════════════════════════════════════════════════════════
// 4. SALES RETURNS (credit notes, fully recovered) + PURCHASE RETURNS
// ═════════════════════════════════════════════════════════════════
interface SrSpec { date: string; customer: string; invKey?: string; sku: string; qty: number; defect?: string }
const SR_2526: SrSpec[] = [
  { date: "2025-11-22", customer: "Mumbai", invKey: "M2", sku: "DMK-CH-001", qty: 2, defect: "Broken" },
  { date: "2026-01-30", customer: "Latur", invKey: "L3", sku: "DMK-CH-002", qty: 1, defect: "Broken" },
  { date: "2026-03-05", customer: "Pune", invKey: "P2", sku: "DMK-ST-010", qty: 1, defect: "Defective" },
];
const SR_2627: SrSpec[] = [
  { date: "2026-06-10", customer: "Latur", invKey: "L4", sku: "DMK-CH-001", qty: 2, defect: "Broken" },
];

async function seedSalesReturns(specs: SrSpec[], productMap: Map<string, ProductRow>, customerMap: Map<string, CustomerRow>, invoiceIndex: Map<string, { id: string; number: string; grand: number; customerId: string | null; outstanding: number; linePrice?: Map<string, number> }>, fy: string) {
  for (const spec of specs) {
    const customer = customerMap.get(spec.customer)!;
    const p = productMap.get(spec.sku)!;
    const date = d(spec.date, 15);
    // Price at the invoiced rate when the return references an invoice
    let unitPrice = round2(p.tier4Retailer);
    if (spec.invKey) {
      const inv = invoiceIndex.get(spec.invKey);
      unitPrice = inv?.linePrice?.get(spec.sku) ?? unitPrice;
    }
    const taxable = round2(unitPrice * spec.qty);
    const gst = calculateGST(taxable, p.gstRate, FIRM!.stateCode, customer.stateCode || FIRM!.stateCode);
    const tax = round2(gst.cgst + gst.sgst + gst.igst);
    const grand = round2(taxable + tax);
    const seq = await nextDocSeq("CN", fy);
    const cnNo = `${FIRM!.invoicePrefix}/${fy}/CN/${String(seq).padStart(4, "0")}`;
    const refInv = spec.invKey ? invoiceIndex.get(spec.invKey) : undefined;
    const cn = await db.salesReturn.create({
      data: {
        firmId: FIRM!.id, creditNoteNo: cnNo, invoiceRef: refInv?.number ?? "", invoiceId: refInv?.id ?? null,
        customerId: customer.id, returnDate: date, subtotal: taxable, totalTax: tax, grandTotal: grand,
        notes: "Demo history — damaged goods returned", refundMode: "CREDIT", createdAt: date,
        items: {
          create: [{
            productId: p.id, damagedQty: spec.qty, unitPrice, gstRate: p.gstRate, totalAmount: grand,
            defectType: spec.defect ?? "Damaged", sentToVendorQty: spec.qty, // fully recovered — no pending send lines
          }],
        },
      },
    });
    await partyLedger("CUSTOMER", customer.id, date, "CREDIT_NOTE", cnNo, `Sales return — credit note ${cnNo}`, 0, grand);
    const jl: JLine[] = [
      { code: ACC.SR, side: "DEBIT", amount: taxable, narration: "Sales returns contra" },
      ...(gst.cgst > 0 ? [{ code: ACC.CGST, side: "DEBIT" as const, amount: gst.cgst }] : []),
      ...(gst.sgst > 0 ? [{ code: ACC.SGST, side: "DEBIT" as const, amount: gst.sgst }] : []),
      ...(gst.igst > 0 ? [{ code: ACC.IGST, side: "DEBIT" as const, amount: gst.igst }] : []),
      { code: ACC.AR, side: "CREDIT", amount: grand },
    ];
    await postDemoJournal("CREDIT_NOTE", date, `Credit note ${cnNo} — sales return from ${customer.partyName}`, jl, cn.id);
  }
}

interface PrSpec { date: string; vendor: string; poDate?: string; sku: string; qty: number; reason?: string }
const PR_2526: PrSpec[] = [
  { date: "2025-09-15", vendor: "DMK Polymers Pvt Ltd", poDate: "2025-04-08", sku: "DMK-CR-301", qty: 2, reason: "Transit Damage" },
  { date: "2026-02-10", vendor: "Supreme Polymers Industries", poDate: "2025-07-18", sku: "DMK-BK-101", qty: 3, reason: "Moulding Defect" },
];
const PR_2627: PrSpec[] = [
  { date: "2026-07-22", vendor: "Supreme Polymers Industries", poDate: "2026-06-09", sku: "DMK-ST-013", qty: 2, reason: "Transit Damage" },
];

async function seedPurchaseReturns(specs: PrSpec[], productMap: Map<string, ProductRow>, vendorMap: Map<string, VendorRow>, poIndex: Map<string, { id: string; number: string; grand: number; vendorId: string; outstanding: number }>, fy: string) {
  for (const spec of specs) {
    const vendor = vendorMap.get(spec.vendor)!;
    const p = productMap.get(spec.sku)!;
    const date = d(spec.date, 14);
    const po = spec.poDate ? poIndex.get(spec.poDate) : undefined;
    const taxable = round2(p.purchaseCost * spec.qty);
    const gst = calculateGST(taxable, p.gstRate, FIRM!.stateCode, vendor.stateCode);
    const tax = round2(gst.cgst + gst.sgst + gst.igst);
    const grand = round2(taxable + tax);
    const seq = await nextDocSeq("DN", fy);
    const dnNo = `${FIRM!.invoicePrefix}/${fy}/DN/${String(seq).padStart(4, "0")}`;
    const dn = await db.purchaseReturn.create({
      data: {
        firmId: FIRM!.id, debitNoteNo: dnNo, poRef: po?.number ?? "", poId: po?.id ?? null, vendorId: vendor.id,
        returnDate: date, subtotal: taxable, totalTax: tax, grandTotal: grand,
        notes: "Demo history — damaged stock returned to vendor", settlementMode: "CREDIT", createdAt: date,
        items: {
          create: [{ productId: p.id, damagedQty: spec.qty, unitCost: p.purchaseCost, gstRate: p.gstRate, totalAmount: grand, reason: spec.reason ?? "Transit Damage" }],
        },
      },
    });
    await partyLedger("VENDOR", vendor.id, date, "DEBIT_NOTE", dnNo, `Purchase return — debit note ${dnNo}`, grand, 0);
    await postDemoJournal("DEBIT_NOTE", date, `Debit note ${dnNo} — purchase return to ${vendor.vendorName}`, [
      { code: ACC.AP, side: "DEBIT", amount: grand },
      { code: ACC.PUR, side: "CREDIT", amount: taxable, narration: "Purchases reversed" },
      ...(gst.cgst > 0 ? [{ code: ACC.CGST, side: "CREDIT" as const, amount: gst.cgst }] : []),
      ...(gst.sgst > 0 ? [{ code: ACC.SGST, side: "CREDIT" as const, amount: gst.sgst }] : []),
      ...(gst.igst > 0 ? [{ code: ACC.IGST, side: "CREDIT" as const, amount: gst.igst }] : []),
    ], dn.id);
  }
}

// ═════════════════════════════════════════════════════════════════
// 5. OPERATING EXPENSES (JOURNAL vouchers)
// ═════════════════════════════════════════════════════════════════
interface OpexSpec { date: string; expense: "OPEX" | "FREIGHT"; amount: number; mode: "BANK" | "CASH"; narration: string }
const OPEX_2526: OpexSpec[] = [
  { date: "2025-04-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Q1 FY 2025-26" },
  { date: "2025-07-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Q2 FY 2025-26" },
  { date: "2025-08-15", expense: "OPEX", amount: 9800, mode: "BANK", narration: "Electricity bill — Aug 2025" },
  { date: "2025-10-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Q3 FY 2025-26" },
  { date: "2025-11-10", expense: "FREIGHT", amount: 4200, mode: "CASH", narration: "Freight inward — local tempo hires" },
  { date: "2026-01-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Q4 FY 2025-26" },
  { date: "2026-02-12", expense: "OPEX", amount: 11200, mode: "BANK", narration: "Electricity bill — Feb 2026" },
  { date: "2026-03-20", expense: "OPEX", amount: 3600, mode: "CASH", narration: "Office stationery and supplies" },
];
const OPEX_2627: OpexSpec[] = [
  { date: "2026-04-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Apr 2026" },
  { date: "2026-05-16", expense: "OPEX", amount: 10400, mode: "BANK", narration: "Electricity bill — May 2026" },
  { date: "2026-07-05", expense: "OPEX", amount: 45000, mode: "BANK", narration: "Shop rent — Jul 2026" },
  { date: "2026-08-09", expense: "FREIGHT", amount: 5600, mode: "CASH", narration: "Freight inward — inter-state consignments" },
  { date: "2026-08-18", expense: "OPEX", amount: 2850, mode: "CASH", narration: "Trade licence renewal" },
];

async function seedOpex(specs: OpexSpec[]) {
  for (const spec of specs) {
    const date = d(spec.date, 9);
    await postDemoJournal("JOURNAL", date, spec.narration, [
      { code: spec.expense === "FREIGHT" ? ACC.FREIGHT : ACC.OPEX, side: "DEBIT", amount: spec.amount, narration: spec.narration },
      { code: spec.mode === "CASH" ? ACC.CASH : ACC.BANK, side: "CREDIT", amount: spec.amount },
    ]);
  }
}

// ═════════════════════════════════════════════════════════════════
// 6. PARTY LEDGER RECOMPUTE (chronological, opening → closing)
// ═════════════════════════════════════════════════════════════════
async function recomputeParties() {
  const customers = await db.customer.findMany({ where: { firmId: FIRM!.id } });
  for (const c of customers) {
    const rows = await db.ledgerEntry.findMany({
      where: { firmId: FIRM!.id, partyType: "CUSTOMER", customerId: c.id },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    let bal = c.openingBalance;
    for (const r of rows) {
      bal = round2(bal + r.debitAmount - r.creditAmount);
      if (r.balanceAfter !== bal) {
        await db.ledgerEntry.update({ where: { id: r.id }, data: { balanceAfter: bal } });
      }
    }
    if (round2(c.closingBalance) !== bal) {
      await db.customer.update({ where: { id: c.id }, data: { closingBalance: bal } });
    }
  }
  const vendors = await db.vendor.findMany({ where: { firmId: FIRM!.id } });
  for (const v of vendors) {
    const rows = await db.ledgerEntry.findMany({
      where: { firmId: FIRM!.id, partyType: "VENDOR", vendorId: v.id },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    let bal = v.openingBalance;
    for (const r of rows) {
      bal = round2(bal - r.debitAmount + r.creditAmount); // Cr-positive
      if (r.balanceAfter !== bal) {
        await db.ledgerEntry.update({ where: { id: r.id }, data: { balanceAfter: bal } });
      }
    }
    if (round2(v.closingBalance) !== bal) {
      await db.vendor.update({ where: { id: v.id }, data: { closingBalance: bal } });
    }
  }
}

// ═════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════
interface ProductRow {
  id: string; sku: string; name: string; hsnCode: string; gstRate: number; purchaseCost: number;
  tier1Distributor: number; tier2Wholesale: number; tier3SemiWholesale: number; tier4Retailer: number;
}
interface CustomerRow { id: string; partyName: string; stateCode: string; assignedTier: string }
interface VendorRow { id: string; vendorName: string; stateCode: string }

async function main() {
  await loadContext();
  const firmId = FIRM!.id;

  // ── idempotency guard ───────────────────────────────────────────
  const existing2526 = await db.invoice.count({
    where: { firmId, invoiceDate: { gte: d("2025-04-01", 0), lt: d("2026-04-01", 0) } },
  });
  if (existing2526 > 0) {
    console.log(`SKIP — ${existing2526} invoice(s) already exist in FY 2025-26 (demo history already seeded)`);
    return;
  }

  // ── FY registry rows (2027-28 deliberately NOT created — the owner
  //    opens it via the FY gate / switcher, demonstrating the flow) ──
  for (const label of ["2025-26", "2026-27"]) {
    const startYear = parseInt(label.slice(0, 4), 10);
    await db.financialYear.upsert({
      where: { firmId_label: { firmId, label } },
      update: {},
      create: {
        firmId, label,
        startDate: new Date(`${startYear}-04-01T00:00:00+05:30`),
        endDate: new Date(`${startYear + 1}-03-31T23:59:59+05:30`),
        isClosed: false, autoCreated: false,
      },
    });
  }
  if ((await db.firm.findUnique({ where: { id: firmId } }))!.financialYear !== "2026-27") {
    await db.firm.update({ where: { id: firmId }, data: { financialYear: "2026-27" } });
  }

  // ── re-date the opening-capital journal to 1 Apr 2025 ───────────
  const opening = await db.journalEntry.findFirst({
    where: { firmId, voucherType: "OPENING" },
    orderBy: { postingDate: "asc" },
  });
  if (opening && opening.postingDate >= d("2025-04-01", 0)) {
    const newNo = `${FIRM!.invoicePrefix}/2025-26/OPE/0001`;
    await db.journalEntry.update({
      where: { id: opening.id },
      data: { postingDate: d("2025-04-01", 9), createdAt: d("2025-04-01", 9), voucherNumber: newNo, narration: "Opening capital contribution — books opened for FY 2025-26" },
    });
    console.log(`Opening journal re-dated to 2025-04-01 and renumbered ${newNo}`);
  }

  // ── lookups ─────────────────────────────────────────────────────
  const products = await db.product.findMany({ where: { firmId } });
  const productMap = new Map(products.map((p) => [p.sku, p as unknown as ProductRow]));
  const customers = await db.customer.findMany({ where: { firmId } });
  const customerMap = new Map<string, CustomerRow>();
  for (const c of customers) {
    if (c.customerType === "B2B") customerMap.set(c.partyName.split(" ")[0], c as unknown as CustomerRow); // location-first: "Latur Ishwar Mule Traders"
    else customerMap.set(c.partyName, c as unknown as CustomerRow); // B2C counter directory
  }
  const vendors = await db.vendor.findMany({ where: { firmId } });
  const vendorMap = new Map(vendors.map((v) => [v.vendorName, v as unknown as VendorRow]));

  // ══ FY 2025-26 — the establishment year ══════════════════════════
  console.log("Seeding FY 2025-26 …");
  const invIdx2526 = new Map<string, { id: string; number: string; grand: number; customerId: string | null; outstanding: number; linePrice?: Map<string, number> }>();
  const created2526 = await seedInvoices(INV_2526, productMap, customerMap, "2025-26");
  for (const [k, v] of created2526) invIdx2526.set(k, { ...v, outstanding: v.grand });
  await attachLinePrices(invIdx2526);
  const po2526 = await seedPurchaseOrders(PO_2526, productMap, vendorMap, "2025-26");
  await seedReceipts(RCPT_2526, invIdx2526, customerMap);
  await seedPayments(PAY_2526, po2526, vendorMap);
  await seedSalesReturns(SR_2526, productMap, customerMap, invIdx2526, "2025-26");
  await seedPurchaseReturns(PR_2526, productMap, vendorMap, po2526, "2025-26");
  await seedOpex(OPEX_2526);

  // ══ FY 2026-27 — the scale-up year (different mix) ═══════════════
  console.log("Seeding FY 2026-27 (April → today) …");
  const created2627 = await seedInvoices(INV_2627, productMap, customerMap, "2026-27");
  const invIdx2627 = new Map<string, { id: string; number: string; grand: number; customerId: string | null; outstanding: number; linePrice?: Map<string, number> }>();
  for (const [k, v] of created2627) invIdx2627.set(k, { ...v, outstanding: v.grand });
  await attachLinePrices(invIdx2627);
  const po2627 = await seedPurchaseOrders(PO_2627, productMap, vendorMap, "2026-27");
  // 2026-27 receipts may settle invoices left open from 2025-26 → merged lookup
  const mergedIdx = new Map([...invIdx2526, ...invIdx2627]);
  await seedReceipts(RCPT_2627, mergedIdx, customerMap);
  await seedPayments(PAY_2627, po2627, vendorMap);
  await seedSalesReturns(SR_2627, productMap, customerMap, invIdx2627, "2026-27");
  await seedPurchaseReturns(PR_2627, productMap, vendorMap, po2627, "2026-27");
  await seedOpex(OPEX_2627);

  // ── recompute party ledgers + closing balances ──────────────────
  console.log("Recomputing party ledgers …");
  await recomputeParties();

  // ── validation: books must balance & subledgers reconcile ───────
  const journals = await db.journalEntry.findMany({ where: { firmId }, select: { totalDebit: true, totalCredit: true } });
  const dr = round2(journals.reduce((s, j) => s + j.totalDebit, 0));
  const cr = round2(journals.reduce((s, j) => s + j.totalCredit, 0));
  const glLines = await db.journalLine.findMany({
    where: { journal: { firmId }, account: { accountCode: { in: [ACC.AR, ACC.AP] } } },
    select: { accountId: true, debitAmount: true, creditAmount: true, account: { select: { accountCode: true } } },
  });
  const arBal = round2(glLines.filter((l) => l.account.accountCode === ACC.AR).reduce((s, l) => s + l.debitAmount - l.creditAmount, 0));
  const apBal = round2(glLines.filter((l) => l.account.accountCode === ACC.AP).reduce((s, l) => s + l.creditAmount - l.debitAmount, 0));
  const custs = await db.customer.findMany({ where: { firmId }, select: { closingBalance: true } });
  const vends = await db.vendor.findMany({ where: { firmId }, select: { closingBalance: true } });
  const sumDr = round2(custs.reduce((s, c) => s + c.closingBalance, 0));
  const sumCr = round2(vends.reduce((s, v) => s + v.closingBalance, 0));

  const [i25, i26] = await Promise.all([
    db.invoice.count({ where: { firmId, invoiceDate: { gte: d("2025-04-01", 0), lt: d("2026-04-01", 0) } } }),
    db.invoice.count({ where: { firmId, invoiceDate: { gte: d("2026-04-01", 0), lt: d("2027-04-01", 0) } } }),
  ]);

  console.log("─".repeat(60));
  console.log(`TB          : ΣDr ₹${dr.toFixed(2)}  ΣCr ₹${cr.toFixed(2)}  Δ ₹${(dr - cr).toFixed(2)}`);
  console.log(`AR recon    : GL 1100 ₹${arBal.toFixed(2)} vs Σ debtors ₹${sumDr.toFixed(2)}  Δ ₹${(arBal - sumDr).toFixed(2)}`);
  console.log(`AP recon    : GL 2000 ₹${apBal.toFixed(2)} vs Σ creditors ₹${sumCr.toFixed(2)}  Δ ₹${(apBal - sumCr).toFixed(2)}`);
  console.log(`Invoices    : FY 2025-26 → ${i25}   FY 2026-27 → ${i26} (incl. pre-existing)`);
  if (Math.abs(dr - cr) > 0.001) throw new Error("TB out of balance!");
  if (Math.abs(arBal - sumDr) > 0.05) throw new Error("AR subledger does not reconcile!");
  if (Math.abs(apBal - sumCr) > 0.05) throw new Error("AP subledger does not reconcile!");
  console.log("ALL CHECKS PASSED ✓");
}

/** Fill each invoice index entry with its per-SKU unit prices (for CN pricing). */
async function attachLinePrices(index: Map<string, { id: string; number: string; grand: number; customerId: string | null; outstanding: number; linePrice?: Map<string, number> }>) {
  for (const [key, entry] of index) {
    const lines = await db.invoiceLineItem.findMany({ where: { invoiceId: entry.id }, select: { sku: true, unitPrice: true } });
    entry.linePrice = new Map(lines.map((l) => [l.sku, l.unitPrice]));
    void key;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
