"use client";

import type { ReactNode } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronLeft,
  Copy,
  CornerUpLeft,
  Forward,
  Files,
  Images,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
  Users,
  Video,
  Phone,
  MapPin,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import { useStartCall } from "@/src/features/calls/call-experience";
import { MessageComposer } from "@/src/features/messaging/message-composer";
import { LiveLocationMessageCard } from "@/src/features/messaging/live-location-card";
import {
  Avatar,
  EmptyState,
} from "@/src/features/shell/shell-ui";
import {
  chatSubtitle,
  chatTitle,
  friendlyError,
} from "@/src/lib/shell-utils";
import { mapsUrl, openInMaps, parseLocationCoords } from "@/src/lib/maps";
import { flushPendingMessages } from "@/src/lib/pending-messages";
import {
  broadcastChatEvent,
  subscribeChat,
  subscribeRecording,
  subscribeTyping,
} from "@/src/lib/websocket";
import {
  locationApi,
  mediaApi,
  messagesApi,
  presenceApi,
} from "@/src/services/messaging-api";
import { chatsApi, searchApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import { useCallStore } from "@/src/stores/call-stores";
import { useMessagingStore } from "@/src/stores/messaging-store";
import {
  useLocationStore,
  useMediaStore,
} from "@/src/stores/feature-stores";
import {
  useChatStore,
  useNavigationStore,
  useProfileStore,
} from "@/src/stores/shell-stores";
import type {
  ChatMessage,
  FileSearchResult,
  MediaFile,
  Paginated,
  UUID,
} from "@/src/types/api";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const EMPTY_ACTIVITY: Array<{ userId: UUID; expiresAt: number }> = [];
type MessagePages = InfiniteData<Paginated<ChatMessage>, number>;

export function ConversationContextPanel() {
  const selectedChatId = useNavigationStore((state) => state.selectedChatId);
  const setSearchOpen = useMessagingStore((state) => state.setSearchOpen);
  const setPinnedOpen = useMessagingStore((state) => state.setPinnedOpen);
  const openGlobalSearch = useNavigationStore((state) => state.setSearchOpen);
  const openProfile = useProfileStore((state) => state.openProfile);
  const chat = useQuery({
    queryKey: ["chat-detail", selectedChatId],
    enabled: Boolean(selectedChatId),
    queryFn: () => chatsApi.get(selectedChatId!),
  });

  if (!selectedChatId) return null;

  return (
    <aside className="shell-scroll hidden h-full w-[270px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_90%,transparent)] p-3 2xl:block">
      <div className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/75 p-4 shadow-xl shadow-black/5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
          Conversation
        </p>
        <h3 className="mt-2 truncate text-sm font-semibold">
          {chat.data?.title || "Direct message"}
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {chat.data?.participants.length ?? 0} members ·{" "}
          {chat.data?.is_muted ? "Muted" : "Notifications on"}
        </p>
      </div>

      <p className="px-2 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
        Context
      </p>
      <div className="space-y-1">
        <ContextAction icon={<Search size={15} />} label="Search messages" onClick={() => setSearchOpen(true)} />
        <ContextAction icon={<Pin size={15} />} label="Pinned messages" onClick={() => setPinnedOpen(true)} />
        <ContextAction icon={<Images size={15} />} label="Shared media" onClick={() => openGlobalSearch(true)} />
        <ContextAction icon={<Files size={15} />} label="Files" onClick={() => openGlobalSearch(true)} />
      </div>

      <div className="mt-5 flex items-center justify-between px-2 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
          Members
        </p>
        <Users size={13} className="text-[var(--muted-2)]" />
      </div>
      <div className="space-y-1">
        {(chat.data?.participants ?? []).map((participant) => (
          <button
            key={participant.user_id}
            type="button"
            onClick={() => openProfile(participant.username)}
            className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition hover:bg-[var(--surface-2)]"
          >
            <Avatar
              name={participant.display_name || participant.username}
              src={participant.avatar_url}
              online={participant.is_online}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">
                {participant.display_name || participant.username}
              </span>
              <span className="block truncate text-[11px] text-[var(--muted)]">
                @{participant.username}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ContextAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface)] text-[var(--accent)]">
        {icon}
      </span>
      {label}
    </button>
  );
}

function mapCachedMessage(
  data: MessagePages | undefined,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      data: page.data.map((message) =>
        message.id === messageId ? update(message) : message,
      ),
    })),
  };
}

function upsertCachedMessage(
  data: MessagePages | undefined,
  message: ChatMessage,
  replaceId?: string,
) {
  if (!data?.pages.length) {
    return {
      pages: [
        {
          data: [message],
          total: 1,
          page: 1,
          page_size: 40,
          has_more: false,
        },
      ],
      pageParams: [1],
    };
  }
  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            data: [
              ...page.data.filter(
                (item) => item.id !== message.id && item.id !== replaceId,
              ),
              message,
            ],
          }
        : page,
    ),
  };
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "Today";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function mediaSearchTerm(type: string) {
  if (type === "voice") return "audio";
  if (type === "image") return "image";
  if (type === "video") return "video";
  return "application";
}

function searchableFileToMedia(
  file: FileSearchResult,
  kind: string,
): MediaFile {
  return {
    id: file.id,
    uploader_id: file.uploader_id,
    kind,
    public_id: "",
    url: file.url,
    resource_type: kind === "document" ? "raw" : kind,
    format: null,
    content_type: file.content_type,
    original_filename: file.filename,
    bytes: file.bytes,
    width: null,
    height: null,
    duration: null,
    chat_id: file.chat_id,
    created_at: file.created_at,
  };
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-1" aria-label="Typing">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-1.5 rounded-full bg-[var(--muted)]"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.15 }}
        />
      ))}
    </span>
  );
}

function MediaBody({
  message,
  media,
  unavailable,
  onOpen,
}: {
  message: ChatMessage;
  media?: MediaFile;
  unavailable?: boolean;
  onOpen?: () => void;
}) {
  if (!media) {
    return (
      <p className="text-xs text-[var(--muted)]">
        {unavailable
          ? "This attachment could not be loaded. Try reopening the conversation."
          : message.type === "voice"
            ? "Voice message"
            : message.type === "image"
              ? "Image"
              : message.type === "video"
                ? "Video"
                : "Attachment"}
      </p>
    );
  }
  if (message.type === "image" || media.kind === "image") {
    return (
      <button type="button" onClick={onOpen} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.original_filename || "Image"}
          loading="lazy"
          decoding="async"
          className="max-h-[440px] max-w-full rounded-2xl object-cover"
        />
      </button>
    );
  }
  if (message.type === "video" || media.kind === "video") {
    return (
      <button type="button" onClick={onOpen} className="block">
        <video
          src={media.url}
          muted
          preload="metadata"
          className="max-h-[440px] max-w-full rounded-2xl"
        />
      </button>
    );
  }
  if (message.type === "voice" || media.kind === "voice") {
    return (
      <audio
        src={media.url}
        controls
        className="h-11 w-[min(520px,70vw)] max-w-full"
      />
    );
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm underline-offset-2 hover:underline"
    >
      {media.original_filename || "Document"}
      <span className="text-xs text-[var(--muted)]">
        {Math.max(1, Math.round(media.bytes / 1024))} KB
      </span>
    </a>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  showAvatar,
  peerName,
}: {
  message: ChatMessage;
  mine: boolean;
  showAvatar: boolean;
  peerName?: string;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const setReplyTo = useMessagingStore((state) => state.setReplyTo);
  const setEditing = useMessagingStore((state) => state.setEditing);
  const setForwardMessage = useMessagingStore((state) => state.setForwardMessage);
  const media = useMessagingStore((state) =>
    message.media_id ? state.mediaCache[message.media_id] : undefined,
  );
  const cacheMedia = useMessagingStore((state) => state.cacheMedia);
  const openMedia = useMediaStore((state) => state.openMedia);
  const currentUser = useAuthStore((state) => state.user);
  const ownsMedia = Boolean(
    message.media_id && currentUser?.id && message.sender.id === currentUser.id,
  );

  const mediaQuery = useQuery({
    queryKey: ["media", message.media_id],
    // Direct GET is uploader-only per API.md — only fetch for own media.
    enabled: Boolean(message.media_id) && ownsMedia && !media,
    queryFn: () => mediaApi.get(message.media_id!),
    staleTime: 300_000,
    retry: false,
  });
  const sharedMediaQuery = useQuery({
    queryKey: ["shared-chat-media", message.chat_id, message.type],
    enabled: Boolean(message.media_id) && !ownsMedia && !media,
    queryFn: () => searchApi.files(mediaSearchTerm(message.type), 100),
    staleTime: 300_000,
    retry: 1,
  });
  const sharedFile = sharedMediaQuery.data?.find(
    (file) =>
      file.id === message.media_id && file.chat_id === message.chat_id,
  );
  const sharedMedia = useMemo(
    () =>
      sharedFile
        ? searchableFileToMedia(sharedFile, message.type)
        : undefined,
    [message.type, sharedFile],
  );

  useEffect(() => {
    if (mediaQuery.data) cacheMedia(mediaQuery.data);
  }, [mediaQuery.data, cacheMedia]);

  useEffect(() => {
    if (sharedMedia) cacheMedia(sharedMedia);
  }, [cacheMedia, sharedMedia]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        moreButtonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const closeMenu = () => setMenuOpen(false);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menuOpen]);

  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const button = moreButtonRef.current;
    if (!button) return;
    const bounds = button.getBoundingClientRect();
    const menuWidth = 192;
    const menuHeight = mine ? 224 : 152;
    const spaceBelow = window.innerHeight - bounds.bottom;
    const openAbove = spaceBelow < menuHeight + 12 && bounds.top > menuHeight + 12;
    setMenuPosition({
      left: Math.max(
        8,
        Math.min(
          mine ? bounds.right - menuWidth : bounds.left,
          window.innerWidth - menuWidth - 8,
        ),
      ),
      top: Math.max(
        8,
        openAbove ? bounds.top - menuHeight - 6 : bounds.bottom + 6,
      ),
    });
    setMenuOpen(true);
  }

  const resolvedMedia = media || mediaQuery.data || sharedMedia;
  const mediaUnavailable =
    Boolean(message.media_id) &&
    !resolvedMedia &&
    !mediaQuery.isLoading &&
    !sharedMediaQuery.isLoading;

  const action = useMutation({
    mutationFn: async (input: {
      type:
        | "react"
        | "unreact"
        | "pin"
        | "unpin"
        | "delete-me"
        | "delete-everyone"
        | "copy";
      emoji?: string;
    }) => {
      const { type, emoji } = input;
      if (type === "copy") {
        await navigator.clipboard.writeText(message.content || "");
        return null;
      }
      if (type === "react" && emoji) return messagesApi.react(message.id, emoji);
      if (type === "unreact" && emoji) return messagesApi.unreact(message.id, emoji);
      if (type === "pin") return messagesApi.pin(message.id);
      if (type === "unpin") return messagesApi.unpin(message.id);
      if (type === "delete-me") return messagesApi.deleteForMe(message.id);
      return messagesApi.deleteForEveryone(message.id);
    },
    onMutate: async (input) => {
      if (
        !currentUser?.id ||
        !input.emoji ||
        (input.type !== "react" && input.type !== "unreact")
      ) {
        return null;
      }
      const queryKey = ["messages", message.chat_id] as const;
      const previous = queryClient.getQueryData<MessagePages>(queryKey);
      queryClient.setQueryData<MessagePages>(queryKey, (data) =>
        mapCachedMessage(data, message.id, (cached) => ({
          ...cached,
          reactions:
            input.type === "unreact"
              ? cached.reactions.filter(
                  (reaction) => reaction.user_id !== currentUser.id,
                )
              : [
                  ...cached.reactions.filter(
                    (reaction) => reaction.user_id !== currentUser.id,
                  ),
                  {
                    user_id: currentUser.id,
                    emoji: input.emoji!,
                    created_at: new Date().toISOString(),
                  },
                ],
        })),
      );
      void queryClient.cancelQueries({ queryKey });
      return { previous };
    },
    onSuccess: (result, input) => {
      setMenuOpen(false);
      if (input.type === "copy") {
        toast.success("Copied");
        return;
      }
      const isReaction =
        input.type === "react" || input.type === "unreact";
      if (result && typeof result === "object" && "id" in result) {
        const updated = result as ChatMessage;
        queryClient.setQueryData<MessagePages>(
          ["messages", message.chat_id],
          (data) => mapCachedMessage(data, updated.id, () => updated),
        );
        broadcastChatEvent(message.chat_id, "message.updated", {
          message_id: updated.id,
        });
      } else if (isReaction) {
        broadcastChatEvent(message.chat_id, "message.updated", {
          message_id: message.id,
        });
      } else if (
        input.type === "delete-me" ||
        input.type === "delete-everyone"
      ) {
        broadcastChatEvent(message.chat_id, "message.deleted", {
          message_id: message.id,
        });
      }
      if (!isReaction) {
        void queryClient.invalidateQueries({
          queryKey: ["messages", message.chat_id],
        });
      }
    },
    onError: (error, _input, optimisticContext) => {
      if (optimisticContext?.previous) {
        queryClient.setQueryData(
          ["messages", message.chat_id],
          optimisticContext.previous,
        );
      }
      toast.error(friendlyError(error));
    },
  });

  const myReaction = message.reactions.find(
    (reaction) => reaction.user_id === currentUser?.id,
  );
  const deleted = message.is_deleted || message.deleted_for_everyone;
  const receipt =
    mine && message.read_count > 0
      ? "read"
      : mine && message.delivered_count > 0
        ? "delivered"
        : mine
          ? "sent"
          : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={cx(
        "group flex gap-2",
        mine ? "justify-end" : "justify-start",
      )}
    >
      {!mine && (
        <div className="w-8 shrink-0 pt-1">
          {showAvatar ? (
            <Avatar name={peerName || message.sender.username} size="sm" />
          ) : null}
        </div>
      )}
      <div
        className={cx(
          "max-w-[min(90%,720px)] sm:max-w-[min(82%,720px)]",
          mine && "items-end",
        )}
      >
        {message.reply_to && (
          <div
            className={cx(
              "mb-1 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]",
              mine ? "bg-[var(--accent-soft)]" : "bg-[var(--surface-2)]",
            )}
          >
            Reply to{" "}
            {message.reply_to.is_deleted || message.reply_to.deleted_for_everyone
              ? "deleted message"
              : message.reply_to.content || message.reply_to.type}
          </div>
        )}
        <div
          className={cx(
            "relative rounded-[20px] px-3.5 py-2.5 shadow-[0_10px_28px_-20px_rgba(0,0,0,0.55)]",
            mine
              ? "rounded-br-md bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--accent)_78%,#111827))] text-white"
              : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur",
            deleted && "opacity-70",
          )}
        >
          {message.forwarded_from_id && (
            <p
              className={cx(
                "mb-1 text-[11px] font-medium",
                mine ? "text-white/80" : "text-[var(--muted)]",
              )}
            >
              Forwarded
            </p>
          )}
          {deleted ? (
            <p className="text-sm italic opacity-80">This message was deleted</p>
          ) : (
            <>
              {message.media_id && (
                <div className="mb-2">
                  <MediaBody
                    message={message}
                    media={resolvedMedia}
                    unavailable={mediaUnavailable}
                    onOpen={() => resolvedMedia && openMedia(resolvedMedia)}
                  />
                  {message.id.startsWith("optimistic-voice-") && (
                    <div
                      className="mt-2"
                      role="progressbar"
                      aria-label="Uploading voice message"
                      aria-valuetext="Uploading"
                    >
                      <div className="h-1 overflow-hidden rounded-full bg-white/20">
                        <motion.div
                          initial={{ width: "8%" }}
                          animate={{ width: "88%" }}
                          transition={{ duration: 7, ease: "easeOut" }}
                          className="h-full rounded-full bg-white/80"
                        />
                      </div>
                      <span className="mt-1 block text-[10px] text-white/70">
                        Uploading…
                      </span>
                    </div>
                  )}
                </div>
              )}
              {message.type === "location" ? (
                <LiveLocationMessageCard
                  content={message.content || ""}
                  senderName={peerName || message.sender.username}
                  senderId={message.sender.id}
                  mine={mine}
                  chatId={message.chat_id}
                />
              ) : message.content ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {message.content}
                </p>
              ) : null}
            </>
          )}
          <div
            className={cx(
              "mt-1 flex items-center justify-end gap-1.5 text-[10px]",
              mine ? "text-white/75" : "text-[var(--muted)]",
            )}
          >
            {message.is_pinned && <Pin size={10} />}
            {message.is_edited && <span>edited</span>}
            <span>{formatClock(message.created_at)}</span>
            <AnimatePresence mode="wait" initial={false}>
              {receipt && (
                <motion.span
                  key={receipt}
                  initial={{ opacity: 0, scale: 0.75, x: -2 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.75 }}
                  transition={{ duration: 0.14 }}
                  aria-label={
                    receipt === "read"
                      ? "Seen"
                      : receipt === "delivered"
                        ? "Delivered"
                        : "Sending"
                  }
                  className={cx(
                    "inline-flex",
                    receipt === "read" && "text-sky-300",
                    receipt === "delivered" && "opacity-75",
                  )}
                >
                  {receipt === "sent" ? (
                    <Check size={12} />
                  ) : (
                    <CheckCheck size={12} />
                  )}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {!deleted && message.reactions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(
                message.reactions.reduce<Record<string, number>>((acc, item) => {
                  acc[item.emoji] = (acc[item.emoji] || 0) + 1;
                  return acc;
                }, {}),
              ).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() =>
                    action.mutate({
                      type: myReaction?.emoji === emoji ? "unreact" : "react",
                      emoji,
                    })
                  }
                  className={cx(
                    "rounded-full px-2 py-0.5 text-xs",
                    mine ? "bg-white/15" : "bg-[var(--surface-2)]",
                  )}
                >
                  {emoji} {count}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className={cx(
            "mt-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100",
            mine ? "justify-end" : "justify-start",
          )}
        >
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => action.mutate({ type: "react", emoji })}
              className="grid size-7 place-items-center rounded-lg text-sm hover:bg-[var(--surface-2)]"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            aria-label="Reply"
            onClick={() => setReplyTo(message)}
            className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <CornerUpLeft size={14} />
          </button>
          <div>
            <button
              ref={moreButtonRef}
              type="button"
              aria-label="More message actions"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
              className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
      </div>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                ref={menuRef}
                role="menu"
                initial={{ opacity: 0, scale: 0.97, y: 3 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 3 }}
                transition={{ duration: 0.13, ease: "easeOut" }}
                style={{ left: menuPosition.left, top: menuPosition.top }}
                className="fixed z-[100] w-48 origin-top overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-1 shadow-2xl shadow-black/25 backdrop-blur-xl"
              >
                <MenuItem
                  icon={Copy}
                  label="Copy"
                  onClick={() => action.mutate({ type: "copy" })}
                />
                {message.type === "location" &&
                  (() => {
                    const coords = parseLocationCoords(message.content);
                    if (!coords) return null;
                    return (
                      <>
                        <MenuItem
                          icon={MapPin}
                          label="Open in Maps"
                          onClick={() => {
                            openInMaps(coords.latitude, coords.longitude);
                            setMenuOpen(false);
                          }}
                        />
                        <MenuItem
                          icon={Copy}
                          label="Copy map link"
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              mapsUrl(coords.latitude, coords.longitude),
                            );
                            toast.success("Map link copied");
                            setMenuOpen(false);
                          }}
                        />
                      </>
                    );
                  })()}
                <MenuItem
                  icon={Forward}
                  label="Forward"
                  onClick={() => {
                    setForwardMessage(message);
                    setMenuOpen(false);
                  }}
                />
                {mine && (
                  <MenuItem
                    icon={CornerUpLeft}
                    label="Edit"
                    onClick={() => {
                      setEditing(message);
                      setMenuOpen(false);
                    }}
                  />
                )}
                <MenuItem
                  icon={message.is_pinned ? PinOff : Pin}
                  label={message.is_pinned ? "Unpin" : "Pin"}
                  onClick={() =>
                    action.mutate({
                      type: message.is_pinned ? "unpin" : "pin",
                    })
                  }
                />
                <MenuItem
                  icon={Trash2}
                  label="Delete for me"
                  onClick={() => action.mutate({ type: "delete-me" })}
                />
                {mine && (
                  <MenuItem
                    icon={Trash2}
                    label="Delete for everyone"
                    danger
                    onClick={() => {
                      const ageMs =
                        Date.now() - new Date(message.created_at).getTime();
                      if (ageMs > 24 * 60 * 60 * 1000) {
                        toast.error(
                          "Delete for everyone is only available for 24 hours.",
                        );
                        return;
                      }
                      action.mutate({ type: "delete-everyone" });
                    }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </motion.div>
  );
});

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]",
        danger && "text-red-600",
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function ForwardDialog({ chatId }: { chatId: UUID }) {
  const forwardMessage = useMessagingStore((state) => state.forwardMessage);
  const setForwardMessage = useMessagingStore((state) => state.setForwardMessage);
  const queryClient = useQueryClient();
  const chats = useQuery({
    queryKey: ["chats", false],
    queryFn: () => chatsApi.list({ page: 1, page_size: 50, archived: false }),
    enabled: Boolean(forwardMessage),
  });

  const forward = useMutation({
    mutationFn: (target: UUID) =>
      messagesApi.forward(forwardMessage!.id, target),
    onSuccess: async (message) => {
      setForwardMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["messages", message.chat_id] });
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      broadcastChatEvent(message.chat_id, "message.created", {
        message_id: message.id,
      });
      toast.success("Message forwarded");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (!forwardMessage) return null;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/20 p-6 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Forward message</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setForwardMessage(null)}
            className="grid size-8 place-items-center rounded-lg hover:bg-[var(--surface-2)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
          {chats.data?.data
            .filter((chat) => chat.id !== chatId)
            .map((chat) => (
              <button
                key={chat.id}
                type="button"
                disabled={forward.isPending}
                onClick={() => forward.mutate(chat.id)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-[var(--surface-2)]"
              >
                <Avatar name={chat.title || "Chat"} size="sm" />
                <span className="truncate text-sm font-medium">
                  {chat.title || "Conversation"}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

export function ConversationPanel({
  onBack,
}: {
  onBack?: () => void;
} = {}) {
  const startCall = useStartCall();
  const selectedChatId = useNavigationStore((state) => state.selectedChatId);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const openGlobalSearch = useNavigationStore((state) => state.setSearchOpen);
  const currentUser = useAuthStore((state) => state.user);
  const details = useChatStore((state) => state.details);
  const cacheDetail = useChatStore((state) => state.cacheDetail);
  const openProfile = useProfileStore((state) => state.openProfile);
  const searchOpen = useMessagingStore((state) => state.searchOpen);
  const setSearchOpen = useMessagingStore((state) => state.setSearchOpen);
  const searchQuery = useMessagingStore((state) => state.searchQuery);
  const setSearchQuery = useMessagingStore((state) => state.setSearchQuery);
  const pinnedOpen = useMessagingStore((state) => state.pinnedOpen);
  const setPinnedOpen = useMessagingStore((state) => state.setPinnedOpen);
  const moreOpen = useMessagingStore((state) => state.moreOpen);
  const setMoreOpen = useMessagingStore((state) => state.setMoreOpen);
  const typingUsers = useMessagingStore(
    (state) => state.typingByChat[selectedChatId ?? ""] ?? EMPTY_ACTIVITY,
  );
  const recordingUsers = useMessagingStore(
    (state) => state.recordingByChat[selectedChatId ?? ""] ?? EMPTY_ACTIVITY,
  );
  const setTyping = useMessagingStore((state) => state.setTyping);
  const setRecording = useMessagingStore((state) => state.setRecording);
  const setPresence = useMessagingStore((state) => state.setPresence);
  const liveLocation = useMessagingStore((state) => state.liveLocation);
  const setLiveLocation = useMessagingStore((state) => state.setLiveLocation);
  const locationRemaining = useLocationStore((state) => state.remainingSeconds);
  const setLocationRemaining = useLocationStore(
    (state) => state.setRemainingSeconds,
  );
  const resetMessagingUi = useMessagingStore((state) => state.resetMessagingUi);
  const offline = useMessagingStore((state) => state.offline);
  const wsConnected = useMessagingStore((state) => state.wsConnected);
  const pendingQueue = useMessagingStore((state) => state.pendingQueue);
  const updatePending = useMessagingStore((state) => state.updatePending);
  const removePending = useMessagingStore((state) => state.removePending);
  const queryClient = useQueryClient();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastReceiptId = useRef<string | null>(null);
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cached = selectedChatId ? details[selectedChatId] : null;
  const detail = useQuery({
    queryKey: ["chat-detail", selectedChatId],
    enabled: Boolean(selectedChatId),
    queryFn: () => chatsApi.get(selectedChatId!),
  });

  useEffect(() => {
    if (detail.data) cacheDetail(detail.data);
  }, [detail.data, cacheDetail]);

  useEffect(() => {
    resetMessagingUi();
  }, [selectedChatId, resetMessagingUi]);

  const chat = cached || detail.data;
  const otherUserId =
    chat?.participants.find(
      (participant) => participant.username !== currentUser?.username,
    )?.user_id ?? null;
  const presence = useMessagingStore((state) =>
    otherUserId ? state.presenceByUser[otherUserId] : undefined,
  );

  const messages = useInfiniteQuery({
    queryKey: ["messages", selectedChatId],
    enabled: Boolean(selectedChatId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      messagesApi.list(selectedChatId!, pageParam, 40),
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });

  const flatMessages = useMemo(() => {
    const items =
      messages.data?.pages?.flatMap((page) => page.data ?? []) ?? [];
    const unique = new Map<string, ChatMessage>();
    for (const item of items) unique.set(item.id, item);
    return [...unique.values()].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages.data]);

  const filtered = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return flatMessages;
    return flatMessages.filter((message) =>
      (message.content || "").toLowerCase().includes(needle),
    );
  }, [flatMessages, searchQuery]);
  const pendingForChat = useMemo(
    () => pendingQueue.filter((message) => message.chatId === selectedChatId),
    [pendingQueue, selectedChatId],
  );

  useEffect(() => {
    const onPendingSent = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          pendingId: string;
          message: ChatMessage;
        }>
      ).detail;
      if (!detail?.message) return;
      queryClient.setQueryData<MessagePages>(
        ["messages", detail.message.chat_id],
        (data) =>
          upsertCachedMessage(
            data,
            {
              ...detail.message,
              delivered_count: Math.max(
                1,
                detail.message.delivered_count,
              ),
            },
            detail.pendingId,
          ),
      );
    };
    window.addEventListener("chatter:pending-message-sent", onPendingSent);
    return () =>
      window.removeEventListener("chatter:pending-message-sent", onPendingSent);
  }, [queryClient]);

  useEffect(() => {
    if (!pendingForChat.length || !stickToBottom.current) return;
    window.requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [pendingForChat.length]);

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer intentionally owns measurement state.
  const messageVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 84,
    overscan: 10,
    getItemKey: (index) => filtered[index]?.id ?? index,
  });

  const pinned = flatMessages.filter((message) => message.is_pinned);

  useEffect(() => {
    if (!selectedChatId || !currentUser?.id) return;
    let active = true;
    let unsubs: Array<() => void> = [];

    void (async () => {
      const scheduleRefresh = () => {
        if (invalidateTimer.current) return;
        invalidateTimer.current = setTimeout(() => {
          invalidateTimer.current = null;
          void queryClient.invalidateQueries({
            queryKey: ["messages", selectedChatId],
          });
          void queryClient.invalidateQueries({ queryKey: ["chats"] });
        }, 180);
      };

      const chatUnsub = await subscribeChat(
        selectedChatId,
        (event) => {
          // Ignore our own echoes — the composer already patched the cache.
          if (event.sender_id === currentUser.id) return;
          const messageId =
            typeof event.payload?.message_id === "string"
              ? event.payload.message_id
              : null;
          if (
            messageId &&
            (event.type === "message.delivered" ||
              event.type === "message.read")
          ) {
            queryClient.setQueryData<MessagePages>(
              ["messages", selectedChatId],
              (data) =>
                mapCachedMessage(data, messageId, (message) => ({
                  ...message,
                  delivered_count: Math.max(1, message.delivered_count),
                  read_count:
                    event.type === "message.read"
                      ? Math.max(1, message.read_count)
                      : message.read_count,
                })),
            );
            if (event.type === "message.read") {
              void queryClient.invalidateQueries({ queryKey: ["chats"] });
            }
            return;
          }
          if (
            event.type === "message.created" ||
            event.type === "message.updated" ||
            event.type === "message.deleted"
          ) {
            scheduleRefresh();
          }
        },
        (status) => {
          if (status === "open") scheduleRefresh();
        },
      );
      const typingUnsub = await subscribeTyping(selectedChatId, (event) => {
        if (event.sender_id === currentUser.id) return;
        const activeTyping = Boolean(
          (event.payload as { active?: boolean })?.active ?? true,
        );
        const existing =
          useMessagingStore.getState().typingByChat[selectedChatId] || [];
        const without = existing.filter(
          (item) => item.userId !== event.sender_id,
        );
        setTyping(
          selectedChatId,
          activeTyping && event.sender_id
            ? [
                ...without,
                {
                  userId: event.sender_id,
                  expiresAt: Date.now() + 4000,
                },
              ]
            : without,
        );
      });
      const recordingUnsub = await subscribeRecording(selectedChatId, (event) => {
        if (event.sender_id === currentUser.id) return;
        const activeRecording = Boolean(
          (event.payload as { active?: boolean })?.active ?? true,
        );
        const existing =
          useMessagingStore.getState().recordingByChat[selectedChatId] || [];
        const without = existing.filter(
          (item) => item.userId !== event.sender_id,
        );
        setRecording(
          selectedChatId,
          activeRecording && event.sender_id
            ? [
                ...without,
                { userId: event.sender_id, expiresAt: Date.now() + 4000 },
              ]
            : without,
        );
      });
      if (active) unsubs = [chatUnsub, typingUnsub, recordingUnsub];
      else {
        chatUnsub();
        typingUnsub();
        recordingUnsub();
      }
    })();

    const prune = setInterval(() => {
      const now = Date.now();
      const currentTyping =
        useMessagingStore.getState().typingByChat[selectedChatId] || [];
      const currentRecording =
        useMessagingStore.getState().recordingByChat[selectedChatId] || [];
      const typing = currentTyping.filter((item) => item.expiresAt > now);
      const recording = currentRecording.filter((item) => item.expiresAt > now);
      if (typing.length !== currentTyping.length) {
        setTyping(selectedChatId, typing);
      }
      if (recording.length !== currentRecording.length) {
        setRecording(selectedChatId, recording);
      }
    }, 1000);

    return () => {
      active = false;
      unsubs.forEach((fn) => fn());
      clearInterval(prune);
      if (invalidateTimer.current) {
        clearTimeout(invalidateTimer.current);
        invalidateTimer.current = null;
      }
    };
  }, [selectedChatId, currentUser?.id, queryClient, setTyping, setRecording]);

  useEffect(() => {
    if (!flatMessages.length || !currentUser?.id || !navigator.onLine) return;
    const latestIncoming = [...flatMessages]
      .reverse()
      .find((message) => message.sender.id !== currentUser.id);
    if (!latestIncoming) return;
    if (lastReceiptId.current === latestIncoming.id) return;
    lastReceiptId.current = latestIncoming.id;

    let cancelled = false;
    const syncReceipt = async () => {
      try {
        const [, read] = await Promise.allSettled([
          messagesApi.markDelivered(latestIncoming.id),
          messagesApi.markRead(latestIncoming.id),
        ]);
        if (cancelled) return;
        if (read.status === "rejected") {
          lastReceiptId.current = null;
          return;
        }
        broadcastChatEvent(latestIncoming.chat_id, "message.read", {
          message_id: latestIncoming.id,
        });
        await queryClient
          .invalidateQueries({ queryKey: ["chats"] })
          .catch(() => undefined);
      } catch {
        // Read receipts are best-effort and must never break the conversation UI.
        if (!cancelled) lastReceiptId.current = null;
      }
    };
    void syncReceipt();
    return () => {
      cancelled = true;
    };
  }, [flatMessages, currentUser?.id, queryClient]);

  useEffect(() => {
    if (!liveLocation?.is_active) return;
    const update = () =>
      setLocationRemaining(
        Math.max(
          0,
          Math.floor(
            (new Date(liveLocation.expires_at).getTime() - Date.now()) / 1000,
          ),
        ),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [liveLocation?.expires_at, liveLocation?.is_active, setLocationRemaining]);

  useEffect(() => {
    if (!stickToBottom.current || filtered.length === 0) return;
    messageVirtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
  }, [filtered.length, messageVirtualizer, selectedChatId]);

  const other = chat?.participants.find(
    (participant) => participant.username !== currentUser?.username,
  );

  useEffect(() => {
    if (!other?.user_id) return;
    let cancelled = false;
    const refreshPresence = () => {
      void presenceApi
        .status(other.user_id)
        .then((status) => {
          if (cancelled) return;
          setPresence(other.user_id, {
            isOnline: status.hidden ? false : status.is_online,
            lastSeenAt: status.hidden ? null : status.last_seen_at,
          });
        })
        .catch(() => undefined);
    };
    refreshPresence();
    const presenceTimer = window.setInterval(refreshPresence, 30_000);
    window.addEventListener("focus", refreshPresence);
    void locationApi
      .get(other.user_id)
      .then((location) => {
        if (location.is_active) setLiveLocation(location);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearInterval(presenceTimer);
      window.removeEventListener("focus", refreshPresence);
    };
  }, [other?.user_id, setPresence, setLiveLocation]);

  if (!selectedChatId) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <EmptyState
          illustration="chats"
          title="Select a conversation"
          description="Choose a chat from the list to start messaging with presence, media, and voice."
        />
      </div>
    );
  }

  if (detail.isLoading && !chat) {
    return (
      <div className="space-y-3 p-6 animate-pulse">
        <div className="h-14 rounded-2xl bg-[var(--surface-2)]" />
        <div className="h-full min-h-80 rounded-3xl bg-[var(--surface-2)]" />
      </div>
    );
  }

  if (detail.isError && !chat) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="text-center">
          <p className="text-sm text-red-600">{friendlyError(detail.error)}</p>
          <Button className="mt-4" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!chat) return null;

  const title = chatTitle(chat, currentUser?.username);
  const subtitle = chatSubtitle(chat, currentUser?.username);
  const typing = typingUsers.filter((item) => item.userId !== currentUser?.id);
  const recording = recordingUsers.filter(
    (item) => item.userId !== currentUser?.id,
  );
  const statusLine = recording.length
    ? "Recording voice…"
    : typing.length
      ? "Typing…"
      : (presence?.isOnline ?? other?.is_online)
        ? "Online"
        : "Offline";
  const handleBack = onBack ?? (() => selectChat(null));

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_70%_0%,var(--accent-soft),transparent_36%),var(--canvas)]">
      {(offline || !wsConnected) && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          {offline
            ? "You’re offline. Messages will sync when you’re back."
            : "Reconnecting realtime…"}
        </div>
      )}

      <header className="relative z-30 flex min-h-[70px] items-center gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_86%,transparent)] px-3 py-3 backdrop-blur-xl sm:gap-3 sm:px-5">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back to conversations"
          className="flex h-9 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] sm:px-3"
        >
          <ChevronLeft size={18} />
          <span>Back</span>
        </button>
        <button
          type="button"
          onClick={() => other && openProfile(other.username)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Avatar
            name={title}
            src={other?.avatar_url}
            online={presence?.isOnline ?? other?.is_online}
          />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.02em]">
              {title}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
              <span>{subtitle}</span>
              <span aria-hidden="true">·</span>
              {typing.length || recording.length ? (
                <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                  {statusLine} <TypingDots />
                </span>
              ) : (
                <span>{statusLine}</span>
              )}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-1">
          <IconButton
            label="Voice call"
            onClick={() => {
              const other = chat.participants.find(
                (participant) => participant.user_id === otherUserId,
              );
              if (other) {
                useCallStore.getState().setPeerMeta({
                  displayName: other.display_name || other.username,
                  username: other.username,
                  avatarUrl: other.avatar_url,
                });
              }
              void startCall(
                otherUserId
                  ? { receiver_id: otherUserId }
                  : { chat_id: chat.id },
                "voice",
              );
            }}
          >
            <Phone size={16} />
          </IconButton>
          <IconButton
            label="Video call"
            onClick={() => {
              const other = chat.participants.find(
                (participant) => participant.user_id === otherUserId,
              );
              if (other) {
                useCallStore.getState().setPeerMeta({
                  displayName: other.display_name || other.username,
                  username: other.username,
                  avatarUrl: other.avatar_url,
                });
              }
              void startCall(
                otherUserId
                  ? { receiver_id: otherUserId }
                  : { chat_id: chat.id },
                "video",
              );
            }}
          >
            <Video size={16} />
          </IconButton>
          <IconButton
            label="Search messages"
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={16} />
          </IconButton>
          <IconButton
            label="Pinned messages"
            onClick={() => setPinnedOpen(!pinnedOpen)}
          >
            <Pin size={16} />
          </IconButton>
          <div className="relative">
            <IconButton
              label="More conversation options"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <MoreHorizontal size={17} />
            </IconButton>
            <AnimatePresence>
              {moreOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close conversation menu"
                    onClick={() => setMoreOpen(false)}
                    className="fixed inset-0 z-30 cursor-default"
                  />
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, scale: 0.97, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-1 shadow-2xl shadow-black/25"
                  >
                    {other && (
                      <ConversationMenuItem
                        label="View profile"
                        onClick={() => {
                          openProfile(other.username);
                          setMoreOpen(false);
                        }}
                      />
                    )}
                    <ConversationMenuItem
                      label="Search messages"
                      onClick={() => {
                        setSearchOpen(true);
                        setMoreOpen(false);
                      }}
                    />
                    <ConversationMenuItem
                      label="Pinned messages"
                      onClick={() => {
                        setPinnedOpen(true);
                        setMoreOpen(false);
                      }}
                    />
                    <ConversationMenuItem
                      label="Shared media"
                      onClick={() => {
                        openGlobalSearch(true);
                        setMoreOpen(false);
                      }}
                    />
                    <ConversationMenuItem
                      label="Shared files"
                      onClick={() => {
                        openGlobalSearch(true);
                        setMoreOpen(false);
                      }}
                    />
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--border)]"
          >
            <div className="px-5 py-3">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search in conversation"
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pinnedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="max-h-40 space-y-2 overflow-y-auto px-5 py-3">
              {pinned.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No pinned messages</p>
              ) : (
                pinned.map((message) => (
                  <p key={message.id} className="truncate text-sm">
                    {message.content || message.type}
                  </p>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {liveLocation?.is_active && liveLocation.chat_id === selectedChatId && (
        <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm">
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,var(--accent-soft),var(--surface-2))]">
            <span className="absolute h-px w-full rotate-[-22deg] bg-[var(--border-strong)]" />
            <span className="absolute h-full w-px rotate-[35deg] bg-[var(--border-strong)]" />
            <motion.span
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="relative z-10 grid size-7 place-items-center rounded-full bg-[var(--accent)] text-white"
            >
              <MapPin size={13} />
            </motion.span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Live location</span>
            <span className="block text-xs text-[var(--muted)]">
              {Math.floor(locationRemaining / 60)}:
              {String(locationRemaining % 60).padStart(2, "0")} remaining
              {liveLocation.accuracy
                ? ` · accurate to ${Math.round(liveLocation.accuracy)} m`
                : ""}
            </span>
          </span>
          <a
            href={mapsUrl(liveLocation.latitude, liveLocation.longitude)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openInMaps(liveLocation.latitude, liveLocation.longitude);
            }}
            className="text-xs font-medium text-[var(--accent)]"
          >
            Open in Maps
          </a>
        </div>
      )}

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        onScroll={(event) => {
          const target = event.currentTarget;
          stickToBottom.current =
            target.scrollHeight - target.scrollTop - target.clientHeight < 80;
          if (
            target.scrollTop < 80 &&
            messages.hasNextPage &&
            !messages.isFetchingNextPage
          ) {
            void messages.fetchNextPage();
          }
        }}
      >
        {messages.isLoading && (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className={cx(
                  "h-14 rounded-3xl bg-[var(--surface-2)]",
                  index % 2 === 0 ? "ml-12" : "mr-12",
                )}
              />
            ))}
          </div>
        )}

        {messages.isError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {friendlyError(messages.error)}
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => void messages.refetch()}
            >
              Retry
            </button>
          </div>
        )}

        {!messages.isLoading && filtered.length === 0 && (
          <EmptyState
            illustration="chats"
            title="No messages yet"
            description="Say hello — your conversation starts here."
          />
        )}

        {filtered.length > 0 && (
          <div
            className="relative mx-auto w-full max-w-6xl"
            style={{ height: messageVirtualizer.getTotalSize() }}
          >
            {messageVirtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const message = filtered[index];
              const prev = filtered[index - 1];
              const showDay =
                !prev || dayKey(prev.created_at) !== dayKey(message.created_at);
              const mine = message.sender.id === currentUser?.id;
              const showAvatar =
                !mine && (!prev || prev.sender.id !== message.sender.id);
              return (
                <div
                  key={message.id}
                  data-index={index}
                  ref={messageVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full pb-3"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {showDay && (
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-1 text-[11px] font-medium text-[var(--muted)] shadow-sm backdrop-blur">
                        {dayLabel(message.created_at)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    mine={mine}
                    showAvatar={showAvatar}
                    peerName={
                      chat.participants.find(
                        (participant) =>
                          participant.user_id === message.sender.id,
                      )?.display_name || message.sender.username
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
        {pendingForChat.length > 0 && (
          <div
            className="mx-auto mt-3 flex w-full max-w-6xl flex-col items-end gap-3"
            role="status"
            aria-live="polite"
          >
            {pendingForChat.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 7 }}
                animate={{ opacity: 1, y: 0 }}
                layout
                className="group max-w-[min(90%,720px)]"
              >
                <div
                  className={cx(
                    "rounded-[20px] rounded-br-md bg-[linear-gradient(135deg,var(--accent),color-mix(in_srgb,var(--accent)_78%,#111827))] px-3.5 py-2.5 text-white shadow-[0_10px_28px_-20px_rgba(0,0,0,0.55)]",
                    message.status === "failed" && "ring-2 ring-amber-400/60",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {message.content}
                  </p>
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-white/75">
                    <span>{formatClock(new Date(message.createdAt).toISOString())}</span>
                    {message.status === "failed" ? (
                      <AlertTriangle
                        size={12}
                        className="text-amber-300"
                        aria-label="Failed to send"
                      />
                    ) : (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.75 }}
                        animate={{ opacity: 1, scale: 1 }}
                        aria-label={
                          message.status === "sending" ? "Sending" : "Queued"
                        }
                      >
                        <Check size={12} />
                      </motion.span>
                    )}
                  </div>
                </div>
                {message.status === "failed" && (
                  <div className="mt-1 flex justify-end gap-1 opacity-80 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        updatePending(message.id, {
                          status: "queued",
                          error: undefined,
                        });
                        void flushPendingMessages();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    >
                      <RefreshCw size={10} /> Retry
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("chatter:edit-pending-message", {
                            detail: {
                              id: message.id,
                              chatId: message.chatId,
                              content: message.content,
                            },
                          }),
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                    >
                      <Pencil size={10} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removePending(message.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={10} /> Delete
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <MessageComposer key={selectedChatId} chatId={selectedChatId} />
      <ForwardDialog chatId={selectedChatId} />
    </div>
  );
}

function ConversationMenuItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full px-3.5 py-2.5 text-left text-sm text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      {label}
    </button>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
