"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CallOverlay, CallsBootstrap } from "@/src/features/calls/call-experience";
import { RealtimeBootstrap } from "@/src/features/messaging/realtime-bootstrap";
import { MediaViewer } from "@/src/features/media/media-viewer";
import { ServerModals } from "@/src/features/servers/server-modals";
import { ServerRealtime } from "@/src/features/servers/server-realtime";
import { GlobalSearch } from "@/src/features/shell/global-search";
import { ConnectionBanner } from "@/src/features/shell/connection-banner";
import { PrimaryNav } from "@/src/features/shell/primary-nav";
import { ProfileDrawer } from "@/src/features/shell/profile-drawer";
import { PageFade } from "@/src/features/shell/shell-ui";
import {
  MobileNavigation,
  useShellLogout,
} from "@/src/features/shell/sidebar";
import { getLocalPreferences } from "@/src/lib/api-client";
import { cycleTheme, isTypingTarget } from "@/src/lib/production-utils";
import { forceSignOut } from "@/src/lib/session";
import { friendlyError } from "@/src/lib/shell-utils";
import { prompt4SettingsApi } from "@/src/services/prompt4-api";
import { usersApi } from "@/src/services/shell-api";
import {
  useThemeStore,
  useUserStore,
} from "@/src/stores/app-stores";
import { useMediaStore } from "@/src/stores/feature-stores";
import { useMessagingStore } from "@/src/stores/messaging-store";
import { useServerStore } from "@/src/stores/server-stores";
import {
  useNavigationStore,
  useProfileStore,
} from "@/src/stores/shell-stores";
import type { ShellPage } from "@/src/types/api";

const shortcutPages: ShellPage[] = [
  "home",
  "chats",
  "status",
  "groups",
  "friends",
  "calls",
  "notifications",
  "ai",
];

const ConversationPanel = lazy(() =>
  import("@/src/features/messaging/conversation-panel").then((module) => ({
    default: module.ConversationPanel,
  })),
);
const GroupsPage = lazy(() =>
  import("@/src/features/messaging/groups-page").then((module) => ({
    default: module.GroupsPage,
  })),
);
const StatusPage = lazy(() =>
  import("@/src/features/status/status-page").then((module) => ({
    default: module.StatusPage,
  })),
);
const CallsPage = lazy(() =>
  import("@/src/features/calls/call-experience").then((module) => ({
    default: module.CallsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/src/features/settings/settings-profile").then((module) => ({
    default: module.SettingsPage,
  })),
);
const ProfileManagementPage = lazy(() =>
  import("@/src/features/settings/settings-profile").then((module) => ({
    default: module.ProfileManagementPage,
  })),
);
const ChatsPage = lazy(() =>
  import("@/src/features/shell/home-chats").then((module) => ({
    default: module.ChatsPage,
  })),
);
const HomePage = lazy(() =>
  import("@/src/features/shell/home-chats").then((module) => ({
    default: module.HomePage,
  })),
);
const FriendsPage = lazy(() =>
  import("@/src/features/shell/friends-notifications").then((module) => ({
    default: module.FriendsPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("@/src/features/shell/friends-notifications").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const AiAssistantPage = lazy(() =>
  import("@/src/features/ai/ai-assistant").then((module) => ({
    default: module.AiAssistantPage,
  })),
);

const ServerWorkspace = lazy(() =>
  import("@/src/features/servers/server-workspace").then((module) => ({
    default: module.ServerWorkspace,
  })),
);

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center p-8" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-full bg-[var(--surface-2)]" />
    </div>
  );
}

export function DesktopShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const page = useNavigationStore((state) => state.page);
  const setPage = useNavigationStore((state) => state.setPage);
  const setSearchOpen = useNavigationStore((state) => state.setSearchOpen);
  const searchOpen = useNavigationStore((state) => state.searchOpen);
  const toggleSidebar = useNavigationStore((state) => state.toggleSidebar);
  const selectedChatId = useNavigationStore((state) => state.selectedChatId);
  const requestCompose = useNavigationStore((state) => state.requestCompose);
  const setAccent = useThemeStore((state) => state.setAccent);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const setProfile = useUserStore((state) => state.setProfile);
  const closeProfile = useProfileStore((state) => state.closeProfile);
  const profileOpen = useProfileStore((state) => state.open);
  const mediaOpen = useMediaStore((state) => state.open);
  const closeMedia = useMediaStore((state) => state.close);
  const messagingSearchOpen = useMessagingStore((state) => state.searchOpen);
  const setMessagingSearchOpen = useMessagingStore((state) => state.setSearchOpen);
  const setMoreOpen = useMessagingStore((state) => state.setMoreOpen);
  const setPinnedOpen = useMessagingStore((state) => state.setPinnedOpen);
  const setForwardMessage = useMessagingStore((state) => state.setForwardMessage);
  const selectServer = useServerStore((state) => state.selectServer);
  const logout = useShellLogout();
  const [loggingOut, setLoggingOut] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(
    Boolean(selectedChatId),
  );
  const previousChatId = useRef(selectedChatId);

  const me = useQuery({
    queryKey: ["users-me"],
    queryFn: () => usersApi.me(),
  });
  const prefs = useQuery({
    queryKey: ["local-preferences"],
    queryFn: getLocalPreferences,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: prompt4SettingsApi.get,
  });

  const themeMutation = useMutation({
    mutationFn: (next: "light" | "dark" | "system") =>
      prompt4SettingsApi.theme({ theme: next }),
    onSuccess: async (result) => {
      const next = ["light", "dark", "system"].includes(result.theme)
        ? (result.theme as "light" | "dark" | "system")
        : "system";
      setTheme(next);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success(`Theme: ${next}`);
    },
    onError: (error) => {
      const saved = settings.data?.theme;
      if (saved === "light" || saved === "dark" || saved === "system") {
        setTheme(saved);
      }
      toast.error(friendlyError(error));
    },
  });

  useEffect(() => {
    if (me.data) setProfile(me.data);
  }, [me.data, setProfile]);

  useEffect(() => {
    let cancelled = false;
    const chatChanged =
      Boolean(selectedChatId) && selectedChatId !== previousChatId.current;
    previousChatId.current = selectedChatId;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!selectedChatId) {
        setConversationOpen(false);
      } else if (chatChanged) {
        setConversationOpen(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedChatId]);

  useEffect(() => {
    if (!prefs.data) return;
    setAccent(prefs.data.accent);
    document.documentElement.style.setProperty(
      "--font-scale",
      String(prefs.data.font_scale || 1),
    );
    document.documentElement.classList.toggle(
      "high-contrast",
      Boolean(prefs.data.high_contrast),
    );
    document.documentElement.classList.toggle(
      "reduce-motion",
      Boolean(prefs.data.reduce_motion),
    );
    const wallpaper = prefs.data.wallpaper_url;
    document.documentElement.style.setProperty(
      "--wallpaper",
      wallpaper ? `url("${wallpaper}")` : "none",
    );
  }, [prefs.data, setAccent]);

  useEffect(() => {
    if (!settings.data) return;
    const next = ["light", "dark", "system"].includes(settings.data.theme)
      ? (settings.data.theme as "light" | "dark" | "system")
      : "system";
    setTheme(next);
  }, [settings.data, setTheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const key = (event.key ?? "").toLowerCase();

      if (event.key === "Escape") {
        if (mediaOpen) {
          event.preventDefault();
          closeMedia();
          return;
        }
        if (searchOpen) {
          event.preventDefault();
          setSearchOpen(false);
          return;
        }
        if (profileOpen) {
          event.preventDefault();
          closeProfile();
          return;
        }
        if (messagingSearchOpen) {
          event.preventDefault();
          setMessagingSearchOpen(false);
          return;
        }
        setMoreOpen(false);
        setPinnedOpen(false);
        setForwardMessage(null);
        if (
          selectedChatId &&
          conversationOpen &&
          !isTypingTarget(event.target)
        ) {
          event.preventDefault();
          setConversationOpen(false);
        }
        return;
      }

      if (!meta) return;

      const shortcutPage = shortcutPages[Number(key) - 1];
      if (shortcutPage) {
        event.preventDefault();
        selectServer(null);
        setPage(shortcutPage);
        return;
      }
      if (key === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        requestCompose();
        return;
      }
      if (key === "g") {
        event.preventDefault();
        selectServer(null);
        setPage("groups");
        return;
      }
      if (key === ",") {
        event.preventDefault();
        selectServer(null);
        setPage("settings");
        return;
      }
      if (event.shiftKey && key === "l") {
        event.preventDefault();
        const next = cycleTheme(theme);
        setTheme(next);
        themeMutation.mutate(next);
        return;
      }
      if (key === "b" && !isTypingTarget(event.target)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    closeMedia,
    closeProfile,
    conversationOpen,
    mediaOpen,
    messagingSearchOpen,
    profileOpen,
    requestCompose,
    searchOpen,
    selectServer,
    selectedChatId,
    setForwardMessage,
    setMessagingSearchOpen,
    setMoreOpen,
    setPage,
    setPinnedOpen,
    setSearchOpen,
    setTheme,
    theme,
    themeMutation,
    toggleSidebar,
  ]);

  useEffect(() => {
    return window.chatter?.onMenuAction((action) => {
      if (action === "search") setSearchOpen(true);
      if (action === "new-chat") requestCompose();
      if (action === "new-group" || action === "groups") setPage("groups");
      if (action === "settings") setPage("settings");
      if (action === "calls") setPage("calls");
      if (action === "toggle-sidebar") toggleSidebar();
      if (action === "toggle-theme") {
        const next = cycleTheme(useThemeStore.getState().theme);
        setTheme(next);
        themeMutation.mutate(next);
      }
    });
  }, [
    requestCompose,
    setPage,
    setSearchOpen,
    setTheme,
    themeMutation,
    toggleSidebar,
  ]);

  useEffect(() => {
    const onSessionExpired = () => {
      void forceSignOut(queryClient).then(() => {
        toast.error("Your session expired. Please sign in again.");
        navigate("/login", { replace: true });
      });
    };
    window.addEventListener("chatter:session-expired", onSessionExpired);
    return () =>
      window.removeEventListener("chatter:session-expired", onSessionExpired);
  }, [navigate, queryClient]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  const messagingPage = page === "chats";
  const serversPage = page === "servers";

  return (
    <div
      className="flex h-dvh min-h-[560px] overflow-hidden bg-[var(--canvas)] bg-cover bg-center text-[var(--ink)]"
      style={{ backgroundImage: "var(--wallpaper)" }}
    >
      <div className="hidden h-full md:flex">
        <PrimaryNav onLogout={handleLogout} loggingOut={loggingOut} />
      </div>

      <main
        className={
          conversationOpen && messagingPage
            ? "flex min-w-0 flex-1 flex-col"
            : "flex min-w-0 flex-1 flex-col pb-20 lg:pb-0"
        }
      >
        <ConnectionBanner />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {serversPage ? (
            <section className="h-full min-h-0 min-w-0">
              <Suspense fallback={<PageFallback />}>
                <ServerWorkspace />
              </Suspense>
            </section>
          ) : messagingPage ? (
            <>
              <motion.section
                initial={false}
                animate={{
                  x: conversationOpen ? "-5%" : "0%",
                  opacity: conversationOpen ? 0 : 1,
                }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                aria-hidden={conversationOpen}
                className="absolute inset-0 min-h-0 min-w-0 bg-[var(--panel)]"
                style={{
                  pointerEvents: conversationOpen ? "none" : "auto",
                  visibility: conversationOpen ? "hidden" : "visible",
                  transitionProperty: "visibility",
                  transitionDelay: conversationOpen ? "250ms" : "0ms",
                }}
              >
                <div className="mx-auto h-full min-h-0 w-full max-w-5xl">
                  <Suspense fallback={<PageFallback />}>
                    <ChatsPage
                      onOpenConversation={() => setConversationOpen(true)}
                    />
                  </Suspense>
                </div>
              </motion.section>

              {selectedChatId && (
                <motion.section
                  initial={{ x: "100%", opacity: 0.96 }}
                  animate={{
                    x: conversationOpen ? "0%" : "100%",
                    opacity: conversationOpen ? 1 : 0.96,
                  }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  aria-hidden={!conversationOpen}
                  className="absolute inset-0 z-10 min-h-0 min-w-0 bg-[var(--canvas)] shadow-[-24px_0_70px_-40px_rgba(0,0,0,0.45)]"
                  style={{
                    pointerEvents: conversationOpen ? "auto" : "none",
                    visibility: conversationOpen ? "visible" : "hidden",
                    transitionProperty: "visibility",
                    transitionDelay: conversationOpen ? "0ms" : "250ms",
                  }}
                >
                  <Suspense fallback={<PageFallback />}>
                    <ConversationPanel
                      onBack={() => setConversationOpen(false)}
                    />
                  </Suspense>
                </motion.section>
              )}
            </>
          ) : (
            <section className="h-full min-h-0 min-w-0 bg-[var(--panel)]">
              <div className="mx-auto h-full min-h-0 w-full max-w-[1440px]">
                <Suspense fallback={<PageFallback />}>
                  <AnimatePresence mode="wait">
                    {page === "home" && (
                      <PageFade pageKey="home">
                        <HomePage />
                      </PageFade>
                    )}
                    {page === "friends" && (
                      <PageFade pageKey="friends">
                        <FriendsPage />
                      </PageFade>
                    )}
                    {page === "status" && (
                      <PageFade pageKey="status">
                        <StatusPage />
                      </PageFade>
                    )}
                    {page === "notifications" && (
                      <PageFade pageKey="notifications">
                        <NotificationsPage />
                      </PageFade>
                    )}
                    {page === "settings" && (
                      <PageFade pageKey="settings">
                        <SettingsPage />
                      </PageFade>
                    )}
                    {page === "profile" && (
                      <PageFade pageKey="profile">
                        <ProfileManagementPage />
                      </PageFade>
                    )}
                    {page === "groups" && (
                      <PageFade pageKey="groups">
                        <GroupsPage />
                      </PageFade>
                    )}
                    {page === "calls" && (
                      <PageFade pageKey="calls">
                        <CallsPage />
                      </PageFade>
                    )}
                    {page === "ai" && (
                      <PageFade pageKey="ai">
                        <AiAssistantPage />
                      </PageFade>
                    )}
                  </AnimatePresence>
                </Suspense>
              </div>
            </section>
          )}
        </div>
      </main>

      <GlobalSearch />
      <MobileNavigation hidden={messagingPage && conversationOpen} />
      <ProfileDrawer />
      <RealtimeBootstrap />
      <ServerRealtime />
      <ServerModals />
      <MediaViewer />
      <CallOverlay />
      <CallsBootstrap />
    </div>
  );
}
