"use client";

// ═══════════════════════════════════════════════════════════════
// AI SETTINGS CARD — Settings → "DMK AI Copilot" section.
// Lets the owner:
//   • see the live copilot status (connected via saved settings /
//     env vars / config file / not configured)
//   • paste or rotate the OpenRouter (or any OpenAI-compatible)
//     API key in one click when it expires — no redeploy needed
//   • pick ANY model from the live OpenRouter catalog with context
//     length + per-1M pricing shown (150k+ highlighted), so a
//     "request token minimum 150k" model is always easy to find
//   • test the connection with one click (clear 401/402/404 hints)
// Saved settings win over AI_* env vars and .z-ai-config files.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Bot, CheckCircle2, KeyRound, Loader2, RefreshCw, Send, Trash2, TriangleAlert } from "lucide-react";

import { Badge, ErrorText, Field, inputCls } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost, apiPut } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface SettingsStatus {
  hasSavedKey: boolean;
  apiKeyMasked: string | null;
  savedBaseUrl: string | null;
  savedModel: string | null;
  updatedAt: string | null;
  envModel: string | null;
  effectiveSource: "db" | "env" | "file-or-none";
}

interface SlimModel {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number; // USD per 1M tokens; -1 = dynamic
  completionPrice: number;
  free: boolean;
}

type Filter = "all" | "150k" | "free";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const RECOMMENDED_MODEL = "z-ai/glm-5.3-flash"; // 1.31M ctx · $0.075/$0.25 per 1M

function fmtCtx(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function fmtPrice(n: number): string {
  if (n < 0) return "dynamic";
  if (n === 0) return "free";
  return `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
}

const SOURCE_META: Record<SettingsStatus["effectiveSource"], { label: string; tone: "success" | "info" | "warning" | "danger"; note: string }> = {
  db: { label: "CONNECTED · SAVED SETTINGS", tone: "success", note: "Using the key & model saved below (highest priority)." },
  env: { label: "CONNECTED · ENV VARS", tone: "info", note: "Using AI_BASE_URL / AI_API_KEY environment variables. Save settings below to override them at runtime." },
  "file-or-none": { label: "NOT CONFIGURED", tone: "warning", note: "No saved settings and no env vars. The copilot replies with a friendly note until a key is added below (or via env/`.z-ai-config` on self-hosted)." },
};

export default function AiSettingsCard() {
  const { toast } = useToast();

  const [status, setStatus] = React.useState<SettingsStatus | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [baseUrl, setBaseUrl] = React.useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = React.useState(""); // empty = keep saved key
  const [model, setModel] = React.useState("");

  const [models, setModels] = React.useState<SlimModel[]>([]);
  const [modelsState, setModelsState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [modelsError, setModelsError] = React.useState("");

  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("150k");

  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = React.useState("");

  // NOTE: api-client helpers unwrap the { ok, data } envelope and return
  // the payload directly; failures throw ApiError.
  const loadStatus = React.useCallback(async () => {
    try {
      const s = await apiGet<SettingsStatus>("/api/v1/ai/settings");
      setStatus(s);
      setBaseUrl(s.savedBaseUrl || DEFAULT_BASE_URL);
      if (s.savedModel) setModel(s.savedModel);
    } catch {
      setFormError("Could not load AI settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = React.useCallback(async () => {
    setModelsState("loading");
    setModelsError("");
    try {
      const list = await apiGet<SlimModel[]>("/api/v1/ai/models");
      setModels(Array.isArray(list) ? list : []);
      setModelsState("ready");
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : "Catalog unavailable");
      setModelsState("error");
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
    void loadModels();
  }, [loadStatus, loadModels]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (filter === "150k" && m.contextLength < 150_000) return false;
      if (filter === "free" && !m.free) return false;
      if (!q) return true;
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [models, filter, search]);

  async function save(opts?: { clearKey?: boolean }) {
    setSaving(true);
    setFormError("");
    try {
      const body: Record<string, unknown> = { baseUrl, model: model.trim() };
      if (opts?.clearKey) body.clearKey = true;
      else if (apiKey.trim() !== "") body.apiKey = apiKey.trim();

      const saved = await apiPut<SettingsStatus>("/api/v1/ai/settings", body);
      setStatus((prev) => ({ ...(prev ?? ({} as SettingsStatus)), ...saved, effectiveSource: saved.hasSavedKey ? "db" : (prev?.effectiveSource ?? "file-or-none") }));
      setApiKey("");
      toast({
        title: opts?.clearKey ? "Saved key removed" : "AI settings saved",
        description: opts?.clearKey
          ? "The copilot falls back to env vars / config file."
          : `Model ${saved.savedModel || "(default)"} · key ${saved.apiKeyMasked ?? "not set"}. The copilot uses these immediately — no redeploy.`,
      });
      void loadStatus();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      // apiPost resolves ONLY on success (envelope ok:true) and returns
      // the unwrapped data; failures throw ApiError whose message is the
      // friendly hint from the route.
      const r = await apiPost<{ source: string; model?: string | null; reply: string }>("/api/v1/ai/settings/test");
      setTestResult({ ok: true, text: `Working · ${r.model ?? "provider default"} → "${r.reply}"` });
    } catch (e) {
      setTestResult({ ok: false, text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  const sourceMeta = status ? SOURCE_META[status.effectiveSource] : null;
  const pick = (id: string) => {
    setModel(id);
    toast({ title: "Model selected", description: `${id} — press Save Settings to apply.` });
  };

  return (
    <div className="dmk-card p-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2.5 mb-1">
        <Bot className="h-4 w-4 text-dmk-yellow" />
        <h2 className="text-[15px] font-semibold text-dmk-text-primary">DMK AI Copilot — Provider Settings</h2>
        {loading ? (
          <Badge tone="info">LOADING…</Badge>
        ) : sourceMeta ? (
          <Badge tone={sourceMeta.tone}>{sourceMeta.label}</Badge>
        ) : null}
      </div>
      <p className="text-[11.5px] text-dmk-text-muted mb-4">
        Rotate an expired API key or switch models anytime — saved settings apply instantly, even on Vercel. Priority: saved settings → env vars → config file.
      </p>

      {/* status strip */}
      {status && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Saved key</p>
            <p className="text-[13px] font-semibold text-dmk-text-primary mt-1 font-money">{status.hasSavedKey ? status.apiKeyMasked : "—"}</p>
          </div>
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Saved model</p>
            <p className="text-[13px] font-semibold text-dmk-text-primary mt-1 truncate">{status.savedModel || "—"}</p>
          </div>
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Resolved model</p>
            <p className="text-[13px] font-semibold text-dmk-text-primary mt-1 truncate">{status.savedModel || status.envModel || "provider default"}</p>
          </div>
          <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-dmk-text-muted font-semibold">Updated</p>
            <p className="text-[13px] font-semibold text-dmk-text-primary mt-1">{status.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : "—"}</p>
          </div>
        </div>
      )}
      {sourceMeta && status && !loading && (
        <p className={cn("text-[11.5px] mb-4 flex items-start gap-1.5", status.effectiveSource === "db" || status.effectiveSource === "env" ? "text-dmk-success" : "text-dmk-warning")}>
          {status.effectiveSource === "db" || status.effectiveSource === "env" ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          {sourceMeta.note}
        </p>
      )}

      {/* form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <Field label="Base URL" hint="Any OpenAI-compatible endpoint">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULT_BASE_URL} className={inputCls} />
        </Field>
        <Field label="API key" hint={status?.hasSavedKey ? `Saved: ${status.apiKeyMasked} — leave blank to keep it` : "Paste your sk-or-… key (openrouter.ai/keys)"}>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status?.hasSavedKey ? "•••••••• (kept)" : "sk-or-v1-…"}
            autoComplete="off"
            className={inputCls}
          />
        </Field>
        <Field label="Model" hint="Pick below or type any model id">
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={RECOMMENDED_MODEL} className={cn(inputCls, "font-money")} />
        </Field>
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving}
          className="h-9 gap-2 bg-dmk-yellow text-[#0A0F1D] hover:bg-dmk-yellow/85 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          Save Settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void testConnection()}
          disabled={testing}
          className="h-9 gap-2 border-dmk-border-subtle bg-dmk-input-well text-[12.5px] hover:bg-dmk-hover"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Test Connection
        </Button>
        {status?.hasSavedKey && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void save({ clearKey: true })}
            disabled={saving}
            className="h-9 gap-2 border-dmk-danger/40 bg-transparent text-dmk-danger hover:bg-dmk-danger/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove Saved Key
          </Button>
        )}
      </div>

      {formError && <ErrorText>{formError}</ErrorText>}

      {testResult && (
        <div
          role="status"
          className={cn(
            "mb-3 rounded-lg border px-3 py-2 text-[12px] flex items-start gap-2",
            testResult.ok
              ? "border-dmk-success/40 bg-dmk-success/10 text-dmk-success"
              : "border-dmk-danger/40 bg-dmk-danger/10 text-dmk-danger",
          )}
        >
          {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          {testResult.text}
        </div>
      )}

      {/* model catalog */}
      <div className="rounded-lg border border-dmk-border-subtle bg-dmk-input-well/30 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-dmk-text-muted mr-auto">
            Model catalog · OpenRouter live
            {modelsState === "ready" && <span className="normal-case font-normal"> · {models.length} models</span>}
          </p>
          {(["all", "150k", "free"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "h-7 px-2.5 rounded-md text-[11px] font-semibold border transition-colors",
                filter === f
                  ? "border-dmk-yellow/60 bg-dmk-yellow/15 text-dmk-yellow"
                  : "border-dmk-border-subtle bg-transparent text-dmk-text-muted hover:bg-dmk-hover",
              )}
            >
              {f === "all" ? "All" : f === "150k" ? "150k+ context" : "Free"}
            </button>
          ))}
          <Button size="sm" variant="outline" onClick={() => void loadModels()} disabled={modelsState === "loading"} className="h-7 gap-1.5 px-2 text-[11px] border-dmk-border-subtle bg-transparent hover:bg-dmk-hover">
            <RefreshCw className={cn("h-3 w-3", modelsState === "loading" && "animate-spin")} /> Refresh
          </Button>
        </div>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search 400+ models…" className={cn(inputCls, "h-8 mb-2")} />

        {modelsState === "error" && <ErrorText>{modelsError}</ErrorText>}
        {modelsState === "loading" && (
          <div className="flex items-center gap-2 py-6 justify-center text-[12px] text-dmk-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog from OpenRouter…
          </div>
        )}
        {modelsState === "ready" && (
          <div className="max-h-96 overflow-y-auto dmk-scroll rounded-md border border-dmk-border-subtle divide-y divide-dmk-border-subtle/60" role="listbox" aria-label="Available models">
            {filtered.length === 0 && <p className="text-[12px] text-dmk-text-muted text-center py-6">No models match — widen the filter or clear the search.</p>}
            {filtered.map((m) => {
              const selected = model === m.id;
              const big = m.contextLength >= 150_000;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(m.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors hover:bg-dmk-hover",
                    selected && "bg-dmk-yellow/10",
                  )}
                >
                  <span className={cn("h-3.5 w-3.5 rounded-full border shrink-0", selected ? "border-dmk-yellow bg-dmk-yellow" : "border-dmk-border-medium")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-dmk-text-primary truncate">{m.id}</span>
                    <span className="block text-[10.5px] text-dmk-text-muted truncate">{m.name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {m.free && <Badge tone="success">FREE</Badge>}
                    <span className={cn("text-[10.5px] font-semibold px-1.5 py-0.5 rounded", big ? "bg-dmk-success/15 text-dmk-success" : "text-dmk-text-muted")}>
                      {fmtCtx(m.contextLength)} ctx{big ? " · 150k+" : ""}
                    </span>
                    <span className="text-[10.5px] text-dmk-text-muted w-28 text-right">
                      {fmtPrice(m.promptPrice)} in · {fmtPrice(m.completionPrice)} out
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10.5px] text-dmk-text-muted mt-2">
          Recommendation: <span className="font-money">{RECOMMENDED_MODEL}</span> — 1.31M-token context (150k+ ✓), $0.075 in / $0.25 out per 1M tokens. Click any row to select, then Save Settings.
        </p>
      </div>
    </div>
  );
}
