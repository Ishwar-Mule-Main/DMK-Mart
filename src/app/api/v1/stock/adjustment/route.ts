// ═══════════════════════════════════════════════════════════════
// /api/v1/stock/adjustment — dual-stock correction (R3)
// TRANSFER_DAMAGED : sellable → damaged quarantine (two audit rows)
// REQUEUE_SELLABLE : damaged → sellable (repaired, value unchanged)
// WRITE_OFF        : damaged stock destroyed → DAMAGE_LOSS journal (R6)
// ADD_SELLABLE     : unrecorded surplus inward → INVENTORY Dr / STOCK_ADJ Cr
// REMOVE_SELLABLE  : count-correction shortage → STOCK_ADJ Dr / INVENTORY Cr
// Every path writes an append-only InventoryMovement + StockAdjustment row.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db, dbTx } from "@/lib/db";
import { ACC, ensureStockAdjustmentAccount, postJournal } from "@/lib/journal";
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

const ADJUST_TYPES = [
  "TRANSFER_DAMAGED",
  "REQUEUE_SELLABLE",
  "WRITE_OFF",
  "ADD_SELLABLE",
  "REMOVE_SELLABLE",
] as const;

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

    if (!(ADJUST_TYPES as readonly string[]).includes(adjustType)) {
      throw new BusinessError(
        "ERR_VALIDATION",
        `adjustType must be one of: ${ADJUST_TYPES.join(", ")}`,
        400
      );
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
      await dbTx(async (tx) => {
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
    } else if (adjustType === "REQUEUE_SELLABLE") {
      // Damaged pool → sellable (repaired / reclassified OK). Value unchanged → no journal.
      await dbTx(async (tx) => {
        await drawDamaged(tx, product, quantity);
        await tx.product.update({
          where: { id: product.id },
          data: { stockQuantity: { increment: quantity } },
        });
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "STOCK_ADJUSTMENT",
          quantity,
          targetPool: "DAMAGED",
          direction: "OUT",
          referenceNo: "ADJUST",
          notes: `Requeued from damaged pool to sellable — ${reason || "no reason given"}`,
        });
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "STOCK_ADJUSTMENT",
          quantity,
          targetPool: "SELLABLE",
          direction: "IN",
          referenceNo: "ADJUST",
          notes: `Received back from damaged quarantine — ${reason || "no reason given"}`,
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
    } else if (adjustType === "WRITE_OFF") {
      // Destroyed from the DAMAGED pool → loss journal
      const lossValue = round2(quantity * product.purchaseCost);
      await dbTx(async (tx) => {
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

      if (lossValue > 0) {
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
    } else if (adjustType === "ADD_SELLABLE") {
      // Unrecorded surplus inward (found stock / missed GRN) → sellable pool.
      // Inventory value rises: Dr INVENTORY, Cr Stock Adjustment (surplus).
      const surplusValue = round2(quantity * product.purchaseCost);
      await dbTx(async (tx) => {
        await tx.product.update({
          where: { id: product.id },
          data: { stockQuantity: { increment: quantity } },
        });
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "STOCK_ADJUSTMENT",
          quantity,
          targetPool: "SELLABLE",
          direction: "IN",
          referenceNo: "ADJUST+",
          notes: `Surplus stock added to sellable — ${reason || "no reason given"}`,
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

      if (surplusValue > 0) {
        await ensureStockAdjustmentAccount(firm.id);
        journal = await postJournal({
          firmId: firm.id,
          voucherType: "JOURNAL",
          postingDate: adjustDate,
          narration: `Stock surplus ${product.name} × ${quantity} @ cost — ${reason || "physical count surplus"}`,
          referenceDocId: adjustment!.id,
          lines: [
            { accountCode: ACC.INVENTORY, entrySide: "DEBIT", amount: surplusValue },
            { accountCode: ACC.STOCK_ADJ, entrySide: "CREDIT", amount: surplusValue },
          ],
        });
      }
    } else {
      // REMOVE_SELLABLE — physical count shortage / shrinkage out of the sellable pool.
      // Inventory value falls: Dr Stock Adjustment (shortage), Cr INVENTORY.
      const shortageValue = round2(quantity * product.purchaseCost);
      await dbTx(async (tx) => {
        await drawSellable(tx, product, quantity);
        await recordMovement(tx, {
          firmId: firm.id,
          productId: product.id,
          movementType: "STOCK_ADJUSTMENT",
          quantity,
          targetPool: "SELLABLE",
          direction: "OUT",
          referenceNo: "ADJUST-",
          notes: `Shortage removed from sellable — ${reason || "no reason given"}`,
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

      if (shortageValue > 0) {
        await ensureStockAdjustmentAccount(firm.id);
        journal = await postJournal({
          firmId: firm.id,
          voucherType: "JOURNAL",
          postingDate: adjustDate,
          narration: `Stock shortage ${product.name} × ${quantity} @ cost — ${reason || "physical count shortage"}`,
          referenceDocId: adjustment!.id,
          lines: [
            { accountCode: ACC.STOCK_ADJ, entrySide: "DEBIT", amount: shortageValue },
            { accountCode: ACC.INVENTORY, entrySide: "CREDIT", amount: shortageValue },
          ],
        });
      }
    }

    return ok({ adjustment, journal }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
