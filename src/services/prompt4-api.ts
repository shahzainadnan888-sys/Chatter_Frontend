import { apiRequest, uploadMediaFile } from "@/src/lib/api-client";
import type {
  ActiveCallResponse,
  Call,
  CallType,
  IceServersResponse,
  MessageResponse,
  NotificationSettingsUpdate,
  PrivacySettingsUpdate,
  ProfileDetail,
  SemanticSearchResult,
  Settings,
  SpeechToTextResult,
  ThemePreference,
  UUID,
  UserDetail,
} from "@/src/types/api";

export const callsApi = {
  iceServers: () =>
    apiRequest<IceServersResponse>({
      path: "/api/v1/calls/ice-servers",
    }),
  start: (body: {
    chat_id?: UUID | null;
    group_id?: UUID | null;
    receiver_id?: UUID | null;
    type?: CallType;
    call_type?: "voice" | "video";
  }) =>
    apiRequest<Call>({
      path: "/api/v1/calls/start",
      method: "POST",
      body,
    }),
  accept: (call_id: UUID, reason?: string) =>
    apiRequest<Call>({
      path: "/api/v1/calls/accept",
      method: "POST",
      body: { call_id, reason },
    }),
  reject: (call_id: UUID, reason?: string) =>
    apiRequest<Call>({
      path: "/api/v1/calls/reject",
      method: "POST",
      body: { call_id, reason },
    }),
  cancel: (call_id: UUID, reason?: string) =>
    apiRequest<Call>({
      path: "/api/v1/calls/cancel",
      method: "POST",
      body: { call_id, reason },
    }),
  join: (call_id: UUID) =>
    apiRequest<Call>({
      path: "/api/v1/calls/join",
      method: "POST",
      body: { call_id },
    }),
  end: (call_id: UUID, reason?: string) =>
    apiRequest<Call>({
      path: "/api/v1/calls/end",
      method: "POST",
      body: { call_id, reason },
    }),
  active: () =>
    apiRequest<ActiveCallResponse>({
      path: "/api/v1/calls/active",
    }),
  history: (page = 1, page_size = 20) =>
    apiRequest<Call[]>({
      path: `/api/v1/calls/history?page=${page}&page_size=${page_size}`,
    }),
  mute: (call_id: UUID) =>
    apiRequest<Call>({
      path: "/api/v1/calls/mute",
      method: "POST",
      body: { call_id },
    }),
  unmute: (call_id: UUID) =>
    apiRequest<Call>({
      path: "/api/v1/calls/unmute",
      method: "POST",
      body: { call_id },
    }),
  startVideo: (call_id: UUID) =>
    apiRequest<Call>({
      path: "/api/v1/calls/video/start",
      method: "POST",
      body: { call_id },
    }),
  endVideo: (call_id: UUID) =>
    apiRequest<Call>({
      path: "/api/v1/calls/video/end",
      method: "POST",
      body: { call_id },
    }),
};

export const aiApi = {
  speechToText: (audio: File) =>
    uploadMediaFile<SpeechToTextResult>(
      "/api/v1/ai/speech-to-text",
      audio,
      "audio",
    ),
  suggestReplies: (messages: string[], count = 3, tone = "natural") =>
    apiRequest<{ replies: string[] }>({
      path: "/api/v1/ai/suggest-replies",
      method: "POST",
      body: { messages, count, tone },
    }),
  rewrite: (text: string, tone = "clear and natural") =>
    apiRequest<{ result: string }>({
      path: "/api/v1/ai/rewrite",
      method: "POST",
      body: { text, tone },
    }),
  translate: (text: string, target_language: string) =>
    apiRequest<{ result: string }>({
      path: "/api/v1/ai/translate",
      method: "POST",
      body: { text, target_language },
    }),
  summarize: (messages: string[], max_words = 150) =>
    apiRequest<{ result: string }>({
      path: "/api/v1/ai/summarize-chat",
      method: "POST",
      body: { messages, max_words },
    }),
  semanticSearch: (query: string, texts: string[], limit = 10) =>
    apiRequest<SemanticSearchResult>({
      path: "/api/v1/ai/search",
      method: "POST",
      body: { query, texts, limit },
    }),
  generateImage: (prompt: string, width = 1024, height = 1024) =>
    apiRequest<{ success: boolean; image_url: string }>({
      path: "/api/v1/ai/image",
      method: "POST",
      body: { prompt, width, height },
    }),
};

export const prompt4SettingsApi = {
  get: () => apiRequest<Settings>({ path: "/api/v1/settings/" }),
  update: (body: Partial<Settings>) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/",
      method: "PATCH",
      body,
    }),
  privacy: (body: PrivacySettingsUpdate) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/privacy",
      method: "PATCH",
      body,
    }),
  theme: (body: { theme?: ThemePreference | null; language?: string | null }) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/theme",
      method: "PATCH",
      body,
    }),
  notifications: (body: NotificationSettingsUpdate) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/notifications",
      method: "PATCH",
      body,
    }),
  security: (body: {
    two_factor_enabled?: boolean | null;
    login_alerts?: boolean | null;
  }) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/security",
      method: "PATCH",
      body,
    }),
};

export const profileApi = {
  me: () => apiRequest<ProfileDetail>({ path: "/api/v1/profiles/me" }),
  update: (body: {
    display_name?: string | null;
    bio?: string | null;
    status_message?: string | null;
    phone?: string | null;
  }) =>
    apiRequest<ProfileDetail>({
      path: "/api/v1/profiles/me",
      method: "PATCH",
      body,
    }),
  updateUsername: (username: string) =>
    apiRequest<UserDetail>({
      path: "/api/v1/users/me/username",
      method: "PATCH",
      body: { username },
    }),
  uploadAvatar: (file: File) =>
    uploadMediaFile<ProfileDetail>("/api/v1/profiles/me/avatar", file),
  removeAvatar: () =>
    apiRequest<ProfileDetail>({
      path: "/api/v1/profiles/me/avatar",
      method: "DELETE",
    }),
  changePassword: (current_password: string, new_password: string) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/auth/change-password",
      method: "POST",
      body: { current_password, new_password },
    }),
};
