export type UUID = string;
export type ISODate = string;

export interface ApiErrorDetail {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
  request_id?: string;
}

export interface MessageResponse {
  success: boolean;
  message: string;
}

export interface AuthUser {
  id: UUID;
  email: string;
  username: string;
  role: string;
  status: string;
  is_email_verified: boolean;
  created_at: ISODate;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: "bearer";
  expires_in: number;
}

export interface LoginResponse {
  success: boolean;
  tokens: TokenResponse;
  user: AuthUser;
}

export interface RendererLoginResponse {
  success: boolean;
  user: AuthUser;
}

export interface SignupRequest {
  email: string;
  password: string;
  username: string;
}

/** Password-reset code generation response. */
export interface OtpGenerationResponse {
  success?: boolean;
  message: string;
  development?: boolean;
  otp?: string;
  expires_in?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UsernameAvailability {
  available: boolean;
  username: string;
  reason: string | null;
}

export interface PasswordResetConfirmRequest {
  email: string;
  otp: string;
  new_password: string;
}

export interface UserDetail extends AuthUser {
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  updated_at: ISODate;
}

export interface ProfileDetail {
  id: UUID;
  user_id: UUID;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  status_message: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  phone: string | null;
}

export type ThemePreference = "light" | "dark" | "system";
export type AudiencePreference = "everyone" | "friends" | "nobody";

export interface Settings {
  two_factor_enabled: boolean;
  login_alerts: boolean;
  notifications_enabled: boolean;
  message_notifications: boolean;
  group_notifications: boolean;
  call_notifications: boolean;
  mention_notifications: boolean;
  notification_sound: boolean;
  show_last_seen: boolean;
  show_online_status: boolean;
  show_read_receipts: boolean;
  show_profile_photo: string;
  who_can_message: string;
  who_can_add_to_groups: string;
  theme: string;
  language: string;
  extra: Record<string, unknown> | null;
}

export type NotificationSettingsUpdate = Partial<
  Pick<
    Settings,
    | "notifications_enabled"
    | "message_notifications"
    | "group_notifications"
    | "call_notifications"
    | "mention_notifications"
    | "notification_sound"
  >
>;

export type PrivacySettingsUpdate = Partial<
  Pick<
    Settings,
    | "show_last_seen"
    | "show_online_status"
    | "show_read_receipts"
    | "show_profile_photo"
    | "who_can_message"
    | "who_can_add_to_groups"
  >
>;

export interface LocalPreferences {
  accent:
    | "purple"
    | "blue"
    | "emerald"
    | "orange"
    | "red"
    | "rose"
    | "pink"
    | "teal";
  friend_request_notifications: boolean;
  who_can_send_friend_requests: AudiencePreference;
  completed_onboarding_user_ids: UUID[];
  wallpaper_url?: string | null;
  profile_cover_url?: string | null;
  reduce_motion?: boolean;
  high_contrast?: boolean;
  font_scale?: number;
  popup_duration?: number;
}

export interface TransportError {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  requestId?: string;
}

export interface TransportResult<T> {
  ok: boolean;
  data?: T;
  error?: TransportError;
}

export interface ApiRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  remember?: boolean;
}

export interface Paginated<T> {
  success?: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface UserPublic {
  id: UUID;
  username: string;
  display_name?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  is_online: boolean;
  last_seen_at?: string | null;
  created_at: ISODate;
}

export interface FriendRequest {
  id: UUID;
  from_user_id: UUID;
  to_user_id: UUID;
  status: string;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface ChatListItem {
  id: UUID;
  type: "direct" | "group" | string;
  title: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_archived: boolean;
  is_favorite: boolean;
  is_muted: boolean;
  muted_until: string | null;
  unread_count: number;
  participant_count: number;
  updated_at: ISODate;
}

export interface ChatParticipant {
  user_id: UUID;
  username: string;
  is_online: boolean;
  joined_at: ISODate;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface ChatDetail {
  id: UUID;
  type: "direct" | "group" | string;
  title: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  is_active: boolean;
  is_archived: boolean;
  is_favorite: boolean;
  is_muted: boolean;
  muted_until: string | null;
  unread_count: number;
  created_at: ISODate;
  updated_at: ISODate;
  participants: ChatParticipant[];
}

export interface CreateChatRequest {
  participant_username: string;
  title?: string | null;
}

export interface ProfilePublic {
  id: UUID;
  user_id: UUID;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  status_message: string | null;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface UserSearchResult {
  id: UUID;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface GroupSearchResult {
  id: UUID;
  name: string;
  description: string | null;
  avatar_url: string | null;
  member_count: number;
  visibility: string;
}

export interface MessageSearchResult {
  id: UUID;
  chat_id: UUID;
  sender_id: UUID;
  content: string;
  created_at: ISODate;
}

export interface FileSearchResult {
  id: UUID;
  chat_id: UUID;
  uploader_id: UUID;
  filename: string;
  url: string;
  content_type: string;
  bytes: number;
  created_at: ISODate;
}

export type GroupVisibility = "public" | "private";
export type GroupMemberRole = "member" | "admin" | "owner";

export interface GroupSummary {
  id: UUID;
  name: string;
  description: string | null;
  avatar_url: string | null;
  visibility: GroupVisibility | string;
  invite_code: string;
  owner_id: UUID;
  member_count: number;
  max_members: number;
  is_active: boolean;
  created_at: ISODate;
}

export interface SeenByResponse {
  user_id: UUID;
  username: string;
  delivered_at: ISODate | null;
  read_at: ISODate | null;
}

export interface GroupInvite {
  id: UUID;
  group_id: UUID;
  invited_by_id: UUID;
  invited_user_id: string | null;
  email: string | null;
  token: string;
  expires_at: ISODate;
}

export interface GroupAnnouncement {
  id: UUID;
  group_id: UUID;
  author_id: UUID;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: ISODate;
}

export interface GroupPollOption {
  id: UUID;
  text: string;
  vote_count: number;
  position: number;
}

export interface GroupPoll {
  id: UUID;
  group_id: UUID;
  author_id: UUID;
  question: string;
  is_anonymous: boolean;
  allows_multiple: boolean;
  closes_at: string | null;
  is_closed: boolean;
  options: GroupPollOption[];
  created_at: ISODate;
}

export type NotificationType =
  | "message"
  | "friend_request"
  | "friend_accepted"
  | "group_invite"
  | "group_announcement"
  | "call"
  | "mention"
  | "system"
  | "reaction"
  | "status"
  | string;

export interface AppNotification {
  id: UUID;
  actor_id: UUID | null;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: ISODate;
}

export interface NotificationListResponse {
  items: AppNotification[];
  total: number;
  unread_count: number;
}

export interface MutationCountResponse {
  success?: boolean;
  updated: number;
}

export type CallType = "audio" | "voice" | "video";
export type CallStatus =
  | "ringing"
  | "accepted"
  | "active"
  | "rejected"
  | "declined"
  | "cancelled"
  | "ended"
  | "missed"
  | "failed";

export interface CallParticipant {
  id: UUID;
  user_id: UUID;
  joined_at: ISODate | null;
  left_at: ISODate | null;
  is_muted: boolean;
  is_video_enabled: boolean;
  is_screen_sharing?: boolean;
}

export interface Call {
  id: UUID;
  chat_id: UUID | null;
  group_id: UUID | null;
  initiator_id: UUID;
  caller_id?: UUID;
  receiver_id?: UUID | null;
  type: CallType;
  status: CallStatus;
  started_at: ISODate | null;
  answered_at?: ISODate | null;
  ended_at: ISODate | null;
  duration_seconds: number | null;
  ended_by?: UUID | null;
  room_id: string;
  is_group_call: boolean;
  video_enabled: boolean;
  failure_reason?: string | null;
  participants: CallParticipant[];
  created_at: ISODate;
  updated_at?: ISODate | null;
}

export interface IceServersResponse {
  iceServers: Array<{
    urls: string | string[];
    username?: string | null;
    credential?: string | null;
  }>;
}

export interface ActiveCallResponse {
  success?: boolean;
  call: Call | null;
}

export interface SpeechToTextResult {
  available: boolean;
  text?: string | null;
  language?: string | null;
  message?: string | null;
  source?: "groq" | "configuration";
}

export interface SemanticMatch {
  index: number;
  text: string;
  relevance: number;
}

export interface SemanticSearchResult {
  matches: SemanticMatch[];
}

export type ShellPage =
  | "home"
  | "chats"
  | "status"
  | "friends"
  | "search"
  | "ai"
  | "groups"
  | "servers"
  | "calls"
  | "notifications"
  | "settings"
  | "profile";

export type ChatFilter = "all" | "unread" | "favorites" | "archived" | "muted";
export type ChatSort = "recent" | "unread" | "name";
export type FriendsTab =
  | "friends"
  | "incoming"
  | "outgoing"
  | "discover"
  | "blocked";

export type ChatMessageType =
  | "text"
  | "image"
  | "video"
  | "document"
  | "voice"
  | "location"
  | "system"
  | "poll"
  | "announcement";

export interface MessageSender {
  id: UUID;
  username: string;
}

export interface MessageReaction {
  user_id: UUID;
  emoji: string;
  created_at: ISODate;
}

export interface ReplyPreview {
  id: UUID;
  sender_id: UUID;
  type: ChatMessageType | string;
  content: string | null;
  is_deleted: boolean;
  deleted_for_everyone: boolean;
}

export interface ChatMessage {
  id: UUID;
  chat_id: UUID;
  sender: MessageSender;
  type: ChatMessageType | string;
  content: string | null;
  media_id: string | null;
  reply_to: ReplyPreview | null;
  forwarded_from_id: string | null;
  is_edited: boolean;
  edited_at: string | null;
  is_deleted: boolean;
  deleted_for_everyone: boolean;
  deleted_at: string | null;
  is_pinned: boolean;
  reactions: MessageReaction[];
  delivered_count: number;
  read_count: number;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface SendMessageRequest {
  chat_id: UUID;
  content?: string | null;
  type?: ChatMessageType;
  media_id?: string | null;
  reply_to_id?: string | null;
}

export interface MediaFile {
  id: UUID;
  uploader_id: UUID;
  kind: "image" | "video" | "document" | "voice" | "profile" | string;
  public_id: string;
  url: string;
  resource_type: string;
  format: string | null;
  content_type: string | null;
  original_filename: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  chat_id: string | null;
  created_at: ISODate;
}

export interface LiveLocation {
  id: UUID;
  user_id: UUID;
  chat_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  is_active: boolean;
  started_at: ISODate;
  expires_at: ISODate;
  last_updated_at: ISODate;
}

export interface WsEvent {
  id: UUID;
  type: string;
  sender_id: UUID | null;
  room: string | null;
  payload: Record<string, unknown>;
  timestamp: ISODate;
}
