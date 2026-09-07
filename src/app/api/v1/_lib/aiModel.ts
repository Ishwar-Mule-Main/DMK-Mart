// ═══════════════════════════════════════════════════════════════
// resolveAiModel / createAiClient — copilot AI client resolution.
// Resolution order:
//   1. AiSettings row in the database (owner manages it from
//      Settings → DMK AI Copilot in the app UI — works on Vercel
//      without a redeploy):
//        baseUrl + apiKey → explicit ZAI client
//        model            → model override (any provider)
//   2. Environment variables (Vercel/serverless fallback):
//        AI_BASE_URL + AI_API_KEY  → explicit ZAI client
//        AI_MODEL                  → model override (any provider)
//   3. .z-ai-config file (searched ./ , ~/ , /etc/ — the same lookup
//      order the z-ai-web-dev-sdk uses) → ZAI.create()
//   4. Nothing found → client = null; callers degrade gracefully
//      (the ERP works fully without the copilot).
// Any OpenAI-compatible provider works: OpenRouter, a local Ollama,
// the Z.ai sandbox gateway, etc.
// ═══════════════════════════════════════════════════════════════

import fs from "fs/promises";
import os from "os";
import path from "path";
import ZAI from "z-ai-web-dev-sdk";

import { db } from "@/lib/db";

interface ZaiConfigFile {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface AiRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export type AiConfigSource = "db" | "env" | "file" | "none";

/**
 * Read the owner-managed AI settings row (Settings → DMK AI Copilot).
 * Never throws — a missing table (schema not yet pushed) or any DB
 * hiccup simply means "no db-level config" and the next source wins.
 */
export async function loadDbAiConfig(): Promise<AiRuntimeConfig | null> {
  try {
    const row = await db.aiSettings.findUnique({ where: { id: "singleton" } });
    if (!row) return null;
    return {
      baseUrl: row.baseUrl?.trim() || undefined,
      apiKey: row.apiKey?.trim() || undefined,
      model: row.model?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** Model id: saved settings → AI_MODEL env → .z-ai-config file → none. */
export async function resolveAiModel(): Promise<string | undefined> {
  const fromDb = await loadDbAiConfig();
  if (fromDb?.model) return fromDb.model;

  const fromEnv = process.env.AI_MODEL?.trim();
  if (fromEnv) return fromEnv;

  const configPaths = [
    path.join(process.cwd(), ".z-ai-config"),
    path.join(os.homedir(), ".z-ai-config"),
    "/etc/.z-ai-config",
  ];
  for (const filePath of configPaths) {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const config = JSON.parse(raw) as ZaiConfigFile;
      const model = config.model?.trim();
      if (model) return model;
    } catch {
      // missing/unreadable/invalid file — try the next candidate
    }
  }
  return undefined;
}

export interface AiClientResolution {
  /** Ready-to-use ZAI client, or null when nothing is configured. */
  client: ZAI | null;
  /** Where the client came from: "db" | "env" | "file" | "none". */
  source: AiConfigSource;
  /** Present when source === "none" — safe to show to the caller. */
  error?: string;
}

function constructClient(baseUrl: string, apiKey: string): ZAI {
  // The SDK's d.ts marks the constructor private (its own factory is
  // the only "official" path), but the class is a plain TS class at
  // runtime — this typed escape hatch is the documented way to inject
  // explicit credentials on serverless platforms.
  const Constructible = ZAI as unknown as new (config: {
    baseUrl: string;
    apiKey: string;
  }) => ZAI;
  return new Constructible({ baseUrl, apiKey });
}

/**
 * Build the copilot's AI client. Saved settings (db) win — the owner
 * manages them from the app UI, which is the only runtime-editable
 * path on Vercel; then env vars; then the SDK's file-based discovery.
 * Never throws.
 */
export async function createAiClient(): Promise<AiClientResolution> {
  const fromDb = await loadDbAiConfig();
  if (fromDb?.baseUrl && fromDb?.apiKey) {
    return { client: constructClient(fromDb.baseUrl, fromDb.apiKey), source: "db" };
  }

  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();
  if (baseUrl && apiKey) {
    return { client: constructClient(baseUrl, apiKey), source: "env" };
  }

  try {
    return { client: await ZAI.create(), source: "file" };
  } catch (e) {
    return {
      client: null,
      source: "none",
      error:
        e instanceof Error
          ? e.message
          : "No AI configuration found (saved settings, AI_BASE_URL/AI_API_KEY, or .z-ai-config)",
    };
  }
}
