import { apiRequest } from "@/src/lib/api-client";
import type { UUID } from "@/src/types/api";
import type {
  Server,
  ServerCategory,
  ServerChannel,
  ServerChannelType,
  ServerDefaultNotifications,
  ServerEmoji,
  ServerInvite,
  ServerInvitePreview,
  ServerInviteType,
  ServerListItem,
  ServerMember,
  ServerMentionSuggestion,
  ServerMessage,
  ServerPermissionCatalogItem,
  ServerRole,
  ServerSearchResult,
  ServerSidebar,
  ServerSuccess,
  ServerVerificationLevel,
  ServerVoiceParticipant,
} from "@/src/types/servers";

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

const base = (serverId: UUID) => `/api/v1/servers/${serverId}`;

export const serversApi = {
  list: () => apiRequest<ServerListItem[]>({ path: "/api/v1/servers" }),

  create: (body: {
    name: string;
    description?: string | null;
    icon_url?: string | null;
    banner_url?: string | null;
  }) =>
    apiRequest<ServerSidebar>({
      path: "/api/v1/servers",
      method: "POST",
      body,
    }),

  join: (code: string) =>
    apiRequest<ServerSidebar>({
      path: "/api/v1/servers/join",
      method: "POST",
      body: { code },
    }),

  previewInvite: (code: string) =>
    apiRequest<ServerInvitePreview>({
      path: `/api/v1/servers/invites/${encodeURIComponent(code)}`,
    }),

  permissions: () =>
    apiRequest<ServerPermissionCatalogItem[]>({
      path: "/api/v1/servers/permissions",
    }),

  get: (serverId: UUID) =>
    apiRequest<Server>({ path: base(serverId) }),

  sidebar: (serverId: UUID) =>
    apiRequest<ServerSidebar>({ path: `${base(serverId)}/sidebar` }),

  update: (
    serverId: UUID,
    body: {
      name?: string | null;
      description?: string | null;
      icon_url?: string | null;
      banner_url?: string | null;
      verification_level?: ServerVerificationLevel | null;
      default_notifications?: ServerDefaultNotifications | null;
    },
  ) =>
    apiRequest<Server>({
      path: base(serverId),
      method: "PATCH",
      body,
    }),

  remove: (serverId: UUID) =>
    apiRequest<ServerSuccess>({
      path: base(serverId),
      method: "DELETE",
    }),

  leave: (serverId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/leave`,
      method: "POST",
    }),

  // Categories
  listCategories: (serverId: UUID) =>
    apiRequest<ServerCategory[]>({ path: `${base(serverId)}/categories` }),

  createCategory: (
    serverId: UUID,
    body: { name: string; position?: number | null },
  ) =>
    apiRequest<ServerCategory>({
      path: `${base(serverId)}/categories`,
      method: "POST",
      body,
    }),

  updateCategory: (
    serverId: UUID,
    categoryId: UUID,
    body: { name?: string | null; position?: number | null },
  ) =>
    apiRequest<ServerCategory>({
      path: `${base(serverId)}/categories/${categoryId}`,
      method: "PATCH",
      body,
    }),

  deleteCategory: (serverId: UUID, categoryId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/categories/${categoryId}`,
      method: "DELETE",
    }),

  // Channels
  listChannels: (serverId: UUID) =>
    apiRequest<ServerChannel[]>({ path: `${base(serverId)}/channels` }),

  createChannel: (
    serverId: UUID,
    body: {
      name: string;
      type?: ServerChannelType;
      category_id?: UUID | null;
      topic?: string | null;
      position?: number | null;
      is_nsfw?: boolean;
      slowmode_seconds?: number;
      bitrate?: number | null;
      user_limit?: number | null;
    },
  ) =>
    apiRequest<ServerChannel>({
      path: `${base(serverId)}/channels`,
      method: "POST",
      body,
    }),

  getChannel: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerChannel>({
      path: `${base(serverId)}/channels/${channelId}`,
    }),

  updateChannel: (
    serverId: UUID,
    channelId: UUID,
    body: {
      name?: string | null;
      topic?: string | null;
      category_id?: UUID | null;
      position?: number | null;
      is_nsfw?: boolean | null;
      slowmode_seconds?: number | null;
      bitrate?: number | null;
      user_limit?: number | null;
    },
  ) =>
    apiRequest<ServerChannel>({
      path: `${base(serverId)}/channels/${channelId}`,
      method: "PATCH",
      body,
    }),

  deleteChannel: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}`,
      method: "DELETE",
    }),

  markChannelRead: (serverId: UUID, channelId: UUID, messageId?: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}/read${qs({
        message_id: messageId,
      })}`,
      method: "POST",
    }),

  startTyping: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}/typing`,
      method: "POST",
    }),

  stopTyping: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}/typing`,
      method: "DELETE",
    }),

  // Messages
  listMessages: (
    serverId: UUID,
    channelId: UUID,
    params?: { before?: UUID; limit?: number },
  ) =>
    apiRequest<ServerMessage[]>({
      path: `${base(serverId)}/channels/${channelId}/messages${qs({
        before: params?.before,
        limit: params?.limit ?? 50,
      })}`,
    }),

  sendMessage: (
    serverId: UUID,
    channelId: UUID,
    body: {
      content?: string | null;
      media_id?: UUID | null;
      reply_to_id?: UUID | null;
    },
  ) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages`,
      method: "POST",
      body,
    }),

  editMessage: (
    serverId: UUID,
    channelId: UUID,
    messageId: UUID,
    content: string,
  ) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}`,
      method: "PATCH",
      body: { content },
    }),

  deleteMessage: (serverId: UUID, channelId: UUID, messageId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}`,
      method: "DELETE",
    }),

  pinMessage: (serverId: UUID, channelId: UUID, messageId: UUID) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}/pin`,
      method: "POST",
    }),

  unpinMessage: (serverId: UUID, channelId: UUID, messageId: UUID) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}/pin`,
      method: "DELETE",
    }),

  addReaction: (
    serverId: UUID,
    channelId: UUID,
    messageId: UUID,
    emoji: string,
  ) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}/reactions`,
      method: "POST",
      body: { emoji },
    }),

  removeReaction: (
    serverId: UUID,
    channelId: UUID,
    messageId: UUID,
    emoji: string,
  ) =>
    apiRequest<ServerMessage>({
      path: `${base(serverId)}/channels/${channelId}/messages/${messageId}/reactions`,
      method: "DELETE",
      body: { emoji },
    }),

  // Voice
  listVoice: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerVoiceParticipant[]>({
      path: `${base(serverId)}/channels/${channelId}/voice`,
    }),

  joinVoice: (
    serverId: UUID,
    channelId: UUID,
    body?: {
      muted?: boolean;
      deafened?: boolean;
      camera_enabled?: boolean;
      screen_sharing?: boolean;
    },
  ) =>
    apiRequest<ServerVoiceParticipant>({
      path: `${base(serverId)}/channels/${channelId}/voice/join`,
      method: "POST",
      body: body ?? {},
    }),

  leaveVoice: (serverId: UUID, channelId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/channels/${channelId}/voice/leave`,
      method: "POST",
    }),

  updateVoiceState: (
    serverId: UUID,
    channelId: UUID,
    body: {
      muted?: boolean | null;
      deafened?: boolean | null;
      camera_enabled?: boolean | null;
      screen_sharing?: boolean | null;
    },
  ) =>
    apiRequest<ServerVoiceParticipant>({
      path: `${base(serverId)}/channels/${channelId}/voice/state`,
      method: "PATCH",
      body,
    }),

  // Roles
  listRoles: (serverId: UUID) =>
    apiRequest<ServerRole[]>({ path: `${base(serverId)}/roles` }),

  createRole: (
    serverId: UUID,
    body: {
      name: string;
      color?: string | null;
      permissions?: string[];
      position?: number | null;
      is_mentionable?: boolean;
      hoist?: boolean;
    },
  ) =>
    apiRequest<ServerRole>({
      path: `${base(serverId)}/roles`,
      method: "POST",
      body,
    }),

  updateRole: (
    serverId: UUID,
    roleId: UUID,
    body: {
      name?: string | null;
      color?: string | null;
      permissions?: string[] | null;
      position?: number | null;
      is_mentionable?: boolean | null;
      hoist?: boolean | null;
    },
  ) =>
    apiRequest<ServerRole>({
      path: `${base(serverId)}/roles/${roleId}`,
      method: "PATCH",
      body,
    }),

  deleteRole: (serverId: UUID, roleId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/roles/${roleId}`,
      method: "DELETE",
    }),

  // Members
  listMembers: (serverId: UUID) =>
    apiRequest<ServerMember[]>({ path: `${base(serverId)}/members` }),

  updateMember: (
    serverId: UUID,
    userId: UUID,
    body: { nickname?: string | null; role_ids?: UUID[] | null },
  ) =>
    apiRequest<ServerMember>({
      path: `${base(serverId)}/members/${userId}`,
      method: "PATCH",
      body,
    }),

  kickMember: (
    serverId: UUID,
    userId: UUID,
    body?: { reason?: string | null },
  ) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/members/${userId}/kick`,
      method: "POST",
      body: body ?? {},
    }),

  banMember: (
    serverId: UUID,
    userId: UUID,
    body?: { reason?: string | null; duration_minutes?: number | null },
  ) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/members/${userId}/ban`,
      method: "POST",
      body: body ?? {},
    }),

  unbanMember: (serverId: UUID, userId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/members/${userId}/unban`,
      method: "POST",
    }),

  muteMember: (
    serverId: UUID,
    userId: UUID,
    body?: { reason?: string | null; duration_minutes?: number | null },
  ) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/members/${userId}/mute`,
      method: "POST",
      body: body ?? {},
    }),

  timeoutMember: (
    serverId: UUID,
    userId: UUID,
    body?: { reason?: string | null; duration_minutes?: number | null },
  ) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/members/${userId}/timeout`,
      method: "POST",
      body: body ?? {},
    }),

  // Invites
  listInvites: (serverId: UUID) =>
    apiRequest<ServerInvite[]>({ path: `${base(serverId)}/invites` }),

  createInvite: (
    serverId: UUID,
    body?: {
      invite_type?: ServerInviteType;
      max_uses?: number | null;
      expires_in_hours?: number | null;
      channel_id?: UUID | null;
    },
  ) =>
    apiRequest<ServerInvite>({
      path: `${base(serverId)}/invites`,
      method: "POST",
      body: body ?? {},
    }),

  revokeInvite: (serverId: UUID, inviteId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/invites/${inviteId}`,
      method: "DELETE",
    }),

  // Emojis
  listEmojis: (serverId: UUID) =>
    apiRequest<ServerEmoji[]>({ path: `${base(serverId)}/emojis` }),

  createEmoji: (serverId: UUID, body: { name: string; image_url: string }) =>
    apiRequest<ServerEmoji>({
      path: `${base(serverId)}/emojis`,
      method: "POST",
      body,
    }),

  deleteEmoji: (serverId: UUID, emojiId: UUID) =>
    apiRequest<ServerSuccess>({
      path: `${base(serverId)}/emojis/${emojiId}`,
      method: "DELETE",
    }),

  // Search & mentions
  search: (serverId: UUID, body: { q: string; limit?: number }) =>
    apiRequest<ServerSearchResult>({
      path: `${base(serverId)}/search`,
      method: "POST",
      body,
    }),

  mentionAutocomplete: (serverId: UUID, q: string, limit = 20) =>
    apiRequest<ServerMentionSuggestion[]>({
      path: `${base(serverId)}/mentions/autocomplete${qs({ q, limit })}`,
    }),
};

export const SERVER_QUERY_KEYS = {
  list: ["servers"] as const,
  sidebar: (serverId: UUID) => ["server-sidebar", serverId] as const,
  members: (serverId: UUID) => ["server-members", serverId] as const,
  messages: (serverId: UUID, channelId: UUID) =>
    ["server-messages", serverId, channelId] as const,
  voice: (serverId: UUID, channelId: UUID) =>
    ["server-voice", serverId, channelId] as const,
  invites: (serverId: UUID) => ["server-invites", serverId] as const,
  roles: (serverId: UUID) => ["server-roles", serverId] as const,
  permissions: ["server-permissions"] as const,
  invitePreview: (code: string) => ["server-invite-preview", code] as const,
  search: (serverId: UUID, q: string) =>
    ["server-search", serverId, q] as const,
  mentions: (serverId: UUID, q: string) =>
    ["server-mentions", serverId, q] as const,
};
