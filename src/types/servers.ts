import type { ISODate, UUID } from "@/src/types/api";

export type ServerChannelType =
  | "text"
  | "voice"
  | "video"
  | "announcement"
  | "stage"
  | "read_only";

export type ServerVerificationLevel = "none" | "low" | "medium" | "high";
export type ServerDefaultNotifications = "all" | "mentions" | "nothing";
export type ServerInviteType = "permanent" | "expiring" | "limited_use";
export type ServerMemberStatus =
  | "active"
  | "muted"
  | "timeout"
  | "banned"
  | "left";

export type ServerPermissionKey =
  | "administrator"
  | "manage_server"
  | "manage_roles"
  | "manage_channels"
  | "manage_categories"
  | "manage_invites"
  | "manage_emojis"
  | "manage_voice"
  | "manage_stage"
  | "kick_members"
  | "ban_members"
  | "mute_members"
  | "timeout_members"
  | "delete_messages"
  | "pin_messages"
  | "mention_everyone"
  | "upload_files"
  | "send_messages"
  | "read_message_history"
  | "connect_voice"
  | "speak"
  | "video"
  | "view_channels"
  | "create_invite"
  | "change_nickname"
  | "manage_nicknames"
  | string;

export interface ServerUserBrief {
  id: UUID;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_online: boolean;
}

export interface Server {
  id: UUID;
  name: string;
  description: string | null;
  icon_url: string | null;
  banner_url: string | null;
  owner_id: UUID;
  invite_code: string;
  verification_level: ServerVerificationLevel;
  default_notifications: ServerDefaultNotifications;
  is_public: boolean;
  member_count: number;
  created_at: ISODate;
  updated_at: ISODate | null;
}

export interface ServerListItem {
  server: Server;
  unread_count: number;
  is_owner: boolean;
}

export interface ServerCategory {
  id: UUID;
  server_id: UUID;
  name: string;
  position: number;
  created_at: ISODate;
}

export interface ServerChannel {
  id: UUID;
  server_id: UUID;
  category_id: UUID | null;
  name: string;
  topic: string | null;
  type: ServerChannelType;
  position: number;
  is_nsfw: boolean;
  slowmode_seconds: number;
  bitrate: number | null;
  user_limit: number | null;
  unread_count: number;
  created_at: ISODate;
}

export interface ServerRole {
  id: UUID;
  server_id: UUID;
  name: string;
  color: string | null;
  position: number;
  permissions: string[];
  is_default: boolean;
  is_mentionable: boolean;
  hoist: boolean;
  created_at: ISODate;
}

export interface ServerMember {
  id: UUID;
  server_id: UUID;
  user: ServerUserBrief;
  nickname: string | null;
  status: ServerMemberStatus;
  joined_at: ISODate;
  muted_until: ISODate | null;
  timeout_until: ISODate | null;
  role_ids: UUID[];
  permissions: string[];
}

export interface ServerInvite {
  id: UUID;
  server_id: UUID;
  creator_id: UUID;
  code: string;
  invite_type: ServerInviteType;
  max_uses: number | null;
  uses: number;
  expires_at: ISODate | null;
  channel_id: UUID | null;
  is_active: boolean;
  created_at: ISODate;
  url: string | null;
}

export interface ServerInvitePreview {
  code: string;
  server: Server;
  member_count: number;
}

export interface ServerSidebar {
  server: Server;
  categories: ServerCategory[];
  channels: ServerChannel[];
  roles: ServerRole[];
  online_count: number;
  my_permissions: string[];
}

export interface ServerMessageReaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface ServerMessage {
  id: UUID;
  channel_id: UUID;
  author: ServerUserBrief;
  content: string | null;
  media_id: UUID | null;
  media_url: string | null;
  reply_to_id: UUID | null;
  is_edited: boolean;
  edited_at: ISODate | null;
  is_pinned: boolean;
  mentions: {
    users?: UUID[];
    roles?: UUID[];
    everyone?: boolean;
    here?: boolean;
  } | null;
  reactions: ServerMessageReaction[];
  created_at: ISODate;
}

export interface ServerVoiceParticipant {
  user: ServerUserBrief;
  muted: boolean;
  deafened: boolean;
  camera_enabled: boolean;
  screen_sharing: boolean;
  joined_at: ISODate;
}

export interface ServerMentionSuggestion {
  id: UUID;
  username: string;
  display_name: string | null;
  type: "user" | "role" | "everyone" | "here" | string;
}

export interface ServerSearchResult {
  messages: ServerMessage[];
  members: ServerMember[];
  channels: ServerChannel[];
  files: Array<Record<string, unknown>>;
}

export interface ServerEmoji {
  id: UUID;
  server_id: UUID;
  name: string;
  image_url: string;
  created_by: UUID | null;
  created_at: ISODate;
}

export interface ServerPermissionCatalogItem {
  key: string;
  name: string;
}

export interface ServerSuccess {
  success: boolean;
  message: string;
}

export type ServerSettingsTab =
  | "overview"
  | "roles"
  | "permissions"
  | "channels"
  | "members"
  | "invites"
  | "integrations"
  | "audit"
  | "moderation"
  | "danger";
