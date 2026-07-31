import { getAccessToken } from "@/src/lib/api-client";
import type { UUID, WsEvent } from "@/src/types/api";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";
const PONG_TIMEOUT_MS = 45_000;

type Listener = (event: WsEvent) => void;
type StatusListener = (status: "connecting" | "open" | "closed" | "error") => void;

interface ManagedSocket {
  url: string;
  socket: WebSocket | null;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  heartbeat?: ReturnType<typeof setInterval>;
  pongWatchdog?: ReturnType<typeof setInterval>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  onlineWaiter?: () => void;
  attempt: number;
  closedByUser: boolean;
  seenIds: Set<string>;
  outboundQueue: Array<{ type: string; frame: string }>;
  lastPongAt: number;
  openedAt: number;
}

const sockets = new Map<string, ManagedSocket>();
const socketInflight = new Map<string, Promise<ManagedSocket>>();

function jitterBackoff(attempt: number) {
  const base = Math.min(30_000, 500 * 2 ** Math.min(attempt, 5));
  return base * (0.5 + Math.random() * 0.5);
}

function clearTimers(managed: ManagedSocket) {
  if (managed.heartbeat) {
    clearInterval(managed.heartbeat);
    managed.heartbeat = undefined;
  }
  if (managed.pongWatchdog) {
    clearInterval(managed.pongWatchdog);
    managed.pongWatchdog = undefined;
  }
  if (managed.reconnectTimer) {
    clearTimeout(managed.reconnectTimer);
    managed.reconnectTimer = undefined;
  }
  if (managed.onlineWaiter) {
    window.removeEventListener("online", managed.onlineWaiter);
    managed.onlineWaiter = undefined;
  }
}

async function buildUrl(path: string, params?: Record<string, string>) {
  const token = await getAccessToken();
  if (!token) throw new Error("No access token for WebSocket.");
  const url = new URL(`${WS_BASE.replace(/\/$/, "")}${path}`);
  url.searchParams.set("token", token);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function emitStatus(managed: ManagedSocket, status: "connecting" | "open" | "closed" | "error") {
  managed.statusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch {
      // Never let one status listener break the rest.
    }
  });
}

function scheduleReconnect(managed: ManagedSocket) {
  if (managed.closedByUser) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const onOnline = () => {
      if (managed.onlineWaiter === onOnline) managed.onlineWaiter = undefined;
      window.removeEventListener("online", onOnline);
      void reconnect(managed);
    };
    managed.onlineWaiter = onOnline;
    window.addEventListener("online", onOnline);
    return;
  }
  managed.reconnectTimer = setTimeout(() => {
    void reconnect(managed);
  }, jitterBackoff(managed.attempt));
}

function attach(managed: ManagedSocket) {
  managed.closedByUser = false;
  clearTimers(managed);
  emitStatus(managed, "connecting");
  const socket = new WebSocket(managed.url);
  managed.socket = socket;
  managed.lastPongAt = Date.now();
  managed.openedAt = 0;

  socket.onopen = () => {
    managed.openedAt = Date.now();
    managed.lastPongAt = Date.now();
    emitStatus(managed, "open");
    const queued = managed.outboundQueue.splice(0);
    queued.forEach(({ frame }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    });
    if (managed.heartbeat) clearInterval(managed.heartbeat);
    managed.heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", payload: {} }));
      }
    }, 30_000);
    managed.pongWatchdog = setInterval(() => {
      if (managed.closedByUser || managed.socket !== socket) return;
      if (socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - managed.lastPongAt < PONG_TIMEOUT_MS) {
        // Only reset backoff after the connection stays healthy for a bit.
        if (managed.openedAt && Date.now() - managed.openedAt > 5_000) {
          managed.attempt = 0;
        }
        return;
      }
      try {
        socket.close();
      } catch {
        // Force reconnect path via onclose.
      }
    }, 10_000);
  };

  socket.onmessage = (message) => {
    try {
      const data = JSON.parse(String(message.data)) as WsEvent | { type: string };
      if (!data || typeof data !== "object" || !("type" in data)) return;
      if (data.type === "pong") {
        managed.lastPongAt = Date.now();
        return;
      }
      const event = data as WsEvent;
      if (event.id) {
        if (managed.seenIds.has(event.id)) return;
        managed.seenIds.add(event.id);
        if (managed.seenIds.size > 500) {
          const first = managed.seenIds.values().next().value;
          if (first) managed.seenIds.delete(first);
        }
      }
      managed.listeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // Isolate listener failures so one bad handler cannot stall realtime.
        }
      });
    } catch {
      // Ignore malformed frames; keep socket open per API guidance.
    }
  };

  socket.onerror = () => emitStatus(managed, "error");

  socket.onclose = (event) => {
    clearTimers(managed);
    managed.socket = null;
    emitStatus(managed, "closed");
    if (managed.closedByUser) return;

    // Auth / membership failures must not reconnect-loop (API.md).
    if (event.code === 4400 || event.code === 4403) {
      managed.closedByUser = true;
      return;
    }
    if (event.code === 4401) {
      managed.closedByUser = true;
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("chatter:session-expired"));
      }
      return;
    }

    managed.attempt += 1;
    scheduleReconnect(managed);
  };
}

async function reconnect(managed: ManagedSocket) {
  try {
    const nextUrl = new URL(managed.url);
    const token = await getAccessToken();
    if (!token) return;
    nextUrl.searchParams.set("token", token);
    managed.url = nextUrl.toString();
    attach(managed);
  } catch {
    managed.attempt += 1;
    scheduleReconnect(managed);
  }
}

async function ensureSocket(
  key: string,
  path: string,
  params?: Record<string, string>,
) {
  const existing = sockets.get(key);
  if (existing) return existing;

  const inflight = socketInflight.get(key);
  if (inflight) return inflight;

  const create = (async () => {
    const again = sockets.get(key);
    if (again) return again;
    const url = await buildUrl(path, params);
    const raced = sockets.get(key);
    if (raced) return raced;
    const managed: ManagedSocket = {
      url,
      socket: null,
      listeners: new Set(),
      statusListeners: new Set(),
      attempt: 0,
      closedByUser: false,
      seenIds: new Set(),
      outboundQueue: [],
      lastPongAt: Date.now(),
      openedAt: 0,
    };
    sockets.set(key, managed);
    attach(managed);
    return managed;
  })();

  socketInflight.set(key, create);
  try {
    return await create;
  } finally {
    socketInflight.delete(key);
  }
}

function releaseSocket(key: string) {
  const managed = sockets.get(key);
  if (!managed) return;
  if (managed.listeners.size > 0) return;
  managed.closedByUser = true;
  clearTimers(managed);
  managed.socket?.close();
  sockets.delete(key);
}

export function sendWs(key: string, type: string, payload: Record<string, unknown> = {}) {
  const managed = sockets.get(key);
  if (!managed) return false;
  const frame = JSON.stringify({ type, payload });
  if (!managed.socket || managed.socket.readyState !== WebSocket.OPEN) {
    if (type === "message.typing" || type === "message.recording") {
      managed.outboundQueue = managed.outboundQueue.filter(
        (queued) => queued.type !== type,
      );
    }
    managed.outboundQueue.push({ type, frame });
    if (managed.outboundQueue.length > 200) managed.outboundQueue.shift();
    return false;
  }
  managed.socket.send(frame);
  return true;
}

export async function subscribeChat(
  chatId: UUID,
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `chat:${chatId}`;
  const managed = await ensureSocket(key, `/chat/${chatId}`);
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribeTyping(
  chatId: UUID,
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `typing:${chatId}`;
  const managed = await ensureSocket(key, "/typing", { chat_id: chatId });
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribeRecording(
  chatId: UUID,
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `recording:${chatId}`;
  const managed = await ensureSocket(key, "/recording", { chat_id: chatId });
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribePresence(
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = "presence";
  const managed = await ensureSocket(key, "/presence");
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribeNotifications(
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = "notifications";
  const managed = await ensureSocket(key, "/notifications");
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribeServer(
  serverId: UUID,
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `server:${serverId}`;
  const managed = await ensureSocket(key, `/servers/${serverId}`);
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export async function subscribeCalls(
  roomId: string,
  target: { chatId?: UUID; groupId?: UUID },
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `calls:${roomId}`;
  const params: Record<string, string> = { room_id: roomId };
  if (target.chatId) params.chat_id = target.chatId;
  if (target.groupId) params.group_id = target.groupId;
  const managed = await ensureSocket(key, "/calls", params);
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export function broadcastCallEvent(
  roomId: string,
  type: string,
  payload: Record<string, unknown>,
  attemptsLeft = 12,
) {
  if (sendWs(`calls:${roomId}`, type, payload)) return;
  if (attemptsLeft <= 0 || typeof window === "undefined") return;
  // The call room socket is opened by the overlay subscription, so the first
  // event after starting or joining can race ahead of the open handshake.
  window.setTimeout(
    () => broadcastCallEvent(roomId, type, payload, attemptsLeft - 1),
    200,
  );
}

export async function subscribeGroup(
  groupId: UUID,
  listener: Listener,
  onStatus?: StatusListener,
) {
  const key = `group:${groupId}`;
  const managed = await ensureSocket(key, `/group/${groupId}`);
  managed.listeners.add(listener);
  if (onStatus) {
    managed.statusListeners.add(onStatus);
    if (managed.socket?.readyState === WebSocket.OPEN) onStatus("open");
    else if (managed.socket) onStatus("connecting");
  }
  return () => {
    managed.listeners.delete(listener);
    if (onStatus) managed.statusListeners.delete(onStatus);
    releaseSocket(key);
  };
}

export function broadcastChatEvent(
  chatId: UUID,
  type: string,
  payload: Record<string, unknown>,
) {
  sendWs(`chat:${chatId}`, type, payload);
}

export function broadcastTyping(chatId: UUID, active: boolean) {
  sendWs(`typing:${chatId}`, "message.typing", { active, chat_id: chatId });
}

export function broadcastRecording(chatId: UUID, active: boolean) {
  sendWs(`recording:${chatId}`, "message.recording", {
    active,
    chat_id: chatId,
  });
}

export function closeAllSockets() {
  for (const [key, managed] of sockets) {
    managed.closedByUser = true;
    managed.listeners.clear();
    managed.statusListeners.clear();
    clearTimers(managed);
    managed.socket?.close();
    sockets.delete(key);
  }
  socketInflight.clear();
}
