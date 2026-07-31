"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  Bell,
  BellOff,
  CalendarDays,
  MessageCircle,
  MoreHorizontal,
  PhoneCall,
  PhoneMissed,
  Plus,
  Search,
  Sparkles,
  Star,
  UserPlus,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import {
  Avatar,
  EmptyState,
  PanelHeader,
  SectionCard,
  SkeletonRows,
  SoftBadge,
} from "@/src/features/shell/shell-ui";
import {
  chatSubtitle,
  chatTitle,
  formatRelativeTime,
  friendlyError,
} from "@/src/lib/shell-utils";
import { isTypingTarget } from "@/src/lib/production-utils";
import { chatsApi, friendsApi, notificationsApi, usersApi } from "@/src/services/shell-api";
import { callsApi } from "@/src/services/prompt4-api";
import { useAuthStore } from "@/src/stores/app-stores";
import { useMessagingStore } from "@/src/stores/messaging-store";
import {
  useChatStore,
  useNavigationStore,
  useProfileStore,
} from "@/src/stores/shell-stores";
import type { ChatFilter, ChatListItem, ChatSort, UUID } from "@/src/types/api";

const EMPTY_TYPING: Array<{ userId: UUID; expiresAt: number }> = [];

function ChatterIntelligenceRow({
  selected,
  onOpen,
}: {
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.18 }}
      className={cx(
        "group relative overflow-hidden rounded-2xl border transition duration-200",
        selected
          ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] shadow-[0_14px_34px_-25px_var(--accent)]"
          : "border-[var(--accent)]/15 bg-[linear-gradient(110deg,var(--accent-soft),var(--surface)_58%,var(--panel))] shadow-[0_12px_30px_-28px_var(--accent)] hover:border-[var(--accent)]/25 hover:shadow-[0_16px_36px_-26px_var(--accent)]",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-10 top-1/2 size-24 -translate-y-1/2 rounded-full bg-[var(--accent)]/10 blur-2xl"
      />
      {selected && (
        <motion.span
          layoutId="selected-ai-chat-indicator"
          className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--accent)]"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open Chatter Intelligence"
        className="relative flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white shadow-lg shadow-[var(--accent)]/20">
          <Sparkles size={17} />
          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-[var(--surface)] bg-emerald-500" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">
              ✨ Chatter Intelligence
            </span>
            <BadgeCheck
              size={13}
              className="shrink-0 text-[var(--accent)]"
              aria-label="Verified AI"
            />
            <SoftBadge tone="accent">AI</SoftBadge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
            Always here to help
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-[var(--muted)]">Now</span>
          <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
            Online
          </span>
        </span>
      </button>
    </motion.div>
  );
}

function useChatsInfinite(archived: boolean) {
  return useInfiniteQuery({
    queryKey: ["chats", archived],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      chatsApi.list({ page: pageParam, page_size: 20, archived }),
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });
}

function sortChats(items: ChatListItem[], sort: ChatSort) {
  const next = [...items];
  if (sort === "unread") {
    next.sort((a, b) => b.unread_count - a.unread_count);
  } else if (sort === "name") {
    next.sort((a, b) =>
      (a.title || "").localeCompare(b.title || "", undefined, {
        sensitivity: "base",
      }),
    );
  } else {
    next.sort((a, b) => {
      const left = new Date(a.last_message_at || a.updated_at).getTime();
      const right = new Date(b.last_message_at || b.updated_at).getTime();
      return right - left;
    });
  }
  return next;
}

function filterChats(
  items: ChatListItem[],
  filter: ChatFilter,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  return items.filter((chat) => {
    if (filter === "unread" && chat.unread_count <= 0) return false;
    if (filter === "favorites" && !chat.is_favorite) return false;
    if (filter === "muted" && !chat.is_muted) return false;
    if (filter === "archived" && !chat.is_archived) return false;
    if (filter === "all" && chat.is_archived) return false;
    if (!needle) return true;
    return `${chat.title ?? ""} ${chat.last_message_preview ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
}

function ChatRow({
  chat,
  selected,
  onOpen,
  currentUsername,
}: {
  chat: ChatListItem;
  selected: boolean;
  onOpen: () => void;
  currentUsername?: string | null;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const typingUsers = useMessagingStore(
    (state) => state.typingByChat[chat.id] ?? EMPTY_TYPING,
  );
  const recordingUsers = useMessagingStore(
    (state) => state.recordingByChat[chat.id] ?? EMPTY_TYPING,
  );
  const detail = useQuery({
    queryKey: ["chat-detail", chat.id],
    queryFn: () => chatsApi.get(chat.id),
    enabled: selected,
    staleTime: 60_000,
  });
  const enriched = detail.data;
  const title = chatTitle(enriched || chat, currentUsername);
  const subtitle = chatSubtitle(enriched || chat, currentUsername);
  const other = enriched?.participants.find(
    (participant) => participant.username !== currentUsername,
  );
  const otherUserId = other?.user_id;
  const presenceOnline = useMessagingStore((state) =>
    otherUserId
      ? (state.presenceByUser[otherUserId]?.isOnline ?? other?.is_online)
      : undefined,
  );

  const preview = recordingUsers.length
    ? "Recording voice…"
    : typingUsers.length
      ? "Typing…"
      : chat.last_message_preview || subtitle;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["chats"] });
    await queryClient.invalidateQueries({ queryKey: ["chat-detail", chat.id] });
  };

  const action = useMutation({
    mutationFn: async (
      type:
        | "archive"
        | "unarchive"
        | "favorite"
        | "unfavorite"
        | "mute"
        | "unmute"
        | "leave",
    ) => {
      if (type === "archive") return chatsApi.archive(chat.id);
      if (type === "unarchive") return chatsApi.unarchive(chat.id);
      if (type === "favorite") return chatsApi.favorite(chat.id);
      if (type === "unfavorite") return chatsApi.unfavorite(chat.id);
      if (type === "mute") return chatsApi.mute(chat.id);
      if (type === "unmute") return chatsApi.unmute(chat.id);
      return chatsApi.leave(chat.id);
    },
    onSuccess: async (_, type) => {
      setMenuOpen(false);
      await invalidate();
      toast.success(
        type === "leave" ? "Conversation removed" : "Chat updated",
      );
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div
      onMouseEnter={() => {
        void queryClient.prefetchQuery({
          queryKey: ["chat-detail", chat.id],
          queryFn: () => chatsApi.get(chat.id),
          staleTime: 60_000,
        });
      }}
      className={cx(
        "group relative flex items-center gap-3 rounded-2xl border px-3 py-3 transition duration-200",
        menuOpen && "z-30",
        selected
          ? "border-[var(--accent)]/25 bg-[var(--accent-soft)] shadow-[0_12px_32px_-24px_var(--accent)]"
          : "border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-2)] hover:shadow-sm",
      )}
    >
      {selected && (
        <motion.span
          layoutId="selected-chat-indicator"
          className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--accent)]"
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Avatar
          name={title}
          src={other?.avatar_url}
          online={presenceOnline}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {chat.is_favorite && (
              <Star size={12} className="shrink-0 text-amber-500" fill="currentColor" />
            )}
            {chat.is_muted && (
              <BellOff size={12} className="shrink-0 text-[var(--muted)]" />
            )}
            {chat.is_archived && <SoftBadge>Archived</SoftBadge>}
          </span>
          <span
            className={cx(
              "mt-0.5 block truncate text-xs",
              typingUsers.length || recordingUsers.length
                ? "font-medium text-[var(--accent)]"
                : "text-[var(--muted)]",
            )}
          >
            {preview}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="text-[11px] text-[var(--muted)]">
            {formatRelativeTime(chat.last_message_at || chat.updated_at)}
          </span>
          {chat.unread_count > 0 && (
            <SoftBadge tone="accent">{chat.unread_count}</SoftBadge>
          )}
        </span>
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label="Chat actions"
          onClick={() => setMenuOpen((value) => !value)}
          className="grid size-8 place-items-center rounded-lg text-[var(--muted)] opacity-0 transition hover:bg-[var(--surface)] group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-50 w-44 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <ActionItem
              label={chat.is_favorite ? "Unfavorite" : "Favorite"}
              onClick={() =>
                action.mutate(chat.is_favorite ? "unfavorite" : "favorite")
              }
            />
            <ActionItem
              label={chat.is_muted ? "Unmute" : "Mute"}
              onClick={() => action.mutate(chat.is_muted ? "unmute" : "mute")}
            />
            <ActionItem
              label={chat.is_archived ? "Unarchive" : "Archive"}
              onClick={() =>
                action.mutate(chat.is_archived ? "unarchive" : "archive")
              }
            />
            <ActionItem
              label="Delete"
              danger
              onClick={() => action.mutate("leave")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full px-3 py-2 text-left text-sm transition hover:bg-[var(--surface-2)]",
        danger && "text-red-600",
      )}
    >
      {label}
    </button>
  );
}

export function ChatsPage({
  onOpenConversation,
}: {
  onOpenConversation?: () => void;
} = {}) {
  const currentUser = useAuthStore((state) => state.user);
  const selectedChatId = useNavigationStore((state) => state.selectedChatId);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectedIndex = useNavigationStore((state) => state.selectedIndex);
  const setSelectedIndex = useNavigationStore((state) => state.setSelectedIndex);
  const composeRequestedAt = useNavigationStore(
    (state) => state.composeRequestedAt,
  );
  const clearComposeRequest = useNavigationStore(
    (state) => state.clearComposeRequest,
  );
  const { filter, sort, query, setFilter, setSort, setQuery, cacheDetail } =
    useChatStore();
  const [composeOpen, setComposeOpen] = useState(false);
  const [username, setUsername] = useState("");
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  const archived = filter === "archived";
  const chats = useChatsInfinite(archived);

  const items = useMemo(() => {
    const flat = chats.data?.pages?.flatMap((page) => page.data ?? []) ?? [];
    return sortChats(filterChats(flat, filter, query), sort);
  }, [chats.data, filter, query, sort]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    const onScroll = () => {
      if (
        node.scrollTop + node.clientHeight >= node.scrollHeight - 120 &&
        chats.hasNextPage &&
        !chats.isFetchingNextPage
      ) {
        void chats.fetchNextPage();
      }
    };
    node.addEventListener("scroll", onScroll);
    return () => node.removeEventListener("scroll", onScroll);
  }, [chats]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex(Math.min(items.length, selectedIndex + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(Math.max(0, selectedIndex - 1));
      }
      if (event.key === "Enter" && selectedIndex === 0) {
        event.preventDefault();
        selectChat(null);
        setPage("ai");
      } else if (event.key === "Enter" && items[selectedIndex - 1]) {
        event.preventDefault();
        selectChat(items[selectedIndex - 1].id);
        onOpenConversation?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    items,
    onOpenConversation,
    selectChat,
    selectedIndex,
    setPage,
    setSelectedIndex,
  ]);

  useEffect(() => {
    if (!composeRequestedAt) return;
    const timer = window.setTimeout(() => {
      setComposeOpen(true);
      clearComposeRequest();
      usernameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clearComposeRequest, composeRequestedAt]);

  const createChat = useMutation({
    mutationFn: () =>
      chatsApi.create({
        participant_username: username.replace(/^@/, "").trim(),
      }),
    onSuccess: async (chat) => {
      cacheDetail(chat);
      selectChat(chat.id);
      onOpenConversation?.();
      setComposeOpen(false);
      setUsername("");
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      toast.success("Chat created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const selectedDetail = useQuery({
    queryKey: ["chat-detail", selectedChatId],
    enabled: Boolean(selectedChatId),
    queryFn: () => chatsApi.get(selectedChatId!),
  });

  useEffect(() => {
    if (selectedDetail.data) cacheDetail(selectedDetail.data);
  }, [cacheDetail, selectedDetail.data]);

  const filters: Array<{ id: ChatFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "unread", label: "Unread" },
    { id: "favorites", label: "Favorites" },
    { id: "muted", label: "Muted" },
    { id: "archived", label: "Archived" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Direct messages"
        description="Focused conversations with people."
        actions={
          <Button onClick={() => setComposeOpen((value) => !value)}>
            <Plus size={16} /> New chat
          </Button>
        }
      />
      <div className="border-b border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/80 px-3 shadow-inner transition focus-within:border-[var(--accent)]/50 focus-within:ring-2 focus-within:ring-[var(--accent)]/10">
          <Search size={15} className="text-[var(--muted)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search direct messages"
            className="h-10 flex-1 bg-transparent text-sm outline-none"
            aria-label="Filter chats"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as ChatSort)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 text-xs outline-none"
            aria-label="Sort chats"
          >
            <option value="recent">Recent</option>
            <option value="unread">Unread</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                filter === item.id
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {composeOpen && (
          <div className="mt-3 flex gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <input
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@username"
              className="h-10 flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] px-3 text-sm outline-none"
              aria-label="Participant username"
              onKeyDown={(event) => {
                if (event.key === "Enter") createChat.mutate();
              }}
            />
            <Button
              loading={createChat.isPending}
              onClick={() => createChat.mutate()}
            >
              Create
            </Button>
          </div>
        )}
      </div>
      <div className="border-b border-[var(--border)] bg-[var(--panel)]/80 px-2.5 py-2 backdrop-blur-xl">
        <div
          className={cx(
            selectedIndex === 0 &&
              "rounded-2xl ring-2 ring-[var(--accent)]/30",
          )}
        >
          <ChatterIntelligenceRow
            selected={selectedIndex === 0}
            onOpen={() => {
              selectChat(null);
              setPage("ai");
            }}
          />
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {chats.isLoading && <SkeletonRows />}
        {chats.isError && (
          <p className="px-4 py-6 text-sm text-red-600">
            {friendlyError(chats.error)}
          </p>
        )}
        {!chats.isLoading && items.length === 0 && (
          <EmptyState
            illustration="chats"
            title="No chats yet"
            description="Start a conversation with someone by their @username."
            action={
              <Button onClick={() => setComposeOpen(true)}>
                <Plus size={16} /> New chat
              </Button>
            }
          />
        )}
        {items.map((chat, index) => (
          <div
            key={chat.id}
            className={cx(
              index + 1 === selectedIndex &&
                "rounded-2xl ring-2 ring-[var(--accent)]/30",
            )}
          >
            <ChatRow
              chat={chat}
              selected={selectedChatId === chat.id}
              currentUsername={currentUser?.username}
              onOpen={() => {
                selectChat(chat.id);
                setSelectedIndex(index + 1);
                onOpenConversation?.();
              }}
            />
          </div>
        ))}
        {chats.isFetchingNextPage && (
          <p className="py-3 text-center text-xs text-[var(--muted)]">
            Loading more…
          </p>
        )}
      </div>
    </div>
  );
}

function DashboardStat({
  label,
  value,
  icon,
  accentClass,
  delay,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  accentClass: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/80 p-4 shadow-[0_18px_45px_-32px_rgba(0,0,0,0.65)] backdrop-blur-xl"
    >
      <div
        className={cx(
          "absolute -right-5 -top-8 size-24 rounded-full opacity-15 blur-2xl transition group-hover:opacity-25",
          accentClass,
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <span
          className={cx(
            "grid size-10 place-items-center rounded-2xl text-white shadow-lg",
            accentClass,
          )}
        >
          {icon}
        </span>
        <ArrowUpRight
          size={14}
          className="text-[var(--muted-2)] transition group-hover:text-[var(--muted)]"
        />
      </div>
      <p className="relative mt-4 text-2xl font-semibold tracking-[-0.04em]">
        {value.toLocaleString()}
      </p>
      <p className="relative mt-0.5 text-xs font-medium text-[var(--muted)]">
        {label}
      </p>
    </motion.div>
  );
}

function QuickAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/70 p-3 text-left transition hover:border-[var(--accent)]/25 hover:bg-[var(--accent-soft)]"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)] transition group-hover:bg-[var(--accent)] group-hover:text-white">
        {icon}
      </span>
      <span className="text-xs font-semibold">{label}</span>
    </motion.button>
  );
}

export function HomePage() {
  const currentUser = useAuthStore((state) => state.user);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const setSearchOpen = useNavigationStore((state) => state.setSearchOpen);
  const requestCompose = useNavigationStore((state) => state.requestCompose);
  const openProfile = useProfileStore((state) => state.openProfile);
  const setFilter = useChatStore((state) => state.setFilter);
  const [today] = useState(() =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date()),
  );

  const me = useQuery({ queryKey: ["users-me"], queryFn: () => usersApi.me() });
  const chats = useQuery({
    queryKey: ["chats", false, "home"],
    queryFn: () => chatsApi.list({ page: 1, page_size: 40, archived: false }),
  });
  const friends = useQuery({
    queryKey: ["friends", 1],
    queryFn: () => friendsApi.list(1, 12),
  });
  const notifications = useQuery({
    queryKey: ["notifications", "home"],
    queryFn: () => notificationsApi.list({ page: 1, page_size: 8 }),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: number }).status)
          : null;
      if (status === 429) return false;
      return failureCount < 1;
    },
  });
  const calls = useQuery({
    queryKey: ["calls-history", 1, 20],
    queryFn: () => callsApi.history(1, 20),
  });

  const recent = sortChats(chats.data?.data ?? [], "recent").slice(0, 6);
  const favorites = (chats.data?.data ?? []).filter((chat) => chat.is_favorite).slice(0, 6);
  const groups = (chats.data?.data ?? []).filter((chat) => chat.type === "group");
  const unreadTotal = (chats.data?.data ?? []).reduce(
    (total, chat) => total + chat.unread_count,
    0,
  );
  const friendsOnline =
    (friends.data?.data ?? []).filter((friend) => friend.is_online).length;
  const missedCalls =
    calls.data?.filter((call) => call.status === "missed").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Overview"
        description={
          <span className="flex items-center gap-1.5">
            <CalendarDays size={13} /> {today}
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => setSearchOpen(true)}>
            <Search size={15} /> Quick search
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5 lg:p-6">
        <section className="relative overflow-hidden rounded-[24px] border border-[var(--accent)]/20 bg-[linear-gradient(120deg,var(--accent-soft),var(--surface)_55%,var(--panel))] p-5 shadow-[0_24px_70px_-42px_var(--accent)] sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-[var(--accent)] opacity-10 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                Your workspace
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
                Welcome back
                {me.data?.display_name || currentUser?.username
                  ? `, ${me.data?.display_name || currentUser?.username}`
                  : ""}
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">
                Pick up where you left off, connect with friends, or start
                something new.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <QuickAction
                label="New chat"
                icon={<MessageCircle size={17} />}
                onClick={() => {
                  setPage("chats");
                  requestCompose();
                }}
              />
              <QuickAction
                label="Create group"
                icon={<UsersRound size={17} />}
                onClick={() => setPage("groups")}
              />
              <QuickAction
                label="Invite friend"
                icon={<UserPlus size={17} />}
                onClick={() => setPage("friends")}
              />
              <QuickAction
                label="Start a call"
                icon={<PhoneCall size={17} />}
                onClick={() => setPage("calls")}
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <DashboardStat
            label="Unread messages"
            value={unreadTotal}
            icon={<MessageCircle size={18} />}
            accentClass="bg-violet-500"
            delay={0}
          />
          <DashboardStat
            label="Friends online"
            value={friendsOnline}
            icon={<UserRoundCheck size={18} />}
            accentClass="bg-emerald-500"
            delay={0.04}
          />
          <DashboardStat
            label="Groups"
            value={groups.length}
            icon={<UsersRound size={18} />}
            accentClass="bg-blue-500"
            delay={0.08}
          />
          <DashboardStat
            label="Missed calls"
            value={missedCalls}
            icon={<PhoneMissed size={18} />}
            accentClass="bg-rose-500"
            delay={0.12}
          />
          <DashboardStat
            label="Notifications"
            value={notifications.data?.unread_count ?? 0}
            icon={<Bell size={18} />}
            accentClass="bg-amber-500"
            delay={0.16}
          />
          <DashboardStat
            label="Conversations"
            value={chats.data?.total ?? 0}
            icon={<MessageCircle size={18} />}
            accentClass="bg-cyan-500"
            delay={0.2}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-2">
          <SectionCard
            title="Recent conversations"
            action={
              <button
                type="button"
                className="text-xs font-semibold text-[var(--accent)]"
                onClick={() => setPage("chats")}
              >
                View all
              </button>
            }
          >
            {chats.isLoading && <SkeletonRows count={4} />}
            {!chats.isLoading && recent.length === 0 && (
              <p className="p-6 text-center text-sm text-[var(--muted)]">
                No conversations yet. Start a new chat when you&apos;re ready.
              </p>
            )}
            {recent.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  selectChat(chat.id);
                  setPage("chats");
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
              >
                <Avatar name={chat.title || "Chat"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {chat.title || "Conversation"}
                  </span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {chat.last_message_preview || "No messages yet"}
                  </span>
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {formatRelativeTime(chat.last_message_at || chat.updated_at)}
                </span>
              </button>
            ))}
          </SectionCard>

          <SectionCard
            title="Online now"
            action={
              <button
                type="button"
                className="text-xs font-semibold text-[var(--accent)]"
                onClick={() => setPage("friends")}
              >
                View friends
              </button>
            }
          >
            {friends.isLoading ? (
              <SkeletonRows count={4} />
            ) : friendsOnline === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted)]">
                None of your friends are online right now.
              </p>
            ) : (
              friends.data?.data
                .filter((friend) => friend.is_online)
                .slice(0, 6)
                .map((friend) => (
                <button
                  key={friend.id}
                  type="button"
                  onClick={() => openProfile(friend.username)}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
                >
                  <Avatar
                    name={friend.display_name || friend.username}
                    src={friend.avatar_url}
                    online
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {friend.display_name || friend.username}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      @{friend.username}
                    </span>
                  </span>
                </button>
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Recent groups"
            action={
              <button
                type="button"
                className="text-xs font-semibold text-[var(--accent)]"
                onClick={() => setPage("groups")}
              >
                All groups
              </button>
            }
          >
            {groups.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted)]">
                Your group conversations will appear here.
              </p>
            ) : (
              groups.slice(0, 6).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => {
                    selectChat(chat.id);
                    setPage("chats");
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <UsersRound size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {chat.title || "Group"}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {chat.participant_count} members
                    </span>
                  </span>
                  {chat.unread_count > 0 && (
                    <SoftBadge tone="accent">{chat.unread_count}</SoftBadge>
                  )}
                </button>
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Pinned & favorites"
            action={
              <button
                type="button"
                className="text-xs font-semibold text-[var(--accent)]"
                onClick={() => {
                  setFilter("favorites");
                  setPage("chats");
                }}
              >
                Open
              </button>
            }
          >
            {favorites.length === 0 ? (
              <p className="p-6 text-center text-sm text-[var(--muted)]">
                Star important conversations to keep them close.
              </p>
            ) : (
              favorites.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => {
                    selectChat(chat.id);
                    setPage("chats");
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
                >
                  <Star
                    size={14}
                    className="text-amber-500"
                    fill="currentColor"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {chat.title || "Conversation"}
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    {formatRelativeTime(chat.last_message_at || chat.updated_at)}
                  </span>
                </button>
              ))
            )}
          </SectionCard>
        </div>

        <SectionCard title="Recent activity">
          {notifications.isLoading && <SkeletonRows count={4} />}
          {!notifications.isLoading &&
            (notifications.data?.items?.length ?? 0) === 0 && (
              <p className="p-6 text-center text-sm text-[var(--muted)]">
                Friend requests, mentions, and updates will appear here.
              </p>
            )}
          {(notifications.data?.items ?? []).map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-2xl px-3 py-3 transition hover:bg-[var(--surface-2)]"
            >
              <span className="mt-1 size-2 rounded-full bg-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                {item.body && (
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{item.body}</p>
                )}
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                {formatRelativeTime(item.created_at)}
              </span>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}
