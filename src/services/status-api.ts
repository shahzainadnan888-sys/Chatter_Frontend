import {
  apiRequest,
  resolveApiAssetUrl,
  type UploadOptions,
} from "@/src/lib/api-client";
import { mediaApi } from "@/src/services/messaging-api";
import type {
  StatusAuthor,
  StatusAuthorGroup,
  StatusDraft,
  StatusKind,
  StatusRecord,
  StatusReply,
  StatusSection,
  StatusViewerRecord,
  StatusVisibility,
} from "@/src/features/status/status-types";
import type { UUID } from "@/src/types/api";

/** Wire format from API.md Status module (snake_case). */
interface StatusAuthorDto {
  id: UUID;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface StatusResponseDto {
  id: UUID;
  author: StatusAuthorDto;
  kind: StatusKind | string;
  media_type?: StatusKind | string;
  text: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  emoji: string | null;
  background_color: string | null;
  visibility: StatusVisibility | string;
  created_at: string;
  expires_at: string;
  viewed_at: string | null;
  viewer_count: number;
  like_count: number;
  reply_count: number;
  liked_by_me: boolean;
  is_muted: boolean;
  is_own: boolean;
}

interface StatusFeedGroupDto {
  author: StatusAuthorDto;
  statuses: StatusResponseDto[];
  section: StatusSection | string;
  unseen_count: number;
  latest_at: string;
}

interface StatusListResponseDto {
  success?: boolean;
  data: StatusResponseDto[];
}

interface StatusFeedResponseDto {
  success?: boolean;
  data: StatusFeedGroupDto[];
}

interface StatusViewerDto {
  user: StatusAuthorDto;
  viewed_at: string;
  liked: boolean;
  replied: boolean;
}

interface StatusReplyDto {
  id: UUID;
  author: StatusAuthorDto;
  text: string;
  created_at: string;
}

interface StatusDeleteResponseDto {
  success: boolean;
  message: string;
}

interface SuccessDto {
  success: boolean;
}

function mapAuthor(dto: StatusAuthorDto): StatusAuthor {
  return {
    id: dto.id,
    username: dto.username,
    displayName: dto.display_name,
    avatarUrl: dto.avatar_url ? resolveApiAssetUrl(dto.avatar_url) : null,
  };
}

function mapKind(value: string | undefined): StatusKind {
  if (value === "image" || value === "video" || value === "voice" || value === "text") {
    return value;
  }
  return "text";
}

function mapVisibility(value: string | undefined): StatusVisibility {
  return value === "friends" ? "friends" : "friends_and_groups";
}

function mapSection(value: string | undefined): StatusSection {
  if (value === "viewed" || value === "muted") return value;
  return "recent";
}

export function mapStatusResponse(dto: StatusResponseDto): StatusRecord {
  const kind = mapKind(dto.media_type ?? dto.kind);
  return {
    id: dto.id,
    author: mapAuthor(dto.author),
    kind,
    text: dto.text,
    mediaUrl: dto.media_url ? resolveApiAssetUrl(dto.media_url) : null,
    thumbnailUrl: dto.thumbnail_url
      ? resolveApiAssetUrl(dto.thumbnail_url)
      : null,
    caption: dto.caption,
    emoji: dto.emoji,
    backgroundColor: dto.background_color,
    visibility: mapVisibility(dto.visibility),
    createdAt: dto.created_at,
    expiresAt: dto.expires_at,
    viewedAt: dto.viewed_at,
    viewerCount: dto.viewer_count,
    likeCount: dto.like_count,
    replyCount: dto.reply_count,
    likedByMe: dto.liked_by_me,
    isMuted: dto.is_muted,
    isOwn: dto.is_own,
  };
}

function mapFeedGroup(dto: StatusFeedGroupDto): StatusAuthorGroup {
  return {
    author: mapAuthor(dto.author),
    statuses: dto.statuses.map(mapStatusResponse),
    section: mapSection(dto.section),
    unseenCount: dto.unseen_count,
    latestAt: dto.latest_at,
  };
}

function mapReply(dto: StatusReplyDto): StatusReply {
  return {
    id: dto.id,
    author: mapAuthor(dto.author),
    text: dto.text,
    createdAt: dto.created_at,
  };
}

function mapViewer(dto: StatusViewerDto): StatusViewerRecord {
  return {
    user: mapAuthor(dto.user),
    viewedAt: dto.viewed_at,
    liked: dto.liked,
    replied: dto.replied,
  };
}

async function createFromMediaId(
  draft: StatusDraft,
  mediaId: UUID | null,
): Promise<StatusRecord> {
  const body = {
    media_type: draft.kind,
    kind: draft.kind,
    caption: draft.caption.trim() || null,
    text: draft.kind === "text" ? draft.text.trim() || null : null,
    emoji: draft.emoji || null,
    background_color:
      draft.kind === "text" ? draft.backgroundColor || null : null,
    media_id: mediaId,
    media_url: null,
    thumbnail_url: null,
    visibility: draft.visibility,
  };
  const response = await apiRequest<StatusResponseDto>({
    path: "/api/v1/status/json",
    method: "POST",
    body,
  });
  return mapStatusResponse(response);
}

export const statusApi = {
  myStatuses: async (): Promise<StatusRecord[]> => {
    const response = await apiRequest<StatusListResponseDto>({
      path: "/api/v1/status/me",
    });
    return (response.data ?? []).map(mapStatusResponse);
  },

  feed: async (): Promise<StatusAuthorGroup[]> => {
    const response = await apiRequest<StatusFeedResponseDto>({
      path: "/api/v1/status/feed",
    });
    return (response.data ?? []).map(mapFeedGroup);
  },

  get: async (statusId: UUID): Promise<StatusRecord> => {
    const response = await apiRequest<StatusResponseDto>({
      path: `/api/v1/status/${statusId}`,
    });
    return mapStatusResponse(response);
  },

  create: async (
    draft: StatusDraft,
    options: UploadOptions = {},
  ): Promise<StatusRecord> => {
    options.onProgress?.(5);
    if (!draft.file) {
      options.onProgress?.(40);
      const created = await createFromMediaId(draft, null);
      options.onProgress?.(100);
      return created;
    }

    const upload =
      draft.kind === "video"
        ? mediaApi.uploadVideo
        : draft.kind === "voice"
          ? mediaApi.uploadVoice
          : mediaApi.uploadImage;

    const media = await upload(draft.file, {
      signal: options.signal,
      onProgress: (pct) => options.onProgress?.(Math.min(85, Math.round(pct * 0.85))),
    });
    options.onProgress?.(90);
    const created = await createFromMediaId(draft, media.id);
    options.onProgress?.(100);
    return created;
  },

  remove: async (statusId: UUID): Promise<void> => {
    await apiRequest<StatusDeleteResponseDto>({
      path: `/api/v1/status/${statusId}`,
      method: "DELETE",
    });
  },

  archive: async (statusId: UUID): Promise<StatusRecord> => {
    const response = await apiRequest<StatusResponseDto>({
      path: `/api/v1/status/${statusId}/archive`,
      method: "POST",
    });
    return mapStatusResponse(response);
  },

  markViewed: async (statusId: UUID): Promise<void> => {
    await apiRequest<SuccessDto>({
      path: "/api/v1/status/view",
      method: "POST",
      body: { status_id: statusId },
    });
  },

  react: async (statusId: UUID, emoji = "❤️"): Promise<StatusRecord> => {
    const response = await apiRequest<StatusResponseDto>({
      path: "/api/v1/status/react",
      method: "POST",
      body: { status_id: statusId, emoji },
    });
    return mapStatusResponse(response);
  },

  unreact: async (statusId: UUID): Promise<StatusRecord> => {
    const response = await apiRequest<StatusResponseDto>({
      path: "/api/v1/status/unreact",
      method: "POST",
      body: { status_id: statusId },
    });
    return mapStatusResponse(response);
  },

  reply: async (statusId: UUID, message: string): Promise<StatusReply> => {
    const response = await apiRequest<StatusReplyDto>({
      path: "/api/v1/status/reply",
      method: "POST",
      body: { status_id: statusId, message },
    });
    return mapReply(response);
  },

  viewers: async (statusId: UUID): Promise<StatusViewerRecord[]> => {
    const response = await apiRequest<StatusViewerDto[]>({
      path: `/api/v1/status/viewers/${statusId}`,
    });
    return (response ?? []).map(mapViewer);
  },

  mute: async (authorId: UUID): Promise<void> => {
    await apiRequest<SuccessDto>({
      path: `/api/v1/status/mute/${authorId}`,
      method: "POST",
    });
  },

  unmute: async (authorId: UUID): Promise<void> => {
    await apiRequest<SuccessDto>({
      path: `/api/v1/status/unmute/${authorId}`,
      method: "POST",
    });
  },
};

export const STATUS_QUERY_KEYS = {
  me: ["status-me"] as const,
  feed: ["status-feed"] as const,
  viewers: (statusId: UUID) => ["status-viewers", statusId] as const,
  detail: (statusId: UUID) => ["status", statusId] as const,
};

export function invalidateStatusQueries(
  invalidate: (options: { queryKey: readonly unknown[] }) => unknown,
) {
  void invalidate({ queryKey: STATUS_QUERY_KEYS.me });
  void invalidate({ queryKey: STATUS_QUERY_KEYS.feed });
}
