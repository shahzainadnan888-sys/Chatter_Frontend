"use client";

import { getAccessToken } from "@/src/lib/api-client";
import { callDebug, callWarn } from "@/src/services/webrtc/call-debug";
import type {
  SignalingEvent,
  SignalingEventType,
  SignalingOutbound,
} from "@/src/services/webrtc/types";

type Listener = (event: SignalingEvent) => void;
type StatusListener = (status: "connecting" | "open" | "closed" | "error") => void;

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persistent JWT-authenticated WebSocket to `/ws/calls`.
 * Backend delivers CALL_INVITE only to sockets registered here — this must stay open
 * for every logged-in client or receivers never ring.
 */
class CallSignalingService {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private closedByUser = false;
  private connecting: Promise<void> | null = null;
  private queue: string[] = [];
  private status: "connecting" | "open" | "closed" | "error" = "closed";

  isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getStatus() {
    return this.status;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    void this.ensureConnected().catch((error) => {
      callWarn("ws", "subscribe connect failed", error);
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async ensureConnected() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.closedByUser = false;
    this.connecting = this.connectWithRetry().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  send(message: SignalingOutbound) {
    const frame = JSON.stringify({
      type: message.type,
      call_id: message.call_id ?? null,
      request_id: message.request_id,
      payload: message.payload ?? {},
    });
    callDebug("ws", `→ ${message.type}`, {
      call_id: message.call_id,
      payload: message.payload,
    });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame);
      return true;
    }
    this.queue.push(frame);
    if (this.queue.length > 100) this.queue.shift();
    void this.ensureConnected().catch(() => undefined);
    return false;
  }

  sendEvent(
    type: SignalingEventType,
    callId: string | null | undefined,
    payload: Record<string, unknown> = {},
  ) {
    return this.send({ type, call_id: callId, payload });
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close();
    this.socket = null;
    this.emitStatus("closed");
  }

  private async connectWithRetry() {
    let lastError: unknown;
    for (let i = 0; i < 8; i += 1) {
      if (this.closedByUser) return;
      try {
        await this.connectOnce();
        return;
      } catch (error) {
        lastError = error;
        callWarn("ws", `connect attempt ${i + 1} failed`, error);
        await sleep(Math.min(8_000, 250 * 2 ** i));
      }
    }
    this.scheduleReconnect();
    throw lastError instanceof Error
      ? lastError
      : new Error("Call signaling connect failed");
  }

  private async waitForToken() {
    for (let i = 0; i < 15; i += 1) {
      const token = await getAccessToken();
      if (token) return token;
      await sleep(200 + i * 100);
    }
    throw new Error("No access token for call signaling.");
  }

  private async connectOnce() {
    const token = await this.waitForToken();
    this.emitStatus("connecting");

    const url = new URL(`${WS_BASE.replace(/\/$/, "")}/calls`);
    url.searchParams.set("token", token);
    callDebug("ws", "connecting", { url: url.origin + url.pathname });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url.toString());
      this.socket = socket;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        this.emitStatus("error");
        reject(error);
      };

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        this.attempt = 0;
        this.emitStatus("open");
        this.startHeartbeat();
        callDebug("ws", "open");
        while (this.queue.length) {
          const frame = this.queue.shift();
          if (frame) socket.send(frame);
        }
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as SignalingEvent;
          if (!data?.type) return;
          if (data.type === "PONG") {
            callDebug("ws", "← PONG");
            return;
          }
          callDebug("ws", `← ${data.type}`, {
            call_id: data.call_id,
            sender_id: data.sender_id,
            payload: data.payload,
          });
          this.listeners.forEach((listener) => {
            try {
              listener(data);
            } catch (error) {
              callWarn("ws", "listener error", error);
            }
          });
        } catch (error) {
          callWarn("ws", "malformed frame", error);
        }
      };

      socket.onerror = () => {
        callWarn("ws", "socket error");
        fail(new Error("Call signaling socket error"));
      };

      socket.onclose = (event) => {
        callDebug("ws", "closed", {
          code: event.code,
          reason: event.reason,
        });
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        if (this.socket === socket) this.socket = null;
        this.emitStatus("closed");
        if (!settled) {
          fail(
            new Error(
              `Call signaling closed before open (${event.code} ${event.reason})`,
            ),
          );
        }
        if (!this.closedByUser) this.scheduleReconnect();
      };
    });
  }

  private startHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      this.send({ type: "PING", payload: {} });
    }, 25_000);
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(30_000, 600 * 2 ** Math.min(this.attempt, 5));
    this.attempt += 1;
    callDebug("ws", `reconnect in ${Math.round(delay)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch((error) => {
        callWarn("ws", "reconnect failed", error);
      });
    }, delay * (0.5 + Math.random() * 0.5));
  }

  private emitStatus(status: "connecting" | "open" | "closed" | "error") {
    this.status = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch {
        // ignore
      }
    });
  }
}

export const callSignaling = new CallSignalingService();
