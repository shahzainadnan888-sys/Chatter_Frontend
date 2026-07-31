import { apiRequest } from "@/src/lib/api-client";
import type {
  AppNotification,
  ChatDetail,
  ChatListItem,
  CreateChatRequest,
  FileSearchResult,
  FriendRequest,
  GroupAnnouncement,
  GroupInvite,
  GroupPoll,
  GroupSearchResult,
  GroupSummary,
  MessageResponse,
  MessageSearchResult,
  MutationCountResponse,
  NotificationListResponse,
  Paginated,
  ProfilePublic,
  UserDetail,
  UserPublic,
  UserSearchResult,
  UUID,
} from "@/src/types/api";

function qs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const chatsApi = {
  list: (params?: {
    page?: number;
    page_size?: number;
    archived?: boolean;
  }) =>
    apiRequest<Paginated<ChatListItem>>({
      path: `/api/v1/chats/${qs({
        page: params?.page ?? 1,
        page_size: params?.page_size ?? 20,
        archived: params?.archived ?? false,
      })}`,
    }),
  get: (chatId: UUID) =>
    apiRequest<ChatDetail>({ path: `/api/v1/chats/${chatId}` }),
  create: (body: CreateChatRequest) =>
    apiRequest<ChatDetail>({
      path: "/api/v1/chats/",
      method: "POST",
      body,
    }),
  archive: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/archive",
      method: "POST",
      body: { chat_id },
    }),
  unarchive: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/unarchive",
      method: "POST",
      body: { chat_id },
    }),
  favorite: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/favorite",
      method: "POST",
      body: { chat_id },
    }),
  unfavorite: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/unfavorite",
      method: "POST",
      body: { chat_id },
    }),
  mute: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/mute",
      method: "POST",
      body: { chat_id },
    }),
  unmute: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/chats/unmute",
      method: "POST",
      body: { chat_id },
    }),
  leave: (chat_id: UUID) =>
    apiRequest<MessageResponse>({
      path: `/api/v1/chats/${chat_id}`,
      method: "DELETE",
    }),
};

export const friendsApi = {
  list: (page = 1, page_size = 20) =>
    apiRequest<Paginated<UserPublic>>({
      path: `/api/v1/users/friends${qs({ page, page_size })}`,
    }),
  requests: (incoming = true, page = 1, page_size = 20) =>
    apiRequest<Paginated<FriendRequest>>({
      path: `/api/v1/users/friends/requests${qs({
        incoming,
        page,
        page_size,
      })}`,
    }),
  send: (user_id: UUID) =>
    apiRequest<FriendRequest>({
      path: "/api/v1/users/friends/request",
      method: "POST",
      body: { user_id },
    }),
  accept: (user_id: UUID) =>
    apiRequest<FriendRequest>({
      path: "/api/v1/users/friends/accept",
      method: "POST",
      body: { user_id },
    }),
  reject: (user_id: UUID) =>
    apiRequest<FriendRequest>({
      path: "/api/v1/users/friends/reject",
      method: "POST",
      body: { user_id },
    }),
  remove: (friend_id: UUID) =>
    apiRequest<MessageResponse>({
      path: `/api/v1/users/friends/${friend_id}`,
      method: "DELETE",
    }),
  blocked: (page = 1, page_size = 20) =>
    apiRequest<Paginated<UserPublic>>({
      path: `/api/v1/users/blocked${qs({ page, page_size })}`,
    }),
  block: (user_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/users/block",
      method: "POST",
      body: { user_id },
    }),
  unblock: (user_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/users/unblock",
      method: "DELETE",
      body: { user_id },
    }),
  report: (body: {
    user_id: UUID;
    reason: string;
    description?: string | null;
  }) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/users/report",
      method: "POST",
      body,
    }),
};

export const usersApi = {
  me: () => apiRequest<UserDetail>({ path: "/api/v1/users/me" }),
  byUsername: (username: string) =>
    apiRequest<UserPublic>({
      path: `/api/v1/users/${encodeURIComponent(username)}`,
    }),
  search: (q: string, page = 1, page_size = 20) =>
    apiRequest<Paginated<UserPublic>>({
      path: `/api/v1/users/search${qs({ q, page, page_size })}`,
    }),
  profile: (username: string) =>
    apiRequest<ProfilePublic>({
      path: `/api/v1/profiles/${encodeURIComponent(username)}`,
    }),
  myProfile: () =>
    apiRequest<ProfilePublic>({ path: "/api/v1/profiles/me" }),
};

export const searchApi = {
  users: (q: string, limit = 20) =>
    apiRequest<UserSearchResult[]>({
      path: `/api/v1/search/users${qs({ q, limit })}`,
    }),
  groups: (q: string, limit = 20) =>
    apiRequest<GroupSearchResult[]>({
      path: `/api/v1/search/groups${qs({ q, limit })}`,
    }),
  messages: (q: string, limit = 50) =>
    apiRequest<MessageSearchResult[]>({
      path: `/api/v1/search/messages${qs({ q, limit })}`,
    }),
  files: (q: string, limit = 50) =>
    apiRequest<FileSearchResult[]>({
      path: `/api/v1/search/files${qs({ q, limit })}`,
    }),
};

export const notificationsApi = {
  list: (params?: {
    page?: number;
    page_size?: number;
    unread_only?: boolean;
  }) =>
    apiRequest<NotificationListResponse>({
      path: `/api/v1/notifications/${qs({
        page: params?.page ?? 1,
        page_size: params?.page_size ?? 20,
        unread_only: params?.unread_only ? true : undefined,
      })}`,
    }),
  markRead: (notification_ids: UUID[]) =>
    apiRequest<MutationCountResponse>({
      path: "/api/v1/notifications/read",
      method: "PATCH",
      body: { notification_ids },
    }),
  markAllRead: () =>
    apiRequest<MutationCountResponse>({
      path: "/api/v1/notifications/read-all",
      method: "PATCH",
    }),
  remove: (notification_id: UUID) =>
    apiRequest<void>({
      path: `/api/v1/notifications/${notification_id}`,
      method: "DELETE",
    }),
};

export const groupsApi = {
  list: (page = 1, page_size = 20) =>
    apiRequest<GroupSummary[]>({
      path: `/api/v1/groups/${qs({ page, page_size })}`,
    }),
  get: (groupId: UUID) =>
    apiRequest<GroupSummary>({ path: `/api/v1/groups/${groupId}` }),
  create: (body: {
    name: string;
    description?: string | null;
    avatar_url?: string | null;
    visibility?: "public" | "private";
    max_members?: number;
  }) =>
    apiRequest<GroupSummary>({
      path: "/api/v1/groups/",
      method: "POST",
      body,
    }),
  update: (
    groupId: UUID,
    body: {
      name?: string | null;
      description?: string | null;
      avatar_url?: string | null;
      visibility?: "public" | "private" | null;
      max_members?: number | null;
    },
  ) =>
    apiRequest<GroupSummary>({
      path: `/api/v1/groups/${groupId}`,
      method: "PATCH",
      body,
    }),
  remove: (groupId: UUID) =>
    apiRequest<MessageResponse>({
      path: `/api/v1/groups/${groupId}`,
      method: "DELETE",
    }),
  join: (invite_code: string) =>
    apiRequest<GroupSummary>({
      path: "/api/v1/groups/join",
      method: "POST",
      body: { invite_code },
    }),
  leave: (group_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/groups/leave",
      method: "POST",
      body: { group_id },
    }),
  invite: (body: {
    group_id: UUID;
    invited_user_id?: string | null;
    email?: string | null;
    expires_in_hours?: number;
  }) =>
    apiRequest<GroupInvite>({
      path: "/api/v1/groups/invite",
      method: "POST",
      body,
    }),
  removeMember: (group_id: UUID, user_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/groups/remove-member",
      method: "POST",
      body: { group_id, user_id },
    }),
  setMemberRole: (
    group_id: UUID,
    user_id: UUID,
    role: "member" | "admin" | "owner",
  ) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/groups/member-role",
      method: "PATCH",
      body: { group_id, user_id, role },
    }),
  announcement: (body: {
    group_id: UUID;
    title: string;
    body: string;
    is_pinned?: boolean;
  }) =>
    apiRequest<GroupAnnouncement>({
      path: "/api/v1/groups/announcement",
      method: "POST",
      body,
    }),
  poll: (body: {
    group_id: UUID;
    question: string;
    options: string[];
    is_anonymous?: boolean;
    allows_multiple?: boolean;
    closes_at?: string | null;
  }) =>
    apiRequest<GroupPoll>({
      path: "/api/v1/groups/poll",
      method: "POST",
      body,
    }),
};

/** Feature gates for group operations not currently defined in API.md. */
export const groupsApiCapabilities = {
  regenerateInviteCode: false,
  joinBySharedLink: false,
  listMembers: false,
  listAnnouncements: false,
  listPolls: false,
  votePoll: false,
} as const;

export type { AppNotification };
