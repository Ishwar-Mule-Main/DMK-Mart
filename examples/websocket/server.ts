/**
 * Native WebSocket chat demo server (Bun runtime).
 *
 * Mirrors the production verification bus pattern in
 * mini-services/verification-realtime: Bun.serve with WebSocket upgrade,
 * JSON frames, and an in-memory presence map.
 *
 * Run: bun run examples/websocket/server.ts
 * Frontend connects via the gateway: new WebSocket("ws://<host>/?XTransformPort=3003")
 */

interface User {
  id: string;
  username: string;
}

interface Message {
  id: string;
  username: string;
  content: string;
  timestamp: string;
  type: 'user' | 'system';
}

type ClientFrame =
  | { type: 'join'; username: string }
  | { type: 'message'; content: string; username: string };

const users = new Map<string, User>();

const generateMessageId = () => Math.random().toString(36).slice(2, 11);

const createSystemMessage = (content: string): Message => ({
  id: generateMessageId(),
  username: 'System',
  content,
  timestamp: new Date().toISOString(),
  type: 'system',
});

const createUserMessage = (username: string, content: string): Message => ({
  id: generateMessageId(),
  username,
  content,
  timestamp: new Date().toISOString(),
  type: 'user',
});

type ClientData = { clientId: string };

const server = Bun.serve<ClientData>({
  port: 3003,
  fetch(req, server) {
    const url = new URL(req.url);
    // WebSocket upgrade on the root path (Caddy forwards via XTransformPort)
    if (url.pathname === '/' && server.upgrade(req, { data: { clientId: crypto.randomUUID() } })) {
      return; // upgraded
    }
    return new Response('WebSocket chat demo — connect with ws upgrade on /', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ type: 'hello', clientId: ws.data.clientId }));
      console.log(`Client connected: ${ws.data.clientId}`);
    },
    message(ws, raw) {
      const client = ws.data.clientId;
      let frame: ClientFrame;
      try {
        frame = JSON.parse(String(raw)) as ClientFrame;
      } catch {
        return;
      }

      if (frame.type === 'join' && frame.username?.trim()) {
        const user: User = { id: client, username: frame.username.trim() };
        users.set(client, user);
        ws.send(JSON.stringify({ type: 'users-list', users: [...users.values()] }));
        server.publish('chat', JSON.stringify({
          type: 'user-joined',
          user,
          message: createSystemMessage(`${user.username} joined the chat room`),
        }));
        console.log(`${user.username} joined — online: ${users.size}`);
        return;
      }

      if (frame.type === 'message' && frame.content?.trim()) {
        const user = users.get(client);
        if (!user || user.username !== frame.username) return;
        server.publish('chat', JSON.stringify({
          type: 'message',
          message: createUserMessage(user.username, frame.content.trim()),
        }));
        console.log(`${user.username}: ${frame.content.trim()}`);
      }
    },
    close(ws) {
      const client = ws.data.clientId;
      const user = users.get(client);
      if (user) {
        users.delete(client);
        server.publish('chat', JSON.stringify({
          type: 'user-left',
          user,
          message: createSystemMessage(`${user.username} left the chat room`),
        }));
        console.log(`${user.username} left — online: ${users.size}`);
      }
    },
  },
});

console.log(`WebSocket chat demo running on port ${server.port}`);

const shutdown = (signal: string) => {
  console.log(`${signal} received — shutting down`);
  server.stop(true);
  process.exit(0);
};

(process as unknown as { on: (s: string, cb: () => void) => void }).on('SIGTERM', () => shutdown('SIGTERM'));
(process as unknown as { on: (s: string, cb: () => void) => void }).on('SIGINT', () => shutdown('SIGINT'));
