import type { ISODate, UUID } from "@/src/types/api";

export type StatusKind = "image" | "video" | "text" | "voice";
export type StatusSection = "recent" | "viewed" | "muted";
export type StatusVisibility = "friends" | "friends_and_groups";

export interface StatusAuthor {
  id: UUID;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface StatusRecord {
  id: UUID;
  author: StatusAuthor;
  kind: StatusKind;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  emoji: string | null;
  backgroundColor: string | null;
  visibility: StatusVisibility;
  createdAt: ISODate;
  expiresAt: ISODate;
  viewedAt: ISODate | null;
  viewerCount: number | null;
  likeCount: number | null;
  replyCount: number | null;
  likedByMe: boolean | null;
  isMuted: boolean;
  isOwn: boolean;
}

export interface StatusViewerRecord {
  user: StatusAuthor;
  viewedAt: ISODate;
  liked: boolean;
  replied: boolean;
}

export interface StatusReply {
  id: UUID;
  author: StatusAuthor;
  text: string;
  createdAt: ISODate;
}

export interface StatusAuthorGroup {
  author: StatusAuthor;
  statuses: StatusRecord[];
  section: StatusSection;
  unseenCount: number;
  latestAt: ISODate;
}

export interface StatusDraft {
  kind: StatusKind;
  text: string;
  caption: string;
  emoji: string;
  backgroundColor: string;
  visibility: StatusVisibility;
  file: File | null;
  previewUrl: string | null;
}
