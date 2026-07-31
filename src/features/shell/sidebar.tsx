"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AtSign,
  Bell,
  CircleDashed,
  Home,
  MoreHorizontal,
  Phone,
  Search,
  Settings,
  UserCircle,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { cx } from "@/src/components/ui";
import { SoftBadge } from "@/src/features/shell/shell-ui";
import { forceSignOut } from "@/src/lib/session";
import { notificationsApi } from "@/src/services/shell-api";
import { useServerStore } from "@/src/stores/server-stores";
import { useNavigationStore } from "@/src/stores/shell-stores";
import type { ShellPage } from "@/src/types/api";

const navItems: Array<{
  id: ShellPage;
  label: string;
  icon: typeof Home;
}> = [
  { id: "home", label: "Home", icon: Home },
  { id: "chats", label: "Messages", icon: AtSign },
  { id: "status", label: "Status", icon: CircleDashed },
  { id: "groups", label: "Groups", icon: UsersRound },
  { id: "friends", label: "People", icon: Users },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "notifications", label: "Activity", icon: Bell },
  { id: "search", label: "Search", icon: Search },
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "settings", label: "Settings", icon: Settings },
];

const mobilePrimaryItems = navItems.filter((item) =>
  ["home", "chats", "status", "groups"].includes(item.id),
);
const mobileMoreItems = navItems.filter((item) =>
  [
    "friends",
    "calls",
    "notifications",
    "search",
    "settings",
    "profile",
  ].includes(item.id),
);

export function MobileNavigation({ hidden = false }: { hidden?: boolean }) {
  const page = useNavigationStore((state) => state.page);
  const setPage = useNavigationStore((state) => state.setPage);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const selectServer = useServerStore((state) => state.selectServer);
  const [moreOpen, setMoreOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ["notifications-badge"],
    queryFn: () => notificationsApi.list({ page: 1, page_size: 1 }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: (failureCount, error) => {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: number }).status)
          : null;
      if (status === 429) return false;
      return failureCount < 1;
    },
  });
  const unread = notifications.data?.unread_count || 0;

  const openPage = (next: ShellPage) => {
    selectServer(null);
    if (next === "search") {
      useNavigationStore.getState().setSearchOpen(true);
      setMoreOpen(false);
      return;
    }
    if (next !== "chats") selectChat(null);
    setPage(next);
    setMoreOpen(false);
  };

  if (hidden) return null;

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            className="absolute inset-x-3 bottom-20 rounded-[24px] border border-[var(--border)] bg-[var(--panel)] p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between px-2 py-1">
              <div>
                <p className="text-sm font-semibold">More from Chatter</p>
                <p className="text-xs text-[var(--muted)]">Your workspace tools</p>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMoreOpen(false)}
                className="grid size-9 place-items-center rounded-xl bg-[var(--surface)] text-[var(--muted)]"
              >
                <X size={17} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {mobileMoreItems.map((item) => {
                const Icon = item.icon;
                const active = page === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openPage(item.id)}
                    className={cx(
                      "relative flex items-center gap-3 rounded-2xl border p-3 text-left text-sm font-medium transition",
                      active
                        ? "border-[var(--accent)]/25 bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)]",
                    )}
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--accent)]">
                      <Icon size={18} />
                    </span>
                    {item.label}
                    {item.id === "notifications" && unread > 0 && (
                      <SoftBadge tone="accent">{unread}</SoftBadge>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-3 bottom-3 z-30 flex h-16 items-center justify-around rounded-[22px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] px-2 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:hidden"
      >
        {mobilePrimaryItems.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openPage(item.id)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition",
                active ? "text-[var(--accent)]" : "text-[var(--muted)]",
              )}
            >
              {active && (
                <motion.span
                  layoutId="mobile-nav-active"
                  className="absolute inset-0 rounded-2xl bg-[var(--accent-soft)]"
                />
              )}
              <Icon className="relative z-10" size={19} />
              <span className="relative z-10">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((value) => !value)}
          aria-expanded={moreOpen}
          className={cx(
            "relative flex h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition",
            moreOpen || mobileMoreItems.some((item) => item.id === page)
              ? "text-[var(--accent)]"
              : "text-[var(--muted)]",
          )}
        >
          <MoreHorizontal size={19} />
          <span>More</span>
          {unread > 0 && (
            <span className="absolute right-2 top-1 size-2 rounded-full bg-red-500 ring-2 ring-[var(--panel)]" />
          )}
        </button>
      </nav>
    </>
  );
}

export function useShellLogout() {
  const queryClient = useQueryClient();

  return async () => {
    await forceSignOut(queryClient);
  };
}
