"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  Clock3,
  FileText,
  Hash,
  MessageCircle,
  Search,
  Users,
  X,
} from "lucide-react";
import { cx } from "@/src/components/ui";
import { Avatar, EmptyState, SoftBadge } from "@/src/features/shell/shell-ui";
import { friendlyError, formatRelativeTime } from "@/src/lib/shell-utils";
import { chatsApi, searchApi } from "@/src/services/shell-api";
import {
  useChatStore,
  useNavigationStore,
  useProfileStore,
  useSearchStore,
} from "@/src/stores/shell-stores";

export function GlobalSearch() {
  const open = useNavigationStore((state) => state.searchOpen);
  const setSearchOpen = useNavigationStore((state) => state.setSearchOpen);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const focusGroup = useNavigationStore((state) => state.focusGroup);
  const openProfile = useProfileStore((state) => state.openProfile);
  const cacheDetail = useChatStore((state) => state.cacheDetail);
  const {
    query,
    setQuery,
    activeTab,
    setActiveTab,
    recent,
    saved,
    sort,
    setSort,
    addRecent,
    toggleSaved,
    reset,
  } = useSearchStore();
  const [debounced, setDebounced] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const enabled = open && debounced.length >= 1;
  const users = useQuery({
    queryKey: ["search-users", debounced],
    enabled,
    queryFn: () => searchApi.users(debounced, 12),
  });
  const groups = useQuery({
    queryKey: ["search-groups", debounced],
    enabled,
    queryFn: () => searchApi.groups(debounced, 12),
  });
  const messages = useQuery({
    queryKey: ["search-messages", debounced],
    enabled,
    queryFn: () => searchApi.messages(debounced, 12),
  });
  const files = useQuery({
    queryKey: ["search-files", debounced],
    enabled,
    queryFn: () => searchApi.files(debounced, 12),
  });
  const chats = useQuery({
    queryKey: ["chats", false, 1],
    enabled: open,
    queryFn: () => chatsApi.list({ page: 1, page_size: 50, archived: false }),
  });

  const chatMatches = useMemo(() => {
    const list = chats.data?.data ?? [];
    if (!debounced) return [];
    const needle = debounced.toLowerCase();
    return list.filter((chat) => {
      const haystack = `${chat.title ?? ""} ${chat.last_message_preview ?? ""} ${chat.type}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [chats.data, debounced]);

  const results = useMemo(() => {
    const items: Array<{
      id: string;
      kind: "user" | "chat" | "group" | "message" | "file";
      title: string;
      subtitle: string;
      avatar?: string | null;
      action: () => void;
    }> = [];

    if (activeTab === "all" || activeTab === "users") {
      for (const user of users.data ?? []) {
        items.push({
          id: `user-${user.id}`,
          kind: "user",
          title: user.display_name || `@${user.username}`,
          subtitle: `@${user.username}`,
          avatar: user.avatar_url,
          action: () => {
            openProfile(user.username);
            setSearchOpen(false);
            reset();
          },
        });
      }
    }
    if (activeTab === "all" || activeTab === "chats") {
      for (const chat of chatMatches) {
        items.push({
          id: `chat-${chat.id}`,
          kind: "chat",
          title: chat.title || "Conversation",
          subtitle: chat.last_message_preview || "Open conversation",
          action: () => {
            selectChat(chat.id);
            setPage("chats");
            setSearchOpen(false);
            reset();
          },
        });
      }
    }
    if (activeTab === "all" || activeTab === "groups") {
      for (const group of groups.data ?? []) {
        items.push({
          id: `group-${group.id}`,
          kind: "group",
          title: group.name,
          subtitle: group.description || `${group.member_count} members`,
          avatar: group.avatar_url,
          action: () => {
            focusGroup(group.id);
            setSearchOpen(false);
            reset();
          },
        });
      }
    }
    if (activeTab === "all" || activeTab === "messages") {
      for (const message of messages.data ?? []) {
        items.push({
          id: `message-${message.id}`,
          kind: "message",
          title: message.content,
          subtitle: formatRelativeTime(message.created_at),
          action: async () => {
            try {
              const detail = await chatsApi.get(message.chat_id);
              cacheDetail(detail);
            } catch {
              // Opening still navigates even if enrichment fails.
            }
            selectChat(message.chat_id);
            setPage("chats");
            setSearchOpen(false);
            reset();
          },
        });
      }
    }
    if (activeTab === "all" || activeTab === "files") {
      for (const file of files.data ?? []) {
        items.push({
          id: `file-${file.id}`,
          kind: "file",
          title: file.filename,
          subtitle: file.content_type,
          action: () => {
            selectChat(file.chat_id);
            setPage("chats");
            setSearchOpen(false);
            reset();
          },
        });
      }
    }
    return items;
  }, [
    activeTab,
    cacheDetail,
    chatMatches,
    focusGroup,
    files.data,
    groups.data,
    messages.data,
    openProfile,
    reset,
    selectChat,
    setPage,
    setSearchOpen,
    users.data,
  ]);

  const activeIndex =
    results.length === 0 ? -1 : Math.min(index, results.length - 1);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        reset();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => Math.min(results.length - 1, value + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      }
      if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
        event.preventDefault();
        if (debounced) addRecent(debounced);
        results[activeIndex].action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, addRecent, debounced, open, reset, results, setSearchOpen]);

  const loading =
    enabled &&
    (users.isFetching ||
      groups.isFetching ||
      messages.isFetching ||
      files.isFetching);

  const tabs = [
    { id: "all", label: "All" },
    { id: "users", label: "Users" },
    { id: "chats", label: "Chats" },
    { id: "groups", label: "Groups" },
    { id: "messages", label: "Messages" },
    { id: "files", label: "Files" },
  ] as const;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close search"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSearchOpen(false);
              reset();
            }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search Chatter"
            className="fixed left-1/2 top-4 z-50 w-[min(760px,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[24px] border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] shadow-[0_35px_100px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:top-[10vh]"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
          >
            <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)]/50 px-4 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Search size={17} />
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users, chats, groups, messages, files…"
                className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-2)]"
                aria-label="Search query"
              />
              {query.trim() && (
                <button
                  type="button"
                  aria-label="Save search"
                  onClick={() => toggleSaved(query.trim())}
                  className={cx(
                    "grid size-8 place-items-center rounded-lg",
                    saved.includes(query.trim())
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  <Bookmark size={15} fill={saved.includes(query.trim()) ? "currentColor" : "none"} />
                </button>
              )}
              <kbd className="hidden rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] sm:inline">
                Esc
              </kbd>
              <button
                type="button"
                className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
                onClick={() => {
                  setSearchOpen(false);
                  reset();
                }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto px-3 py-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cx(
                    "rounded-xl px-3 py-1.5 text-xs font-medium transition",
                    activeTab === tab.id
                      ? "bg-[var(--accent)] text-white shadow-sm"
                      : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  {tab.label}
                </button>
              ))}
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as "relevance" | "newest")
                }
                className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 text-xs text-[var(--muted)]"
                aria-label="Sort search results"
              >
                <option value="relevance">Relevance</option>
                <option value="newest">Newest</option>
              </select>
            </div>
            <div className="max-h-[52vh] overflow-y-auto p-2">
              {!debounced && (
                <div className="p-3">
                  {recent.length === 0 && saved.length === 0 ? (
                    <EmptyState
                      illustration="search"
                      title="Search everything"
                      description="Find people by @username, jump into chats, or locate messages and files."
                    />
                  ) : (
                    <div className="space-y-5">
                      {recent.length > 0 && (
                        <SearchHistory
                          icon={Clock3}
                          title="Recent searches"
                          items={recent}
                          onSelect={setQuery}
                        />
                      )}
                      {saved.length > 0 && (
                        <SearchHistory
                          icon={Bookmark}
                          title="Saved searches"
                          items={saved}
                          onSelect={setQuery}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
              {debounced && loading && (
                <p className="px-4 py-6 text-sm text-[var(--muted)]">Searching…</p>
              )}
              {debounced && !loading && results.length === 0 && (
                <EmptyState
                  illustration="search"
                  title="No results"
                  description="Try another username, keyword, or filename."
                />
              )}
              {results.map((item, itemIndex) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setIndex(itemIndex)}
                  onClick={() => {
                    addRecent(debounced);
                    item.action();
                  }}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition",
                    itemIndex === activeIndex
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--surface-2)]",
                  )}
                >
                  {item.kind === "user" || item.kind === "group" ? (
                    <Avatar name={item.title} src={item.avatar} size="sm" />
                  ) : (
                    <span className="grid size-8 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--muted)]">
                      {item.kind === "chat" && <MessageCircle size={15} />}
                      {item.kind === "message" && <Hash size={15} />}
                      {item.kind === "file" && <FileText size={15} />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      <Highlight text={item.title} query={debounced} />
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {item.subtitle}
                    </span>
                  </span>
                  <SoftBadge>
                    {item.kind === "user" ? (
                      <Users size={10} />
                    ) : (
                      item.kind
                    )}
                  </SoftBadge>
                </button>
              ))}
              {(users.isError ||
                groups.isError ||
                messages.isError ||
                files.isError) && (
                <p className="px-4 py-3 text-sm text-red-600">
                  {friendlyError(
                    users.error || groups.error || messages.error || files.error,
                  )}
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SearchHistory({
  icon: Icon,
  title,
  items,
  onSelect,
}: {
  icon: typeof Clock3;
  title: string;
  items: string[];
  onSelect: (value: string) => void;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
        <Icon size={13} /> {title}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            className="rounded-full bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--accent-soft)]"
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0 || !query) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-[var(--accent-soft)] text-inherit">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}
