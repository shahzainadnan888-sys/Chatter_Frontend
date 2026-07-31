import { chatsApi } from "@/src/services/shell-api";
import type { ChatDetail, ChatListItem, UUID } from "@/src/types/api";

const cacheKey = (groupId: UUID) => `chatter.group-chat.${groupId}`;

/** Resolve the backend chat thread that backs a group (created alongside the group). */
export async function resolveGroupChat(group: {
  id: UUID;
  name: string;
}): Promise<ChatListItem | null> {
  if (typeof window !== "undefined") {
    const cachedId = window.sessionStorage.getItem(cacheKey(group.id));
    if (cachedId) {
      try {
        const detail = await chatsApi.get(cachedId);
        if (detail.type === "group") {
          return chatDetailToListItem(detail);
        }
      } catch {
        window.sessionStorage.removeItem(cacheKey(group.id));
      }
    }
  }

  for (let page = 1; page <= 8; page += 1) {
    const result = await chatsApi.list({
      page,
      page_size: 50,
      archived: false,
    });
    const match =
      result.data.find(
        (chat) => chat.type === "group" && chat.title === group.name,
      ) ??
      result.data.find(
        (chat) =>
          chat.type === "group" &&
          (chat.title || "").toLowerCase() === group.name.toLowerCase(),
      );
    if (match) {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(cacheKey(group.id), match.id);
      }
      return match;
    }
    if (!result.has_more) break;
  }
  return null;
}

export function rememberGroupChat(groupId: UUID, chatId: UUID) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(cacheKey(groupId), chatId);
}

function chatDetailToListItem(detail: ChatDetail): ChatListItem {
  return {
    id: detail.id,
    type: detail.type,
    title: detail.title,
    last_message_at: detail.last_message_at,
    last_message_preview: detail.last_message_preview,
    is_archived: detail.is_archived,
    is_favorite: detail.is_favorite,
    is_muted: detail.is_muted,
    muted_until: detail.muted_until,
    unread_count: detail.unread_count,
    participant_count: detail.participants.length,
    updated_at: detail.updated_at,
  };
}
