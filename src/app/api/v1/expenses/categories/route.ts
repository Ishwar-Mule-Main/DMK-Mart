// ═══════════════════════════════════════════════════════════════
// /api/v1/expenses/categories — trilingual expense category chart
// GET  → all categories (EN / हिंदी / मराठी names + COA account)
// POST → owner adds a custom category (auto-assigns the next 53xx
//        Indirect-Expense account so journals always balance)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getStr, handleApiError, ok, resolveFirm } from "@/app/api/v1/_lib/api";
import { ensureExpenseAccounts } from "@/app/api/v1/_lib/expenses";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const count = await db.expenseCategory.count({ where: { firmId } });
    if (count === 0) {
      // Fresh firm → lazily seed the default DMK Mart chart
      const { seedExpenseCategories } = await import("@/app/api/v1/_lib/expenses");
      await seedExpenseCategories(firmId);
    }

    const categories = await db.expenseCategory.findMany({
      where: { firmId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: { _count: { select: { expenses: true } } },
    });
    return ok(categories);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json());
    const firmId = getStr(body.firmId);
    await resolveFirm(firmId);

    const nameEnglish = getStr(body.nameEnglish).trim();
    if (!nameEnglish) throw new BusinessError("ERR_VALIDATION", "Category name (English) is required", 400);

    await ensureExpenseAccounts(firmId);

    // Next display code: continue the 4000-series (4800, 4900…)
    const existing = await db.expenseCategory.findMany({
      where: { firmId },
      select: { code: true },
    });
    let code = getStr(body.code).trim();
    if (!code) {
      const nums = existing
        .map((c) => Number(c.code))
        .filter((n) => Number.isFinite(n) && n >= 4100 && n < 4990)
        .sort((a, b) => a - b);
      code = String(nums.length ? Math.max(...nums) + 100 : 4800);
    }
    if (existing.some((c) => c.code === code)) {
      throw new BusinessError("ERR_DUPLICATE_CODE", `Category code ${code} already exists`, 409);
    }

    // Auto-assign the next free 53xx expense account
    const accounts = await db.chartOfAccount.findMany({
      where: { firmId, accountCode: { startsWith: "53" } },
      select: { accountCode: true },
    });
    const used = new Set(accounts.map((a) => a.accountCode));
    let accountCode = "";
    for (let n = 5308; n <= 5390; n++) {
      const candidate = String(n);
      if (!used.has(candidate)) {
        accountCode = candidate;
        break;
      }
    }
    if (!accountCode) {
      throw new BusinessError("ERR_VALIDATION", "No free expense account codes left (5308–5390)", 400);
    }
    await db.chartOfAccount.create({
      data: {
        firmId,
        accountCode,
        accountName: nameEnglish,
        accountGroup: "Indirect Expenses",
        accountClass: "EXPENSE",
      },
    });

    const maxSort = await db.expenseCategory.aggregate({
      where: { firmId },
      _max: { sortOrder: true },
    });

    const category = await db.expenseCategory.create({
      data: {
        firmId,
        code,
        nameEnglish,
        nameHindi: getStr(body.nameHindi).trim() || nameEnglish,
        nameMarathi: getStr(body.nameMarathi).trim() || nameEnglish,
        description: getStr(body.description),
        accountCode,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      },
    });

    return ok(category, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
