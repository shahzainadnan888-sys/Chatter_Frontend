"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Hash,
  Headphones,
  Lock,
  Megaphone,
  Plus,
  Settings,
  Volume2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, cx, Input } from "@/src/components/ui";
import {
  canManageChannels,
  canManageServer,
  hasServerPermission,
} from "@/src/lib/server-permissions";
import { friendlyError } from "@/src/lib/shell-utils";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useServerStore } from "@/src/stores/server-stores";
import type {
  ServerCategory,
  ServerChannel,
  ServerChannelType,
  ServerSidebar,
} from "@/src/types/servers";

function channelIcon(type: ServerChannelType) {
  if (type === "voice" || type === "stage" || type === "video") return Volume2;
  if (type === "announcement") return Megaphone;
  if (type === "read_only") return Lock;
  return Hash;
}

export function ServerChannelPanel({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const selectedChannelId = useServerStore((state) => state.selectedChannelId);
  const selectChannel = useServerStore((state) => state.selectChannel);
  const collapsed = useServerStore((state) => state.collapsedCategories);
  const toggleCategory = useServerStore((state) => state.toggleCategory);
  const openSettings = useServerStore((state) => state.openSettings);
  const typingByChannel = useServerStore((state) => state.typingByChannel);
  const activeVoiceChannelId = useServerStore(
    (state) => state.activeVoiceChannelId,
  );
  const voiceParticipants = useServerStore((state) => state.voiceParticipants);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ServerChannelType>("text");
  const [newCategoryId, setNewCategoryId] = useState<string>("");

  const perms = sidebar.my_permissions;
  const manageChannels = canManageChannels(perms);
  const manageServer = canManageServer(perms);

  const groups = useMemo(() => {
    const cats = [...sidebar.categories].sort((a, b) => a.position - b.position);
    const channels = [...sidebar.channels].sort(
      (a, b) => a.position - b.position,
    );
    const byCat = new Map<string | null, ServerChannel[]>();
    byCat.set(null, []);
    for (const cat of cats) byCat.set(cat.id, []);
    for (const channel of channels) {
      const key = channel.category_id;
      const list = byCat.get(key) ?? byCat.get(null)!;
      list.push(channel);
      if (!byCat.has(key)) byCat.set(key, list);
    }
    return { cats, byCat };
  }, [sidebar.categories, sidebar.channels]);

  const createChannel = useMutation({
    mutationFn: () =>
      serversApi.createChannel(sidebar.server.id, {
        name: newName.trim(),
        type: newType,
        category_id: newCategoryId || null,
      }),
    onSuccess: async (channel) => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      selectChannel(channel.id);
      setCreateOpen(false);
      setNewName("");
      toast.success("Channel created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const renameChannel = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      serversApi.updateChannel(sidebar.server.id, id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      setRenameId(null);
      toast.success("Channel renamed");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const deleteChannel = useMutation({
    mutationFn: (id: string) =>
      serversApi.deleteChannel(sidebar.server.id, id),
    onSuccess: async (_, id) => {
      if (selectedChannelId === id) selectChannel(null);
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      toast.success("Channel deleted");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const moveChannel = useMutation({
    mutationFn: ({
      id,
      position,
      category_id,
    }: {
      id: string;
      position: number;
      category_id?: string | null;
    }) =>
      serversApi.updateChannel(sidebar.server.id, id, {
        position,
        category_id,
      }),
    onMutate: async ({ id, position, category_id }) => {
      const key = SERVER_QUERY_KEYS.sidebar(sidebar.server.id);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ServerSidebar>(key);
      if (previous) {
        queryClient.setQueryData<ServerSidebar>(key, {
          ...previous,
          channels: previous.channels.map((channel) =>
            channel.id === id
              ? {
                  ...channel,
                  position,
                  category_id:
                    category_id === undefined
                      ? channel.category_id
                      : category_id,
                }
              : channel,
          ),
        });
      }
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(
          SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
          ctx.previous,
        );
      }
      toast.error(friendlyError(error));
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
    },
  });

  function renderChannel(channel: ServerChannel, siblings: ServerChannel[]) {
    const Icon = channelIcon(channel.type);
    const active = selectedChannelId === channel.id;
    const typing = typingByChannel[channel.id] ?? [];
    const isVoice =
      channel.type === "voice" ||
      channel.type === "stage" ||
      channel.type === "video";
    const idx = siblings.findIndex((item) => item.id === channel.id);

    return (
      <div key={channel.id} className="group relative px-2">
        <button
          type="button"
          onClick={() => selectChannel(channel.id)}
          onContextMenu={(event) => {
            if (!manageChannels) return;
            event.preventDefault();
            setRenameId(channel.id);
            setDraftName(channel.name);
          }}
          className={cx(
            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition",
            active
              ? "bg-[var(--surface-2)] font-semibold text-[var(--ink)]"
              : channel.unread_count > 0
                ? "font-semibold text-[var(--ink)] hover:bg-[var(--surface)]"
                : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]",
          )}
        >
          <Icon size={15} className="shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {typing.length > 0 && (
            <span className="text-[10px] text-[var(--accent)]">…</span>
          )}
          {channel.unread_count > 0 && (
            <span className="min-w-4 rounded-full bg-[var(--accent)] px-1 text-center text-[9px] font-bold text-white">
              {channel.unread_count > 99 ? "99+" : channel.unread_count}
            </span>
          )}
        </button>

        {manageChannels && (
          <div className="absolute right-3 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
            <button
              type="button"
              title="Move up"
              disabled={idx <= 0}
              className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-30"
              onClick={() => {
                const prev = siblings[idx - 1];
                if (!prev) return;
                moveChannel.mutate({
                  id: channel.id,
                  position: prev.position,
                });
                moveChannel.mutate({
                  id: prev.id,
                  position: channel.position,
                });
              }}
            >
              ↑
            </button>
            <button
              type="button"
              title="Move down"
              disabled={idx >= siblings.length - 1}
              className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-2)] disabled:opacity-30"
              onClick={() => {
                const next = siblings[idx + 1];
                if (!next) return;
                moveChannel.mutate({
                  id: channel.id,
                  position: next.position,
                });
                moveChannel.mutate({
                  id: next.id,
                  position: channel.position,
                });
              }}
            >
              ↓
            </button>
            <button
              type="button"
              title="Delete"
              className="rounded p-0.5 text-red-500 hover:bg-red-500/10"
              onClick={() => {
                if (window.confirm(`Delete #${channel.name}?`)) {
                  deleteChannel.mutate(channel.id);
                }
              }}
            >
              ×
            </button>
          </div>
        )}

        {isVoice &&
          activeVoiceChannelId === channel.id &&
          voiceParticipants.length > 0 && (
            <div className="mb-1 ml-7 space-y-0.5">
              {voiceParticipants.map((participant) => (
                <div
                  key={participant.user.id}
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
                >
                  <Headphones size={11} />
                  <span className="truncate">
                    {participant.user.display_name || participant.user.username}
                  </span>
                  {participant.muted && <span>🔇</span>}
                </div>
              ))}
            </div>
          )}

        {renameId === channel.id && (
          <form
            className="px-2 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (draftName.trim()) {
                renameChannel.mutate({
                  id: channel.id,
                  name: draftName.trim(),
                });
              }
            }}
          >
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={() => setRenameId(null)}
              className="w-full rounded-md border border-[var(--accent)] bg-[var(--surface)] px-2 py-1 text-[12px] outline-none"
            />
          </form>
        )}
      </div>
    );
  }

  function renderCategory(category: ServerCategory | null) {
    const id = category?.id ?? "__uncategorized";
    const channels = groups.byCat.get(category?.id ?? null) ?? [];
    if (!category && channels.length === 0) return null;
    const isCollapsed = Boolean(collapsed[id]);

    return (
      <div key={id} className="mb-2">
        {category && (
          <button
            type="button"
            onClick={() => toggleCategory(id)}
            className="flex w-full items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <motion.span
              animate={{ rotate: isCollapsed ? -90 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronDown size={12} />
            </motion.span>
            {category.name}
          </button>
        )}
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              {channels.map((channel) => renderChannel(channel, channels))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]">
      <div className="electron-drag flex h-14 items-center justify-between border-b border-[var(--border)]/70 px-4">
        <h2 className="electron-no-drag truncate text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {sidebar.server.name}
        </h2>
        <div className="electron-no-drag flex items-center gap-1">
          {manageChannels && (
            <button
              type="button"
              aria-label="Create channel"
              onClick={() => setCreateOpen((open) => !open)}
              className="grid size-8 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <Plus size={15} />
            </button>
          )}
          {manageServer && (
            <button
              type="button"
              aria-label="Server settings"
              onClick={() => openSettings("overview")}
              className="grid size-8 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              <Settings size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="shell-scroll min-h-0 flex-1 overflow-y-auto py-3">
        {renderCategory(null)}
        {groups.cats.map((category) => renderCategory(category))}
      </div>

      <AnimatePresence>
        {createOpen && manageChannels && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[var(--border)] p-3"
          >
            <Input
              label="Channel name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="new-channel"
            />
            <label className="mt-2 block text-[12px]">
              <span className="mb-1 block font-medium">Type</span>
              <select
                value={newType}
                onChange={(event) =>
                  setNewType(event.target.value as ServerChannelType)
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
              >
                <option value="text">Text</option>
                <option value="voice">Voice</option>
                <option value="announcement">Announcements</option>
                <option value="stage">Stage</option>
                <option value="video">Video</option>
                <option value="read_only">Read only</option>
              </select>
            </label>
            <label className="mt-2 block text-[12px]">
              <span className="mb-1 block font-medium">Category</span>
              <select
                value={newCategoryId}
                onChange={(event) => setNewCategoryId(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
              >
                <option value="">None</option>
                {sidebar.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  newName.trim().length < 1 ||
                  createChannel.isPending ||
                  !hasServerPermission(perms, "manage_channels")
                }
                onClick={() => createChannel.mutate()}
              >
                Create
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** @deprecated Prefer ServerChannelPanel — kept for compatibility. */
export const ChannelSidebar = ServerChannelPanel;
