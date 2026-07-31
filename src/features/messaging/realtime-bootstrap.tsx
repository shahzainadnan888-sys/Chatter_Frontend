"use client";

import { useEffect } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  closeAllSockets,
  subscribeNotifications,
  subscribePresence,
} from "@/src/lib/websocket";
import { flushPendingMessages } from "@/src/lib/pending-messages";
import { presenceApi } from "@/src/services/messaging-api";
import { useMessagingStore } from "@/src/stores/messaging-store";
import type { AppNotification, NotificationListResponse } from "@/src/types/api";

function prependNotification(
  queryClient: ReturnType<typeof useQueryClient>,
  notification: AppNotification,
) {
  queryClient.setQueriesData<InfiniteData<NotificationListResponse>>(
    { queryKey: ["notifications", "infinite"] },
    (current) => {
      if (!current?.pages?.length) return current;
      const exists = current.pages.some((page) =>
        page.items.some((item) => item.id === notification.id),
      );
      if (exists) return current;
      const [first, ...rest] = current.pages;
      return {
        ...current,
        pages: [
          {
            ...first,
            items: [notification, ...first.items],
            total: first.total + 1,
            unread_count: first.unread_count + (notification.is_read ? 0 : 1),
          },
          ...rest.map((page) => ({
            ...page,
            total: page.total + 1,
            unread_count: page.unread_count + (notification.is_read ? 0 : 1),
          })),
        ],
      };
    },
  );

  queryClient.setQueriesData<NotificationListResponse>(
    { queryKey: ["notifications"] },
    (current) => {
      if (!current?.items) return current;
      if (current.items.some((item) => item.id === notification.id)) return current;
      return {
        ...current,
        items: [notification, ...current.items],
        total: current.total + 1,
        unread_count: current.unread_count + (notification.is_read ? 0 : 1),
      };
    },
  );

  void queryClient.invalidateQueries({ queryKey: ["notifications-badge"] });
}

function notificationFromPayload(
  payload: Record<string, unknown>,
): AppNotification | null {
  const id = typeof payload.id === "string" ? payload.id : null;
  const type = typeof payload.type === "string" ? payload.type : null;
  const title = typeof payload.title === "string" ? payload.title : null;
  if (!id || !type || !title) return null;
  return {
    id,
    actor_id: typeof payload.actor_id === "string" ? payload.actor_id : null,
    type,
    title,
    body: typeof payload.body === "string" ? payload.body : null,
    data:
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : null,
    is_read: Boolean(payload.is_read),
    read_at: typeof payload.read_at === "string" ? payload.read_at : null,
    created_at:
      typeof payload.created_at === "string"
        ? payload.created_at
        : new Date().toISOString(),
  };
}

export function RealtimeBootstrap() {
  const queryClient = useQueryClient();
  const setPresence = useMessagingStore((state) => state.setPresence);
  const setWsConnected = useMessagingStore((state) => state.setWsConnected);
  const setOffline = useMessagingStore((state) => state.setOffline);

  useEffect(() => {
    let cancelled = false;
    let presenceUnsub: () => void = () => undefined;
    let notificationsUnsub: () => void = () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const boot = async () => {
      try {
        await presenceApi.online(90);
      } catch {
        // Presence HTTP can fail while sockets still work; ignore.
      }
      if (cancelled) return;

      const unsubscribePresence = await subscribePresence(
        (event) => {
          const type = event.type || "";
          if (type.startsWith("status_")) {
            void queryClient.invalidateQueries({ queryKey: ["status-me"] });
            void queryClient.invalidateQueries({ queryKey: ["status-feed"] });
            return;
          }
          if (type === "notification.created" || type.startsWith("notification")) {
            const notification = notificationFromPayload(
              (event.payload ?? {}) as Record<string, unknown>,
            );
            if (notification) prependNotification(queryClient, notification);
            else {
              void queryClient.invalidateQueries({ queryKey: ["notifications"] });
              void queryClient.invalidateQueries({
                queryKey: ["notifications-badge"],
              });
            }
            return;
          }
          const payload = event.payload as {
            user_id?: string;
            last_seen_at?: string | null;
            hidden?: boolean;
          };
          const userId =
            payload.user_id ||
            (event.type.includes("offline") || event.type.includes("online")
              ? event.sender_id
              : null);
          if (!userId) return;
          if (payload.hidden) {
            setPresence(userId, {
              isOnline: false,
              lastSeenAt: null,
            });
            return;
          }
          if (event.type.includes("offline") || event.type === "presence.offline") {
            setPresence(userId, {
              isOnline: false,
              lastSeenAt: payload.last_seen_at ?? new Date().toISOString(),
            });
          } else {
            setPresence(userId, {
              isOnline: true,
              lastSeenAt: payload.last_seen_at ?? null,
            });
          }
        },
        (status) => setWsConnected(status === "open"),
      );
      if (cancelled) {
        unsubscribePresence();
        return;
      }
      presenceUnsub = unsubscribePresence;

      const unsubscribeNotifications = await subscribeNotifications((event) => {
        const type = event.type || "";

        if (type.startsWith("status_")) {
          void queryClient.invalidateQueries({ queryKey: ["status-me"] });
          void queryClient.invalidateQueries({ queryKey: ["status-feed"] });
          const statusId =
            typeof event.payload?.status_id === "string"
              ? event.payload.status_id
              : null;
          if (statusId) {
            void queryClient.invalidateQueries({
              queryKey: ["status-viewers", statusId],
            });
            void queryClient.invalidateQueries({
              queryKey: ["status", statusId],
            });
          }
          return;
        }

        if (type === "notification.created" || type.startsWith("notification")) {
          const notification = notificationFromPayload(
            (event.payload ?? {}) as Record<string, unknown>,
          );
          if (notification) {
            prependNotification(queryClient, notification);
            const title = notification.title;
            const body = notification.body || "";
            if (document.visibilityState !== "visible") {
              void window.chatter?.notify({ title, body });
            }
            return;
          }
        }

        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({
          queryKey: ["notifications-badge"],
        });
        const title =
          typeof event.payload.title === "string"
            ? event.payload.title
            : "New activity in Chatter";
        const body =
          typeof event.payload.body === "string" ? event.payload.body : "";
        if (document.visibilityState !== "visible" && title) {
          void window.chatter?.notify({ title, body });
        }
      });
      if (cancelled) {
        unsubscribeNotifications();
        return;
      }
      notificationsUnsub = unsubscribeNotifications;

      heartbeat = setInterval(() => {
        if (navigator.onLine) {
          void presenceApi.online(90).catch(() => undefined);
        }
      }, 30_000);
      await flushPendingMessages();
      await queryClient.invalidateQueries({ queryKey: ["messages"] });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    void boot().catch(() => {
      if (!cancelled) setWsConnected(false);
    });

    const onOnline = () => {
      setOffline(false);
      void presenceApi.online(90).catch(() => undefined);
      void flushPendingMessages().finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["messages"] });
        void queryClient.invalidateQueries({ queryKey: ["chats"] });
        void queryClient.invalidateQueries({ queryKey: ["status-me"] });
        void queryClient.invalidateQueries({ queryKey: ["status-feed"] });
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["notifications-badge"] });
      });
    };
    const onOffline = () => {
      setOffline(true);
      setWsConnected(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setOffline(!navigator.onLine);

    const onUnload = () => {
      void presenceApi.offline().catch(() => undefined);
      closeAllSockets();
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      cancelled = true;
      presenceUnsub();
      notificationsUnsub();
      if (heartbeat) clearInterval(heartbeat);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", onUnload);
      void presenceApi.offline().catch(() => undefined);
      closeAllSockets();
    };
  }, [queryClient, setPresence, setWsConnected, setOffline]);

  return null;
}
