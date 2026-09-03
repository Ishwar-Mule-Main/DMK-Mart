"use client";

// ═══════════════════════════════════════════════════════════════
// useVerificationBus — live link between owner & team portals.
// · Native WebSocket via the gateway (/?XTransformPort=3010), with
//   infinite exponential-backoff reconnection
// · 15s polling heartbeat in every view so the link is never
//   interrupted even while the socket is re-establishing
// · returns { connected, tick } — tick bumps on every bus event
//   so views refetch instantly
// ═══════════════════════════════════════════════════════════════

import * as React from "react";

export type BusEvent = {
  event: string;
  data?: Record<string, unknown>;
  at?: string;
};

type BusState = {
  ws: WebSocket | null;
  firmId: string;
  connected: boolean;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const listeners = new Set<(e: BusEvent) => void>();
const bus: BusState = { ws: null, firmId: "", connected: false, retry: 0, timer: null };

function notify(e: BusEvent) {
  listeners.forEach((fn) => fn(e));
}

function connect(firmId: string) {
  if (typeof window === "undefined") return;
  if (bus.ws) {
    bus.ws.onclose = null;
    bus.ws.close();
    bus.ws = null;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/?XTransformPort=3010&firmId=${encodeURIComponent(firmId)}`);
  bus.ws = ws;

  ws.onopen = () => {
    bus.connected = true;
    bus.retry = 0;
    notify({ event: "bus:open" });
  };
  ws.onmessage = (m) => {
    try {
      const parsed = JSON.parse(String(m.data)) as BusEvent;
      if (parsed.event && !parsed.event.startsWith("bus:")) notify(parsed);
    } catch {
      // keep-alive noise — ignore
    }
  };
  ws.onclose = () => {
    bus.connected = false;
    bus.ws = null;
    const delay = Math.min(800 * 2 ** bus.retry, 8000);
    bus.retry += 1;
    bus.timer = setTimeout(() => connect(bus.firmId), delay);
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  };
}

function ensureConnected(firmId: string) {
  if (!firmId) return;
  if (bus.ws && bus.firmId === firmId) return; // healthy, same room
  bus.firmId = firmId;
  connect(firmId);
}

export function useVerificationBus(firmId: string | null | undefined) {
  const [connected, setConnected] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!firmId) return;
    ensureConnected(firmId);

    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);

    // Track connection flips for the LIVE chip
    const ping = setInterval(() => setConnected(bus.connected), 2000);
    setConnected(bus.connected);

    return () => {
      listeners.delete(listener);
      clearInterval(ping);
    };
  }, [firmId]);

  return { connected, tick };
}
