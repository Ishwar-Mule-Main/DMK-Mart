// ═══════════════════════════════════════════════════════════════
// DELETED DATA (recycle bin) — capture / restore / purge engine
// Every delete across the owner portal lands here first: the record
// is snapshotted into DeletedRecord, then soft- or hard-deleted as
// the entity allows. Restore reactivates (soft) or recreates (hard,
// e.g. recurring templates) from the snapshot; purge drops the
// underlying row only when no transaction history references it.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { BusinessError } from "@/app/api/v1/_lib/api";

export const TRASH_TYPES = [
  "PRODUCT",
  "CUSTOMER",
  "VENDOR",
  "RECURRING_TEMPLATE",
  "VERIFICATION_STAFF",
] as const;

export type TrashEntityType = (typeof TRASH_TYPES)[number];

export function isTrashEntityType(v: unknown): v is TrashEntityType {
  return typeof v === "string" && (TRASH_TYPES as readonly string[]).includes(v);
}

export interface MoveToTrashInput {
  firmId: string;
  entityType: TrashEntityType;
  entityId: string;
  label: string;
  meta?: string;
  snapshot: unknown;
}

/** Snapshot a record into the Deleted Data bin. Idempotent per delete: a
 *  fresh row is created each time (restored → re-deleted works naturally). */
export async function moveToTrash(input: MoveToTrashInput) {
  return db.deletedRecord.create({
    data: {
      firmId: input.firmId,
      entityType: input.entityType,
      entityId: input.entityId,
      label: input.label || "(unnamed record)",
      meta: input.meta ?? "",
      snapshot: JSON.stringify(input.snapshot ?? {}),
    },
  });
}

export interface RestoreResult {
  id: string;
  entityType: TrashEntityType;
  label: string;
  /** How the restore was performed. */
  mode: "reactivated" | "recreated";
}

/**
 * Restore one trash entry. Soft-deleted masters (product/customer/vendor/
 * staff) are reactivated in place; hard-deleted records (recurring
 * templates) are recreated from their snapshot. Clear business errors are
 * thrown for genuine conflicts (e.g. SKU/username now taken by another
 * record, recurring customer deleted) so the owner sees an actionable
 * message instead of a silent partial restore.
 */
export async function restoreFromTrash(trashId: string): Promise<RestoreResult> {
  const entry = await db.deletedRecord.findUnique({ where: { id: trashId } });
  if (!entry) throw new BusinessError("ERR_TRASH_NOT_FOUND", "Deleted item not found", 404);
  if (entry.restoredAt) {
    throw new BusinessError("ERR_ALREADY_RESTORED", `"${entry.label}" is already restored`, 409);
  }

  const snap = safeParse(entry.snapshot);
  const type = entry.entityType as TrashEntityType;

  switch (type) {
    case "PRODUCT":
      return reactivateOrRecreate(entry, {
        find: () => db.product.findUnique({ where: { id: entry.entityId } }),
        reactivate: () =>
          db.product.update({ where: { id: entry.entityId }, data: { isActive: true } }),
        recreate: async () => {
          const sku = str(snap.sku) || "RESTORED";
          const dupe = await db.product.findUnique({
            where: { firmId_sku: { firmId: entry.firmId, sku } },
            select: { id: true },
          });
          if (dupe) {
            throw new BusinessError(
              "ERR_DUPLICATE_SKU",
              `Cannot restore "${entry.label}" — SKU "${sku}" now belongs to another product`,
              409
            );
          }
          return db.product.create({
            data: { ...productData(snap), firmId: entry.firmId, sku } as never,
          });
        },
      });

    case "CUSTOMER":
      return reactivateOrRecreate(entry, {
        find: () => db.customer.findUnique({ where: { id: entry.entityId } }),
        reactivate: () =>
          db.customer.update({ where: { id: entry.entityId }, data: { isActive: true } }),
        recreate: () =>
          db.customer.create({ data: { ...plain(snap), firmId: entry.firmId } as never }),
      });

    case "VENDOR":
      return reactivateOrRecreate(entry, {
        find: () => db.vendor.findUnique({ where: { id: entry.entityId } }),
        reactivate: () =>
          db.vendor.update({ where: { id: entry.entityId }, data: { isActive: true } }),
        recreate: () =>
          db.vendor.create({ data: { ...plain(snap), firmId: entry.firmId } as never }),
      });

    case "RECURRING_TEMPLATE": {
      // Hard-deleted — always recreate. The parent customer must still exist.
      const items = Array.isArray(snap.items) ? snap.items : [];
      const template = plain((snap.template ?? snap) as Record<string, unknown>);
      const customerId = str(template.customerId);
      const customer = customerId
        ? await db.customer.findUnique({ where: { id: customerId }, select: { id: true } })
        : null;
      if (!customer) {
        throw new BusinessError(
          "ERR_RESTORE_CONFLICT",
          `Cannot restore "${entry.label}" — its customer no longer exists. Restore the customer first.`,
          409
        );
      }
      const created = await db.recurringTemplate.create({
        data: {
          firmId: entry.firmId,
          name: str(template.name) || "Restored template",
          customerId,
          frequency: str(template.frequency) || "MONTHLY",
          paymentMode: str(template.paymentMode) || "CREDIT",
          startDate: date(template.startDate),
          endDate: template.endDate ? date(template.endDate) : null,
          nextRunDate: date(template.nextRunDate ?? template.startDate),
          lastRunDate: template.lastRunDate ? date(template.lastRunDate) : null,
          skipUntil: template.skipUntil ? date(template.skipUntil) : null,
          autoPost: template.autoPost !== false,
          isActive: template.isActive !== false,
          notes: str(template.notes),
        },
      });
      if (items.length > 0) {
        // Only keep lines whose product still exists (products are never
        // hard-deleted in this ERP, so this is purely defensive).
        const skus = items.map((i: Record<string, unknown>) => str(i.sku)).filter(Boolean);
        const products = await db.product.findMany({
          where: { firmId: entry.firmId, sku: { in: skus } },
          select: { id: true, sku: true },
        });
        const bySku = new Map(products.map((p) => [p.sku, p.id]));
        const rows = items
          .map((i: Record<string, unknown>) => {
            const productId = bySku.get(str(i.sku));
            if (!productId) return null;
            return {
              templateId: created.id,
              productId,
              sku: str(i.sku),
              productName: str(i.productName),
              quantity: num(i.quantity, 1),
              manualDiscountPct: i.manualDiscountPct == null ? null : num(i.manualDiscountPct),
            };
          })
          .filter(Boolean);
        if (rows.length > 0) await db.recurringTemplateItem.createMany({ data: rows as never });
      }
      return finish(entry, "recreated");
    }

    case "VERIFICATION_STAFF":
      return reactivateOrRecreate(entry, {
        find: () => db.verificationStaff.findUnique({ where: { id: entry.entityId } }),
        reactivate: () =>
          db.verificationStaff.update({
            where: { id: entry.entityId },
            data: { isActive: true },
          }),
        recreate: async () => {
          const username = str(snap.username);
          const dupe = await db.verificationStaff.findFirst({
            where: { firmId: entry.firmId, username },
            select: { id: true },
          });
          if (dupe) {
            throw new BusinessError(
              "ERR_DUPLICATE_USERNAME",
              `Cannot restore "${entry.label}" — username "${username}" is now taken`,
              409
            );
          }
          return db.verificationStaff.create({
            data: { ...plain(snap), firmId: entry.firmId } as never,
          });
        },
      });

    default:
      throw new BusinessError("ERR_TRASH_TYPE", `Unknown deleted-item type "${entry.entityType}"`, 422);
  }
}

// ─── shared restore helpers ──────────────────────────────────────

async function reactivateOrRecreate(
  entry: { id: string; entityType: string; label: string; snapshot: string },
  h: {
    find: () => Promise<unknown | null>;
    reactivate: () => Promise<unknown>;
    recreate: () => Promise<unknown>;
  }
): Promise<RestoreResult> {
  const existing = await h.find();
  if (existing) {
    await h.reactivate();
    return finish(entry, "reactivated");
  }
  await h.recreate();
  return finish(entry, "recreated");
}

function finish(entry: { id: string; entityType: string; label: string }, mode: RestoreResult["mode"]): RestoreResult {
  // Fire-and-forget timestamp — restore result does not depend on it.
  db.deletedRecord
    .update({ where: { id: entry.id }, data: { restoredAt: new Date() } })
    .catch(() => undefined);
  return {
    id: entry.id,
    entityType: entry.entityType as TrashEntityType,
    label: entry.label,
    mode,
  };
}

// ─── purge: hard-delete the underlying row when history allows ───

export interface PurgeResult {
  /** true when the row itself was removed; false when it only left the bin. */
  recordRemoved: boolean;
  note: string;
}

export async function purgeFromTrash(trashId: string): Promise<PurgeResult> {
  const entry = await db.deletedRecord.findUnique({ where: { id: trashId } });
  if (!entry) throw new BusinessError("ERR_TRASH_NOT_FOUND", "Deleted item not found", 404);

  const type = entry.entityType as TrashEntityType;
  const id = entry.entityId;
  let result: PurgeResult = {
    recordRemoved: true,
    note: "Removed forever.",
  };

  switch (type) {
    case "PRODUCT": {
      const row = await db.product.findUnique({ where: { id } });
      if (row) {
        // Any transactional document referencing the product keeps the row alive.
        const refs =
          (await db.invoiceLineItem.count({ where: { productId: id } })) +
          (await db.purchaseOrderItem.count({ where: { productId: id } })) +
          (await db.salesReturnItem.count({ where: { productId: id } })) +
          (await db.purchaseReturnItem.count({ where: { productId: id } })) +
          (await db.recurringTemplateItem.count({ where: { productId: id } }));
        if (refs === 0) {
          // Product-scoped audit rows (stock movements + adjustments) belong to
          // this product alone — clear them, then hard-delete the master row.
          await db.inventoryMovement.deleteMany({ where: { productId: id } });
          await db.stockAdjustment.deleteMany({ where: { productId: id } });
          const deleted = await db.product
            .delete({ where: { id } })
            .then(() => true)
            .catch(() => false);
          if (!deleted) {
            result = {
              recordRemoved: false,
              note: "Product could not be fully deleted — the inactive row stays for ledger integrity.",
            };
          }
        } else {
          result = {
            recordRemoved: false,
            note: "Product has transaction history — removed from the bin; the inactive row stays for ledger integrity.",
          };
        }
      }
      break;
    }
    case "CUSTOMER": {
      const row = await db.customer.findUnique({ where: { id } });
      if (row) {
        const refs =
          (await db.invoice.count({ where: { customerId: id } })) +
          (await db.ledgerEntry.count({ where: { customerId: id } }));
        if (refs === 0) {
          await db.customer.delete({ where: { id } }).catch(() => undefined);
        } else {
          result = {
            recordRemoved: false,
            note: "Customer has transaction history — removed from the bin; the inactive row stays for ledger integrity.",
          };
        }
      }
      break;
    }
    case "VENDOR": {
      const row = await db.vendor.findUnique({ where: { id } });
      if (row) {
        const refs =
          (await db.purchaseOrder.count({ where: { vendorId: id } })) +
          (await db.ledgerEntry.count({ where: { vendorId: id } }));
        if (refs === 0) {
          await db.vendor.delete({ where: { id } }).catch(() => undefined);
        } else {
          result = {
            recordRemoved: false,
            note: "Vendor has purchase history — removed from the bin; the inactive row stays for ledger integrity.",
          };
        }
      }
      break;
    }
    case "RECURRING_TEMPLATE":
      // already hard-deleted at trash time — nothing further
      break;
    case "VERIFICATION_STAFF": {
      const row = await db.verificationStaff.findUnique({ where: { id } });
      if (row) {
        const refs =
          (await db.poVerification.count({ where: { assignedToId: id } })) +
          (await db.poVerification.count({ where: { submittedById: id } }));
        if (refs === 0) {
          await db.verificationStaff.delete({ where: { id } }).catch(() => undefined);
        } else {
          result = {
            recordRemoved: false,
            note: "Team account has verification history — removed from the bin; the inactive row stays.",
          };
        }
      }
      break;
    }
    default:
      throw new BusinessError("ERR_TRASH_TYPE", `Unknown deleted-item type "${entry.entityType}"`, 422);
  }

  await db.deletedRecord.delete({ where: { id: trashId } });
  return result;
}

// ─── tiny JSON helpers (SQLite snapshots are strings) ────────────

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function plain(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "id" || k === "firmId" || k === "firm" || k.startsWith("_")) continue;
    out[k] = val;
  }
  return out;
}

function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function date(v: unknown): Date {
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Numeric-safe product snapshot for recreation (drops relational noise). */
function productData(snap: Record<string, unknown>): Record<string, unknown> {
  const p = plain(snap);
  return {
    name: str(p.name) || "Restored product",
    category: str(p.category, "General") || "General",
    brand: str(p.brand),
    unit: str(p.unit, "Pcs") || "Pcs",
    hsnCode: str(p.hsnCode, "3924") || "3924",
    gstRate: num(p.gstRate, 18),
    purchaseCost: num(p.purchaseCost),
    tier1Distributor: num(p.tier1Distributor),
    tier2Wholesale: num(p.tier2Wholesale),
    tier3SemiWholesale: num(p.tier3SemiWholesale),
    tier4Retailer: num(p.tier4Retailer),
    tier5Mrp: num(p.tier5Mrp),
    stockQuantity: num(p.stockQuantity),
    damagedStock: num(p.damagedStock),
    lowStockThreshold: num(p.lowStockThreshold),
    weightGrams: p.weightGrams == null ? null : num(p.weightGrams),
    barcode: p.barcode ? str(p.barcode) : null,
    isActive: true,
  };
}
