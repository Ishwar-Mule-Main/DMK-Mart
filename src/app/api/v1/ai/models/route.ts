// ═══════════════════════════════════════════════════════════════
// GET /api/v1/ai/models — live OpenRouter catalog (public endpoint,
// no key required), slimmed + cached in memory for 6h.
// Powers the model picker in Settings → DMK AI Copilot so the owner
// can choose ANY model (context length + per-1M pricing shown) and
// swap it whenever they like.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface OrModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export interface SlimModel {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number; // USD per 1M prompt tokens
  completionPrice: number; // USD per 1M completion tokens
  free: boolean;
}

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
let catalogCache: { at: number; data: SlimModel[] } | null = null;

function toNum(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : -1; // -1 = dynamic/unknown
}

export async function GET() {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return NextResponse.json({
      ok: true,
      data: catalogCache.data,
      cached: true,
      fetchedAt: new Date(catalogCache.at).toISOString(),
    });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);

    const json = (await res.json()) as { data?: OrModel[] };
    const models: SlimModel[] = (json.data ?? [])
      .filter((m) => typeof m.id === "string" && m.id.length > 0)
      .map((m) => {
        const promptPrice = toNum(m.pricing?.prompt);
        const completionPrice = toNum(m.pricing?.completion);
        return {
          id: m.id as string,
          name: m.name?.trim() || (m.id as string),
          contextLength: typeof m.context_length === "number" ? m.context_length : 0,
          promptPrice,
          completionPrice,
          free: promptPrice === 0 && completionPrice === 0,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) throw new Error("Empty catalog from OpenRouter");

    catalogCache = { at: Date.now(), data: models };
    return NextResponse.json({
      ok: true,
      data: models,
      cached: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    // Serve a stale cache rather than failing outright.
    if (catalogCache) {
      return NextResponse.json({
        ok: true,
        data: catalogCache.data,
        cached: true,
        stale: true,
        fetchedAt: new Date(catalogCache.at).toISOString(),
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Error
            ? `Could not load the model catalog: ${e.message}`
            : "Could not load the model catalog",
      },
      { status: 502 },
    );
  }
}
