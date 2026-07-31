"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign,
  Bell,
  CircleDashed,
  Home,
  LogOut,
  Phone,
  Plus,
  Search,
  Settings,
  UserCircle,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import { cx } from "@/src/components/ui";
import { resolveApiAssetUrl } from "@/src/lib/api-client";
import { serverInitials } from "@/src/lib/server-permissions";
import { notificationsApi } from "@/src/services/shell-api";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useAuthStore, useUserStore } from "@/src/stores/app-stores";
import { useServerStore } from "@/src/stores/server-stores";
import { useNavigationStore } from "@/src/stores/shell-stores";
import type { ShellPage } from "@/src/types/api";

const ICON = 20;
const STROKE = 1.85;

const bottomNav: Array<{
  id: ShellPage;
  label: string;
  icon: typeof Home;
  shortcut?: string;
}> = [
  { id: "chats", label: "Direct Messages", icon: AtSign, shortcut: "⌘2" },
  { id: "status", label: "Status", icon: CircleDashed, shortcut: "⌘3" },
  { id: "friends", label: "Friends", icon: Users, shortcut: "⌘5" },
  { id: "groups", label: "Groups", icon: UsersRound, shortcut: "⌘4" },
  { id: "calls", label: "Calls", icon: Phone, shortcut: "⌘6" },
  { id: "notifications", label: "Notifications", icon: Bell, shortcut: "⌘7" },
  { id: "search", label: "Search", icon: Search, shortcut: "⌘K" },
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "settings", label: "Settings", icon: Settings, shortcut: "⌘," },
];

export function PrimaryNav({
  onLogout,
  loggingOut,
}: {
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const page = useNavigationStore((state) => state.page);
  const setPage = useNavigationStore((state) => state.setPage);
  const setSearchOpen = useNavigationStore((state) => state.setSearchOpen);
  const selectChat = useNavigationStore((state) => state.selectChat);
  const selectedServerId = useServerStore((state) => state.selectedServerId);
  const selectServer = useServerStore((state) => state.selectServer);
  const openCreate = useServerStore((state) => state.openCreate);
  const openJoin = useServerStore((state) => state.openJoin);
  const authUser = useAuthStore((state) => state.user);
  const profile = useUserStore((state) => state.profile);
  const [plusOpen, setPlusOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const servers = useQuery({
    queryKey: SERVER_QUERY_KEYS.list,
    queryFn: () => serversApi.list(),
  });

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

  const sortedServers = useMemo(() => {
    const items = [...(servers.data ?? [])];
    items.sort((a, b) => {
      const aTime = Date.parse(a.server.created_at) || 0;
      const bTime = Date.parse(b.server.created_at) || 0;
      return bTime - aTime;
    });
    return items;
  }, [servers.data]);

  useEffect(() => {
    if (!plusOpen && !userMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (plusOpen && plusRef.current && !plusRef.current.contains(target)) {
        setPlusOpen(false);
      }
      if (userMenuOpen && userRef.current && !userRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPlusOpen(false);
        setUserMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [plusOpen, userMenuOpen]);

  const inServer = page === "servers" && Boolean(selectedServerId);
  const homeActive = !inServer && page === "home";
  const displayName =
    profile?.display_name || profile?.username || authUser?.username || "You";
  const avatarUrl = profile?.avatar_url
    ? resolveApiAssetUrl(profile.avatar_url)
    : null;
  const online = profile?.is_online ?? true;

  function goHome() {
    selectServer(null);
    selectChat(null);
    setPage("home");
  }

  function goPersonal(next: ShellPage) {
    selectServer(null);
    if (next === "search") {
      setSearchOpen(true);
      return;
    }
    if (next !== "chats") selectChat(null);
    setPage(next);
  }

  function openServer(serverId: string) {
    selectChat(null);
    selectServer(serverId);
    setPage("servers");
  }

  return (
    <aside
      className="primary-rail electron-drag relative z-30 flex h-full w-[72px] shrink-0 flex-col items-center"
      aria-label="Primary navigation"
    >
      {/* Top: brand + home */}
      <div className="electron-no-drag flex w-full flex-col items-center gap-2 px-3 pt-3">
        <NavTooltip label="Chatter">
          <motion.button
            type="button"
            aria-label="Chatter"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={goHome}
            className="primary-rail-brand grid size-12 place-items-center overflow-hidden outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rail-focus)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="./chatter-logo-dark.png"
              alt=""
              className="size-[28px] object-contain dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="./chatter-logo-light.png"
              alt=""
              className="hidden size-[28px] object-contain dark:block"
            />
          </motion.button>
        </NavTooltip>

        <RailButton
          label="Home"
          active={homeActive}
          onClick={goHome}
          variant="home"
        >
          <Home size={ICON} strokeWidth={STROKE} />
        </RailButton>
      </div>

      <RailDivider />

      {/* Servers, create, then app destinations */}
      <div className="shell-scroll electron-no-drag flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto px-3 py-1">
        {sortedServers.map((item) => {
          const active = inServer && selectedServerId === item.server.id;
          const icon = item.server.icon_url
            ? resolveApiAssetUrl(item.server.icon_url)
            : null;
          return (
            <RailButton
              key={item.server.id}
              label={item.server.name}
              active={active}
              unread={item.unread_count}
              onClick={() => openServer(item.server.id)}
              variant="server"
            >
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold tracking-wide">
                  {serverInitials(item.server.name)}
                </span>
              )}
            </RailButton>
          );
        })}

        <div ref={plusRef} className="relative">
          <RailButton
            label="Create Server"
            active={plusOpen}
            onClick={() => {
              setUserMenuOpen(false);
              setPlusOpen((open) => !open);
            }}
            variant="accent"
            ariaExpanded={plusOpen}
          >
            <Plus size={ICON} strokeWidth={2.25} />
          </RailButton>
          <AnimatePresence>
            {plusOpen && (
              <motion.div
                initial={{ opacity: 0, x: -8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -6, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                className="absolute left-[56px] top-0 z-50 w-48 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.65)]"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--surface)]"
                  onClick={() => {
                    setPlusOpen(false);
                    openCreate();
                  }}
                >
                  <Plus size={15} className="text-[var(--accent)]" />
                  Create Server
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--surface)]"
                  onClick={() => {
                    setPlusOpen(false);
                    openJoin();
                  }}
                >
                  <UserPlus size={15} className="text-[var(--accent)]" />
                  Join Server
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <RailDivider />

        {bottomNav.map((item) => {
          const Icon = item.icon;
          const active = !inServer && page === item.id;
          const badge =
            item.id === "notifications"
              ? notifications.data?.unread_count || 0
              : 0;
          return (
            <RailButton
              key={item.id}
              label={
                item.shortcut ? `${item.label} · ${item.shortcut}` : item.label
              }
              active={active}
              unread={badge}
              onClick={() => goPersonal(item.id)}
              variant="nav"
            >
              <Icon size={ICON} strokeWidth={STROKE} />
            </RailButton>
          );
        })}
      </div>

      {/* User avatar */}
      <div
        ref={userRef}
        className="electron-no-drag relative mt-auto flex w-full flex-col items-center px-3 pb-3 pt-2"
      >
        <NavTooltip label={displayName}>
          <motion.button
            type="button"
            aria-label={`${displayName} account menu`}
            aria-expanded={userMenuOpen}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={() => {
              setPlusOpen(false);
              setUserMenuOpen((open) => !open);
            }}
            className="primary-rail-avatar relative grid size-12 place-items-center overflow-hidden rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rail-focus)]"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-[13px] font-bold tracking-tight text-[var(--ink)]">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span
              className={cx(
                "absolute bottom-0 right-0 size-3 rounded-full ring-[3px] ring-[var(--rail-bg)]",
                online ? "bg-emerald-500" : "bg-[var(--muted-2)]",
              )}
            />
          </motion.button>
        </NavTooltip>

        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, x: -8, y: 4, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -6, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="absolute bottom-3 left-[56px] z-50 w-44 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.65)]"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--surface)]"
                onClick={() => {
                  setUserMenuOpen(false);
                  goPersonal("profile");
                }}
              >
                <UserCircle size={15} />
                Profile
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--surface)] disabled:opacity-50"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
              >
                <LogOut size={15} />
                {loggingOut ? "Signing out…" : "Log out"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  );
}

function RailDivider() {
  return <div className="primary-rail-divider" aria-hidden />;
}

function NavTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative flex justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, x: -8, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 480, damping: 30 }}
            className="pointer-events-none absolute left-[60px] top-1/2 z-[70] -translate-y-1/2"
          >
            <div className="relative whitespace-nowrap rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold tracking-[-0.01em] text-[var(--canvas)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]">
              <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rotate-45 bg-[var(--ink)]" />
              {label}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RailButton({
  label,
  active = false,
  unread = 0,
  variant = "nav",
  disabled = false,
  ariaExpanded,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  unread?: number;
  variant?: "home" | "server" | "nav" | "accent";
  disabled?: boolean;
  ariaExpanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <NavTooltip label={label}>
      <div className="relative flex h-12 w-full items-center justify-center">
        <motion.button
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          aria-expanded={ariaExpanded}
          data-variant={variant}
          data-active={active ? "true" : "false"}
          disabled={disabled}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={onClick}
          className={cx("sidebar-item", disabled && "pointer-events-none opacity-45")}
        >
          {children}
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="sidebar-item-badge"
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </motion.button>
      </div>
    </NavTooltip>
  );
}

/** Shared sidebar item — theme-aware via `.sidebar-item` tokens. */
export const SidebarItem = RailButton;

