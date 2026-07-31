import {
  ApiError,
  apiRequest,
  uploadMediaFile,
  type UploadOptions,
} from "@/src/lib/api-client";
import type {
  ChatMessage,
  LiveLocation,
  MediaFile,
  MessageResponse,
  MutationCountResponse,
  Paginated,
  SeenByResponse,
  SendMessageRequest,
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

export interface PresenceStatus {
  user_id: UUID;
  is_online: boolean;
  last_seen_at?: string | null;
  hidden?: boolean;
}

export const messagesApi = {
  list: (chatId: UUID, page = 1, page_size = 50) =>
    apiRequest<Paginated<ChatMessage>>({
      path: `/api/v1/messages/${chatId}${qs({ page, page_size })}`,
    }),
  send: (body: SendMessageRequest) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/",
      method: "POST",
      body,
    }),
  reply: (body: {
    chat_id: UUID;
    reply_to_id: UUID;
    content?: string | null;
    type?: SendMessageRequest["type"];
    media_id?: string | null;
  }) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/reply",
      method: "POST",
      body,
    }),
  forward: (message_id: UUID, target_chat_id: UUID) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/forward",
      method: "POST",
      body: { message_id, target_chat_id },
    }),
  react: (message_id: UUID, emoji: string) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/react",
      method: "POST",
      body: { message_id, emoji },
    }),
  unreact: (message_id: UUID, emoji: string) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/messages/react",
      method: "DELETE",
      body: { message_id, emoji },
    }),
  pin: (message_id: UUID) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/pin",
      method: "POST",
      body: { message_id },
    }),
  unpin: (message_id: UUID) =>
    apiRequest<ChatMessage>({
      path: "/api/v1/messages/pin",
      method: "DELETE",
      body: { message_id },
    }),
  markRead: (message_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/messages/read",
      method: "POST",
      body: { message_id },
    }),
  markDelivered: (message_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/messages/delivered",
      method: "POST",
      body: { message_id },
    }),
  seenBy: (message_id: UUID) =>
    apiRequest<SeenByResponse[]>({
      path: `/api/v1/messages/seen-by/${message_id}`,
    }),
  edit: (message_id: UUID, content: string) =>
    apiRequest<ChatMessage>({
      path: `/api/v1/messages/${message_id}`,
      method: "PATCH",
      body: { content },
    }),
  deleteForMe: (message_id: UUID) =>
    apiRequest<MessageResponse>({
      path: `/api/v1/messages/${message_id}`,
      method: "DELETE",
    }),
  deleteForEveryone: (message_id: UUID) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/messages/delete-for-everyone",
      method: "POST",
      body: { message_id },
    }),
};

export const mediaApi = {
  uploadImage: (file: File, options?: UploadOptions) =>
    uploadMediaFile<MediaFile>("/api/v1/media/upload-image", file, "file", options),
  uploadVideo: (file: File, options?: UploadOptions) =>
    uploadMediaFile<MediaFile>("/api/v1/media/upload-video", file, "file", options),
  uploadDocument: (file: File, options?: UploadOptions) =>
    uploadMediaFile<MediaFile>("/api/v1/media/upload-document", file, "file", options),
  uploadVoice: (file: File, options?: UploadOptions) =>
    uploadMediaFile<MediaFile>("/api/v1/media/upload-voice", file, "file", options),
  get: (fileId: UUID) =>
    apiRequest<MediaFile>({ path: `/api/v1/media/${fileId}` }),
  remove: (fileId: UUID) =>
    apiRequest<MessageResponse>({
      path: `/api/v1/media/${fileId}`,
      method: "DELETE",
    }),
};

export const presenceApi = {
  online: (ttl_seconds = 90) =>
    apiRequest<PresenceStatus>({
      path: "/api/v1/presence/online",
      method: "POST",
      body: { ttl_seconds },
    }),
  offline: () =>
    apiRequest<PresenceStatus>({
      path: "/api/v1/presence/offline",
      method: "POST",
    }),
  status: (userId: UUID) =>
    apiRequest<PresenceStatus>({
      path: `/api/v1/presence/status/${userId}`,
    }),
};

export const locationApi = {
  shareLive: (body: {
    chat_id?: string | null;
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    duration_minutes?: number;
  }) =>
    apiRequest<LiveLocation>({
      path: "/api/v1/location/share-live",
      method: "POST",
      body,
    }),
  stopSharing: () =>
    apiRequest<MutationCountResponse>({
      path: "/api/v1/location/stop-sharing",
      method: "POST",
    }),
  get: (userId: UUID) =>
    apiRequest<LiveLocation>({
      path: `/api/v1/location/${userId}`,
    }),
};

export function detectMediaKind(
  file: File,
): "image" | "video" | "document" | "voice" {
  const type = file.type.toLowerCase();
  if (
    type === "image/jpeg" ||
    type === "image/png" ||
    type === "image/gif" ||
    type === "image/webp" ||
    type === "image/heic"
  ) {
    return "image";
  }
  if (
    type === "video/mp4" ||
    type === "video/webm" ||
    type === "video/quicktime" ||
    type === "video/x-msvideo"
  ) {
    return "video";
  }
  if (
    type === "audio/mpeg" ||
    type === "audio/mp4" ||
    type === "audio/ogg" ||
    type === "audio/wav" ||
    type === "audio/webm" ||
    type === "audio/aac"
  ) {
    return "voice";
  }
  if (
    type === "application/pdf" ||
    type === "application/msword" ||
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "application/vnd.ms-excel" ||
    type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "text/plain" ||
    type === "application/zip"
  ) {
    return "document";
  }
  throw new ApiError(
    422,
    "validation_error",
    `Unsupported file type${type ? ` (${type})` : ""}.`,
  );
}

export async function uploadByKind(file: File, options?: UploadOptions) {
  const kind = detectMediaKind(file);
  if (kind === "image") return { kind, media: await mediaApi.uploadImage(file, options) };
  if (kind === "video") return { kind, media: await mediaApi.uploadVideo(file, options) };
  if (kind === "voice") return { kind, media: await mediaApi.uploadVoice(file, options) };
  return { kind, media: await mediaApi.uploadDocument(file, options) };
}
