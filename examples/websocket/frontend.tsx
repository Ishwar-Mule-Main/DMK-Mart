'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

type User = {
  id: string;
  username: string;
};

type Message = {
  id: string;
  username: string;
  content: string;
  timestamp: string;
  type: 'user' | 'system';
};

type ServerEvent =
  | { type: 'hello'; clientId: string }
  | { type: 'message'; message: Message }
  | { type: 'user-joined'; user: User; message: Message }
  | { type: 'user-left'; user: User; message: Message }
  | { type: 'users-list'; users: User[] };

/**
 * Native WebSocket chat demo.
 *
 * Gateway rules (same as the production verification bus):
 * - Never put the port in the URL; always pass `XTransformPort` in the query.
 * - Keep the path as `/` so Caddy forwards to the right service.
 */
export default function WebSocketDemo() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [username, setUsername] = useState('');
  const [isUsernameSet, setIsUsernameSet] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let retry = 0;
    let closed = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(`${proto}://${window.location.host}/?XTransformPort=3003`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        retry = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as ServerEvent;
          if (data.type === 'message') {
            setMessages((prev) => [...prev, data.message]);
          } else if (data.type === 'user-joined') {
            setMessages((prev) => [...prev, data.message]);
            setUsers((prev) =>
              prev.find((u) => u.id === data.user.id) ? prev : [...prev, data.user]
            );
          } else if (data.type === 'user-left') {
            setMessages((prev) => [...prev, data.message]);
            setUsers((prev) => prev.filter((u) => u.id !== data.user.id));
          } else if (data.type === 'users-list') {
            setUsers(data.users);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (!closed && retry < 5) {
          retry += 1;
          setTimeout(connect, 1000 * retry);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const send = (payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const handleJoin = () => {
    if (username.trim() && isConnected) {
      send({ type: 'join', username: username.trim() });
      setIsUsernameSet(true);
    }
  };

  const sendMessage = () => {
    if (inputMessage.trim() && username.trim()) {
      send({ type: 'message', content: inputMessage.trim(), username: username.trim() });
      setInputMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') action();
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            WebSocket Demo
            <span
              className={`text-sm px-2 py-1 rounded ${
                isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}
            >
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isUsernameSet ? (
            <div className="space-y-2">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, handleJoin)}
                placeholder="Enter your username..."
                disabled={!isConnected}
                className="flex-1"
              />
              <Button
                onClick={handleJoin}
                disabled={!isConnected || !username.trim()}
                className="w-full"
              >
                Join Chat
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="h-80 w-full border rounded-md p-4">
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <p className="text-gray-500 text-center">No messages yet</p>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className="border-b pb-2 last:border-b-0">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p
                              className={`text-sm font-medium ${
                                msg.type === 'system' ? 'text-blue-600 italic' : 'text-gray-700'
                              }`}
                            >
                              {msg.username}
                            </p>
                            <p
                              className={`${
                                msg.type === 'system' ? 'text-blue-500 italic' : 'text-gray-900'
                              }`}
                            >
                              {msg.content}
                            </p>
                          </div>
                          <span className="text-xs text-gray-500">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              <div className="flex space-x-2">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, sendMessage)}
                  placeholder="Type a message..."
                  disabled={!isConnected}
                  className="flex-1"
                />
                <Button onClick={sendMessage} disabled={!isConnected || !inputMessage.trim()}>
                  Send
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
