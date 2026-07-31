"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import {
  Copy,
  Hash,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Pin,
  Reply,
  ScreenShare,
  Search,
  Smile,
  Trash2,
  Users,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { toast } from "sonner";
import { Button, cx, Input } from "@/src/components/ui";
import { Avatar } from "@/src/features/shell/shell-ui";
import { resolveApiAssetUrl } from "@/src/lib/api-client";
import {
  canConnectVoice,
  canDeleteMessages,
  canPinMessages,
  canSendMessages,
  canUploadFiles,
  hasServerPermission,
} from "@/src/lib/server-permissions";
import { friendlyError } from "@/src/lib/shell-utils";
import { mediaApi, uploadByKind } from "@/src/services/messaging-api";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useAuthStore, useUserStore } from "@/src/stores/app-stores";
import { useServerStore } from "@/src/stores/server-stores";
import type {
  ServerChannel,
  ServerMentionSuggestion,
  ServerMessage,
  ServerSidebar,
} from "@/src/types/servers";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
const EMOJIS = ["😀", "😂", "🔥", "✨", "💯", "👍", "❤️", "🎉", "✅"];

function highlightMentions(content: string | null) {
  if (!content) return null;
  const parts = content.split(/(@everyone|@here|@[\w.-]+)/g);
  return parts.map((part, index) => {
    if (/^@(everyone|here|[\w.-]+)$/.test(part)) {
      return (
        <span
          key={`${part}-${index}`}
          className="rounded bg-[var(--accent-soft)] px-1 font-semibold text-[var(--accent)]"
        >
          {part}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export function ServerChat({
  sidebar,
  channel,
}: {
  sidebar: ServerSidebar;
  channel: ServerChannel;
}) {
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.user);
  const profile = useUserStore((state) => state.profile);
  const setMembersOpen = useServerStore((state) => state.setMembersOpen);
  const membersOpen = useServerStore((state) => state.membersOpen);
  const replyToId = useServerStore((state) => state.replyToId);
  const setReplyTo = useServerStore((state) => state.setReplyTo);
  const activeVoiceChannelId = useServerStore(
    (state) => state.activeVoiceChannelId,
  );
  const setVoice = useServerStore((state) => state.setVoice);
  const voiceMuted = useServerStore((state) => state.voiceMuted);
  const voiceDeafened = useServerStore((state) => state.voiceDeafened);
  const setVoiceControls = useServerStore((state) => state.setVoiceControls);

  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const perms = sidebar.my_permissions;
  const isVoice =
    channel.type === "voice" ||
    channel.type === "stage" ||
    channel.type === "video";
  const canSend = canSendMessages(perms) && channel.type !== "read_only";
  const canUpload = canUploadFiles(perms);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(searchQ.trim()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [searchQ]);

  const messages = useInfiniteQuery({
    queryKey: SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      serversApi.listMessages(sidebar.server.id, channel.id, {
        before: pageParam,
        limit: 50,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.length >= 50 ? lastPage[lastPage.length - 1]?.id : undefined,
  });

  const flat = useMemo(() => {
    const items = messages.data?.pages.flatMap((page) => page) ?? [];
    return [...items].reverse();
  }, [messages.data]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 12,
  });

  useEffect(() => {
    if (!flat.length) return;
    const last = flat[flat.length - 1];
    if (!last) return;
    void serversApi
      .markChannelRead(sidebar.server.id, channel.id, last.id)
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
        }),
      )
      .catch(() => undefined);
  }, [channel.id, flat, queryClient, sidebar.server.id]);

  const mentions = useQuery({
    queryKey: SERVER_QUERY_KEYS.mentions(sidebar.server.id, mentionQuery),
    queryFn: () =>
      serversApi.mentionAutocomplete(sidebar.server.id, mentionQuery),
    enabled: mentionOpen,
  });

  const search = useQuery({
    queryKey: SERVER_QUERY_KEYS.search(sidebar.server.id, debouncedSearch),
    queryFn: () =>
      serversApi.search(sidebar.server.id, { q: debouncedSearch, limit: 20 }),
    enabled: searchOpen && debouncedSearch.length >= 1,
  });

  const voice = useQuery({
    queryKey: SERVER_QUERY_KEYS.voice(sidebar.server.id, channel.id),
    queryFn: () => serversApi.listVoice(sidebar.server.id, channel.id),
    enabled: isVoice,
    refetchInterval: isVoice ? 8_000 : false,
  });

  useEffect(() => {
    if (isVoice && voice.data && activeVoiceChannelId === channel.id) {
      setVoice(channel.id, voice.data);
    }
  }, [activeVoiceChannelId, channel.id, isVoice, setVoice, voice.data]);

  const send = useMutation({
    mutationFn: async (payload: {
      content?: string;
      media_id?: string;
      reply_to_id?: string | null;
    }) =>
      serversApi.sendMessage(sidebar.server.id, channel.id, payload),
    onMutate: async (payload) => {
      const key = SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      const optimistic: ServerMessage = {
        id: `optimistic-${Date.now()}`,
        channel_id: channel.id,
        author: {
          id: me?.id ?? profile?.id ?? "me",
          username: profile?.username ?? me?.username ?? "you",
          display_name: profile?.display_name ?? me?.username ?? "You",
          avatar_url: profile?.avatar_url ?? null,
          is_online: true,
        },
        content: payload.content ?? null,
        media_id: payload.media_id ?? null,
        media_url: null,
        reply_to_id: payload.reply_to_id ?? null,
        is_edited: false,
        edited_at: null,
        is_pinned: false,
        mentions: null,
        reactions: [],
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData(key, (current: typeof messages.data) => {
        if (!current?.pages?.length) {
          return { pages: [[optimistic]], pageParams: [undefined] };
        }
        const [first, ...rest] = current.pages;
        return {
          ...current,
          pages: [[optimistic, ...first], ...rest],
        };
      });
      return { previous, key };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ctx.key, ctx.previous);
      toast.error(friendlyError(error));
    },
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      setEmojiOpen(false);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id),
      });
    },
  });

  const react = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      serversApi.addReaction(sidebar.server.id, channel.id, messageId, emoji),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id),
      });
    },
  });

  const removeMsg = useMutation({
    mutationFn: (messageId: string) =>
      serversApi.deleteMessage(sidebar.server.id, channel.id, messageId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id),
      });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const pin = useMutation({
    mutationFn: (messageId: string) =>
      serversApi.pinMessage(sidebar.server.id, channel.id, messageId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.messages(sidebar.server.id, channel.id),
      });
      toast.success("Pinned");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const joinVoice = useMutation({
    mutationFn: () =>
      serversApi.joinVoice(sidebar.server.id, channel.id, {
        muted: voiceMuted,
        deafened: voiceDeafened,
      }),
    onSuccess: async () => {
      setVoice(channel.id, voice.data ?? []);
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.voice(sidebar.server.id, channel.id),
      });
      toast.success("Joined voice");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const leaveVoice = useMutation({
    mutationFn: () => serversApi.leaveVoice(sidebar.server.id, channel.id),
    onSuccess: async () => {
      setVoice(null, []);
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.voice(sidebar.server.id, channel.id),
      });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const voiceState = useMutation({
    mutationFn: (body: {
      muted?: boolean;
      deafened?: boolean;
      camera_enabled?: boolean;
    }) => serversApi.updateVoiceState(sidebar.server.id, channel.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.voice(sidebar.server.id, channel.id),
      });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  function updateMentionState(value: string) {
    const match = value.match(/(?:^|\s)@([\w.-]*)$/);
    if (match) {
      setMentionOpen(true);
      setMentionQuery(match[1] ?? "");
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }
  }

  function applyMention(suggestion: ServerMentionSuggestion) {
    const insert =
      suggestion.type === "everyone"
        ? "@everyone"
        : suggestion.type === "here"
          ? "@here"
          : `@${suggestion.username}`;
    setDraft((current) => current.replace(/(?:^|\s)@([\w.-]*)$/, ` ${insert} `));
    setMentionOpen(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const suggestions = mentions.data ?? [];
    if (mentionOpen && suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = suggestions[mentionIndex];
        if (item) applyMention(item);
        return;
      }
      if (event.key === "Escape") {
        setMentionOpen(false);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function submit() {
    const content = draft.trim();
    if (!content && !canUpload) return;
    if (!content) return;
    if (!canSend) {
      toast.error("Missing permission: send_messages");
      return;
    }
    void serversApi
      .startTyping(sidebar.server.id, channel.id)
      .catch(() => undefined);
    send.mutate({
      content,
      reply_to_id: replyToId,
    });
    void serversApi
      .stopTyping(sidebar.server.id, channel.id)
      .catch(() => undefined);
  }

  async function onPickFile(file: File | null) {
    if (!file || !canUpload) return;
    try {
      const uploaded = await uploadByKind(file);
      await send.mutateAsync({
        media_id: uploaded.media.id,
        content: draft.trim() || undefined,
        reply_to_id: replyToId,
      });
    } catch (error) {
      toast.error(friendlyError(error));
    }
  }

  const replyPreview = replyToId
    ? flat.find((message) => message.id === replyToId)
    : null;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--canvas)]">
      <header className="electron-drag flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4">
        <div className="electron-no-drag flex min-w-0 items-center gap-2">
          {isVoice ? <Volume2 size={16} /> : <Hash size={16} />}
          <h3 className="truncate font-semibold text-[var(--ink)]">
            {channel.name}
          </h3>
          {channel.topic && (
            <span className="hidden truncate text-xs text-[var(--muted)] md:inline">
              — {channel.topic}
            </span>
          )}
        </div>
        <div className="electron-no-drag flex items-center gap-1">
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen((open) => !open)}
            className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            aria-label="Members"
            onClick={() => setMembersOpen(!membersOpen)}
            className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <Users size={15} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3"
          >
            <Input
              label="Search this server"
              value={searchQ}
              onChange={(event) => setSearchQ(event.target.value)}
              placeholder="Messages, members, channels…"
              autoFocus
            />
            {search.data && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                {search.data.messages.slice(0, 8).map((message) => (
                  <p key={message.id} className="truncate text-[var(--muted)]">
                    {message.author.username}: {message.content}
                  </p>
                ))}
                {search.data.channels.slice(0, 4).map((item) => (
                  <p key={item.id} className="text-[var(--ink)]">
                    #{item.name}
                  </p>
                ))}
                {!search.data.messages.length &&
                  !search.data.channels.length &&
                  !search.data.members.length && (
                    <p className="text-[var(--muted)]">No results</p>
                  )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {isVoice && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
          {activeVoiceChannelId === channel.id ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  const next = !voiceMuted;
                  setVoiceControls({ muted: next });
                  voiceState.mutate({ muted: next });
                }}
              >
                {voiceMuted ? <MicOff size={15} /> : <Mic size={15} />}
                {voiceMuted ? "Unmute" : "Mute"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const next = !voiceDeafened;
                  setVoiceControls({ deafened: next });
                  voiceState.mutate({ deafened: next });
                }}
              >
                {voiceDeafened ? <VolumeX size={15} /> : <Headphones size={15} />}
                {voiceDeafened ? "Undeafen" : "Deafen"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => voiceState.mutate({ camera_enabled: true })}
                disabled={!hasServerPermission(perms, "video")}
              >
                <Video size={15} /> Video
              </Button>
              <Button variant="ghost" disabled title="Screen share is not proxied by the backend">
                <ScreenShare size={15} /> Screen Share
              </Button>
              <Button
                onClick={() => leaveVoice.mutate()}
                disabled={leaveVoice.isPending}
              >
                <PhoneOff size={15} /> Leave
              </Button>
            </>
          ) : (
            <Button
              disabled={!canConnectVoice(perms) || joinVoice.isPending}
              onClick={() => joinVoice.mutate()}
            >
              <Headphones size={15} /> Join Voice
            </Button>
          )}
          <span className="text-xs text-[var(--muted)]">
            {(voice.data ?? []).length} in channel
          </span>
        </div>
      )}

      <div ref={parentRef} className="shell-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-xl bg-[var(--surface)]"
              />
            ))}
          </div>
        )}
        {messages.isError && (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="font-medium">Couldn’t load messages</p>
              <Button className="mt-3" onClick={() => messages.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {!messages.isLoading && !flat.length && (
          <div className="grid h-full place-items-center text-center text-[var(--muted)]">
            <div>
              <Hash size={28} className="mx-auto mb-2 opacity-40" />
              <p className="font-medium text-[var(--ink)]">
                Welcome to #{channel.name}
              </p>
              <p className="mt-1 text-sm">This is the start of the channel.</p>
            </div>
          </div>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const message = flat[row.index]!;
            const canDelete =
              message.author.id === me?.id || canDeleteMessages(perms);
            return (
              <div
                key={message.id}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="group absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <article className="flex gap-3 rounded-xl px-2 py-2 hover:bg-[var(--surface)]/70">
                  <Avatar
                    name={
                      message.author.display_name || message.author.username
                    }
                    src={
                      message.author.avatar_url
                        ? resolveApiAssetUrl(message.author.avatar_url)
                        : null
                    }
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold text-[var(--ink)]">
                        {message.author.display_name ||
                          message.author.username}
                      </span>
                      <time className="text-[11px] text-[var(--muted)]">
                        {new Date(message.created_at).toLocaleString()}
                      </time>
                      {message.is_edited && (
                        <span className="text-[10px] text-[var(--muted)]">
                          (edited)
                        </span>
                      )}
                      {message.is_pinned && (
                        <Pin size={11} className="text-[var(--accent)]" />
                      )}
                    </div>
                    {message.reply_to_id && (
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                        Replying to a message
                      </p>
                    )}
                    {message.content && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-6 text-[var(--ink)]">
                        {highlightMentions(message.content)}
                      </p>
                    )}
                    {message.media_url && (
                      <MessageMedia url={message.media_url} id={message.media_id} />
                    )}
                    {message.reactions?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {message.reactions.map((reaction) => (
                          <button
                            key={reaction.emoji}
                            type="button"
                            onClick={() =>
                              react.mutate({
                                messageId: message.id,
                                emoji: reaction.emoji,
                              })
                            }
                            className={cx(
                              "rounded-full border px-2 py-0.5 text-xs",
                              reaction.me
                                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                : "border-[var(--border)] bg-[var(--surface)]",
                            )}
                          >
                            {reaction.emoji} {reaction.count}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="hidden shrink-0 gap-0.5 group-hover:flex">
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="rounded p-1 hover:bg-[var(--surface-2)]"
                        onClick={() =>
                          react.mutate({ messageId: message.id, emoji })
                        }
                      >
                        {emoji}
                      </button>
                    ))}
                    <button
                      type="button"
                      title="Reply"
                      className="rounded p-1 hover:bg-[var(--surface-2)]"
                      onClick={() => setReplyTo(message.id)}
                    >
                      <Reply size={14} />
                    </button>
                    <button
                      type="button"
                      title="Copy"
                      className="rounded p-1 hover:bg-[var(--surface-2)]"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          message.content ?? "",
                        );
                        toast.success("Copied");
                      }}
                    >
                      <Copy size={14} />
                    </button>
                    {canPinMessages(perms) && (
                      <button
                        type="button"
                        title="Pin"
                        className="rounded p-1 hover:bg-[var(--surface-2)]"
                        onClick={() => pin.mutate(message.id)}
                      >
                        <Pin size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        title="Delete"
                        className="rounded p-1 text-red-500 hover:bg-red-500/10"
                        onClick={() => removeMsg.mutate(message.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="relative border-t border-[var(--border)] bg-[var(--panel)] p-3">
        {replyPreview && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
            <span>
              Replying to{" "}
              {replyPreview.author.display_name || replyPreview.author.username}
            </span>
            <button type="button" onClick={() => setReplyTo(null)}>
              ×
            </button>
          </div>
        )}
        <AnimatePresence>
          {mentionOpen && (mentions.data?.length ?? 0) > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="absolute bottom-[calc(100%-8px)] left-3 right-3 z-10 max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl"
            >
              {(mentions.data ?? []).map((item, index) => (
                <li key={`${item.type}-${item.id}-${item.username}`}>
                  <button
                    type="button"
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                      index === mentionIndex
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "hover:bg-[var(--surface)]",
                    )}
                    onClick={() => applyMention(item)}
                  >
                    <span className="font-semibold">
                      {item.type === "everyone" || item.type === "here"
                        ? `@${item.type}`
                        : `@${item.username}`}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {item.type}
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              void onPickFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={!canUpload}
            onClick={() => fileRef.current?.click()}
            className="pb-1 text-[var(--muted)] disabled:opacity-40"
            aria-label="Attach file"
          >
            📎
          </button>
          <textarea
            value={draft}
            disabled={!canSend}
            onChange={(event) => {
              setDraft(event.target.value);
              updateMentionState(event.target.value);
              void serversApi
                .startTyping(sidebar.server.id, channel.id)
                .catch(() => undefined);
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              canSend
                ? `Message #${channel.name}`
                : "You cannot send messages here"
            }
            className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none disabled:opacity-50"
          />
          <div className="relative">
            <button
              type="button"
              aria-label="Emoji"
              onClick={() => setEmojiOpen((open) => !open)}
              className="pb-1 text-[var(--muted)]"
            >
              <Smile size={16} />
            </button>
            {emojiOpen && (
              <div className="absolute bottom-8 right-0 z-10 grid grid-cols-5 gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-xl">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded p-1 hover:bg-[var(--surface)]"
                    onClick={() => setDraft((value) => `${value}${emoji}`)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            disabled={!draft.trim() || send.isPending || !canSend}
            onClick={submit}
          >
            Send
          </Button>
        </div>
      </footer>
    </section>
  );
}

function MessageMedia({ url, id }: { url: string; id: string | null }) {
  const media = useQuery({
    queryKey: ["media", id],
    queryFn: () => mediaApi.get(id!),
    enabled: Boolean(id) && !url,
  });
  const src = resolveApiAssetUrl(url || media.data?.url || "");
  if (!src) return null;
  const lower = src.toLowerCase();
  if (/\.(mp4|webm|mov)(\?|$)/.test(lower)) {
    return (
      <video
        src={src}
        controls
        className="mt-2 max-h-72 max-w-full rounded-xl"
        preload="metadata"
      />
    );
  }
  if (/\.(mp3|wav|ogg|m4a|webm)(\?|$)/.test(lower) || media.data?.kind === "voice") {
    return <audio src={src} controls className="mt-2 w-full max-w-md" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      className="mt-2 max-h-80 max-w-full rounded-xl object-contain"
    />
  );
}
