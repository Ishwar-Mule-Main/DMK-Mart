// ═══════════════════════════════════════════════════════════════
// /api/v1/inventory/integrations — registered platforms that share
// this inventory (DMK Mart ERP · B2B ecommerce · Franchise/B2C).
// GET  — list (API keys masked; full key shown only once at create)
// POST — register a portal + generate its API key (returned ONCE)
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { asRecord, BusinessError, getBool, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { generateApiKey, hashApiKey } from "@/app/api/universal/v1/_lib/portal";
import { ensureSyncSetting } from "@/lib/inventory-sync";
import { requireInvAuth } from "@/app/api/v1/inventory/_lib/auth";

const KINDS = ["ERP", "B2B_STORE", "FRANCHISE_B2C"] as const;

export async function GET(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const portals = await db.integrationPortal.findMany({
      where: { firmId: firm.id },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      portals: portals.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        webhookUrl: p.webhookUrl,
        contactEmail: p.contactEmail,
        status: p.status,
        autoSync: p.autoSync,
        apiKeyMasked: p.apiKey.replace(/^(dmk_inv_).+$/, "$1••••••••••••"),
        createdAt: p.createdAt,
        lastSyncAt: p.lastSyncAt,
        lastSyncStatus: p.lastSyncStatus,
        lastSyncMessage: p.lastSyncMessage,
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { firm } = await requireInvAuth(req);
    const body = asRecord(await req.json().catch(() => ({})));
    const name = getStr(body.name).trim();
    const kind = getStr(body.kind).trim().toUpperCase() || "ERP";
    if (!name) throw new BusinessError("ERR_VALIDATION", "name is required", 422);
    if (!KINDS.includes(kind as (typeof KINDS)[number])) {
      throw new BusinessError("ERR_VALIDATION", `kind must be one of ${KINDS.join(", ")}`, 422);
    }
    const dup = await db.integrationPortal.findFirst({ where: { firmId: firm.id, name } });
    if (dup) throw new BusinessError("ERR_PORTAL_EXISTS", `Portal "${name}" is already registered`, 422);

    const apiKey = generateApiKey();
    const portal = await db.integrationPortal.create({
      data: {
        firmId: firm.id,
        name,
        kind,
        apiKey: hashApiKey(apiKey),
        baseUrl: getStr(body.baseUrl).trim(),
        webhookUrl: getStr(body.webhookUrl).trim(),
        contactEmail: getStr(body.contactEmail).trim(),
        autoSync: body.autoSync === undefined ? true : getBool(body.autoSync),
      },
    });
    await ensureSyncSetting(firm.id);
    // The raw key crosses the wire exactly once — only its SHA-256 lives in the DB.
    return ok({ portal: { ...portal, apiKey: undefined }, apiKey, message: "Copy the key now — it is never shown again" }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
