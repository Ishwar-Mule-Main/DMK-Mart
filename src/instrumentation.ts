// ═══════════════════════════════════════════════════════════════
// Next.js instrumentation hook — boots the recurring auto-post
// scheduler exactly once per server process (nodejs runtime only,
// never during build / edge middleware).
// Kill switch: DMK_SCHEDULER=off
// ═══════════════════════════════════════════════════════════════

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  } catch (e) {
    console.error("[scheduler] failed to start:", e);
  }
}
