// ═══════════════════════════════════════════════════════════════
// resolveAiModel — chat model override resolution for the copilot.
// The z-ai-web-dev-sdk passes the request body through as-is, so the
// `model` field must be supplied by the caller. Resolution order:
//   1. AI_MODEL environment variable
//   2. "model" field inside .z-ai-config (same lookup order as the
//      SDK itself: project dir → home dir → /etc/.z-ai-config)
//   3. undefined → no model field is sent; the configured gateway
//      default model is used (Z.ai sandbox behaviour)
// This lets a self-hosted deployment point the copilot at ANY
// OpenAI-compatible provider (e.g. OpenRouter's "z-ai/glm-5.3-flash",
// a local Ollama model, etc.) just by editing .z-ai-config.
// ═══════════════════════════════════════════════════════════════

import fs from "fs/promises";
import os from "os";
import path from "path";

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
