"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ServerChannelPanel } from "@/src/features/servers/channel-sidebar";
import { MembersSidebar } from "@/src/features/servers/members-sidebar";
import { ServerChat } from "@/src/features/servers/server-chat";
import { ServerSettingsModal } from "@/src/features/servers/server-settings";
import { Button } from "@/src/components/ui";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useServerStore } from "@/src/stores/server-stores";

export function ServerWorkspace() {
  const serverId = useServerStore((state) => state.selectedServerId);
  const channelId = useServerStore((state) => state.selectedChannelId);
  const membersOpen = useServerStore((state) => state.membersOpen);
  const applySidebarDefaults = useServerStore(
    (state) => state.applySidebarDefaults,
  );
  const [channelsOpen, setChannelsOpen] = useState(true);

  const sidebar = useQuery({
    queryKey: SERVER_QUERY_KEYS.sidebar(serverId ?? "none"),
    queryFn: () => serversApi.sidebar(serverId!),
    enabled: Boolean(serverId),
  });

  useEffect(() => {
    if (sidebar.data) applySidebarDefaults(sidebar.data);
  }, [applySidebarDefaults, sidebar.data]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setChannelsOpen(!mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [serverId]);

  if (!serverId) {
    return (
      <div className="grid h-full place-items-center bg-[var(--panel)] p-8 text-center">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
            Your servers
          </h2>
          <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
            Pick a server from the left rail, or use + to create or join one.
          </p>
        </div>
      </div>
    );
  }

  if (sidebar.isLoading) {
    return (
      <div className="grid h-full grid-cols-1 gap-0 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_minmax(200px,260px)]">
        <div className="animate-pulse bg-[var(--surface)]" />
        <div className="animate-pulse bg-[var(--canvas)]" />
        <div className="hidden animate-pulse bg-[var(--surface)] xl:block" />
      </div>
    );
  }

  if (sidebar.isError || !sidebar.data) {
    return (
      <div className="grid h-full place-items-center bg-[var(--panel)] p-8 text-center">
        <div>
          <p className="font-medium text-[var(--ink)]">
            Couldn’t load this server
          </p>
          <Button className="mt-3" onClick={() => sidebar.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const channel =
    sidebar.data.channels.find((item) => item.id === channelId) ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--panel)] md:flex-row">
      <div className="absolute left-3 top-3 z-20 flex gap-2 md:hidden">
        <Button
          variant="secondary"
          className="h-8 px-2.5 text-xs"
          onClick={() => setChannelsOpen((open) => !open)}
        >
          Channels
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {channelsOpen && (
          <motion.section
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            aria-label="Server channels"
            className="absolute inset-y-0 left-0 z-30 w-[min(280px,86vw)] overflow-hidden border-r border-[var(--border)]/70 bg-[var(--panel)] shadow-xl md:relative md:z-0 md:w-[260px] md:shrink-0 md:shadow-none"
          >
            <ServerChannelPanel sidebar={sidebar.data} />
          </motion.section>
        )}
      </AnimatePresence>

      {channelsOpen && (
        <button
          type="button"
          className="absolute inset-0 z-20 bg-black/35 md:hidden"
          aria-label="Close channels"
          onClick={() => setChannelsOpen(false)}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.section
          key={channel?.id ?? "empty"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="flex min-w-0 flex-1"
          aria-label="Server conversation"
        >
          {channel ? (
            <ServerChat sidebar={sidebar.data} channel={channel} />
          ) : (
            <div className="grid flex-1 place-items-center px-6 text-center text-sm text-[var(--muted)]">
              Select a channel to start chatting
            </div>
          )}
        </motion.section>
      </AnimatePresence>

      {membersOpen && (
        <section
          aria-label="Server members"
          className="hidden min-w-0 xl:block xl:w-[240px] xl:shrink-0"
        >
          <MembersSidebar sidebar={sidebar.data} />
        </section>
      )}

      <ServerSettingsModal sidebar={sidebar.data} />
    </div>
  );
}
