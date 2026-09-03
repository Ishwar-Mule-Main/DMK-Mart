// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — PO VERIFICATION CORE
// Owner raises PO → verification request auto-lands on the team
// portal → team counts actual sellable + damaged per line (product
// name + ordered qty only) → owner accepts → GRN pipeline books
// stock + vendor payable + PURCHASE journal (Finance & Accounting).
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { BusinessError } from "./api";
import { confirmPurchaseOrder } from "./po";
import { round2 } from "@/lib/gst";

export const V_STATUS = {
  AWAITING: "AWAITING_VERIFICATION",
  SUBMITTED: "SUBMITTED",
  ACCEPTED: "OWNER_ACCEPTED",
} as const;

/** sha256 hex hash for staff/owner passwords (demo-grade local auth). */
export async function hashPasswordAsync(pw: string): Promise<string> {
  const data = new TextEncoder().encode(`dmk::${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPasswordAsync(pw: string, hash: string): Promise<boolean> {
  const legacyPlain = hash === pw; // seed-created plain passwords
  const hashed = await hashPasswordAsync(pw);
  return hashed === hash || legacyPlain;
}

// ─── Realtime bridge (fire-and-forget — never blocks ERP APIs) ────
// The socket.io mini-service listens on 127.0.0.1:3011 /emit and
// fans events out to both portals on firm rooms. If it is down the
// portals still poll — nothing in the ERP depends on this call.

const EMIT_URL = process.env.DMK_EMIT_URL ?? "http://127.0.0.1:3011/emit";

export async function notifyRealtime(
  firmId: string,
  event: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    await fetch(EMIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firmId, event, data }),
      signal: ac.signal,
    }).catch(() => {});
    clearTimeout(t);
  } catch {
    // realtime is best-effort; polling keeps the portals in sync
  }
}

// ─── Backfill: every PENDING PO must have a verification request ──

export async function ensurePoVerification(firmId: string): Promise<void> {
  const pending = await db.purchaseOrder.findMany({
    where: { firmId, status: "PENDING", verification: { is: null } },
    include: { items: true },
    take: 200,
  });
  if (pending.length === 0) return;
  for (const po of pending) {
    await db.poVerification.create({
      data: {
        firmId,
        poId: po.id,
        status: V_STATUS.AWAITING,
        items: {
          create: po.items.map((i) => ({
            poItemId: i.id,
            productId: i.productId,
            sku: i.sku,
            productName: i.productName,
            orderedQty: i.quantity,
          })),
        },
      },
    });
  }
}

export async function getVerificationByPo(poId: string) {
  return db.poVerification.findUnique({
    where: { poId },
    include: { items: true },
  });
}

/** Create the verification request right after a PO is raised. */
export async function createVerificationForPo(poId: string, firmId: string): Promise<void> {
  const existing = await db.poVerification.findUnique({ where: { poId } });
  if (existing) return;
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
  if (!po) return;
  await db.poVerification.create({
    data: {
      firmId,
      poId,
      status: V_STATUS.AWAITING,
      items: {
        create: po.items.map((i) => ({
          poItemId: i.id,
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          orderedQty: i.quantity,
        })),
      },
    },
  });
}

// ─── Team submit: record actual sellable + damaged per line ───────

export interface VerifyItemInput {
  verificationItemId: string;
  sellableQty: number;
  damagedQty: number;
}

export async function submitVerification(
  verificationId: string,
  opts: {
    items: VerifyItemInput[];
    note?: string;
    staffId: string;
  }
) {
  const verification = await db.poVerification.findUnique({
    where: { id: verificationId },
    include: { po: true, items: true },
  });
  if (!verification) throw new BusinessError("ERR_NOT_FOUND", "Verification request not found", 404);
  if (verification.status === V_STATUS.ACCEPTED) {
    throw new BusinessError("ERR_INVALID_STATUS", "This request is already accepted by the owner", 409);
  }

  const staff = await db.verificationStaff.findFirst({
    where: { id: opts.staffId, firmId: verification.firmId, isActive: true },
  });
  if (!staff) throw new BusinessError("ERR_FORBIDDEN", "Unknown or inactive team account", 403);

  const byId = new Map(opts.items.map((i) => [i.verificationItemId, i]));
  for (const item of verification.items) {
    const input = byId.get(item.id);
    if (!input) {
      throw new BusinessError("ERR_VALIDATION", `Missing quantities for ${item.productName}`, 400);
    }
    const sellable = round2(Math.max(0, Number(input.sellableQty) || 0));
    const damaged = round2(Math.max(0, Number(input.damagedQty) || 0));
    if (sellable + damaged > item.orderedQty + 1e-9) {
      throw new BusinessError(
        "ERR_VALIDATION",
        `${item.productName}: sellable ${sellable} + damaged ${damaged} exceeds ordered ${item.orderedQty}`,
        400
      );
    }
    await db.poVerificationItem.update({
      where: { id: item.id },
      data: { sellableQty: sellable, damagedQty: damaged },
    });
  }

  const updated = await db.poVerification.update({
    where: { id: verification.id },
    data: {
      status: V_STATUS.SUBMITTED,
      submittedById: staff.id,
      submittedAt: new Date(),
      submittedNote: (opts.note ?? "").slice(0, 500),
      returnReason: "",
    },
    include: { items: true, submittedBy: { select: { id: true, name: true, username: true } } },
  });

  await notifyRealtime(verification.firmId, "verify:update", {
    kind: "submitted",
    verificationId: verification.id,
    poNumber: verification.po.poNumber,
    by: staff.name,
  });

  return updated;
}

// ─── Owner accept → GRN pipeline (stock + payable + journal) ──────

export async function acceptVerification(
  verificationId: string,
  opts: {
    items?: VerifyItemInput[];
    note?: string;
    vendorBillNo?: string;
    vendorBillDate?: Date | null;
  } = {}
) {
  const verification = await db.poVerification.findUnique({
    where: { id: verificationId },
    include: { po: { include: { vendor: true } }, items: true },
  });
  if (!verification) throw new BusinessError("ERR_NOT_FOUND", "Verification request not found", 404);
  if (verification.status === V_STATUS.ACCEPTED) {
    throw new BusinessError("ERR_INVALID_STATUS", "Already accepted", 409);
  }
  if (verification.po.status !== "PENDING") {
    throw new BusinessError("ERR_INVALID_STATUS", `PO ${verification.po.poNumber} is ${verification.po.status}`, 409);
  }

  // Owner may fine-tune quantities; defaults = team's submission, or
  // ordered qty when the owner overrides before the team checked in.
  const overrides = new Map((opts.items ?? []).map((i) => [i.verificationItemId, i]));
  const received = verification.items.map((item) => {
    const override = overrides.get(item.id);
    const sellable = override ? Math.max(0, Number(override.sellableQty) || 0) : item.sellableQty ?? item.orderedQty;
    const damaged = override ? Math.max(0, Number(override.damagedQty) || 0) : item.damagedQty ?? 0;
    return { itemId: item.poItemId, acceptedQty: round2(sellable), damagedQty: round2(damaged) };
  });

  const result = await confirmPurchaseOrder(verification.poId, {
    received,
    receivedDate: new Date(),
    note:
      (opts.note ?? verification.submittedNote ?? "").slice(0, 500) +
      (verification.submittedById ? ` · verified by team` : " · owner override (no team verification)"),
    ...(opts.vendorBillNo !== undefined || opts.vendorBillDate !== undefined
      ? { vendorBillNo: opts.vendorBillNo, vendorBillDate: opts.vendorBillDate }
      : {}),
  });

  const acceptedValue = round2(verification.po.grandTotal);

  const updated = await db.poVerification.update({
    where: { id: verification.id },
    data: {
      status: V_STATUS.ACCEPTED,
      acceptedAt: new Date(),
      acceptedNote: (opts.note ?? "").slice(0, 500),
      acceptedValue: verification.po.grandTotal,
    },
    include: { items: true },
  });

  await notifyRealtime(verification.firmId, "verify:update", {
    kind: "accepted",
    verificationId: verification.id,
    poNumber: verification.po.poNumber,
  });

  return { verification: updated, po: result.po, journal: result.journal, acceptedValue };
}

// ─── Owner sends the submission back to the team ──────────────────

export async function rejectVerification(verificationId: string, reason: string) {
  const verification = await db.poVerification.findUnique({ where: { id: verificationId }, include: { po: true } });
  if (!verification) throw new BusinessError("ERR_NOT_FOUND", "Verification request not found", 404);
  if (verification.status !== V_STATUS.SUBMITTED) {
    throw new BusinessError("ERR_INVALID_STATUS", "Only team submissions can be sent back", 409);
  }
  const updated = await db.poVerification.update({
    where: { id: verification.id },
    data: { status: V_STATUS.AWAITING, returnReason: reason.slice(0, 500) },
  });
  await notifyRealtime(verification.firmId, "verify:update", {
    kind: "returned",
    verificationId: verification.id,
    poNumber: verification.po.poNumber,
    reason,
  });
  return updated;
}
