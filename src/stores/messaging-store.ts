import { create } from "zustand";
import type { ChatMessage, LiveLocation, MediaFile, UUID } from "@/src/types/api";

interface TypingUser {
  userId: UUID;
  username?: string;
  expiresAt: number;
}

interface RecordingUser {
  userId: UUID;
  expiresAt: number;
}

interface PresenceEntry {
  isOnline: boolean;
  lastSeenAt?: string | null;
}

interface ComposerAttachment {
  id: string;
  file: File;
  previewUrl?: string;
  progress: number;
  status: "pending" | "uploading" | "ready" | "error";
  error?: string;
  media?: MediaFile;
  kind: "image" | "video" | "document" | "voice";
}

export interface PendingOutboundMessage {
  id: string;
  chatId: UUID;
  content: string;
  replyToId?: UUID;
  createdAt: number;
  status: "queued" | "sending" | "failed";
  error?: string;
}

const PENDING_MESSAGES_KEY = "chatter.pending-messages.v1";

function loadPendingMessages(): PendingOutboundMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(PENDING_MESSAGES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as PendingOutboundMessage[];
    return Array.isArray(parsed)
      ? parsed.map((message) => ({
          ...message,
          status: message.status === "sending" ? "queued" : message.status,
        }))
      : [];
  } catch {
    return [];
  }
}

function persistPendingMessages(messages: PendingOutboundMessage[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(messages));
}

interface MessagingUiState {
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  searchOpen: boolean;
  searchQuery: string;
  pinnedOpen: boolean;
  moreOpen: boolean;
  forwardMessage: ChatMessage | null;
  attachments: ComposerAttachment[];
  mediaCache: Record<string, MediaFile>;
  typingByChat: Record<string, TypingUser[]>;
  recordingByChat: Record<string, RecordingUser[]>;
  presenceByUser: Record<string, PresenceEntry>;
  liveLocation: LiveLocation | null;
  wsConnected: boolean;
  offline: boolean;
  pendingQueue: PendingOutboundMessage[];
  setReplyTo: (message: ChatMessage | null) => void;
  setEditing: (message: ChatMessage | null) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setPinnedOpen: (open: boolean) => void;
  setMoreOpen: (open: boolean) => void;
  setForwardMessage: (message: ChatMessage | null) => void;
  setAttachments: (attachments: ComposerAttachment[]) => void;
  upsertAttachment: (attachment: ComposerAttachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  cacheMedia: (media: MediaFile) => void;
  setTyping: (chatId: UUID, users: TypingUser[]) => void;
  setRecording: (chatId: UUID, users: RecordingUser[]) => void;
  setPresence: (userId: UUID, entry: PresenceEntry) => void;
  setLiveLocation: (location: LiveLocation | null) => void;
  setWsConnected: (connected: boolean) => void;
  setOffline: (offline: boolean) => void;
  enqueuePending: (
    message: Omit<PendingOutboundMessage, "status"> & {
      status?: PendingOutboundMessage["status"];
    },
  ) => void;
  updatePending: (
    id: string,
    patch: Partial<Pick<PendingOutboundMessage, "status" | "error">>,
  ) => void;
  removePending: (id: string) => void;
  clearPendingQueue: () => void;
  resetMessagingUi: () => void;
  clearSessionState: () => void;
}

export type { ComposerAttachment, TypingUser };

export const useMessagingStore = create<MessagingUiState>((set) => ({
  replyTo: null,
  editing: null,
  searchOpen: false,
  searchQuery: "",
  pinnedOpen: false,
  moreOpen: false,
  forwardMessage: null,
  attachments: [],
  mediaCache: {},
  typingByChat: {},
  recordingByChat: {},
  presenceByUser: {},
  liveLocation: null,
  wsConnected: false,
  offline: false,
  pendingQueue: loadPendingMessages(),
  setReplyTo: (replyTo) => set({ replyTo, editing: null }),
  setEditing: (editing) => set({ editing, replyTo: null }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setPinnedOpen: (pinnedOpen) => set({ pinnedOpen }),
  setMoreOpen: (moreOpen) => set({ moreOpen }),
  setForwardMessage: (forwardMessage) => set({ forwardMessage }),
  setAttachments: (attachments) => set({ attachments }),
  upsertAttachment: (attachment) =>
    set((state) => {
      const index = state.attachments.findIndex((item) => item.id === attachment.id);
      if (index === -1) return { attachments: [...state.attachments, attachment] };
      const next = [...state.attachments];
      next[index] = attachment;
      return { attachments: next };
    }),
  removeAttachment: (id) =>
    set((state) => ({
      attachments: state.attachments.filter((item) => item.id !== id),
    })),
  clearAttachments: () =>
    set((state) => {
      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return { attachments: [] };
    }),
  cacheMedia: (media) =>
    set((state) => {
      const next = { ...state.mediaCache, [media.id]: media };
      const keys = Object.keys(next);
      if (keys.length > 250) {
        for (const key of keys.slice(0, keys.length - 250)) {
          delete next[key];
        }
      }
      return { mediaCache: next };
    }),
  setTyping: (chatId, users) =>
    set((state) => ({
      typingByChat: { ...state.typingByChat, [chatId]: users },
    })),
  setRecording: (chatId, users) =>
    set((state) => ({
      recordingByChat: { ...state.recordingByChat, [chatId]: users },
    })),
  setPresence: (userId, entry) =>
    set((state) => ({
      presenceByUser: { ...state.presenceByUser, [userId]: entry },
    })),
  setLiveLocation: (liveLocation) => set({ liveLocation }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setOffline: (offline) => set({ offline }),
  enqueuePending: (message) =>
    set((state) => {
      const pendingQueue = [
        ...state.pendingQueue.filter((item) => item.id !== message.id),
        { ...message, status: message.status ?? ("queued" as const) },
      ];
      persistPendingMessages(pendingQueue);
      return { pendingQueue };
    }),
  updatePending: (id, patch) =>
    set((state) => {
      const pendingQueue = state.pendingQueue.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      persistPendingMessages(pendingQueue);
      return { pendingQueue };
    }),
  removePending: (id) =>
    set((state) => {
      const pendingQueue = state.pendingQueue.filter((item) => item.id !== id);
      persistPendingMessages(pendingQueue);
      return { pendingQueue };
    }),
  clearPendingQueue: () => {
    persistPendingMessages([]);
    set({ pendingQueue: [] });
  },
  resetMessagingUi: () =>
    set((state) => {
      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return {
        replyTo: null,
        editing: null,
        searchOpen: false,
        searchQuery: "",
        pinnedOpen: false,
        moreOpen: false,
        forwardMessage: null,
        attachments: [],
      };
    }),
  clearSessionState: () => {
    persistPendingMessages([]);
    set((state) => {
      state.attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return {
        replyTo: null,
        editing: null,
        searchOpen: false,
        searchQuery: "",
        pinnedOpen: false,
        moreOpen: false,
        forwardMessage: null,
        attachments: [],
        mediaCache: {},
        typingByChat: {},
        recordingByChat: {},
        presenceByUser: {},
        liveLocation: null,
        wsConnected: false,
        pendingQueue: [],
      };
    });
  },
}));
