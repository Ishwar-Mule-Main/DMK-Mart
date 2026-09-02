// ═══════════════════════════════════════════════════════════════
// /api/v1/stock/adjustment — dual-stock correction (R3)
// TRANSFER_DAMAGED: sellable → damaged quarantine (two audit rows)
// WRITE_OFF: damaged stock destroyed → DAMAGE_LOSS journal (R6)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ACC, postJournal } from "@/lib/journal";
import { round2 } from "@/lib/gst";
import {
  BusinessError,
  asRecord,
  getDate,
  getNum,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { drawDamaged, drawSellable, recordMovement } from "@/app/api/v1/_lib/party";

type PostedJournal = Awaited<ReturnType<typeof postJournal>>;

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    await resolveFirm(firmId);

    const adjustments = await db.stockAdjustment.findMany({
      where: { firmId },
      orderBy: { adjustDate: "desc" },
      take: 200,
    });
    return ok(adjustments);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const firm = await resolveFirm(getStr(body.firmId));

    const productId = getStr(body.productId);
    const adjustType = getStr(body.adjustType);
    const quantity = round2(getNum(body.quantity));
    const reason = getStr(body.reason);
    const adjustDate = getDate(body.adjustDate);

    if (!["TRANSFER_DAMAGED", "WRITE_OFF"].includes(adjustType)) {
      throw new BusinessError("ERR_VALIDATION", "adjustType must be TRANSFER_DAMAGED or WRITE_OFF", 400);
    }
    if (quantity <= 0) {
      throw new BusinessError("ERR_VALIDATION", "quantity must be positive", 400);
    }

    const product = await db.product.findFirst({ where: { id: productId, firmId: firm.id } });
    if (!product) throw new BusinessError("ERR_PRODUCT_NOT_FOUND", "Product not found for this firm", 404);

    let adjustment: Awaited<ReturnType<typeof db.stockAdjustment.create>> | undefined;
    let journal: PostedJournal | null = null;

    if (adjustType === "TRANSFER_DAMAGED") {
      // Sellable pool → damaged quarantine. Inventory VALUE unchanged,
      // so no journal is posted — two movement rows keep the audit trail.
      await db.$transaction(async (tx) => {
        await drawSellable(tx, product, quantity);
        await tx.product.update({
          where: { id: product.id },
          data: { damagedStock: { increment: quantity } },
        });
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "DAMAGE_QUARANTINE",
          quantity,
          targetPool: "SELLABLE",
          direction: "OUT",
          referenceNo: "ADJUST",
          notes: `Transferred to damaged quarantine — ${reason || "no reason given"}`,
        });
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "DAMAGE_QUARANTINE",
          quantity,
          targetPool: "DAMAGED",
          direction: "IN",
          referenceNo: "ADJUST",
          notes: `Received from sellable pool — ${reason || "no reason given"}`,
        });
        adjustment = await tx.stockAdjustment.create({
          data: {
            firmId: firm.id,
            adjustDate,
            productId: product.id,
            productName: product.name,
            adjustType,
            quantity,
            reason,
          },
        });
      });
    } else {
      // WRITE_OFF: destroyed from the DAMAGED pool → loss journal
      const lossValue = round2(quantity * product.purchaseCost);
      await db.$transaction(async (tx) => {
        await drawDamaged(tx, product, quantity);
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "WRITE_OFF",
          quantity,
          targetPool: "DAMAGED",
          direction: "OUT",
          referenceNo: "WRITE-OFF",
          notes: `Written off — ${reason || "no reason given"}`,
        });
        adjustment = await tx.stockAdjustment.create({
          data: {
            firmId: firm.id,
            adjustDate,
            productId: product.id,
            productName: product.name,
            adjustType,
            quantity,
            reason,
          },
        });
      });

      journal = await postJournal({
        firmId: firm.id,
        voucherType: "JOURNAL",
        postingDate: adjustDate,
        narration: `Write-off ${product.name} × ${quantity} — ${reason || "damaged beyond recovery"}`,
        referenceDocId: adjustment!.id,
        lines: [
          { accountCode: ACC.DAMAGE_LOSS, entrySide: "DEBIT", amount: lossValue },
          { accountCode: ACC.INVENTORY, entrySide: "CREDIT", amount: lossValue },
        ],
      });
    }

    return ok({ adjustment, journal }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
