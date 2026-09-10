// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-team/members — owner portal manages sales accounts.
// GET  ?firmId= → members + per-member attribution stats
// POST          → create a member (username unique per firm)
// The permission booleans mirror the /sales section switchboard.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  asRecord,
  getBool,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { hashPasswordAsync } from "@/app/api/v1/_lib/verification";

const MEMBER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  username: true,
  isActive: true,
  assignedRouteId: true,
  assignedRoute: { select: { id: true, name: true } },
  canB2BBilling: true,
  canB2CPos: true,
  canSalesOrders: true,
  canManageCustomers: true,
  canViewStock: true,
  canViewInvoices: true,
  canRecordReceipts: true,
  canOverridePrice: true,
  createdAt: true,
  _count: { select: { invoices: true, salesOrders: true, receipts: true, customersCreated: true } },
} as const;

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));

    const [members, billedByMember, billedTodayByMember] = await Promise.all([
      db.salesMember.findMany({
        where: { firmId: firm.id },
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
        select: MEMBER_SELECT,
      }),
      db.invoice.groupBy({
        by: ["salesMemberId"],
        where: { firmId: firm.id, salesMemberId: { not: null }, status: "POSTED" },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      db.invoice.groupBy({
        by: ["salesMemberId"],
        where: {
          firmId: firm.id,
          salesMemberId: { not: null },
          status: "POSTED",
          invoiceDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
        _sum: { grandTotal: true },
      }),
    ]);

    const billedMap = new Map(billedByMember.map((r) => [r.salesMemberId, r]));
    const todayMap = new Map(billedTodayByMember.map((r) => [r.salesMemberId, r]));

    return ok({
      members: members.map((m) => ({
        ...m,
        totalBilled: billedMap.get(m.id)?._sum?.grandTotal ?? 0,
        invoiceCount: billedMap.get(m.id)?._count?._all ?? m._count.invoices,
        todayBilled: todayMap.get(m.id)?._sum?.grandTotal ?? 0,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const fullName = getStr(body.fullName);
    const username = getStr(body.username).toLowerCase().trim();
    const password = getStr(body.password);
    if (!fullName || !username || !password) {
      throw new BusinessError("ERR_VALIDATION", "Full name, username and password are required", 400);
    }
    if (password.length < 4) {
      throw new BusinessError("ERR_VALIDATION", "Password must be at least 4 characters", 400);
    }

    const dupe = await db.salesMember.findFirst({
      where: { firmId: firm.id, username },
      select: { id: true },
    });
    if (dupe) {
      throw new BusinessError("ERR_DUPLICATE_USERNAME", `Username "${username}" is already taken in this firm`, 409);
    }

    // Optional territory mapping — the route must belong to this firm.
    const assignedRouteId = getStr(body.assignedRouteId);
    if (assignedRouteId) {
      const route = await db.deliveryRoute.findFirst({
        where: { id: assignedRouteId, firmId: firm.id },
        select: { id: true },
      });
      if (!route) throw new BusinessError("ERR_VALIDATION", "Selected route does not exist in this firm", 422);
    }

    const member = await db.salesMember.create({
      data: {
        firmId: firm.id,
        fullName,
        phone: getStr(body.phone),
        username,
        passwordHash: await hashPasswordAsync(password),
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        assignedRouteId: assignedRouteId || null,
        canB2BBilling: getBool(body.canB2BBilling, true),
        canB2CPos: getBool(body.canB2CPos, true),
        canSalesOrders: getBool(body.canSalesOrders, true),
        canManageCustomers: getBool(body.canManageCustomers, true),
        canViewStock: getBool(body.canViewStock, true),
        canViewInvoices: getBool(body.canViewInvoices, true),
        canRecordReceipts: getBool(body.canRecordReceipts, false),
        canOverridePrice: getBool(body.canOverridePrice, false),
      },
      select: MEMBER_SELECT,
    });

    return ok(member, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
