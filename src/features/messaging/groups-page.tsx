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
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  Crown,
  Globe2,
  Image as ImageIcon,
  Link2,
  Lock,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
  Video,
  Vote,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import { useStartCall } from "@/src/features/calls/call-experience";
import {
  Avatar,
  EmptyState,
  PanelHeader,
  SoftBadge,
} from "@/src/features/shell/shell-ui";
import { ApiError } from "@/src/lib/api-client";
import { rememberGroupChat, resolveGroupChat } from "@/src/lib/group-chat";
import { formatRelativeTime, friendlyError } from "@/src/lib/shell-utils";
import { subscribeGroup } from "@/src/lib/websocket";
import {
  chatsApi,
  friendsApi,
  groupsApi,
  searchApi,
  usersApi,
} from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import { useNavigationStore } from "@/src/stores/shell-stores";
import type {
  ChatParticipant,
  GroupAnnouncement,
  GroupPoll,
  GroupSearchResult,
  GroupSummary,
  UUID,
} from "@/src/types/api";

type HomeView = "all" | "owned" | "recent" | "favorites";
type DetailTab =
  | "overview"
  | "members"
  | "announcements"
  | "polls"
  | "settings";

interface CreateForm {
  name: string;
  description: string;
  avatar_url: string;
  visibility: "public" | "private";
  max_members: number;
}

interface SettingsForm {
  name: string;
  description: string;
  avatar_url: string;
  visibility: "public" | "private";
  max_members: number;
}

const PAGE_SIZE = 24;
const FAVORITES_KEY = "chatter.group-favorites";
const inputClass =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm outline-none transition placeholder:text-[var(--muted-2)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10";

function joinError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404) return "This invite code is invalid or has expired.";
    if (error.status === 403) return "You do not have permission to join this group.";
    if (error.status === 409) return "You are already a member of this group.";
  }
  return friendlyError(error);
}

function roleFor(group: GroupSummary, userId?: UUID | null) {
  return group.owner_id === userId ? "Owner" : "Joined";
}

export function GroupsPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const focusGroupId = useNavigationStore((state) => state.focusGroupId);
  const focusGroup = useNavigationStore((state) => state.focusGroup);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const setPage = useNavigationStore((state) => state.setPage);
  const [selectedId, setSelectedId] = useState<UUID | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<GroupSummary | null>(null);
  const [view, setView] = useState<HomeView>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [favorites, setFavorites] = useState<Set<UUID>>(new Set());
  const [announcements, setAnnouncements] = useState<
    Record<UUID, GroupAnnouncement[]>
  >({});
  const [polls, setPolls] = useState<Record<UUID, GroupPoll[]>>({});
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const favoritesKey = `${FAVORITES_KEY}.${currentUser?.id ?? "anonymous"}`;

  const groups = useInfiniteQuery({
    queryKey: ["groups", "infinite"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => groupsApi.list(pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length + 1 : undefined,
  });

  const groupChats = useQuery({
    queryKey: ["chats", false, "groups-meta"],
    queryFn: () => chatsApi.list({ page: 1, page_size: 100, archived: false }),
  });

  const chatByTitle = useMemo(() => {
    const result = new Map<
      string,
      {
        id: UUID;
        last_message_preview: string | null;
        last_message_at: string | null;
        unread_count: number;
        participant_count: number;
      }
    >();
    for (const chat of groupChats.data?.data ?? []) {
      if (chat.type !== "group" || !chat.title) continue;
      result.set(chat.title.toLowerCase(), {
        id: chat.id,
        last_message_preview: chat.last_message_preview,
        last_message_at: chat.last_message_at,
        unread_count: chat.unread_count,
        participant_count: chat.participant_count,
      });
    }
    return result;
  }, [groupChats.data]);

  async function openGroupChat(group: GroupSummary) {
    try {
      const cached = chatByTitle.get(group.name.toLowerCase());
      if (cached) {
        rememberGroupChat(group.id, cached.id);
        selectChat(cached.id);
        setPage("chats");
        return;
      }
      const chat = await resolveGroupChat(group);
      if (!chat) {
        toast.error("Could not find the group conversation yet. Try again shortly.");
        return;
      }
      rememberGroupChat(group.id, chat.id);
      selectChat(chat.id);
      setPage("chats");
    } catch (error) {
      toast.error(friendlyError(error));
    }
  }

  const allGroups = useMemo(() => {
    const unique = new Map<UUID, GroupSummary>();
    for (const page of groups.data?.pages ?? []) {
      for (const group of page) unique.set(group.id, group);
    }
    return [...unique.values()];
  }, [groups.data]);

  const selected = useQuery({
    queryKey: ["group", selectedId],
    enabled: Boolean(selectedId),
    queryFn: () => groupsApi.get(selectedId!),
    staleTime: 60_000,
  });

  const search = useQuery({
    queryKey: ["group-search", debouncedQuery],
    enabled: debouncedQuery.length >= 2,
    queryFn: () => searchApi.groups(debouncedQuery, 100),
    staleTime: 30_000,
  });

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      280,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(favoritesKey);
        setFavorites(
          new Set(stored ? (JSON.parse(stored) as UUID[]) : []),
        );
      } catch {
        setFavorites(new Set());
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [favoritesKey]);

  useEffect(() => {
    if (!focusGroupId) return;
    const timer = window.setTimeout(() => {
      setSelectedId(focusGroupId);
      focusGroup(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusGroup, focusGroupId]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        groups.hasNextPage &&
        !groups.isFetchingNextPage
      ) {
        void groups.fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [groups]);

  const visibleGroups = useMemo(() => {
    const sorted = [...allGroups].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    if (view === "owned") {
      return sorted.filter((group) => group.owner_id === currentUser?.id);
    }
    if (view === "favorites") {
      return sorted.filter((group) => favorites.has(group.id));
    }
    if (view === "recent") return sorted.slice(0, 8);
    return sorted;
  }, [allGroups, currentUser?.id, favorites, view]);

  function toggleFavorite(groupId: UUID) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      window.localStorage.setItem(favoritesKey, JSON.stringify([...next]));
      return next;
    });
  }

  async function refreshGroups() {
    await queryClient.invalidateQueries({ queryKey: ["groups"] });
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_75%_0%,var(--accent-soft),transparent_35%)]">
      <motion.div
        initial={false}
        animate={{
          x: selectedId ? "-4%" : "0%",
          opacity: selectedId ? 0 : 1,
        }}
        transition={{ duration: 0.24, ease: "easeInOut" }}
        aria-hidden={Boolean(selectedId)}
        className="absolute inset-0 flex min-h-0 flex-col"
        style={{
          pointerEvents: selectedId ? "none" : "auto",
          visibility: selectedId ? "hidden" : "visible",
          transitionDelay: selectedId ? "240ms" : "0ms",
          transitionProperty: "visibility",
        }}
      >
        <PanelHeader
          title="Groups"
          description="Your communities, conversations, and shared moments."
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setJoining(true)}>
                <Link2 size={15} /> Join
              </Button>
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> Create group
              </Button>
            </div>
          }
        />

        <div className="shell-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                icon={<UsersRound size={18} />}
                label="Joined groups"
                value={allGroups.length}
              />
              <StatCard
                icon={<Crown size={18} />}
                label="Groups you own"
                value={
                  allGroups.filter((group) => group.owner_id === currentUser?.id)
                    .length
                }
              />
              <StatCard
                icon={<Star size={18} />}
                label="Favorites"
                value={favorites.size}
              />
            </div>

            <div className="mt-5 rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/75 p-3 shadow-xl shadow-black/5 backdrop-blur-xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 focus-within:border-[var(--accent)]/50">
                  <Search size={16} className="text-[var(--muted)]" />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchIndex(0);
                    }}
                    onKeyDown={(event) => {
                      const results = search.data ?? [];
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSearchIndex((index) =>
                          Math.min(results.length - 1, index + 1),
                        );
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSearchIndex((index) => Math.max(0, index - 1));
                      }
                      if (event.key === "Enter" && results[searchIndex]) {
                        event.preventDefault();
                        setSelectedId(results[searchIndex].id);
                      }
                    }}
                    placeholder="Search your groups or discover public groups"
                    aria-label="Search groups"
                    aria-controls="group-search-results"
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                      className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div
                  className="shell-scroll flex gap-1 overflow-x-auto"
                  role="tablist"
                  aria-label="Group views"
                >
                  {(
                    [
                      ["all", "My groups"],
                      ["recent", "Recent"],
                      ["owned", "Owned"],
                      ["favorites", "Favorites"],
                    ] as Array<[HomeView, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={view === id}
                      onClick={() => setView(id)}
                      className={cx(
                        "whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition",
                        view === id
                          ? "bg-[var(--accent)] text-white"
                          : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {debouncedQuery.length >= 2 ? (
              <SearchResults
                query={debouncedQuery}
                results={search.data ?? []}
                loading={search.isLoading}
                error={search.error}
                activeIndex={searchIndex}
                joinedIds={new Set(allGroups.map((group) => group.id))}
                onOpen={setSelectedId}
              />
            ) : (
              <section className="mt-7" aria-labelledby="group-list-title">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
                      Workspace
                    </p>
                    <h2 id="group-list-title" className="mt-1 text-lg font-semibold">
                      {view === "all"
                        ? "My groups"
                        : view === "owned"
                          ? "Groups you own"
                          : view === "favorites"
                            ? "Favorite groups"
                            : "Recent groups"}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshGroups()}
                    aria-label="Refresh groups"
                    className="grid size-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                  >
                    <RefreshCw
                      size={15}
                      className={groups.isRefetching ? "animate-spin" : ""}
                    />
                  </button>
                </div>

                {groups.isLoading ? (
                  <GroupSkeletons />
                ) : groups.isError ? (
                  <ErrorState
                    message={friendlyError(groups.error)}
                    onRetry={() => void groups.refetch()}
                  />
                ) : visibleGroups.length ? (
                  <motion.div layout className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibleGroups.map((group, index) => (
                      <GroupCard
                        key={group.id}
                        group={group}
                        role={roleFor(group, currentUser?.id)}
                        favorite={favorites.has(group.id)}
                        index={index}
                        preview={chatByTitle.get(group.name.toLowerCase())}
                        onFavorite={() => toggleFavorite(group.id)}
                        onOpen={() => setSelectedId(group.id)}
                        onOpenChat={() => void openGroupChat(group)}
                      />
                    ))}
                  </motion.div>
                ) : (
                  <EmptyState
                    illustration="groups"
                    title={view === "favorites" ? "No favorite groups" : "No groups yet"}
                    description={
                      view === "favorites"
                        ? "Star groups you want to reach quickly."
                        : "Create a group or join one with a backend-issued invite code."
                    }
                    action={
                      <Button onClick={() => setCreating(true)}>
                        <Plus size={15} /> Create group
                      </Button>
                    }
                  />
                )}
                <div ref={loadMoreRef} className="h-8" aria-hidden="true" />
                {groups.isFetchingNextPage && (
                  <p className="pb-4 text-center text-xs text-[var(--muted)]">
                    Loading more groups…
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedId && (
          <motion.div
            key={selectedId}
            initial={{ x: "100%", opacity: 0.96 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.96 }}
            transition={{ duration: 0.24, ease: "easeInOut" }}
            className="absolute inset-0 z-10 min-h-0 bg-[var(--canvas)]"
          >
            <GroupDetail
              group={selected.data}
              loading={selected.isLoading}
              error={selected.error}
              currentUserId={currentUser?.id}
              announcements={announcements[selectedId] ?? []}
              polls={polls[selectedId] ?? []}
              onBack={() => setSelectedId(null)}
              onOpenChat={() => {
                if (selected.data) void openGroupChat(selected.data);
              }}
              onAnnouncement={(announcement) =>
                setAnnouncements((current) => ({
                  ...current,
                  [selectedId]: [
                    announcement,
                    ...(current[selectedId] ?? []),
                  ],
                }))
              }
              onPoll={(poll) =>
                setPolls((current) => ({
                  ...current,
                  [selectedId]: [poll, ...(current[selectedId] ?? [])],
                }))
              }
              onDeleted={async () => {
                setSelectedId(null);
                await refreshGroups();
              }}
              onUpdated={async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["group", selectedId],
                });
                await refreshGroups();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {creating && (
          <CreateGroupDialog
            onClose={() => setCreating(false)}
            onCreated={async (group) => {
              setCreating(false);
              await refreshGroups();
              void queryClient.invalidateQueries({ queryKey: ["chats"] });
              setCreatedGroup(group);
              setSelectedId(group.id);
            }}
          />
        )}
        {joining && (
          <JoinGroupDialog
            onClose={() => setJoining(false)}
            onJoined={async (group) => {
              setJoining(false);
              await refreshGroups();
              void queryClient.invalidateQueries({ queryKey: ["chats"] });
              setSelectedId(group.id);
            }}
          />
        )}
        {createdGroup && (
          <CreatedInviteDialog
            group={createdGroup}
            onClose={() => setCreatedGroup(null)}
            onOpenChat={() => {
              const group = createdGroup;
              setCreatedGroup(null);
              void openGroupChat(group);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 p-4 shadow-lg shadow-black/5 backdrop-blur-xl"
    >
      <span className="grid size-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      <span>
        <span className="block text-xl font-semibold">{value}</span>
        <span className="text-xs text-[var(--muted)]">{label}</span>
      </span>
    </motion.div>
  );
}

function GroupCard({
  group,
  role,
  favorite,
  index,
  preview,
  onFavorite,
  onOpen,
  onOpenChat,
}: {
  group: GroupSummary;
  role: string;
  favorite: boolean;
  index: number;
  preview?: {
    last_message_preview: string | null;
    last_message_at: string | null;
    unread_count: number;
  };
  onFavorite: () => void;
  onOpen: () => void;
  onOpenChat: () => void;
}) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.18) }}
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/85 p-4 shadow-[0_18px_48px_-38px_rgba(0,0,0,0.8)] transition hover:border-[var(--accent)]/25"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 text-left"
      >
        <Avatar name={group.name} src={group.avatar_url} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-sm font-semibold">
              {group.name}
            </span>
            {(preview?.unread_count ?? 0) > 0 && (
              <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {preview?.unread_count}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] tracking-wide text-[var(--muted-2)]">
            {group.invite_code}
          </span>
          <span className="mt-1 line-clamp-2 min-h-9 text-xs leading-[18px] text-[var(--muted)]">
            {preview?.last_message_preview ||
              group.description ||
              "A Chatter group"}
          </span>
        </span>
      </button>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <SoftBadge>{group.visibility}</SoftBadge>
        <RoleBadge role={role} />
        <span className="ml-auto text-[11px] text-[var(--muted)]">
          {group.member_count.toLocaleString()} members
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[11px] text-[var(--muted-2)]">
        <span>
          {preview?.last_message_at
            ? formatRelativeTime(preview.last_message_at)
            : `Created ${formatRelativeTime(group.created_at)}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenChat}
            aria-label={`Open chat for ${group.name}`}
            className="grid size-8 place-items-center rounded-xl transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            <MessageCircle size={14} />
          </button>
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            className="grid size-8 place-items-center rounded-xl transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
          >
            <Star size={14} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function SearchResults({
  query,
  results,
  loading,
  error,
  activeIndex,
  joinedIds,
  onOpen,
}: {
  query: string;
  results: GroupSearchResult[];
  loading: boolean;
  error: unknown;
  activeIndex: number;
  joinedIds: Set<UUID>;
  onOpen: (id: UUID) => void;
}) {
  return (
    <section id="group-search-results" className="mt-7" aria-live="polite">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
        Search
      </p>
      <h2 className="mt-1 text-lg font-semibold">Results for “{query}”</h2>
      {loading ? (
        <div className="mt-3">
          <GroupSkeletons />
        </div>
      ) : error ? (
        <div className="mt-3">
          <ErrorState message={friendlyError(error)} />
        </div>
      ) : results.length ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map((group, index) => (
            <motion.button
              key={group.id}
              type="button"
              onClick={() => {
                if (joinedIds.has(group.id)) {
                  onOpen(group.id);
                } else {
                  toast.info("A valid invite code is required to join this group.");
                }
              }}
              whileHover={{ y: -2 }}
              className={cx(
                "flex items-center gap-3 rounded-[20px] border bg-[var(--surface)]/85 p-4 text-left transition",
                index === activeIndex
                  ? "border-[var(--accent)]/50 ring-2 ring-[var(--accent)]/10"
                  : "border-[var(--border)] hover:border-[var(--border-strong)]",
              )}
            >
              <Avatar name={group.name} src={group.avatar_url} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{group.name}</span>
                <span className="block truncate text-xs text-[var(--muted)]">
                  {group.member_count} members
                </span>
              </span>
              <SoftBadge>{joinedIds.has(group.id) ? "Joined" : group.visibility}</SoftBadge>
            </motion.button>
          ))}
        </div>
      ) : (
        <EmptyState
          illustration="search"
          title="No groups found"
          description="Try a different name or description."
        />
      )}
    </section>
  );
}

function GroupDetail({
  group,
  loading,
  error,
  currentUserId,
  announcements,
  polls,
  onBack,
  onOpenChat,
  onAnnouncement,
  onPoll,
  onDeleted,
  onUpdated,
}: {
  group?: GroupSummary;
  loading: boolean;
  error: unknown;
  currentUserId?: UUID | null;
  announcements: GroupAnnouncement[];
  polls: GroupPoll[];
  onBack: () => void;
  onOpenChat: () => void;
  onAnnouncement: (announcement: GroupAnnouncement) => void;
  onPoll: (poll: GroupPoll) => void;
  onDeleted: () => Promise<void>;
  onUpdated: () => Promise<void>;
}) {
  const startCall = useStartCall();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");
  const [socketStatus, setSocketStatus] = useState<
    "connecting" | "open" | "closed" | "error"
  >("connecting");

  useEffect(() => {
    if (!group?.id) return;
    let unsubscribe: () => void = () => undefined;
    void subscribeGroup(
      group.id,
      () => {
        void queryClient.invalidateQueries({ queryKey: ["group", group.id] });
        void queryClient.invalidateQueries({ queryKey: ["groups"] });
      },
      setSocketStatus,
    ).then((cleanup) => {
      unsubscribe = cleanup;
    });
    return () => unsubscribe();
  }, [group?.id, queryClient]);

  if (loading && !group) return <GroupDetailSkeleton onBack={onBack} />;
  if (error && !group) {
    return (
      <div className="flex h-full flex-col">
        <DetailBackBar onBack={onBack} />
        <div className="grid flex-1 place-items-center p-6">
          <ErrorState message={friendlyError(error)} onRetry={onBack} />
        </div>
      </div>
    );
  }
  if (!group) return null;

  const owner = group.owner_id === currentUserId;
  const tabs: Array<[DetailTab, string]> = [
    ["overview", "Overview"],
    ["members", "Members"],
    ["announcements", "Announcements"],
    ["polls", "Polls"],
    ["settings", "Settings"],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative z-10 border-b border-[var(--border)] bg-[var(--panel)]/85 backdrop-blur-xl">
        <div className="flex min-h-[70px] items-center gap-3 px-3 sm:px-5">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            <ChevronLeft size={17} /> Groups
          </button>
          <Avatar name={group.name} src={group.avatar_url} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold">{group.name}</h1>
            <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              {socketStatus === "open" ? (
                <Wifi size={11} className="text-emerald-500" />
              ) : (
                <WifiOff size={11} />
              )}
              {socketStatus === "open" ? "Live updates connected" : "Reconnecting updates…"}
            </p>
          </div>
          <div className="flex gap-1">
            <HeaderIcon label="Open group chat" onClick={onOpenChat}>
              <MessageCircle size={16} />
            </HeaderIcon>
            <HeaderIcon
              label="Start group voice call"
              onClick={() => void startCall({ group_id: group.id }, "audio")}
            >
              <Phone size={16} />
            </HeaderIcon>
            <HeaderIcon
              label="Start group video call"
              onClick={() => void startCall({ group_id: group.id }, "video")}
            >
              <Video size={16} />
            </HeaderIcon>
          </div>
        </div>
        <div className="shell-scroll flex overflow-x-auto px-3 sm:px-5" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                "relative min-w-max px-3 py-3 text-xs font-semibold transition",
                tab === id ? "text-[var(--ink)]" : "text-[var(--muted)]",
              )}
            >
              {label}
              {tab === id && (
                <motion.span
                  layoutId="active-group-tab"
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]"
                />
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="shell-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16 }}
            >
              {tab === "overview" && (
                <GroupOverview
                  group={group}
                  owner={owner}
                  announcements={announcements}
                  polls={polls}
                  onOpenChat={onOpenChat}
                />
              )}
              {tab === "members" && (
                <MembersPanel group={group} owner={owner} onUpdated={onUpdated} />
              )}
              {tab === "announcements" && (
                <AnnouncementsPanel
                  group={group}
                  canManage
                  announcements={announcements}
                  onCreated={onAnnouncement}
                />
              )}
              {tab === "polls" && (
                <PollsPanel group={group} polls={polls} onCreated={onPoll} />
              )}
              {tab === "settings" && (
                <GroupSettings
                  group={group}
                  owner={owner}
                  onUpdated={onUpdated}
                  onDeleted={onDeleted}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function GroupOverview({
  group,
  owner,
  announcements,
  polls,
  onOpenChat,
}: {
  group: GroupSummary;
  owner: boolean;
  announcements: GroupAnnouncement[];
  polls: GroupPoll[];
  onOpenChat: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)]/85 shadow-xl shadow-black/5">
        <div className="relative h-40 overflow-hidden bg-[radial-gradient(circle_at_72%_30%,var(--accent),transparent_18%),radial-gradient(circle_at_top_right,var(--accent-soft),transparent_55%),linear-gradient(135deg,var(--surface-2),var(--panel))]">
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          <span className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white backdrop-blur">
            {group.visibility}
          </span>
        </div>
        <div className="px-5 pb-5 sm:px-7 sm:pb-7">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <span className="rounded-full border-4 border-[var(--surface)]">
              <Avatar name={group.name} src={group.avatar_url} size="xl" />
            </span>
            <div className="flex items-center gap-2">
              <RoleBadge role={owner ? "Owner" : "Member"} />
              <Button onClick={onOpenChat}>
                <MessageCircle size={15} /> Open chat
              </Button>
            </div>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.035em]">
            {group.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {group.description || "No description has been added yet."}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Members" value={`${group.member_count}/${group.max_members}`} />
            <MiniStat
              label="Created"
              value={new Date(group.created_at).toLocaleDateString()}
            />
            <MiniStat label="Status" value={group.is_active ? "Active" : "Inactive"} />
          </div>
        </div>
      </section>

      {announcements[0] && (
        <section className="rounded-[24px] border border-[var(--accent)]/25 bg-[var(--accent-soft)]/60 p-5">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
            <Megaphone size={13} /> Pinned announcement
          </p>
          <h3 className="mt-2 text-base font-semibold">{announcements[0].title}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {announcements[0].body}
          </p>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <InviteCodeCard group={group} />
        <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/80 p-5">
          <h3 className="text-sm font-semibold">Group activity</h3>
          <div className="mt-4 space-y-3">
            <ActivityRow
              icon={<Megaphone size={14} />}
              label="Announcements created this session"
              value={announcements.length}
            />
            <ActivityRow
              icon={<Vote size={14} />}
              label="Polls created this session"
              value={polls.length}
            />
            <ActivityRow
              icon={<UsersRound size={14} />}
              label="Current member count"
              value={group.member_count}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function InviteCodeCard({ group }: { group: GroupSummary }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(group.invite_code);
    setCopied(true);
    toast.success("Invite code copied");
    window.setTimeout(() => setCopied(false), 1500);
  }
  async function share() {
    if (navigator.share) {
      await navigator.share({
        title: `Join ${group.name} on Chatter`,
        text: `Use invite code ${group.invite_code} to join ${group.name}.`,
      });
      return;
    }
    await copy();
  }
  return (
    <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/80 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 size={15} className="text-[var(--accent)]" /> Invite code
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Share this backend-issued code with people you trust.
          </p>
        </div>
        <SoftBadge>Active</SoftBadge>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-[var(--accent)]/35 bg-[var(--accent-soft)] p-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-semibold tracking-[0.12em]">
          {group.invite_code}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy invite code"
          className="grid size-9 place-items-center rounded-xl bg-[var(--surface)] text-[var(--muted)] shadow-sm"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void share()}
          aria-label="Share invite code"
          className="grid size-9 place-items-center rounded-xl bg-[var(--surface)] text-[var(--muted)] shadow-sm"
        >
          <Share2 size={15} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <UnavailableAction icon={<RefreshCw size={14} />} label="Regenerate code" />
        <UnavailableAction icon={<QrCode size={14} />} label="Show QR code" />
      </div>
    </section>
  );
}

function MembersPanel({
  group,
  owner,
  onUpdated,
}: {
  group: GroupSummary;
  owner: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteHours, setInviteHours] = useState(72);
  const [memberQuery, setMemberQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "owner">("admin");
  const friends = useQuery({
    queryKey: ["friends", 1, 50],
    queryFn: () => friendsApi.list(1, 50),
  });
  const members = useQuery({
    queryKey: ["group-members-via-chat", group.id, group.name],
    queryFn: async () => {
      const chat = await resolveGroupChat(group);
      if (!chat) return [] as ChatParticipant[];
      const detail = await chatsApi.get(chat.id);
      return detail.participants;
    },
  });
  const invite = useMutation({
    mutationFn: async () => {
      const user = await usersApi.byUsername(
        inviteUsername.replace(/^@/, "").trim(),
      );
      return groupsApi.invite({
        group_id: group.id,
        invited_user_id: user.id,
        expires_in_hours: inviteHours,
      });
    },
    onSuccess: (inviteResult) => {
      setInviteUsername("");
      toast.success(
        `Invitation sent · expires ${new Date(inviteResult.expires_at).toLocaleString()}`,
      );
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const updateRole = useMutation({
    mutationFn: () => groupsApi.setMemberRole(group.id, userId.trim(), role),
    onSuccess: async () => {
      await onUpdated();
      void members.refetch();
      toast.success("Member role updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const remove = useMutation({
    mutationFn: () => groupsApi.removeMember(group.id, userId.trim()),
    onSuccess: async () => {
      setUserId("");
      await onUpdated();
      void members.refetch();
      toast.success("Member removed");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const filteredMembers = (members.data ?? []).filter((member) => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      member.username.toLowerCase().includes(q) ||
      (member.display_name || "").toLowerCase().includes(q)
    );
  });
  const onlineCount = (members.data ?? []).filter((member) => member.is_online)
    .length;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Invite members" icon={<UserPlus size={16} />}>
        <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
          Invitations are created by the backend and expire after the selected window.
        </p>
        <div className="flex gap-2">
          <input
            value={inviteUsername}
            onChange={(event) => setInviteUsername(event.target.value)}
            placeholder="@username"
            aria-label="Username to invite"
            className={inputClass}
          />
          <Button
            loading={invite.isPending}
            disabled={!inviteUsername.trim()}
            onClick={() => invite.mutate()}
          >
            Invite
          </Button>
        </div>
        <label className="mt-3 block text-xs text-[var(--muted)]">
          Invite expiration
          <select
            value={inviteHours}
            onChange={(event) => setInviteHours(Number(event.target.value))}
            className={cx(inputClass, "mt-1.5")}
          >
            <option value={24}>24 hours</option>
            <option value={72}>72 hours</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {(friends.data?.data ?? []).slice(0, 8).map((friend) => (
            <button
              key={friend.id}
              type="button"
              onClick={() => setInviteUsername(friend.username)}
              className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
            >
              @{friend.username}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Members" icon={<UsersRound size={16} />}>
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
          <span>
            {(members.data ?? []).length} members · {onlineCount} online
          </span>
        </div>
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3">
          <Search size={14} className="text-[var(--muted)]" />
          <input
            value={memberQuery}
            onChange={(event) => setMemberQuery(event.target.value)}
            placeholder="Search members"
            aria-label="Search members"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        {members.isLoading ? (
          <div className="space-y-2 animate-pulse">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-14 rounded-2xl bg-[var(--surface-2)]" />
            ))}
          </div>
        ) : filteredMembers.length === 0 ? (
          <EmptyState
            illustration="friends"
            title="No members found"
            description="Open the group chat once so membership can sync, or invite people above."
          />
        ) : (
          <div className="space-y-2">
            {filteredMembers.map((member) => {
              const isOwner = member.user_id === group.owner_id;
              return (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--surface-2)] p-3"
                >
                  <Avatar
                    name={member.display_name || member.username}
                    src={member.avatar_url}
                    online={member.is_online}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {member.display_name || member.username}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      @{member.username}
                      {member.joined_at
                        ? ` · joined ${formatRelativeTime(member.joined_at)}`
                        : ""}
                    </span>
                  </span>
                  <RoleBadge role={isOwner ? "Owner" : "Member"} />
                  {owner && !isOwner && (
                    <button
                      type="button"
                      aria-label={`Manage ${member.username}`}
                      onClick={() => setUserId(member.user_id)}
                      className="rounded-xl px-2 py-1 text-[11px] font-semibold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                    >
                      Manage
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {owner && (
        <Panel title="Owner member tools" icon={<ShieldCheck size={16} />}>
          <p className="mb-3 text-xs leading-5 text-[var(--muted)]">
            Select Manage on a member or paste a user UUID. Roles: Owner, Admin,
            Member.
          </p>
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Member user UUID"
            aria-label="Member user ID"
            className={inputClass}
          />
          <div className="mt-2 flex gap-2">
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as "member" | "admin" | "owner")
              }
              aria-label="Member role"
              className={cx(inputClass, "flex-1")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Transfer ownership</option>
            </select>
            <Button
              variant="secondary"
              loading={updateRole.isPending}
              disabled={!userId.trim()}
              onClick={() => updateRole.mutate()}
            >
              Update role
            </Button>
          </div>
          <Button
            variant="ghost"
            loading={remove.isPending}
            disabled={!userId.trim()}
            onClick={() => {
              if (window.confirm("Remove this member from the group?")) {
                remove.mutate();
              }
            }}
            className="mt-2 text-red-600"
          >
            <Trash2 size={14} /> Remove member
          </Button>
        </Panel>
      )}
    </div>
  );
}

function AnnouncementsPanel({
  group,
  canManage,
  announcements,
  onCreated,
}: {
  group: GroupSummary;
  canManage: boolean;
  announcements: GroupAnnouncement[];
  onCreated: (announcement: GroupAnnouncement) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      groupsApi.announcement({
        group_id: group.id,
        title: title.trim(),
        body: body.trim(),
        is_pinned: pinned,
      }),
    onSuccess: (announcement) => {
      onCreated(announcement);
      setTitle("");
      setBody("");
      toast.success("Announcement published");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
      <Panel title="Create announcement" icon={<Megaphone size={16} />}>
        {canManage ? (
          <div className="space-y-3">
            <input
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Announcement title"
              className={inputClass}
            />
            <textarea
              value={body}
              maxLength={10_000}
              rows={6}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Share an important update…"
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => setPinned(event.target.checked)}
              />
              Pin this announcement
            </label>
            <Button
              loading={create.isPending}
              disabled={!title.trim() || !body.trim()}
              onClick={() => create.mutate()}
            >
              Publish announcement
            </Button>
          </div>
        ) : (
          <PermissionNotice />
        )}
      </Panel>
      <Panel title="Announcements" icon={<Bell size={16} />}>
        {announcements.length ? (
          <div className="space-y-3">
            {announcements.map((announcement) => (
              <motion.article
                key={announcement.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">{announcement.title}</h3>
                  {announcement.is_pinned && <SoftBadge>Pinned</SoftBadge>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                  {announcement.body}
                </p>
                <p className="mt-3 text-[10px] text-[var(--muted-2)]">
                  {new Date(announcement.created_at).toLocaleString()}
                </p>
              </motion.article>
            ))}
          </div>
        ) : (
          <CompactEmpty
            icon={<Megaphone size={20} />}
            title="No announcements in this session"
            description="The backend supports creating announcements but does not expose a list endpoint."
          />
        )}
      </Panel>
    </div>
  );
}

function PollsPanel({
  group,
  polls,
  onCreated,
}: {
  group: GroupSummary;
  polls: GroupPoll[];
  onCreated: (poll: GroupPoll) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [anonymous, setAnonymous] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const validOptions = options.map((option) => option.trim()).filter(Boolean);
  const create = useMutation({
    mutationFn: () =>
      groupsApi.poll({
        group_id: group.id,
        question: question.trim(),
        options: validOptions,
        is_anonymous: anonymous,
        allows_multiple: multiple,
        closes_at: closesAt ? new Date(closesAt).toISOString() : null,
      }),
    onSuccess: (poll) => {
      onCreated(poll);
      setQuestion("");
      setOptions(["", ""]);
      setClosesAt("");
      toast.success("Poll created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[0.82fr_1.18fr]">
      <Panel title="Create poll" icon={<Vote size={16} />}>
        <div className="space-y-3">
          <input
            value={question}
            maxLength={500}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question"
            className={inputClass}
          />
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={option}
                maxLength={300}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                placeholder={`Option ${index + 1}`}
                className={inputClass}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove option ${index + 1}`}
                  onClick={() =>
                    setOptions((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)]"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={options.length >= 20}
            onClick={() => setOptions((current) => [...current, ""])}
            className="text-xs font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            + Add option
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              Anonymous voting
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(event) => setMultiple(event.target.checked)}
              />
              Allow multiple choices
            </label>
          </div>
          <Field label="Closing date (optional)">
            <input
              type="datetime-local"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Button
            loading={create.isPending}
            disabled={!question.trim() || validOptions.length < 2}
            onClick={() => create.mutate()}
          >
            Create poll
          </Button>
        </div>
      </Panel>
      <Panel title="Polls" icon={<Vote size={16} />}>
        {polls.length ? (
          <div className="space-y-3">
            {polls.map((poll) => {
              const total = poll.options.reduce(
                (sum, option) => sum + option.vote_count,
                0,
              );
              return (
                <motion.article
                  key={poll.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                >
                  <h3 className="text-sm font-semibold">{poll.question}</h3>
                  <div className="mt-3 space-y-2">
                    {poll.options.map((option) => {
                      const percentage = total
                        ? Math.round((option.vote_count / total) * 100)
                        : 0;
                      return (
                        <div key={option.id}>
                          <div className="flex justify-between text-xs">
                            <span>{option.text}</span>
                            <span className="text-[var(--muted)]">{percentage}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${percentage}%` }}
                              className="h-full rounded-full bg-[var(--accent)]"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--muted-2)]">
                    <span>{total} votes</span>
                    <span>{poll.is_closed ? "Closed" : "Open"}</span>
                  </div>
                  <UnavailableAction label="Vote — backend endpoint required" className="mt-3" />
                </motion.article>
              );
            })}
          </div>
        ) : (
          <CompactEmpty
            icon={<Vote size={20} />}
            title="No polls in this session"
            description="The backend supports creating polls but does not expose list or vote endpoints."
          />
        )}
      </Panel>
    </div>
  );
}

function GroupSettings({
  group,
  owner,
  onUpdated,
  onDeleted,
}: {
  group: GroupSummary;
  owner: boolean;
  onUpdated: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [section, setSection] = useState<
    "general" | "permissions" | "notifications" | "privacy" | "invite" | "danger"
  >("general");
  const form = useForm<SettingsForm>({
    values: {
      name: group.name,
      description: group.description ?? "",
      avatar_url: group.avatar_url ?? "",
      visibility: group.visibility === "public" ? "public" : "private",
      max_members: group.max_members,
    },
  });
  const update = useMutation({
    mutationFn: (values: SettingsForm) =>
      groupsApi.update(group.id, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        avatar_url: values.avatar_url.trim() || null,
        visibility: values.visibility,
        max_members: values.max_members,
      }),
    onSuccess: async () => {
      await onUpdated();
      toast.success("Group settings saved");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const leave = useMutation({
    mutationFn: () => groupsApi.leave(group.id),
    onSuccess: async () => {
      await onDeleted();
      toast.success("You left the group");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const remove = useMutation({
    mutationFn: () => groupsApi.remove(group.id),
    onSuccess: async () => {
      await onDeleted();
      toast.success("Group deleted");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const sections = [
    ["general", "General"],
    ["permissions", "Permissions"],
    ["notifications", "Notifications"],
    ["privacy", "Privacy"],
    ["invite", "Invite code"],
    ["danger", "Danger zone"],
  ] as const;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="h-fit rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/80 p-2">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cx(
              "w-full rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition",
              section === id
                ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <Panel title={sections.find(([id]) => id === section)?.[1] ?? "Settings"} icon={<Settings2 size={16} />}>
        {section === "general" ? (
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit((values) => update.mutate(values))}
          >
            <Field label="Group name">
              <input
                {...form.register("name", {
                  required: "Group name is required",
                  maxLength: 100,
                })}
                className={inputClass}
              />
            </Field>
            <Field label="Description">
              <textarea
                {...form.register("description")}
                rows={4}
                className={inputClass}
              />
            </Field>
            <Field label="Avatar URL">
              <input
                {...form.register("avatar_url")}
                type="url"
                className={inputClass}
              />
            </Field>
            <Field label="Maximum members">
              <input
                {...form.register("max_members", {
                  valueAsNumber: true,
                  min: 2,
                  max: 5000,
                })}
                type="number"
                min={2}
                max={5000}
                className={inputClass}
              />
            </Field>
            <Button type="submit" loading={update.isPending}>
              Save changes
            </Button>
          </form>
        ) : section === "privacy" ? (
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit((values) => update.mutate(values))}
          >
            <PrivacyPicker register={form.register("visibility")} />
            <Button type="submit" loading={update.isPending}>
              Save privacy
            </Button>
          </form>
        ) : section === "invite" ? (
          <InviteCodeCard group={group} />
        ) : section === "permissions" ? (
          <div className="space-y-3">
            <UnavailableSetting label="Join approval" />
            <UnavailableSetting label="Who can invite members" />
            <UnavailableSetting label="Member posting permissions" />
            <UnavailableSetting label="Moderator role permissions" />
          </div>
        ) : section === "notifications" ? (
          <div>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Group notification preferences are managed globally in Chatter Settings.
              The backend does not expose per-group notification overrides.
            </p>
            <UnavailableSetting label="Per-group notification overrides" className="mt-4" />
          </div>
        ) : (
          <div className="space-y-4">
            {!owner && (
              <DangerAction
                title="Leave group"
                description="You will need a valid invite code to join again."
                action="Leave"
                loading={leave.isPending}
                onClick={() => {
                  if (window.confirm("Leave this group?")) leave.mutate();
                }}
              />
            )}
            {owner && (
              <DangerAction
                title="Delete group"
                description="Permanently delete this group. This cannot be undone."
                action="Delete group"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Permanently delete “${group.name}”?`)) {
                    remove.mutate();
                  }
                }}
              />
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function CreateGroupDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (group: GroupSummary) => Promise<void>;
}) {
  const form = useForm<CreateForm>({
    defaultValues: {
      name: "",
      description: "",
      avatar_url: "",
      visibility: "private",
      max_members: 100,
    },
  });
  const create = useMutation({
    mutationFn: (values: CreateForm) =>
      groupsApi.create({
        name: values.name.trim(),
        description: values.description.trim() || null,
        avatar_url: values.avatar_url.trim() || null,
        visibility: values.visibility,
        max_members: values.max_members,
      }),
    onSuccess: async (group) => {
      await onCreated(group);
      toast.success("Group created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return (
    <Dialog title="Create a group" description="Build a private or public space for your community." onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)] p-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-[var(--surface)] text-[var(--muted)]">
            <ImageIcon size={19} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold">Avatar and banner uploads</p>
            <p className="text-[11px] text-[var(--muted)]">
              Backend upload support is required. You can provide an avatar URL below.
            </p>
          </div>
        </div>
        <Field label="Group name">
          <input
            autoFocus
            {...form.register("name", {
              required: true,
              minLength: 1,
              maxLength: 100,
            })}
            placeholder="e.g. Product Design"
            className={inputClass}
          />
        </Field>
        <Field label="Description">
          <textarea
            {...form.register("description", { maxLength: 2000 })}
            rows={3}
            placeholder="What is this group about?"
            className={inputClass}
          />
        </Field>
        <Field label="Avatar URL (optional)">
          <input
            {...form.register("avatar_url")}
            type="url"
            placeholder="https://…"
            className={inputClass}
          />
        </Field>
        <PrivacyPicker register={form.register("visibility")} />
        <Field label="Member capacity">
          <input
            {...form.register("max_members", {
              valueAsNumber: true,
              min: 2,
              max: 5000,
            })}
            type="number"
            min={2}
            max={5000}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-3">
          <UnavailableSetting label="Join approval" compact />
          <UnavailableSetting label="Invite permissions" compact />
          <UnavailableSetting label="Member permissions" compact />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            <Plus size={15} /> Create group
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function JoinGroupDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (group: GroupSummary) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const join = useMutation({
    mutationFn: () => groupsApi.join(code.trim()),
    onSuccess: async (group) => {
      await onJoined(group);
      toast.success(`Joined ${group.name}`);
    },
  });
  return (
    <Dialog
      title="Join a group"
      description="Enter an invite code issued by Chatter."
      onClose={onClose}
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[var(--muted)]">
          Invite code
        </span>
        <div className="flex gap-2">
          <input
            autoFocus
            value={code}
            maxLength={32}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && code.trim()) join.mutate();
            }}
            placeholder="e.g. CHAT-6F8A92"
            className={inputClass}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                .readText()
                .then((value) => setCode(value.trim().slice(0, 32)))
                .catch(() => toast.error("Clipboard access was denied"))
            }
          >
            <ClipboardPaste size={15} /> Paste
          </Button>
        </div>
      </label>
      {join.isError && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
          {joinError(join.error)}
        </div>
      )}
      <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <p className="text-xs font-semibold">Other ways to join</p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
          Invitations arrive through Chatter notifications. Shared group links require a
          future backend token-resolution endpoint.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={join.isPending}
          disabled={!code.trim()}
          onClick={() => join.mutate()}
        >
          Join group
        </Button>
      </div>
    </Dialog>
  );
}

function CreatedInviteDialog({
  group,
  onClose,
  onOpenChat,
}: {
  group: GroupSummary;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(group.invite_code);
    setCopied(true);
    toast.success("Invite code copied");
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Dialog
      title="Group created"
      description="Share this invite code so people can join instantly."
      onClose={onClose}
    >
      <div className="rounded-[22px] border border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)] p-4 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          Group code
        </p>
        <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.14em]">
          {group.invite_code}
        </p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />} Copy code
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.share?.({
              title: `Join ${group.name} on Chatter`,
              text: `Use invite code ${group.invite_code} to join ${group.name}.`,
            })
          }
        >
          <Share2 size={14} /> Share code
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <UnavailableAction icon={<RefreshCw size={14} />} label="Regenerate code" />
        <UnavailableAction icon={<QrCode size={14} />} label="Show QR code" />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
        <Button onClick={onOpenChat}>
          <MessageCircle size={14} /> Open chat
        </Button>
      </div>
    </Dialog>
  );
}

function PrivacyPicker({
  register,
}: {
  register: ReturnType<ReturnType<typeof useForm<CreateForm>>["register"]>;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-[var(--muted)]">
        Privacy
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 transition has-[:checked]:border-[var(--accent)]/45 has-[:checked]:bg-[var(--accent-soft)]">
          <input type="radio" value="private" {...register} className="mt-1" />
          <Lock size={15} className="mt-0.5 text-[var(--accent)]" />
          <span>
            <span className="block text-xs font-semibold">Private</span>
            <span className="text-[11px] text-[var(--muted)]">Invite code required</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 transition has-[:checked]:border-[var(--accent)]/45 has-[:checked]:bg-[var(--accent-soft)]">
          <input type="radio" value="public" {...register} className="mt-1" />
          <Globe2 size={15} className="mt-0.5 text-[var(--accent)]" />
          <span>
            <span className="block text-xs font-semibold">Public</span>
            <span className="text-[11px] text-[var(--muted)]">Visible in search</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-dialog-title"
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.985 }}
        transition={{ duration: 0.2 }}
        className="shell-scroll max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id="group-dialog-title" className="text-xl font-semibold tracking-[-0.03em]">
              {title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/82 p-4 shadow-lg shadow-black/5 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function RoleBadge({ role }: { role: string }) {
  const owner = role === "Owner";
  const admin = role === "Admin";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold",
        owner
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : admin
            ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
            : "bg-[var(--surface-2)] text-[var(--muted)]",
      )}
    >
      {owner && <Crown size={10} />}
      {role}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[var(--surface-2)] px-4 py-3">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-2)]">
        {label}
      </span>
      <span className="mt-1 block text-sm font-semibold">{value}</span>
    </div>
  );
}

function ActivityRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[var(--muted)]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function HeaderIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      className="grid size-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      {children}
    </motion.button>
  );
}

function UnavailableAction({
  icon,
  label,
  className,
}: {
  icon?: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      title="Backend support required"
      className={cx(
        "flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] text-xs text-[var(--muted-2)]",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function UnavailableSetting({
  label,
  className,
  compact = false,
}: {
  label: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-2)]/45",
        compact ? "p-2.5" : "p-3.5",
        className,
      )}
      title="Backend support required"
    >
      <span className={cx("font-medium text-[var(--muted)]", compact ? "text-[10px]" : "text-xs")}>
        {label}
      </span>
      <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--muted-2)]">
        API required
      </span>
    </div>
  );
}

function DangerAction({
  title,
  description,
  action,
  loading,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-red-600">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
      </div>
      <Button
        variant="secondary"
        loading={loading}
        onClick={onClick}
        className="border-red-500/30 text-red-600"
      >
        {action}
      </Button>
    </div>
  );
}

function PermissionNotice() {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-5 text-amber-700 dark:text-amber-300">
      Owner or administrator permission is required for this action.
    </div>
  );
}

function CompactEmpty({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
      <div>
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--muted)]">
          {icon}
        </span>
        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-center">
      <p className="text-sm text-red-600">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

function GroupSkeletons() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-44 animate-pulse rounded-[22px] border border-[var(--border)] bg-[var(--surface-2)]"
        />
      ))}
    </div>
  );
}

function GroupDetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full">
      <DetailBackBar onBack={onBack} />
      <div className="mx-auto max-w-6xl space-y-4 p-6 animate-pulse">
        <div className="h-72 rounded-[28px] bg-[var(--surface-2)]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-52 rounded-[24px] bg-[var(--surface-2)]" />
          <div className="h-52 rounded-[24px] bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}

function DetailBackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)]"
      >
        <ChevronLeft size={17} /> Groups
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-[var(--muted)]">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
