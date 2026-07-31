"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  FileImage,
  Heart,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  Mic,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Smile,
  Trash2,
  Upload,
  UserRound,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/src/lib/api-client";
import { Button, cx } from "@/src/components/ui";
import type {
  StatusAuthor,
  StatusAuthorGroup,
  StatusDraft,
  StatusRecord,
  StatusSection,
  StatusViewerRecord,
} from "@/src/features/status/status-types";
import { Avatar, SoftBadge } from "@/src/features/shell/shell-ui";
import { formatRelativeTime } from "@/src/lib/shell-utils";
import {
  formatStatusRemaining,
  getStatusDayBucket,
  statusDayBucketLabel,
  type StatusDayBucket,
} from "@/src/lib/status-time";
import {
  invalidateStatusQueries,
  STATUS_QUERY_KEYS,
  statusApi,
} from "@/src/services/status-api";
import { usersApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import { useStatusStore } from "@/src/stores/status-store";

const EMPTY_GROUPS: StatusAuthorGroup[] = [];
const EMPTY_STATUSES: StatusRecord[] = [];
const BACKGROUNDS = [
  "#7c3aed",
  "#2563eb",
  "#059669",
  "#db2777",
  "#dc2626",
  "#c2410c",
  "#111827",
];
const EMOJIS = ["✨", "❤️", "😂", "🔥", "👏", "🎉", "💭", "🌙"];
const DAY_ORDER: StatusDayBucket[] = ["today", "yesterday", "older"];
const inputClass =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm outline-none transition placeholder:text-[var(--muted-2)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "This status isn't available.";
    if (error.status === 404) return "This status isn't available.";
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function StatusPage() {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((state) => state.user);
  const me = useQuery({
    queryKey: ["users-me"],
    queryFn: () => usersApi.me(),
  });
  const creatorOpen = useStatusStore((state) => state.creatorOpen);
  const openCreator = useStatusStore((state) => state.openCreator);
  const closeCreator = useStatusStore((state) => state.closeCreator);
  const activeSection = useStatusStore((state) => state.activeSection);
  const setActiveSection = useStatusStore((state) => state.setActiveSection);
  const searchQuery = useStatusStore((state) => state.searchQuery);
  const setSearchQuery = useStatusStore((state) => state.setSearchQuery);
  const selectStatus = useStatusStore((state) => state.selectStatus);
  const clearSelection = useStatusStore((state) => state.clearSelection);
  const setUpload = useStatusStore((state) => state.setUpload);
  const resetUpload = useStatusStore((state) => state.resetUpload);

  const [viewerStatuses, setViewerStatuses] = useState<StatusRecord[] | null>(
    null,
  );
  const [viewerIsPreview, setViewerIsPreview] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [selectedForDetails, setSelectedForDetails] =
    useState<StatusRecord | null>(null);

  const currentAuthor: StatusAuthor = {
    id: me.data?.id ?? authUser?.id ?? "draft-user",
    username: me.data?.username ?? authUser?.username ?? "you",
    displayName: me.data?.display_name ?? null,
    avatarUrl: me.data?.avatar_url ?? null,
  };

  const myStatusesQuery = useQuery({
    queryKey: STATUS_QUERY_KEYS.me,
    queryFn: () => statusApi.myStatuses(),
  });
  const feedQuery = useQuery({
    queryKey: STATUS_QUERY_KEYS.feed,
    queryFn: () => statusApi.feed(),
  });

  const ownStatuses = myStatusesQuery.data ?? EMPTY_STATUSES;
  const groups = feedQuery.data ?? EMPTY_GROUPS;
  const isLoading = myStatusesQuery.isLoading || feedQuery.isLoading;

  const filteredGroups = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return groups.filter((group) => {
      if (group.section !== activeSection) return false;
      if (!needle) return true;
      return `${group.author.username} ${group.author.displayName ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [activeSection, groups, searchQuery]);

  const viewersQuery = useQuery({
    queryKey: STATUS_QUERY_KEYS.viewers(selectedForDetails?.id ?? "none"),
    queryFn: () => statusApi.viewers(selectedForDetails!.id),
    enabled: Boolean(selectedForDetails?.isOwn && selectedForDetails.id),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (draft: StatusDraft) =>
      statusApi.create(draft, {
        onProgress: (pct) => setUpload("uploading", pct),
      }),
    onMutate: () => setUpload("uploading", 8),
    onSuccess: async (published) => {
      resetUpload();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEYS.me }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEYS.feed }),
      ]);
      setViewerIsPreview(false);
      setViewerStatuses([published]);
      setSelectedForDetails(published);
      selectStatus(published.author.id, published.id);
      closeCreator();
      toast.success("Status published");
    },
    onError: (error) => {
      setUpload("failed", null);
      toast.error(errorMessage(error, "Could not publish status."));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (statusId: string) => statusApi.remove(statusId),
    onSuccess: async () => {
      setViewerStatuses(null);
      setSelectedForDetails(null);
      clearSelection();
      invalidateStatusQueries((opts) =>
        queryClient.invalidateQueries(opts),
      );
      toast.success("Status deleted");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not delete status.")),
  });

  const archiveMutation = useMutation({
    mutationFn: (statusId: string) => statusApi.archive(statusId),
    onSuccess: async () => {
      setViewerStatuses(null);
      setSelectedForDetails(null);
      invalidateStatusQueries((opts) =>
        queryClient.invalidateQueries(opts),
      );
      toast.success("Status archived");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not archive status.")),
  });

  const viewMutation = useMutation({
    mutationFn: (statusId: string) => statusApi.markViewed(statusId),
    onSuccess: () => {
      invalidateStatusQueries((opts) =>
        queryClient.invalidateQueries(opts),
      );
    },
  });

  const reactMutation = useMutation({
    mutationFn: ({
      statusId,
      liked,
    }: {
      statusId: string;
      liked: boolean;
    }) => (liked ? statusApi.react(statusId) : statusApi.unreact(statusId)),
    onSuccess: (updated) => {
      setViewerStatuses((current) =>
        current?.map((status) =>
          status.id === updated.id ? updated : status,
        ) ?? null,
      );
      setSelectedForDetails((current) =>
        current?.id === updated.id ? updated : current,
      );
      invalidateStatusQueries((opts) =>
        queryClient.invalidateQueries(opts),
      );
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not update reaction.")),
  });

  const replyMutation = useMutation({
    mutationFn: ({
      statusId,
      message,
    }: {
      statusId: string;
      message: string;
    }) => statusApi.reply(statusId, message),
    onSuccess: (_reply, variables) => {
      setViewerStatuses((current) =>
        current?.map((status) =>
          status.id === variables.statusId
            ? {
                ...status,
                replyCount: (status.replyCount ?? 0) + 1,
              }
            : status,
        ) ?? null,
      );
      invalidateStatusQueries((opts) =>
        queryClient.invalidateQueries(opts),
      );
      if (selectedForDetails?.isOwn) {
        void queryClient.invalidateQueries({
          queryKey: STATUS_QUERY_KEYS.viewers(variables.statusId),
        });
      }
      toast.success("Reply sent");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not send reply.")),
  });

  const muteMutation = useMutation({
    mutationFn: ({
      authorId,
      muted,
    }: {
      authorId: string;
      muted: boolean;
    }) => (muted ? statusApi.mute(authorId) : statusApi.unmute(authorId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEYS.feed });
      toast.success("Status preferences updated");
    },
    onError: (error) =>
      toast.error(errorMessage(error, "Could not update mute.")),
  });

  function openOwnStatuses(startId?: string) {
    if (!ownStatuses.length) {
      openCreator();
      return;
    }
    setUnavailable(false);
    setViewerIsPreview(false);
    const ordered = [...ownStatuses];
    if (startId) {
      const index = ordered.findIndex((status) => status.id === startId);
      if (index > 0) {
        ordered.push(...ordered.splice(0, index));
      }
    }
    setViewerStatuses(ordered);
    setSelectedForDetails(ordered[0] ?? null);
    selectStatus(currentAuthor.id, ordered[0]?.id ?? startId ?? "");
  }

  async function openAuthorGroup(authorId: string, statusId: string) {
    const group = groups.find((entry) => entry.author.id === authorId);
    if (!group?.statuses.length) {
      setUnavailable(true);
      clearSelection();
      return;
    }
    setUnavailable(false);
    setViewerIsPreview(false);
    const ordered = [...group.statuses];
    const index = ordered.findIndex((status) => status.id === statusId);
    if (index > 0) ordered.push(...ordered.splice(0, index));
    setViewerStatuses(ordered);
    setSelectedForDetails(ordered[0] ?? null);
    selectStatus(authorId, ordered[0]?.id ?? statusId);
  }

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_30%_0%,var(--accent-soft),transparent_32%),var(--canvas)]">
      <StatusListPanel
        author={currentAuthor}
        ownStatuses={ownStatuses}
        groups={groups}
        filteredGroups={filteredGroups}
        activeSection={activeSection}
        searchQuery={searchQuery}
        loading={isLoading}
        onSearch={setSearchQuery}
        onSection={setActiveSection}
        onCreate={openCreator}
        onViewOwn={() => openOwnStatuses()}
        onOpenGroup={(authorId, statusId) => {
          void openAuthorGroup(authorId, statusId);
        }}
        onMute={(authorId, muted) =>
          muteMutation.mutate({ authorId, muted })
        }
      />

      <main className="relative min-w-0 flex-1" aria-live="polite">
        {unavailable ? (
          <StatusUnavailableState onDismiss={() => setUnavailable(false)} />
        ) : isLoading ? (
          <StatusMainSkeleton />
        ) : (
          <StatusEmptyViewer
            onCreate={openCreator}
            hasOwn={ownStatuses.length > 0}
            hasFriends={groups.some((group) => group.section === "recent")}
            onViewOwn={() => openOwnStatuses()}
          />
        )}
      </main>

      <StatusDetailsPanel
        status={selectedForDetails}
        isOwner={Boolean(selectedForDetails?.isOwn)}
        viewers={viewersQuery.data ?? []}
        loading={viewersQuery.isLoading}
        viewersError={
          viewersQuery.isError
            ? errorMessage(viewersQuery.error, "Viewers unavailable.")
            : null
        }
      />

      <AnimatePresence>
        {creatorOpen && (
          <StatusCreator
            author={currentAuthor}
            publishing={createMutation.isPending}
            onClose={() => {
              resetUpload();
              closeCreator();
            }}
            onPreview={(status) => {
              closeCreator();
              setViewerIsPreview(true);
              setViewerStatuses([status]);
            }}
            onPublish={async (draft) => {
              await createMutation.mutateAsync(draft);
            }}
          />
        )}
        {viewerStatuses && (
          <StatusViewer
            statuses={viewerStatuses}
            preview={viewerIsPreview}
            onClose={() => {
              if (viewerIsPreview) {
                viewerStatuses.forEach((status) => {
                  if (status.mediaUrl?.startsWith("blob:")) {
                    URL.revokeObjectURL(status.mediaUrl);
                  }
                });
              }
              setViewerStatuses(null);
            }}
            onActiveChange={(status) => {
              setSelectedForDetails(status);
              selectStatus(status.author.id, status.id);
              if (!viewerIsPreview && !status.isOwn && !status.viewedAt) {
                viewMutation.mutate(status.id);
              }
            }}
            onDelete={
              viewerIsPreview
                ? undefined
                : async (statusId) => {
                    await deleteMutation.mutateAsync(statusId);
                  }
            }
            onArchive={
              viewerIsPreview
                ? undefined
                : async (statusId) => {
                    await archiveMutation.mutateAsync(statusId);
                  }
            }
            onLike={async (status, liked) => {
              if (status.isOwn) {
                toast.message("You can't react to your own status.");
                return;
              }
              await reactMutation.mutateAsync({ statusId: status.id, liked });
            }}
            onReply={async (status, text) => {
              await replyMutation.mutateAsync({
                statusId: status.id,
                message: text,
              });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusListPanel({
  author,
  ownStatuses,
  groups,
  filteredGroups,
  activeSection,
  searchQuery,
  loading,
  onSearch,
  onSection,
  onCreate,
  onViewOwn,
  onOpenGroup,
  onMute,
}: {
  author: StatusAuthor;
  ownStatuses: StatusRecord[];
  groups: StatusAuthorGroup[];
  filteredGroups: StatusAuthorGroup[];
  activeSection: StatusSection;
  searchQuery: string;
  loading: boolean;
  onSearch: (value: string) => void;
  onSection: (section: StatusSection) => void;
  onCreate: () => void;
  onViewOwn: () => void;
  onOpenGroup: (authorId: string, statusId: string) => void;
  onMute: (authorId: string, muted: boolean) => void;
}) {
  const sections: Array<{ id: StatusSection; label: string; empty: string }> = [
    { id: "recent", label: "Recent updates", empty: "No recent updates" },
    { id: "viewed", label: "Viewed updates", empty: "No viewed updates" },
    { id: "muted", label: "Muted updates", empty: "No muted updates" },
  ];
  const activeMeta = sections.find((section) => section.id === activeSection)!;
  const latestOwn = ownStatuses.at(-1);
  const grouped = useMemo(() => {
    const buckets: Record<StatusDayBucket, StatusAuthorGroup[]> = {
      today: [],
      yesterday: [],
      older: [],
    };
    for (const group of filteredGroups) {
      buckets[getStatusDayBucket(group.latestAt)].push(group);
    }
    return buckets;
  }, [filteredGroups]);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]/88 sm:w-[330px] xl:w-[360px]">
      <div className="electron-drag flex min-h-[76px] items-center justify-between border-b border-[var(--border)] px-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.035em]">Status</h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Private to friends · disappears in 24h
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          aria-label="Add status"
          className="electron-no-drag grid size-10 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/20 transition hover:-translate-y-0.5"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="border-b border-[var(--border)] p-3">
        <div className="group relative flex items-center rounded-[20px] transition hover:bg-[var(--surface-2)]">
          <button
            type="button"
            onClick={ownStatuses.length ? onViewOwn : onCreate}
            className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
          >
            <span className="relative grid size-[58px] shrink-0 place-items-center">
              <motion.span
                className={cx(
                  "absolute inset-0 rounded-full",
                  ownStatuses.length
                    ? "bg-gradient-to-br from-[var(--accent)] via-pink-500 to-orange-400"
                    : "border-2 border-dashed border-[var(--accent)]",
                )}
                animate={
                  ownStatuses.length
                    ? { rotate: [0, 360] }
                    : undefined
                }
                transition={
                  ownStatuses.length
                    ? { duration: 10, repeat: Infinity, ease: "linear" }
                    : undefined
                }
              />
              <span className="absolute inset-[3px] rounded-full bg-[var(--panel)]" />
              <span className="relative z-10 grid place-items-center">
                <Avatar
                  name={author.displayName || author.username}
                  src={author.avatarUrl}
                  size="lg"
                />
              </span>
              {!ownStatuses.length && (
                <span className="absolute bottom-0 right-0 z-20 grid size-5 place-items-center rounded-full border-2 border-[var(--panel)] bg-[var(--accent)] text-white">
                  <Plus size={11} />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">My Status</span>
              <span className="block truncate text-xs text-[var(--muted)]">
                {latestOwn
                  ? `${ownStatuses.length} update${ownStatuses.length === 1 ? "" : "s"} · ${formatStatusRemaining(latestOwn.expiresAt)}`
                  : "Add a photo, video, text, or voice update"}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onCreate}
            aria-label="Add another status"
            className="mr-2 grid size-8 shrink-0 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--accent)]"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 focus-within:border-[var(--accent)]/40">
          <Search size={14} className="text-[var(--muted)]" />
          <input
            value={searchQuery}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search friends' statuses"
            aria-label="Search statuses"
            className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Clear status search"
              className="text-[var(--muted)]"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="shell-scroll mt-3 flex gap-1 overflow-x-auto" role="tablist">
          {sections.map((section) => {
            const count = groups.filter(
              (group) => group.section === section.id,
            ).length;
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeSection === section.id}
                onClick={() => onSection(section.id)}
                className={cx(
                  "whitespace-nowrap rounded-xl px-3 py-2 text-[11px] font-semibold transition",
                  activeSection === section.id
                    ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                )}
              >
                {section.label.replace(" updates", "")}
                {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shell-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
          Friends&apos; Status · {activeMeta.label}
        </p>
        {loading ? (
          <StatusListSkeleton />
        ) : filteredGroups.length ? (
          <div className="space-y-4">
            {DAY_ORDER.map((bucket) => {
              const bucketGroups = grouped[bucket];
              if (!bucketGroups.length) return null;
              return (
                <div key={bucket}>
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-2)]">
                    {statusDayBucketLabel(bucket)}
                  </p>
                  <div className="space-y-1">
                    {bucketGroups.map((group) => (
                      <StatusGroupRow
                        key={group.author.id}
                        group={group}
                        onOpen={onOpenGroup}
                        onMute={onMute}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <StatusListEmpty
            searching={Boolean(searchQuery.trim())}
            label={
              activeSection === "recent"
                ? "No status updates from your friends yet."
                : activeMeta.empty
            }
          />
        )}
      </div>
    </aside>
  );
}

const StatusGroupRow = memo(function StatusGroupRow({
  group,
  onOpen,
  onMute,
}: {
  group: StatusAuthorGroup;
  onOpen: (authorId: string, statusId: string) => void;
  onMute: (authorId: string, muted: boolean) => void;
}) {
  const latest = group.statuses.at(-1);
  if (!latest) return null;
  const viewed = group.unseenCount === 0;
  return (
    <div className="group/row relative flex items-center">
      <motion.button
        type="button"
        whileHover={{ x: 2 }}
        onClick={() => onOpen(group.author.id, latest.id)}
        aria-label={`Open status from ${group.author.displayName || group.author.username}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-2.5 py-2.5 text-left transition hover:bg-[var(--surface-2)]"
      >
        <StatusRing
          name={group.author.displayName || group.author.username}
          src={group.author.avatarUrl}
          unseen={group.unseenCount > 0}
          fresh={group.unseenCount > 0}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate text-sm font-semibold">
              {group.author.displayName || group.author.username}
            </span>
            {group.unseenCount > 0 && <SoftBadge tone="accent">New</SoftBadge>}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted)]">
            @{group.author.username} · {formatRelativeTime(group.latestAt)}
            {" · "}
            {formatStatusRemaining(latest.expiresAt)}
          </span>
        </span>
        {viewed ? (
          <span className="text-[10px] font-medium text-[var(--muted-2)]">
            Viewed
          </span>
        ) : (
          <SoftBadge tone="accent">{group.unseenCount}</SoftBadge>
        )}
      </motion.button>
      <button
        type="button"
        aria-label={
          group.section === "muted"
            ? `Unmute ${group.author.username}`
            : `Mute ${group.author.username}`
        }
        onClick={() => onMute(group.author.id, group.section !== "muted")}
        className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--muted)] opacity-0 transition hover:bg-[var(--surface)] group-hover/row:opacity-100 sm:block"
      >
        {group.section === "muted" ? "Unmute" : "Mute"}
      </button>
    </div>
  );
});

function StatusRing({
  name,
  src,
  unseen,
  fresh = false,
}: {
  name: string;
  src: string | null;
  unseen: boolean;
  fresh?: boolean;
}) {
  return (
    <motion.span
      className={cx(
        "rounded-full p-[2px]",
        unseen
          ? "bg-gradient-to-br from-[var(--accent)] via-pink-500 to-orange-400"
          : "bg-[var(--border-strong)]",
      )}
      animate={fresh ? { scale: [1, 1.06, 1] } : undefined}
      transition={fresh ? { duration: 1.8, repeat: Infinity } : undefined}
    >
      <span className="block rounded-full border-2 border-[var(--panel)]">
        <Avatar name={name} src={src} />
      </span>
    </motion.span>
  );
}

function StatusListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading statuses">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-[18px] px-2.5 py-2.5"
        >
          <span className="size-12 animate-pulse rounded-full bg-[var(--surface-2)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-28 animate-pulse rounded bg-[var(--surface-2)]" />
            <span className="block h-2.5 w-40 animate-pulse rounded bg-[var(--surface-2)]" />
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusListEmpty({
  searching,
  label,
}: {
  searching: boolean;
  label: string;
}) {
  return (
    <div className="grid min-h-48 place-items-center px-5 text-center">
      <div>
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--muted)]">
          {searching ? <Search size={18} /> : <Clock3 size={18} />}
        </span>
        <p className="mt-3 text-xs font-semibold">
          {searching ? "No results" : label}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
          {searching
            ? "Try another username or display name."
            : "Only friends and shared group members appear here — never the public."}
        </p>
      </div>
    </div>
  );
}

function StatusEmptyViewer({
  onCreate,
  hasOwn,
  hasFriends,
  onViewOwn,
}: {
  onCreate: () => void;
  hasOwn: boolean;
  hasFriends: boolean;
  onViewOwn: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid h-full place-items-center p-8 text-center"
    >
      <div className="max-w-md">
        <div className="relative mx-auto size-24">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full border border-dashed border-[var(--accent)]/45"
          />
          <span className="absolute inset-3 grid place-items-center rounded-full bg-gradient-to-br from-[var(--accent-soft)] to-[var(--surface-2)] text-[var(--accent)] shadow-xl">
            <Clock3 size={30} />
          </span>
        </div>
        <h2 className="mt-6 text-2xl font-semibold tracking-[-0.035em]">
          {hasFriends
            ? "Pick a status to view"
            : hasOwn
              ? "Your circle is quiet"
              : "Share a moment"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {hasFriends
            ? "Open a story from the sidebar. Statuses stay private to friends and shared groups."
            : hasOwn
              ? "No status updates from your friends yet."
              : "Post a photo, video, voice, or thought that disappears after 24 hours."}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onCreate}>
            <Plus size={16} /> Add status
          </Button>
          {hasOwn && (
            <Button variant="ghost" onClick={onViewOwn}>
              View my status
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatusUnavailableState({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center" role="alert">
      <div className="max-w-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--muted)]">
          <Eye size={22} />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-[-0.03em]">
          This status isn&apos;t available.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          You can only view statuses from friends, shared group members, or your
          own updates.
        </p>
        <Button className="mt-5" variant="ghost" onClick={onDismiss}>
          Back to Status
        </Button>
      </div>
    </div>
  );
}

function StatusMainSkeleton() {
  return (
    <div
      className="grid h-full place-items-center p-8"
      aria-busy="true"
      aria-label="Loading status"
    >
      <div className="w-full max-w-md space-y-4">
        <div className="mx-auto size-24 animate-pulse rounded-full bg-[var(--surface-2)]" />
        <div className="mx-auto h-6 w-48 animate-pulse rounded-lg bg-[var(--surface-2)]" />
        <div className="mx-auto h-4 w-72 animate-pulse rounded-lg bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}

function StatusDetailsPanel({
  status,
  isOwner,
  viewers,
  loading,
  viewersError,
}: {
  status: StatusRecord | null;
  isOwner: boolean;
  viewers: StatusViewerRecord[];
  loading: boolean;
  viewersError: string | null;
}) {
  return (
    <aside className="hidden w-[290px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)]/80 p-4 2xl:block">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-2)]">
        Status details
      </p>
      {!status ? (
        <div className="mt-4 grid min-h-64 place-items-center rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--surface)]/55 p-5 text-center">
          <div>
            <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--surface-2)] text-[var(--muted)]">
              <UserRound size={18} />
            </span>
            <p className="mt-3 text-xs font-semibold">No status selected</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">
              Profile information, viewers, likes, and replies will appear here.
            </p>
          </div>
        </div>
      ) : (
        <motion.div
          key={status.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/70 p-4"
        >
          <div className="flex items-center gap-3">
            <Avatar
              name={status.author.displayName || status.author.username}
              src={status.author.avatarUrl}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {status.author.displayName || status.author.username}
              </p>
              <p className="truncate text-[11px] text-[var(--muted)]">
                @{status.author.username}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            {formatRelativeTime(status.createdAt)} ·{" "}
            {formatStatusRemaining(status.expiresAt)}
          </p>
        </motion.div>
      )}
      <div className="mt-4 space-y-2">
        <DetailMetric
          icon={<Eye size={14} />}
          label="Views"
          value={isOwner ? status?.viewerCount ?? 0 : null}
          locked={!isOwner}
        />
        <DetailMetric
          icon={<Heart size={14} />}
          label="Likes"
          value={status?.likeCount ?? 0}
        />
        <DetailMetric
          icon={<MessageCircle size={14} />}
          label="Replies"
          value={status?.replyCount ?? 0}
        />
      </div>
      {isOwner && status && (
        <div className="mt-4">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-2)]">
            Viewers
          </p>
          {loading ? (
            <div className="mt-2 space-y-2">
              <div className="h-10 animate-pulse rounded-xl bg-[var(--surface-2)]" />
              <div className="h-10 animate-pulse rounded-xl bg-[var(--surface-2)]" />
            </div>
          ) : viewersError ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">{viewersError}</p>
          ) : viewers.length ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {viewers.map((viewer) => (
                <li
                  key={`${viewer.user.id}-${viewer.viewedAt}`}
                  className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs"
                >
                  <Avatar
                    name={viewer.user.displayName || viewer.user.username}
                    src={viewer.user.avatarUrl}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {viewer.user.displayName || viewer.user.username}
                  </span>
                  <span className="text-[10px] text-[var(--muted-2)]">
                    {formatRelativeTime(viewer.viewedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
              No views yet. Only you can see who opened this status.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

function DetailMetric({
  icon,
  label,
  value,
  locked = false,
}: {
  icon: ReactNode;
  label: string;
  value?: number | null;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
      <span className="grid size-8 place-items-center rounded-xl bg-[var(--surface-2)]">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span>{locked ? "Private" : value == null ? "—" : value}</span>
    </div>
  );
}

function StatusCreator({
  author,
  publishing,
  onClose,
  onPreview,
  onPublish,
}: {
  author: StatusAuthor;
  publishing: boolean;
  onClose: () => void;
  onPreview: (status: StatusRecord) => void;
  onPublish: (draft: StatusDraft) => Promise<void>;
}) {
  const uploadProgress = useStatusStore((state) => state.uploadProgress);
  const [mode, setMode] = useState<"text" | "media" | "voice">("text");
  const [draft, setDraft] = useState<StatusDraft>({
    kind: "text",
    text: "",
    caption: "",
    emoji: "",
    backgroundColor: BACKGROUNDS[0],
    visibility: "friends_and_groups",
    file: null,
    previewUrl: null,
  });
  const [dragging, setDragging] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (draft.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(draft.previewUrl);
      }
    };
  }, [draft.previewUrl]);

  function chooseFile(file: File, forceVoice = false) {
    const isVoice =
      forceVoice ||
      file.type.startsWith("audio/") ||
      mode === "voice";
    if (
      !isVoice &&
      !file.type.startsWith("image/") &&
      !file.type.startsWith("video/")
    ) {
      toast.error("Choose an image, video, or voice file.");
      return;
    }
    if (draft.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(draft.previewUrl);
    }
    const kind = isVoice
      ? "voice"
      : file.type.startsWith("video/")
        ? "video"
        : "image";
    setDraft((current) => ({
      ...current,
      kind,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setMode(isVoice ? "voice" : "media");
  }

  const canPreview =
    mode === "text"
      ? Boolean(draft.text.trim() || draft.emoji)
      : Boolean(draft.file && draft.previewUrl);

  function preview() {
    if (!canPreview) return;
    const now = Date.now();
    onPreview({
      id: crypto.randomUUID(),
      author,
      kind: mode === "text" ? "text" : draft.kind,
      text: mode === "text" ? draft.text.trim() : null,
      mediaUrl:
        mode !== "text" && draft.file
          ? URL.createObjectURL(draft.file)
          : null,
      thumbnailUrl: null,
      caption: draft.caption.trim() || null,
      emoji: draft.emoji || null,
      backgroundColor: mode === "text" ? draft.backgroundColor : null,
      visibility: draft.visibility,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      viewedAt: null,
      viewerCount: 0,
      likeCount: 0,
      replyCount: 0,
      likedByMe: false,
      isMuted: false,
      isOwn: true,
    });
  }

  async function publish() {
    if (!canPreview || publishing) return;
    setPublishError(null);
    try {
      await onPublish({
        ...draft,
        kind: mode === "text" ? "text" : draft.kind,
      });
    } catch (error) {
      setPublishError(errorMessage(error, "The status could not be published."));
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !publishing) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-creator-title"
        initial={{ opacity: 0, y: 14, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        className="shell-scroll max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="status-creator-title"
              className="text-xl font-semibold tracking-[-0.03em]"
            >
              Create status
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Visible to friends
              {draft.visibility === "friends_and_groups"
                ? " and shared groups"
                : ""}
              . Expires in 24 hours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={publishing}
            aria-label="Close status creator"
            className="grid size-9 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-[var(--surface-2)] p-1">
          {(
            [
              ["text", "Text"],
              ["media", "Photo / video"],
              ["voice", "Voice"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                if (id === "text") {
                  setDraft((current) => ({
                    ...current,
                    kind: "text",
                    file: null,
                    previewUrl: null,
                  }));
                }
              }}
              className={cx(
                "rounded-xl px-3 py-2 text-xs font-semibold transition",
                mode === id
                  ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm"
                  : "text-[var(--muted)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                visibility: "friends_and_groups",
              }))
            }
            className={cx(
              "rounded-xl px-3 py-1.5 text-[11px] font-semibold",
              draft.visibility === "friends_and_groups"
                ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                : "bg-[var(--surface-2)] text-[var(--muted)]",
            )}
          >
            Friends + groups
          </button>
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({ ...current, visibility: "friends" }))
            }
            className={cx(
              "rounded-xl px-3 py-1.5 text-[11px] font-semibold",
              draft.visibility === "friends"
                ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                : "bg-[var(--surface-2)] text-[var(--muted)]",
            )}
          >
            Friends only
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={
            mode === "voice"
              ? "audio/*"
              : "image/*,video/*"
          }
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) chooseFile(file, mode === "voice");
            event.target.value = "";
          }}
        />

        {mode === "text" ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div
              className="grid min-h-72 place-items-center rounded-[24px] p-6 text-center text-white"
              style={{ backgroundColor: draft.backgroundColor }}
            >
              <div>
                {draft.emoji && <div className="mb-3 text-5xl">{draft.emoji}</div>}
                <p className="whitespace-pre-wrap break-words text-2xl font-semibold leading-relaxed">
                  {draft.text.trim() || "Write something…"}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <textarea
                value={draft.text}
                rows={6}
                maxLength={2000}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
                placeholder="What's on your mind?"
                className={inputClass}
              />
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Background ${color}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        backgroundColor: color,
                      }))
                    }
                    className={cx(
                      "size-7 rounded-full border-2",
                      draft.backgroundColor === color
                        ? "border-[var(--ink)]"
                        : "border-transparent",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        emoji: current.emoji === emoji ? "" : emoji,
                      }))
                    }
                    className={cx(
                      "grid size-9 place-items-center rounded-xl text-lg",
                      draft.emoji === emoji
                        ? "bg-[var(--accent-soft)]"
                        : "hover:bg-[var(--surface-2)]",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div
              className={cx(
                "grid min-h-72 place-items-center rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--surface)] p-4",
                dragging && "border-[var(--accent)] bg-[var(--accent-soft)]/40",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) chooseFile(file, mode === "voice");
              }}
            >
              {draft.previewUrl && draft.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.previewUrl}
                  alt="Status preview"
                  className="max-h-80 rounded-2xl object-contain"
                />
              ) : draft.previewUrl && draft.kind === "video" ? (
                <video
                  src={draft.previewUrl}
                  controls
                  className="max-h-80 rounded-2xl"
                />
              ) : draft.previewUrl && draft.kind === "voice" ? (
                <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
                  <Mic size={32} />
                  <audio src={draft.previewUrl} controls className="w-64" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex flex-col items-center gap-2 text-[var(--muted)]"
                >
                  <Upload size={22} />
                  <span className="text-xs font-semibold">
                    {mode === "voice"
                      ? "Drop a voice note or browse"
                      : "Drop media or browse"}
                  </span>
                </button>
              )}
            </div>
            <div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  {draft.kind === "video" ? (
                    <Video size={14} />
                  ) : draft.kind === "voice" ? (
                    <Mic size={14} />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                  {draft.file?.name || "No media selected"}
                </p>
              </div>
              <textarea
                value={draft.caption}
                rows={5}
                maxLength={500}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    caption: event.target.value,
                  }))
                }
                placeholder="Add a caption…"
                className={cx(inputClass, "mt-3")}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-2.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-2)]"
              >
                <FileImage size={14} /> Replace media
              </button>
            </div>
          </div>
        )}

        {publishing && (
          <div className="mt-5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <motion.div
              className="h-1 rounded-full bg-[var(--accent)]"
              animate={{ width: `${uploadProgress ?? 18}%` }}
              transition={{ type: "spring", stiffness: 180, damping: 24 }}
            />
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center">
          <p
            className={cx(
              "min-w-0 flex-1 text-[10px] leading-4",
              publishError ? "text-red-500" : "text-[var(--muted-2)]",
            )}
          >
            {publishError ||
              "Statuses are never public. Only allowed viewers can see them."}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={publishing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canPreview || publishing}
            onClick={preview}
          >
            <Eye size={15} /> Preview
          </Button>
          <Button
            type="button"
            disabled={!canPreview || publishing}
            onClick={() => void publish()}
          >
            {publishing ? (
              <>
                <LoaderCircle size={15} className="animate-spin" /> Publishing…
              </>
            ) : publishError ? (
              "Retry publish"
            ) : (
              "Publish"
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatusViewer({
  statuses,
  preview = false,
  onClose,
  onDelete,
  onArchive,
  onLike,
  onReply,
  onActiveChange,
}: {
  statuses: StatusRecord[];
  preview?: boolean;
  onClose: () => void;
  onDelete?: (statusId: string) => Promise<void>;
  onArchive?: (statusId: string) => Promise<void>;
  onLike?: (status: StatusRecord, liked: boolean) => Promise<void>;
  onReply?: (status: StatusRecord, text: string) => Promise<void>;
  onActiveChange?: (status: StatusRecord) => void;
}) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [liked, setLiked] = useState(false);
  const [reply, setReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const active = statuses[index];
  const duration =
    active?.kind === "video" || active?.kind === "voice" ? 15_000 : 7_000;

  const next = useCallback(() => {
    if (index >= statuses.length - 1) {
      onClose();
      return;
    }
    setIndex((current) => current + 1);
    setProgress(0);
  }, [index, onClose, statuses.length]);

  const previous = useCallback(() => {
    if (index <= 0) return;
    setIndex((current) => current - 1);
    setProgress(0);
  }, [index]);

  useEffect(() => {
    setLiked(Boolean(active?.likedByMe));
    setReply("");
  }, [active?.id, active?.likedByMe]);

  useEffect(() => {
    if (active) onActiveChange?.(active);
    // Intentionally only when the active story changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (paused || !active || active.kind === "video" || active.kind === "voice") {
      return;
    }
    const step = 50;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const nextProgress = current + (step / duration) * 100;
        if (nextProgress >= 100) {
          window.clearInterval(timer);
          window.setTimeout(next, 0);
          return 100;
        }
        return nextProgress;
      });
    }, step);
    return () => window.clearInterval(timer);
  }, [active, duration, next, paused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
      if (event.key === " ") {
        event.preventDefault();
        setPaused((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose, previous]);

  if (!active) return null;
  const remainingLabel = formatStatusRemaining(active.expiresAt);
  const canLike = !preview && !active.isOwn;
  const canReply = !preview;

  async function submitReply() {
    if (!canReply || !reply.trim() || sendingReply) return;
    setSendingReply(true);
    try {
      await onReply?.(active, reply);
      setReply("");
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Status from ${active.author.displayName || active.author.username}`}
      className="fixed inset-0 z-[80] flex bg-[#05070b]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
        <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/75 to-transparent px-4 pb-14 pt-4">
          <div className="flex gap-1" aria-hidden="true">
            {statuses.map((status, statusIndex) => (
              <div
                key={status.id}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/25"
              >
                <motion.div
                  className="h-full bg-white"
                  animate={{
                    width:
                      statusIndex < index
                        ? "100%"
                        : statusIndex === index
                          ? `${progress}%`
                          : "0%",
                  }}
                  transition={{ duration: 0.06, ease: "linear" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Avatar
              name={active.author.displayName || active.author.username}
              src={active.author.avatarUrl}
            />
            <div className="min-w-0 flex-1 text-white">
              <p className="truncate text-sm font-semibold">
                {active.author.displayName || active.author.username}
              </p>
              <p className="truncate text-[11px] text-white/65">
                @{active.author.username}
                {" · "}
                {preview ? "Preview" : formatRelativeTime(active.createdAt)}
                {" · "}
                {remainingLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPaused((current) => !current)}
              aria-label={paused ? "Resume status" : "Pause status"}
              className="grid size-9 place-items-center rounded-xl text-white/80 hover:bg-white/10"
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            {(active.kind === "video" || active.kind === "voice") && (
              <button
                type="button"
                onClick={() => setMuted((current) => !current)}
                aria-label={muted ? "Unmute" : "Mute"}
                className="grid size-9 place-items-center rounded-xl text-white/80 hover:bg-white/10"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            )}
            <button
              type="button"
              ref={closeRef}
              onClick={onClose}
              aria-label="Close status viewer"
              className="grid size-9 place-items-center rounded-xl text-white/80 hover:bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active.id}
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.01 }}
            transition={{ duration: 0.2 }}
            className="grid h-full w-full place-items-center"
          >
            {active.kind === "image" && active.mediaUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.mediaUrl}
                alt={active.caption || "Status"}
                className="max-h-full max-w-full object-contain"
              />
            ) : active.kind === "video" && active.mediaUrl ? (
              <video
                src={active.mediaUrl}
                autoPlay
                muted={muted}
                playsInline
                preload="metadata"
                onTimeUpdate={(event) => {
                  const media = event.currentTarget;
                  if (!media.duration) return;
                  setProgress((media.currentTime / media.duration) * 100);
                }}
                onEnded={next}
                className="max-h-full max-w-full"
              />
            ) : active.kind === "voice" && active.mediaUrl ? (
              <div className="flex flex-col items-center gap-4 text-white">
                <Mic size={48} />
                <audio
                  src={active.mediaUrl}
                  autoPlay
                  muted={muted}
                  onTimeUpdate={(event) => {
                    const media = event.currentTarget;
                    if (!media.duration) return;
                    setProgress((media.currentTime / media.duration) * 100);
                  }}
                  onEnded={next}
                  controls
                  className="w-72"
                />
              </div>
            ) : (
              <div
                className="grid h-full w-full place-items-center p-12 text-center text-white"
                style={{
                  backgroundColor: active.backgroundColor || "#111827",
                }}
              >
                <div className="max-w-3xl">
                  {active.emoji && (
                    <div className="mb-5 text-7xl">{active.emoji}</div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-4xl font-semibold leading-relaxed">
                    {active.text}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {active.caption && (
          <div className="absolute inset-x-0 bottom-24 z-20 mx-auto max-w-2xl px-6 text-center text-sm leading-6 text-white drop-shadow">
            {active.caption}
          </div>
        )}

        <button
          type="button"
          onClick={previous}
          disabled={index === 0}
          aria-label="Previous status"
          className="absolute left-4 top-1/2 z-30 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55 disabled:opacity-0"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next status"
          className="absolute right-4 top-1/2 z-30 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55"
        >
          <ChevronRight size={22} />
        </button>

        <div className="absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-5 pb-5 pt-12">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 backdrop-blur-xl">
            <Smile size={16} className="text-white/70" />
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              disabled={!canReply}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitReply();
                }
              }}
              placeholder={
                preview ? "Replies unavailable in preview" : "Reply privately…"
              }
              aria-label="Reply to status"
              className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45 disabled:cursor-not-allowed"
            />
            <button
              type="button"
              disabled={!reply.trim() || !canReply || sendingReply}
              onClick={() => void submitReply()}
              aria-label="Send status reply"
              className="text-white disabled:opacity-35"
            >
              <Send size={16} />
            </button>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.84 }}
            disabled={!canLike}
            onClick={() => {
              const nextLiked = !liked;
              setLiked(nextLiked);
              void onLike?.(active, nextLiked)?.catch(() => {
                setLiked(!nextLiked);
              });
            }}
            aria-label={liked ? "Unlike status" : "Like status"}
            className={cx(
              "grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10 text-white backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-45",
              liked && "text-rose-500",
            )}
          >
            <Heart size={19} fill={liked ? "currentColor" : "none"} />
          </motion.button>
        </div>
      </div>

      <aside className="hidden w-[320px] shrink-0 border-l border-white/10 bg-[#0b0e14] p-5 text-white xl:block">
        <div className="flex items-center gap-3">
          <Avatar
            name={active.author.displayName || active.author.username}
            src={active.author.avatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {active.author.displayName || active.author.username}
            </p>
            <p className="truncate text-xs text-white/50">
              @{active.author.username}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <ViewerMetric
            icon={<Eye size={14} />}
            value={active.isOwn ? active.viewerCount : null}
            label="Viewed"
          />
          <ViewerMetric
            icon={<Heart size={14} />}
            value={active.likeCount}
            label="Likes"
          />
          <ViewerMetric
            icon={<MessageCircle size={14} />}
            value={active.replyCount}
            label="Replies"
          />
        </div>
        <div className="mt-5 rounded-2xl bg-white/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Expires
          </p>
          <p className="mt-1 text-sm">{remainingLabel}</p>
        </div>
        {active.kind === "text" && active.text && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(active.text || "");
              toast.success("Status text copied");
            }}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs text-white/65 transition hover:bg-white/5 hover:text-white"
          >
            <Copy size={15} /> Copy text
          </button>
        )}
        {active.isOwn && (
          <>
            <button
              type="button"
              disabled={!onArchive}
              onClick={() => void onArchive?.(active.id)}
              className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs text-white/65 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Archive size={15} /> Archive status
            </button>
            <button
              type="button"
              disabled={!onDelete}
              onClick={() => void onDelete?.(active.id)}
              className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={15} /> Delete status
            </button>
          </>
        )}
      </aside>
    </motion.div>
  );
}

function ViewerMetric({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: number | null;
  label?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 text-center">
      <span className="mx-auto grid place-items-center text-white/55">{icon}</span>
      <span className="mt-1 block text-sm font-semibold">{value ?? "—"}</span>
      {label && (
        <span className="mt-0.5 block text-[9px] uppercase tracking-wider text-white/35">
          {label}
        </span>
      )}
    </div>
  );
}
