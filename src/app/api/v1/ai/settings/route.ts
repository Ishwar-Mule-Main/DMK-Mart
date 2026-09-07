// ═══════════════════════════════════════════════════════════════
// GET  /api/v1/ai/settings — current copilot config (masked)
// PUT  /api/v1/ai/settings — save/rotate provider settings from the
//      Settings → DMK AI Copilot card (owner UI).
//
// The saved row lives in the AiSettings table (account-wide, one
// row). It is the FIRST source the copilot resolves — so the owner
// can rotate an expired OpenRouter key or switch models at runtime,
// even on Vercel, without touching env vars or redeploying.
//
// The raw API key NEVER leaves the server — only a masked hint
// (last 4 chars) is returned to the UI.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { loadDbAiConfig, resolveAiModel } from "../../_lib/aiModel";

export const dynamic = "force-dynamic";

const SETTINGS_ID = "singleton";

function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `${key.startsWith("sk-or-") ? "sk-or-…" : "…"}${tail}`;
}

export async function GET() {
  try {
    const [row, envModel] = await Promise.all([
      db.aiSettings.findUnique({ where: { id: SETTINGS_ID } }).catch(() => null),
      resolveAiModel(),
    ]);

    const hasDbKey = Boolean(row?.apiKey);
    const envConfigured = Boolean(
      process.env.AI_BASE_URL?.trim() && process.env.AI_API_KEY?.trim(),
    );

    return NextResponse.json({
      ok: true,
      data: {
        hasSavedKey: hasDbKey,
        apiKeyMasked: hasDbKey ? maskKey(row!.apiKey as string) : null,
        savedBaseUrl: row?.baseUrl ?? null,
        savedModel: row?.model ?? null,
        updatedAt: row?.updatedAt ?? null,
        envModel: envModel ?? null,
        effectiveSource: hasDbKey ? "db" : envConfigured ? "env" : "file-or-none",
        // Never expose the raw key.
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load AI settings" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      baseUrl?: string;
      apiKey?: string; // undefined = keep saved key; "" = clear; string = replace
      model?: string;
      clearKey?: boolean;
    };

    const data: {
      baseUrl?: string;
      apiKey?: string | null;
      model?: string | null;
    } = {};

    if (typeof body.baseUrl === "string") {
      const url = body.baseUrl.trim();
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { ok: false, error: "Base URL must start with http:// or https://" },
          { status: 422 },
        );
      }
      data.baseUrl = url.replace(/\/+$/, "");
    }

    if (body.clearKey) {
      data.apiKey = null;
    } else if (typeof body.apiKey === "string") {
      const key = body.apiKey.trim();
      data.apiKey = key === "" ? null : key;
    }

    if (typeof body.model === "string") {
      const model = body.model.trim();
      data.model = model === "" ? null : model;
    }

    const row = await db.aiSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });

    return NextResponse.json({
      ok: true,
      data: {
        hasSavedKey: Boolean(row.apiKey),
        apiKeyMasked: row.apiKey ? maskKey(row.apiKey) : null,
        savedBaseUrl: row.baseUrl,
        savedModel: row.model,
        updatedAt: row.updatedAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to save AI settings" },
      { status: 500 },
    );
  }
}
