// ═══════════════════════════════════════════════════════════════
// Next.js instrumentation hook — boots the recurring auto-post
// scheduler exactly once per server process (nodejs runtime only,
// never during build / edge middleware).
// Kill switch: DMK_SCHEDULER=off
// Vercel: serverless functions are ephemeral, so the in-process
// interval cannot run there. It is skipped automatically (VERCEL=1)
// and replaced by Vercel Cron pinging GET /api/v1/recurring/generate
// (see vercel.json) — same engine, same idempotent catch-up.
// ═══════════════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.VERCEL) {
    console.log("[scheduler] skipped on Vercel — Vercel Cron drives recurring auto-post instead");
    return;
  }
  try {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  } catch (e) {
    console.error("[scheduler] failed to start:", e);
  }
}
