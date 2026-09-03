// ═══════════════════════════════════════════════════════════════
// DMK VERIFICATION REALTIME BUS (Bun native WebSocket)
// Keeps the OWNER portal and the VERIFICATION TEAM portal connected
// at all times:
//   · :3010  WebSocket endpoint (path "/", firm rooms via pub/sub).
//            Browsers connect to /?XTransformPort=3010&firmId=<id>
//            through the Caddy gateway — plain ws upgrade.
//   · :3011  Internal HTTP — the Next.js ERP APIs POST /emit here
//            (fire-and-forget; ERP never blocks on realtime).
// If the socket drops, the client reconnects with backoff and the
// portals fall back to 15s polling — nothing interrupts the link.
// ═══════════════════════════════════════════════════════════════

const SOCKET_PORT = 3010;
const EMIT_PORT = 3011;

/** Every connected socket — used for firm-less broadcasts. */
const allSockets = new Set<{ send: (data: string) => void }>();

// ─── Browser-facing WebSocket server ─────────────────────────────
Bun.serve({
  port: SOCKET_PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    const wantsUpgrade = (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
    if (wantsUpgrade && (url.pathname === "/" || url.pathname === "/socket.io/")) {
      const firmId = url.searchParams.get("firmId") ?? "";
      const ok = server.upgrade(req, { data: { firmId } });
      if (ok) return; // upgraded
      return new Response("upgrade failed", { status: 400 });
    }
    return new Response("dmk-verification-bus alive", { status: 200 });
  },
  websocket: {
    open(ws) {
      allSockets.add(ws as unknown as { send: (data: string) => void });
      const firmId = (ws.data as { firmId?: string }).firmId ?? "";
      if (firmId) ws.subscribe(`firm:${firmId}`);
      ws.send(JSON.stringify({ event: "bus:hello", data: { at: new Date().toISOString() } }));
    },
    // Clients may ping; treat any text as keep-alive.
    message(ws) {
      ws.send(JSON.stringify({ event: "bus:pong", data: { at: new Date().toISOString() } }));
    },
    close(ws) {
      allSockets.delete(ws as unknown as { send: (data: string) => void });
    },
  },
});

// ─── Internal emit endpoint (Next.js APIs → bus) ─────────────────
Bun.serve({
  port: EMIT_PORT,
  fetch(req) {
    if (req.method !== "POST") {
      return new Response("dmk-verification-bus emit — POST {firmId, event, data}", { status: 200 });
    }
    return req
      .json()
      .then((body: { firmId?: string; event?: string; data?: unknown }) => {
        const { firmId, event, data } = body ?? {};
        if (!event) return Response.json({ error: "event required" }, { status: 400 });
        const payload = JSON.stringify({ event, data, at: new Date().toISOString() });
        if (firmId) Bun.publish(`firm:${firmId}`, payload);
        else for (const s of allSockets) s.send(payload);
        return Response.json({ ok: true });
      })
      .catch(() => new Response('{"error":"bad json"}', { status: 400 }));
  },
});

console.log(`[verify-bus] websocket online on :${SOCKET_PORT} (path /)`);
console.log(`[verify-bus] internal emit endpoint on 127.0.0.1:${EMIT_PORT}`);
