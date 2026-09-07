// ═══════════════════════════════════════════════════════════════
// resolveAiModel / createAiClient — copilot AI client resolution.
// Resolution order:
//   1. Environment variables (Vercel/serverless path):
//        AI_BASE_URL + AI_API_KEY  → explicit ZAI client
//        AI_MODEL                  → model override (any provider)
//   2. .z-ai-config file (searched ./ , ~/ , /etc/ — the same lookup
//      order the z-ai-web-dev-sdk uses) → ZAI.create()
//   3. Nothing found → client = null; callers degrade gracefully
//      (the ERP works fully without the copilot).
// Any OpenAI-compatible provider works: OpenRouter, a local Ollama,
// the Z.ai sandbox gateway, etc.
// ═══════════════════════════════════════════════════════════════

import fs from "fs/promises";
import os from "os";
import path from "path";
import ZAI from "z-ai-web-dev-sdk";

interface ZaiConfigFile {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export async function resolveAiModel(): Promise<string | undefined> {
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
  /** Where the client came from: "env" | "file" | "none". */
  source: "env" | "file" | "none";
  /** Present when source === "none" — safe to show to the caller. */
  error?: string;
}

/**
 * Build the copilot's AI client. Env vars win (the only workable
 * path on Vercel, where no config file exists); otherwise fall back
 * to the SDK's own file-based discovery. Never throws.
 */
export async function createAiClient(): Promise<AiClientResolution> {
  const baseUrl = process.env.AI_BASE_URL?.trim();
  const apiKey = process.env.AI_API_KEY?.trim();

  if (baseUrl && apiKey) {
    // The SDK's d.ts marks the constructor private (its own factory is
    // the only "official" path), but the class is a plain TS class at
    // runtime — this typed escape hatch is the documented way to inject
    // explicit credentials on serverless platforms.
    const Constructible = ZAI as unknown as new (config: {
      baseUrl: string;
      apiKey: string;
    }) => ZAI;
    return { client: new Constructible({ baseUrl, apiKey }), source: "env" };
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
          : "No AI configuration found (.z-ai-config or AI_BASE_URL/AI_API_KEY)",
    };
  }
}
