// ═══════════════════════════════════════════════════════════════
// /api/v1/expenses — Operational Expense vouchers (R: Expense module)
// GET  → register + report summary (category & payment-source split)
// POST → record one expense; auto-posts a balanced PAYMENT journal
//        (DEBIT category 530x · CREDIT drawer/bank/CC) so the cash
//        drawer, Day Book and P&L update the instant it is saved.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getDate,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import {
  createExpenseVoucher,
  seedExpenseCategories,
  SOURCE_ACCOUNT,
} from "@/app/api/v1/_lib/expenses";
import { round2 } from "@/lib/gst";

const VALID_SOURCES = Object.keys(SOURCE_ACCOUNT);

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const from = sp.get("from");
    const to = sp.get("to");
    const categoryId = getStr(sp.get("categoryId"));
    const paymentSource = getStr(sp.get("paymentSource"));
    const q = getStr(sp.get("q")).trim();
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 200), 1), 500);

    const dateWhere: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) dateWhere.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        dateWhere.lte = d;
      }
    }

    const where = {
      firmId,
      ...(dateWhere.gte || dateWhere.lte ? { expenseDate: dateWhere } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(paymentSource && VALID_SOURCES.includes(paymentSource) ? { paymentSource: paymentSource as never } : {}),
      ...(q
        ? {
            OR: [
              { voucherNumber: { contains: q } },
              { paidTo: { contains: q } },
              { narration: { contains: q } },
              { vehicleNumber: { contains: q } },
            ],
          }
        : {}),
    };

    const [vouchers, totalCount] = await Promise.all([
      db.expenseVoucher.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              code: true,
              nameEnglish: true,
              nameHindi: true,
              nameMarathi: true,
              accountCode: true,
            },
          },
          journalEntry: { select: { id: true, voucherNumber: true } },
        },
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        take: limit,
      }),
      db.expenseVoucher.count({ where }),
    ]);

    // ── Report summary over the same filter window ───────────────
    const allInRange = await db.expenseVoucher.findMany({
      where,
      select: {
        amount: true,
        paymentSource: true,
        category: { select: { code: true, nameEnglish: true, nameHindi: true, nameMarathi: true } },
      },
    });

    const total = round2(allInRange.reduce((s, v) => s + v.amount, 0));

    const catMap = new Map<
      string,
      { code: string; nameEnglish: string; nameHindi: string; nameMarathi: string; total: number; count: number }
    >();
    for (const v of allInRange) {
      const key = v.category.code;
      const cur = catMap.get(key) ?? {
        code: v.category.code,
        nameEnglish: v.category.nameEnglish,
        nameHindi: v.category.nameHindi,
        nameMarathi: v.category.nameMarathi,
        total: 0,
        count: 0,
      };
      cur.total = round2(cur.total + v.amount);
      cur.count += 1;
      catMap.set(key, cur);
    }
    const byCategory = [...catMap.values()].sort((a, b) => b.total - a.total);

    const bySource = { CASH_DRAWER: 0, BANK_CURRENT: 0, BANK_CC: 0 } as Record<string, number>;
    for (const v of allInRange) {
      if (bySource[v.paymentSource] !== undefined) {
        bySource[v.paymentSource] = round2(bySource[v.paymentSource] + v.amount);
      }
    }

    return ok({
      expenses: vouchers,
      count: totalCount,
      summary: {
        total,
        count: allInRange.length,
        byCategory: byCategory.map((c) => ({
          ...c,
          percent: total > 0 ? round2((c.total / total) * 100) : 0,
        })),
        bySource,
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json());
    const firmId = getStr(body.firmId);
    const firm = await resolveFirm(firmId);

    const categoryId = getStr(body.categoryId);
    if (!categoryId) throw new BusinessError("ERR_VALIDATION", "categoryId is required", 400);

    // First save on a fresh firm → auto-seed the trilingual default chart
    const catCount = await db.expenseCategory.count({ where: { firmId } });
    if (catCount === 0) await seedExpenseCategories(firmId);

    const expenseDate = getDate(body.expenseDate ?? body.date, new Date());
    const voucherDate = new Date(expenseDate);
    if (voucherDate.getTime() > Date.now() + 24 * 3600 * 1000) {
      throw new BusinessError("ERR_VALIDATION", "Expense date cannot be in the future", 400);
    }

    const { voucher, journal } = await createExpenseVoucher(firmId, {
      expenseDate: voucherDate,
      categoryId,
      amount: Number(body.amount ?? 0),
      paymentSource: getStr(body.paymentSource, "CASH_DRAWER"),
      paidTo: getStr(body.paidTo),
      vehicleNumber: getStr(body.vehicleNumber),
      tripId: getStr(body.tripId),
      narration: getStr(body.narration),
      receiptFileUrl: typeof body.receiptFileUrl === "string" ? body.receiptFileUrl : null,
      createdBy: getStr(body.createdBy, "OWNER"),
    });

    return ok(
      {
        voucher: {
          ...voucher,
          firmName: firm.firmName,
        },
        journal: {
          id: journal.id,
          voucherNumber: journal.voucherNumber,
          lines: journal.lines.map((l) => ({
            accountName: l.accountName,
            entrySide: l.entrySide,
            amount: l.entrySide === "DEBIT" ? l.debitAmount : l.creditAmount,
          })),
        },
      },
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
