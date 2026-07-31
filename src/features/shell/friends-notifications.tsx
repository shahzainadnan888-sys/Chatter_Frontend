"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { Check, MessageCircle, Phone, Search, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import { useStartCall } from "@/src/features/calls/call-experience";
import {
  Avatar,
  EmptyState,
  PanelHeader,
  SkeletonRows,
  SoftBadge,
} from "@/src/features/shell/shell-ui";
import {
  formatRelativeTime,
  friendlyError,
} from "@/src/lib/shell-utils";
import {
  groupNotifications,
  matchesNotificationFilter,
  notificationErrorCopy,
  notificationNavTarget,
  type GroupedNotification,
} from "@/src/lib/notification-utils";
import { chatsApi, friendsApi, notificationsApi, usersApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import { useCallStore } from "@/src/stores/call-stores";
import {
  useFriendStore,
  useNavigationStore,
  useNotificationStore,
  useProfileStore,
} from "@/src/stores/shell-stores";
import type {
  FriendsTab,
  NotificationListResponse,
  UUID,
} from "@/src/types/api";

export function FriendsPage() {
  const startCall = useStartCall();
  const currentUser = useAuthStore((state) => state.user);
  const { tab, setTab, discoverQuery, setDiscoverQuery } = useFriendStore();
  const openProfile = useProfileStore((state) => state.openProfile);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const queryClient = useQueryClient();
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebounced(discoverQuery.trim().replace(/^@/, "")),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [discoverQuery]);

  const friends = useInfiniteQuery({
    queryKey: ["friends", "infinite"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => friendsApi.list(pageParam, 20),
    getNextPageParam: (last) =>
      last?.has_more ? (last.page ?? 0) + 1 : undefined,
  });
  const incoming = useQuery({
    queryKey: ["friend-requests", true],
    queryFn: () => friendsApi.requests(true, 1, 50),
  });
  const outgoing = useQuery({
    queryKey: ["friend-requests", false],
    queryFn: () => friendsApi.requests(false, 1, 50),
  });
  const blocked = useQuery({
    queryKey: ["blocked"],
    queryFn: () => friendsApi.blocked(1, 50),
  });
  const discover = useQuery({
    queryKey: ["users-search", debounced],
    enabled: tab === "discover" && debounced.length >= 2,
    queryFn: () => usersApi.search(debounced, 1, 20),
  });

  const friendList = useMemo(
    () =>
      friends.data?.pages?.flatMap((page) => page.data ?? []) ?? [],
    [friends.data],
  );
  const friendIds = useMemo(
    () => new Set(friendList.map((friend) => friend.id)),
    [friendList],
  );
  const knownUsers = useMemo(() => {
    const map = new Map<
      string,
      {
        username: string;
        display_name?: string | null;
        avatar_url?: string | null;
        is_online?: boolean;
      }
    >();
    for (const friend of friendList) map.set(friend.id, friend);
    for (const user of blocked.data?.data ?? []) map.set(user.id, user);
    for (const user of discover.data?.data ?? []) map.set(user.id, user);
    return map;
  }, [blocked.data, discover.data, friendList]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["friends"] }),
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["blocked"] }),
      queryClient.invalidateQueries({ queryKey: ["friends-all"] }),
    ]);
  };

  const send = useMutation({
    mutationFn: (user_id: UUID) => friendsApi.send(user_id),
    onSuccess: async () => {
      toast.success("Friend request sent");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const accept = useMutation({
    mutationFn: (user_id: UUID) => friendsApi.accept(user_id),
    onSuccess: async () => {
      toast.success("Request accepted");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const reject = useMutation({
    mutationFn: (user_id: UUID) => friendsApi.reject(user_id),
    onSuccess: async () => {
      toast.success("Request updated");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const remove = useMutation({
    mutationFn: (friend_id: UUID) => friendsApi.remove(friend_id),
    onSuccess: async () => {
      toast.success("Friend removed");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const openConversation = useMutation({
    mutationFn: (username: string) =>
      chatsApi.create({ participant_username: username }),
    onSuccess: (chat) => {
      selectChat(chat.id);
      setPage("chats");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const callFriend = useMutation({
    mutationFn: async (friend: {
      id: UUID;
      username: string;
      display_name?: string | null;
      avatar_url?: string | null;
    }) => {
      useCallStore.getState().setPeerMeta({
        displayName: friend.display_name || friend.username,
        username: friend.username,
        avatarUrl: friend.avatar_url,
      });
      await startCall({ receiver_id: friend.id }, "voice");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const unblock = useMutation({
    mutationFn: (user_id: UUID) => friendsApi.unblock(user_id),
    onSuccess: async () => {
      toast.success("User unblocked");
      await invalidate();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const tabs: Array<{ id: FriendsTab; label: string; count?: number }> = [
    { id: "friends", label: "Friends", count: friends.data?.pages[0]?.total },
    { id: "incoming", label: "Pending", count: incoming.data?.total },
    { id: "outgoing", label: "Sent", count: outgoing.data?.total },
    { id: "discover", label: "Suggested" },
    { id: "blocked", label: "Blocked", count: blocked.data?.total },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Friends"
        description="Manage connections, requests, and discovery."
      />
      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 backdrop-blur-xl">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition",
              tab === item.id
                ? "bg-[var(--accent)] text-white shadow-lg shadow-black/10"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
            )}
          >
            {item.label}
            {typeof item.count === "number" && item.count > 0 && (
              <SoftBadge tone={tab === item.id ? "accent" : "neutral"}>
                {item.count}
              </SoftBadge>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,var(--accent-soft),transparent_34%)] p-4">
        {tab === "discover" && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3">
            <Search size={15} className="text-[var(--muted)]" />
            <input
              value={discoverQuery}
              onChange={(event) => setDiscoverQuery(event.target.value)}
              placeholder="Search by @username"
              className="h-11 flex-1 bg-transparent text-sm outline-none"
              aria-label="Discover people"
            />
          </div>
        )}

        {tab === "friends" && (
          <>
            {friends.isLoading && <SkeletonRows />}
            {!friends.isLoading && friendList.length === 0 && (
              <EmptyState
                illustration="friends"
                title="No friends yet"
                description="Search for people by @username and send a friend request."
                action={
                  <Button onClick={() => setTab("discover")}>Find people</Button>
                }
              />
            )}
            {friendList.some((friend) => friend.is_online) && (
              <section className="mb-4">
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
                  Online now
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {friendList
                    .filter((friend) => friend.is_online)
                    .slice(0, 8)
                    .map((friend) => (
                      <button
                        key={friend.id}
                        type="button"
                        onClick={() => openProfile(friend.username)}
                        className="flex min-w-24 flex-col items-center rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-3 py-3 transition hover:border-[var(--accent)]/30 hover:bg-[var(--accent-soft)]"
                      >
                        <Avatar
                          name={friend.display_name || friend.username}
                          src={friend.avatar_url}
                          online
                        />
                        <span className="mt-2 max-w-20 truncate text-xs font-semibold">
                          {friend.display_name || friend.username}
                        </span>
                      </button>
                    ))}
                </div>
                <p className="mb-2 mt-5 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
                  All friends
                </p>
              </section>
            )}
            {friendList.map((friend) => (
              <div
                key={friend.id}
                className="group mb-2 flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-4 py-3 shadow-[0_14px_35px_-30px_rgba(0,0,0,0.7)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => openProfile(friend.username)}
                >
                  <Avatar
                    name={friend.display_name || friend.username}
                    src={friend.avatar_url}
                    online={friend.is_online}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {friend.display_name || friend.username}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      @{friend.username}
                    </span>
                  </span>
                </button>
                <SoftBadge tone={friend.is_online ? "success" : "neutral"}>
                  {friend.is_online ? "Online" : "Offline"}
                </SoftBadge>
                <Button
                  variant="ghost"
                  onClick={() => openConversation.mutate(friend.username)}
                  aria-label={`Message ${friend.username}`}
                >
                  <MessageCircle size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => callFriend.mutate(friend)}
                  aria-label={`Call ${friend.username}`}
                >
                  <Phone size={15} />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => remove.mutate(friend.id)}
                  aria-label={`Remove ${friend.username}`}
                >
                  <UserMinus size={15} />
                </Button>
              </div>
            ))}
            {friends.hasNextPage && (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                loading={friends.isFetchingNextPage}
                onClick={() => void friends.fetchNextPage()}
              >
                Load more
              </Button>
            )}
          </>
        )}

        {tab === "incoming" && (
          <>
            {incoming.isLoading && <SkeletonRows />}
            {!incoming.isLoading && (incoming.data?.data?.length ?? 0) === 0 && (
              <EmptyState
                illustration="friends"
                title="No pending requests"
                description="When someone wants to connect, their request will appear here."
              />
            )}
            {(incoming.data?.data ?? []).map((request) => {
              const known = knownUsers.get(request.from_user_id);
              return (
                <div
                  key={request.id}
                  className="mb-2 flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-4 py-3 transition hover:border-[var(--border-strong)]"
                >
                  <Avatar
                    name={known?.username || "User"}
                    src={known?.avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {known?.display_name ||
                        (known ? `@${known.username}` : "Incoming request")}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {formatRelativeTime(request.created_at)}
                    </p>
                  </div>
                  <Button
                    onClick={() => accept.mutate(request.from_user_id)}
                    loading={accept.isPending}
                  >
                    <Check size={15} /> Accept
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => reject.mutate(request.from_user_id)}
                    loading={reject.isPending}
                  >
                    <X size={15} />
                  </Button>
                </div>
              );
            })}
          </>
        )}

        {tab === "outgoing" && (
          <>
            {outgoing.isLoading && <SkeletonRows />}
            {!outgoing.isLoading && (outgoing.data?.data?.length ?? 0) === 0 && (
              <EmptyState
                illustration="friends"
                title="No sent requests"
                description="Friend requests you send will wait here until they’re answered."
              />
            )}
            {(outgoing.data?.data ?? []).map((request) => {
              const known = knownUsers.get(request.to_user_id);
              return (
                <div
                  key={request.id}
                  className="mb-2 flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-4 py-3 transition hover:border-[var(--border-strong)]"
                >
                  <Avatar
                    name={known?.username || "User"}
                    src={known?.avatar_url}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {known?.display_name ||
                        (known ? `@${known.username}` : "Outgoing request")}
                    </p>
                    <p className="text-xs text-[var(--muted)]">Pending</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => reject.mutate(request.to_user_id)}
                    loading={reject.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              );
            })}
          </>
        )}

        {tab === "discover" && (
          <>
            {debounced.length < 2 && (
              <EmptyState
                illustration="friends"
                title="Find people on Chatter"
                description="Type at least 2 characters of a username to search the directory."
              />
            )}
            {discover.isLoading && <SkeletonRows />}
            {discover.isError && (
              <p className="px-3 py-4 text-sm text-red-600">
                {friendlyError(discover.error)}
              </p>
            )}
            {debounced.length >= 2 &&
              !discover.isLoading &&
              (discover.data?.data?.length ?? 0) === 0 && (
                <EmptyState
                  illustration="search"
                  title="No people found"
                  description="Try another @username spelling."
                />
              )}
            {(discover.data?.data ?? [])
              .filter((user) => user.id !== currentUser?.id)
              .map((user) => {
                const alreadyFriend = friendIds.has(user.id);
                const pendingOut = (outgoing.data?.data ?? []).some(
                  (request) => request.to_user_id === user.id,
                );
                return (
                  <div
                    key={user.id}
                    className="mb-2 flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-4 py-3 transition hover:border-[var(--border-strong)]"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => openProfile(user.username)}
                    >
                      <Avatar
                        name={user.display_name || user.username}
                        src={user.avatar_url}
                        online={user.is_online}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {user.display_name || user.username}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          @{user.username}
                        </span>
                      </span>
                    </button>
                    {alreadyFriend ? (
                      <SoftBadge tone="success">Friends</SoftBadge>
                    ) : pendingOut ? (
                      <SoftBadge>Pending</SoftBadge>
                    ) : (
                      <Button
                        onClick={() => send.mutate(user.id)}
                        loading={send.isPending}
                      >
                        <UserPlus size={15} /> Add
                      </Button>
                    )}
                  </div>
                );
              })}
          </>
        )}

        {tab === "blocked" && (
          <>
            {blocked.isLoading && <SkeletonRows />}
            {!blocked.isLoading && (blocked.data?.data?.length ?? 0) === 0 && (
              <EmptyState
                illustration="friends"
                title="No blocked users"
                description="People you block will appear here."
              />
            )}
            {(blocked.data?.data ?? []).map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-[var(--surface-2)]"
              >
                <Avatar
                  name={user.display_name || user.username}
                  src={user.avatar_url}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {user.display_name || user.username}
                  </p>
                  <p className="text-xs text-[var(--muted)]">@{user.username}</p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => unblock.mutate(user.id)}
                  loading={unblock.isPending}
                >
                  Unblock
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function NotificationsPage() {
  const selected = useNotificationStore((state) => state.category);
  const setCategory = useNotificationStore((state) => state.setCategory);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const openProfile = useProfileStore((state) => state.openProfile);
  const focusGroup = useNavigationStore((state) => state.focusGroup);
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  const list = useInfiniteQuery({
    queryKey: ["notifications", "infinite"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      notificationsApi.list({ page: pageParam, page_size: 30 }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: number }).status)
          : null;
      if (status === 429) return false;
      return failureCount < 1;
    },
  });

  const flatItems = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data],
  );
  const unreadCount = list.data?.pages[0]?.unread_count ?? 0;

  const filtered = useMemo(
    () =>
      flatItems.filter((item) => matchesNotificationFilter(item, selected)),
    [flatItems, selected],
  );

  const grouped = useMemo(() => groupNotifications(filtered), [filtered]);

  const virtualizer = useVirtualizer({
    count: grouped.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!list.hasNextPage || list.isFetchingNextPage) return;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining < 240) void list.fetchNextPage();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [list]);

  const invalidateNotifications = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications-badge"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications", "home"] }),
    ]);
  };

  const markRead = useMutation({
    mutationFn: (ids: UUID[]) => notificationsApi.markRead(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const idSet = new Set(ids);
      queryClient.setQueriesData<NotificationListResponse>(
        { queryKey: ["notifications"] },
        (current) => {
          if (!current?.items) return current;
          let newlyRead = 0;
          const items = current.items.map((item) => {
            if (!idSet.has(item.id) || item.is_read) return item;
            newlyRead += 1;
            return {
              ...item,
              is_read: true,
              read_at: new Date().toISOString(),
            };
          });
          return {
            ...current,
            items,
            unread_count: Math.max(0, current.unread_count - newlyRead),
          };
        },
      );
      queryClient.setQueriesData(
        { queryKey: ["notifications", "infinite"] },
        (current: unknown) => {
          if (!current || typeof current !== "object" || !("pages" in current)) {
            return current;
          }
          const infinite = current as {
            pages: NotificationListResponse[];
            pageParams: unknown[];
          };
          let newlyRead = 0;
          const pages = infinite.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              if (!idSet.has(item.id) || item.is_read) return item;
              newlyRead += 1;
              return {
                ...item,
                is_read: true,
                read_at: new Date().toISOString(),
              };
            }),
            unread_count: Math.max(0, page.unread_count - newlyRead),
          }));
          return { ...infinite, pages };
        },
      );
    },
    onError: (error) => {
      toast.error(friendlyError(error));
      void invalidateNotifications();
    },
    onSettled: () => {
      void invalidateNotifications();
    },
  });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      queryClient.setQueriesData<NotificationListResponse>(
        { queryKey: ["notifications"] },
        (current) => {
          if (!current?.items) return current;
          return {
            ...current,
            unread_count: 0,
            items: current.items.map((item) => ({
              ...item,
              is_read: true,
              read_at: item.read_at ?? new Date().toISOString(),
            })),
          };
        },
      );
      queryClient.setQueriesData(
        { queryKey: ["notifications", "infinite"] },
        (current: unknown) => {
          if (!current || typeof current !== "object" || !("pages" in current)) {
            return current;
          }
          const infinite = current as {
            pages: NotificationListResponse[];
            pageParams: unknown[];
          };
          return {
            ...infinite,
            pages: infinite.pages.map((page) => ({
              ...page,
              unread_count: 0,
              items: page.items.map((item) => ({
                ...item,
                is_read: true,
                read_at: item.read_at ?? new Date().toISOString(),
              })),
            })),
          };
        },
      );
    },
    onSuccess: () => toast.success("All notifications marked read"),
    onError: (error) => {
      toast.error(friendlyError(error));
      void invalidateNotifications();
    },
    onSettled: () => {
      void invalidateNotifications();
    },
  });

  const remove = useMutation({
    mutationFn: (id: UUID) => notificationsApi.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      queryClient.setQueriesData(
        { queryKey: ["notifications", "infinite"] },
        (current: unknown) => {
          if (!current || typeof current !== "object" || !("pages" in current)) {
            return current;
          }
          const infinite = current as {
            pages: NotificationListResponse[];
            pageParams: unknown[];
          };
          return {
            ...infinite,
            pages: infinite.pages.map((page) => {
              const removed = page.items.find((item) => item.id === id);
              return {
                ...page,
                total: Math.max(0, page.total - (removed ? 1 : 0)),
                unread_count: Math.max(
                  0,
                  page.unread_count - (removed && !removed.is_read ? 1 : 0),
                ),
                items: page.items.filter((item) => item.id !== id),
              };
            }),
          };
        },
      );
    },
    onError: (error) => {
      toast.error(friendlyError(error));
      void invalidateNotifications();
    },
    onSettled: () => {
      void invalidateNotifications();
    },
  });

  function openGrouped(group: GroupedNotification) {
    const unreadIds = group.items
      .filter((item) => !item.is_read)
      .map((item) => item.id);
    if (unreadIds.length) markRead.mutate(unreadIds);

    const target = notificationNavTarget(group.primary);
    if (!target) return;
    if (target.chatId) {
      selectChat(target.chatId);
      setPage("chats");
      return;
    }
    if (target.page === "friends") {
      setPage("friends");
      return;
    }
    if (target.page === "status") {
      setPage("status");
      return;
    }
    if (target.page === "groups") {
      if (target.groupId) focusGroup(target.groupId);
      else setPage("groups");
      return;
    }
    if (target.page === "calls") {
      setPage("calls");
      return;
    }
    if (target.username) openProfile(target.username);
    setPage(target.page);
  }

  const categories = [
    { id: "all", label: "All" },
    { id: "friend_request", label: "Friend requests" },
    { id: "mention", label: "Mentions" },
    { id: "message", label: "Messages" },
    { id: "call", label: "Calls" },
    { id: "group", label: "Groups" },
    { id: "status", label: "Status" },
    { id: "system", label: "System" },
  ] as const;

  const errorCopy = list.isError ? notificationErrorCopy(list.error) : null;
  const showEmpty =
    list.isSuccess && !list.isLoading && grouped.length === 0 && !list.isError;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Notifications"
        description={
          list.isSuccess
            ? `${unreadCount} unread`
            : "Updates from across Chatter"
        }
        actions={
          <Button
            variant="secondary"
            loading={markAll.isPending}
            disabled={!list.isSuccess || unreadCount === 0}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        }
      />
      <div
        className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)]/80 px-4 py-3 backdrop-blur-xl"
        role="tablist"
        aria-label="Notification filters"
      >
        {categories.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected === item.id}
            onClick={() => setCategory(item.id)}
            className={cx(
              "rounded-xl px-3 py-2 text-xs font-medium transition",
              selected === item.id
                ? "bg-[var(--accent)] text-white shadow-lg shadow-black/10"
                : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,var(--accent-soft),transparent_35%)] p-4"
        aria-busy={list.isLoading}
      >
        {list.isLoading && <NotificationSkeleton />}

        {list.isError && errorCopy && (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="max-w-sm rounded-[24px] border border-[var(--border)] bg-[var(--surface)]/80 p-6">
              <p className="text-base font-semibold">{errorCopy.title}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {errorCopy.description}
              </p>
              <Button
                className="mt-5"
                loading={list.isFetching}
                onClick={() => void list.refetch()}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {showEmpty && (
          <EmptyState
            illustration="notifications"
            title="No notifications"
            description="You're all clear. New activity will land here."
          />
        )}

        {list.isSuccess && grouped.length > 0 && (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const group = grouped[row.index]!;
              const unread = group.items.some((item) => !item.is_read);
              return (
                <motion.div
                  key={group.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-0 right-0 px-0"
                  style={{
                    transform: `translateY(${row.start}px)`,
                  }}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                >
                  <div
                    className={cx(
                      "relative mb-2 flex items-start gap-3 rounded-[20px] border px-4 py-3.5 shadow-[0_14px_36px_-32px_rgba(0,0,0,0.7)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)]",
                      unread
                        ? "border-[var(--accent)]/20 bg-[var(--accent-soft)]/50"
                        : "border-[var(--border)] bg-[var(--surface)]/75",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      onClick={() => openGrouped(group)}
                      aria-label={group.title}
                    >
                      <span className="relative mt-0.5 shrink-0">
                        <Avatar
                          name={group.actorName || group.title}
                          src={group.actorAvatar}
                        />
                        {unread && (
                          <motion.span
                            className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[var(--accent)]"
                            animate={{ scale: [1, 1.25, 1] }}
                            transition={{ duration: 1.6, repeat: Infinity }}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">
                          {group.title}
                        </span>
                        {group.body && (
                          <span className="mt-1 block truncate text-sm text-[var(--muted)]">
                            {group.body}
                          </span>
                        )}
                        <span className="mt-2 block text-[11px] text-[var(--muted)]">
                          {formatRelativeTime(group.primary.created_at)}
                          {group.kind === "status_views" && group.count > 1
                            ? ` · ${group.count} views`
                            : ""}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      {unread && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            markRead.mutate(
                              group.items
                                .filter((item) => !item.is_read)
                                .map((item) => item.id),
                            )
                          }
                        >
                          Read
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => {
                          for (const item of group.items) {
                            remove.mutate(item.id);
                          }
                        }}
                        aria-label="Delete notification"
                      >
                        <X size={15} />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {list.isFetchingNextPage && (
          <div className="py-3 text-center text-xs text-[var(--muted)]">
            Loading more…
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3.5"
        >
          <span className="mt-0.5 size-10 animate-pulse rounded-full bg-[var(--surface-2)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 w-2/3 animate-pulse rounded bg-[var(--surface-2)]" />
            <span className="block h-3 w-full animate-pulse rounded bg-[var(--surface-2)]" />
            <span className="block h-2.5 w-24 animate-pulse rounded bg-[var(--surface-2)]" />
          </span>
        </div>
      ))}
    </div>
  );
}
