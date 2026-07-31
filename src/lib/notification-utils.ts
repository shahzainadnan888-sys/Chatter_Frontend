import { resolveApiAssetUrl } from "@/src/lib/api-client";
import type { AppNotification, ShellPage, UUID } from "@/src/types/api";

export type NotificationFilter =
  | "all"
  | "friend_request"
  | "mention"
  | "message"
  | "call"
  | "group"
  | "status"
  | "system";

export interface NotificationNavTarget {
  page: ShellPage;
  chatId?: UUID;
  statusId?: UUID;
  username?: string;
  groupId?: UUID;
  callId?: UUID;
}

export interface GroupedNotification {
  key: string;
  kind: "single" | "status_views";
  items: AppNotification[];
  primary: AppNotification;
  title: string;
  body: string | null;
  actorName: string | null;
  actorAvatar: string | null;
  count: number;
}

function dataString(data: Record<string, unknown> | null | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function notificationCategory(type: string): NotificationFilter {
  const value = type.toLowerCase();
  if (value.includes("friend")) return "friend_request";
  if (value.includes("mention")) return "mention";
  if (value.includes("call")) return "call";
  if (value.includes("group") || value.includes("invite") || value.includes("announcement")) {
    return "group";
  }
  if (value.includes("status")) return "status";
  if (value.includes("message") || value.includes("chat") || value.includes("reaction")) {
    return "message";
  }
  return "system";
}

export function matchesNotificationFilter(
  item: AppNotification,
  filter: NotificationFilter,
) {
  if (filter === "all") return true;
  return notificationCategory(item.type) === filter;
}

export function notificationActor(item: AppNotification) {
  const data = item.data ?? {};
  const name =
    dataString(data, "actor_display_name") ||
    dataString(data, "actor_username") ||
    dataString(data, "display_name") ||
    dataString(data, "username");
  const username = dataString(data, "actor_username") || dataString(data, "username");
  const avatarRaw =
    dataString(data, "actor_avatar_url") || dataString(data, "avatar_url");
  return {
    name,
    username,
    avatarUrl: avatarRaw ? resolveApiAssetUrl(avatarRaw) : null,
  };
}

export function isStatusViewNotification(item: AppNotification) {
  if (notificationCategory(item.type) !== "status") return false;
  const title = item.title.toLowerCase();
  return title.includes("viewed your status");
}

export function groupNotifications(items: AppNotification[]): GroupedNotification[] {
  const groups: GroupedNotification[] = [];
  const viewBuckets = new Map<string, AppNotification[]>();

  for (const item of items) {
    if (!isStatusViewNotification(item)) {
      const actor = notificationActor(item);
      groups.push({
        key: item.id,
        kind: "single",
        items: [item],
        primary: item,
        title: item.title,
        body: item.body,
        actorName: actor.name,
        actorAvatar: actor.avatarUrl,
        count: 1,
      });
      continue;
    }
    const statusId = dataString(item.data, "status_id") || "status";
    const bucket = viewBuckets.get(statusId) ?? [];
    bucket.push(item);
    viewBuckets.set(statusId, bucket);
  }

  for (const [statusId, bucket] of viewBuckets) {
    const sorted = [...bucket].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const primary = sorted[0]!;
    const names = sorted
      .map((item) => notificationActor(item).name)
      .filter((name): name is string => Boolean(name));
    const uniqueNames = [...new Set(names)];
    let title: string;
    if (uniqueNames.length === 0) {
      title = primary.title;
    } else if (uniqueNames.length === 1) {
      title = `${uniqueNames[0]} viewed your Status`;
    } else if (uniqueNames.length === 2) {
      title = `${uniqueNames[0]} and ${uniqueNames[1]} viewed your Status`;
    } else {
      title = `${uniqueNames[0]}, ${uniqueNames[1]} and ${uniqueNames.length - 2} others viewed your Status`;
    }
    const actor = notificationActor(primary);
    groups.push({
      key: `status-views:${statusId}`,
      kind: "status_views",
      items: sorted,
      primary,
      title,
      body: null,
      actorName: actor.name,
      actorAvatar: actor.avatarUrl,
      count: sorted.length,
    });
  }

  return groups.sort(
    (a, b) =>
      new Date(b.primary.created_at).getTime() -
      new Date(a.primary.created_at).getTime(),
  );
}

export function notificationNavTarget(
  item: AppNotification,
): NotificationNavTarget | null {
  const data = item.data ?? {};
  const category = notificationCategory(item.type);
  const chatId = dataString(data, "chat_id") as UUID | null;
  const statusId = dataString(data, "status_id") as UUID | null;
  const groupId = dataString(data, "group_id") as UUID | null;
  const callId = dataString(data, "call_id") as UUID | null;
  const username =
    dataString(data, "actor_username") || dataString(data, "username");

  if (chatId) {
    return { page: "chats", chatId, username: username ?? undefined };
  }
  if (category === "status" || statusId) {
    return { page: "status", statusId: statusId ?? undefined };
  }
  if (category === "friend_request") {
    return { page: "friends", username: username ?? undefined };
  }
  if (category === "call" || callId) {
    return {
      page: chatId ? "chats" : "calls",
      chatId: chatId ?? undefined,
      callId: callId ?? undefined,
    };
  }
  if (category === "group" || groupId) {
    return { page: "groups", groupId: groupId ?? undefined };
  }
  if (category === "message" || category === "mention") {
    return { page: "chats", chatId: chatId ?? undefined };
  }
  return null;
}

export function notificationErrorCopy(error: unknown): {
  title: string;
  description: string;
} {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : null;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message ?? "")
        : "";
  const looksLikeNetwork =
    !status ||
    /failed to fetch|networkerror|load failed|cors/i.test(message);

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      title: "You're offline",
      description: "Reconnect to the internet to load notifications.",
    };
  }
  if (status === 401) {
    return {
      title: "Session expired",
      description: "Sign in again to see your notifications.",
    };
  }
  if (status === 403) {
    return {
      title: "Access denied",
      description: "You don't have permission to view these notifications.",
    };
  }
  if (status === 404) {
    return {
      title: "Not found",
      description: "Those notifications are no longer available.",
    };
  }
  if (status === 422) {
    return {
      title: "Invalid request",
      description: "Something was wrong with the notifications request.",
    };
  }
  if (status === 429 || code === "rate_limit_exceeded") {
    return {
      title: "Slow down",
      description: "Too many requests. Wait a moment and try again.",
    };
  }
  if (status && status >= 500) {
    return {
      title: "Server unavailable",
      description: "Chatter couldn't load notifications. Please retry.",
    };
  }
  if (looksLikeNetwork) {
    return {
      title: "Couldn't load notifications",
      description:
        "The request was blocked or interrupted. Wait a few seconds and try again.",
    };
  }
  return {
    title: "Couldn't load notifications",
    description: "Check your connection and try again.",
  };
}
