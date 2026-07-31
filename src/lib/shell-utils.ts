import { ApiError } from "@/src/lib/api-client";
import type { ChatDetail, ChatListItem, ISODate } from "@/src/types/api";

export function formatRelativeTime(value?: ISODate | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatJoinDate(value?: ISODate | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function chatTitle(
  chat: ChatListItem | ChatDetail,
  currentUsername?: string | null,
): string {
  if (chat.title?.trim()) return chat.title.trim();
  if ("participants" in chat && chat.participants?.length) {
    const other = chat.participants.find(
      (participant) => participant.username !== currentUsername,
    );
    if (other) return other.display_name || `@${other.username}`;
  }
  return chat.type === "group" ? "Group chat" : "Conversation";
}

export function chatSubtitle(
  chat: ChatListItem | ChatDetail,
  currentUsername?: string | null,
): string {
  if ("participants" in chat && chat.participants?.length) {
    const other = chat.participants.find(
      (participant) => participant.username !== currentUsername,
    );
    if (other) return `@${other.username}`;
  }
  return chat.type === "group" ? "Group" : "Direct message";
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message || "That request couldn’t be processed.";
    if (error.status === 401) return "Your session expired. Please sign in again.";
    if (error.status === 403) return "You don’t have permission for that action.";
    if (error.status === 404) return "That item could not be found.";
    if (error.status === 409) return error.message || "That action conflicts with current state.";
    if (error.status === 413) return "That file is too large to upload.";
    if (error.status === 415) return "That file type isn’t supported.";
    if (error.status === 422) {
      if (/size|large|mi[bB]|mime|type|unsupported/i.test(error.message)) {
        return error.message;
      }
      return error.message || "Please check your input and try again.";
    }
    if (error.status === 429) return "Too many requests. Please wait a moment.";
    if (error.status === 503) return "Chatter is temporarily unavailable. Trying again soon…";
    if (error.status >= 500) return "Something went wrong on our side. Please try again.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function notificationCategory(
  type: string,
): "friend_request" | "mention" | "message" | "call" | "group" | "status" | "system" {
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
