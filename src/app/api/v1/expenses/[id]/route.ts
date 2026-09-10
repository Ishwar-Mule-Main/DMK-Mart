// ═══════════════════════════════════════════════════════════════
// /api/v1/expenses/[id] — one expense voucher
// GET    → full voucher incl. its PAYMENT journal lines
// DELETE → accounting-correct removal: the original journal stays
//          immutable; a mirror reversal journal cancels its effect,
//          then the voucher row is dropped (drawer / bank / P&L return
//          to their prior state).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { reverseAndDeleteExpenseVoucher } from "@/app/api/v1/_lib/expenses";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sp = _request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const voucher = await db.expenseVoucher.findFirst({
      where: { id, firmId },
      include: {
        category: true,
        journalEntry: { include: { lines: true } },
      },
    });
    if (!voucher) return ok(null, 404);
    return ok(voucher);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const result = await reverseAndDeleteExpenseVoucher(firmId, id);
    return ok({
      deleted: true,
      reversalJournalNumber: result.reversalJournalNumber,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
