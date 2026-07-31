import { create } from "zustand";
import type {
  ChatDetail,
  ChatFilter,
  ChatSort,
  FriendsTab,
  ProfilePublic,
  ShellPage,
  UserPublic,
  UUID,
} from "@/src/types/api";

interface NavigationState {
  page: ShellPage;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  searchOpen: boolean;
  selectedChatId: UUID | null;
  selectedIndex: number;
  composeRequestedAt: number;
  focusGroupId: UUID | null;
  setPage: (page: ShellPage) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSearchOpen: (open: boolean) => void;
  selectChat: (chatId: UUID | null) => void;
  setSelectedIndex: (index: number) => void;
  requestCompose: () => void;
  clearComposeRequest: () => void;
  focusGroup: (groupId: UUID | null) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  page: "chats",
  sidebarCollapsed: true,
  sidebarWidth: 248,
  searchOpen: false,
  selectedChatId: null,
  selectedIndex: -1,
  composeRequestedAt: 0,
  focusGroupId: null,
  setPage: (page) => set({ page, selectedIndex: -1 }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setSidebarWidth: (sidebarWidth) =>
    set({ sidebarWidth: Math.min(320, Math.max(200, sidebarWidth)) }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  selectChat: (selectedChatId) => set({ selectedChatId }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  requestCompose: () =>
    set({ page: "chats", composeRequestedAt: Date.now() }),
  clearComposeRequest: () => set({ composeRequestedAt: 0 }),
  focusGroup: (focusGroupId) =>
    set({ page: "groups", focusGroupId }),
}));

interface ChatState {
  filter: ChatFilter;
  sort: ChatSort;
  query: string;
  details: Record<string, ChatDetail>;
  setFilter: (filter: ChatFilter) => void;
  setSort: (sort: ChatSort) => void;
  setQuery: (query: string) => void;
  cacheDetail: (chat: ChatDetail) => void;
  clearChatUi: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  filter: "all",
  sort: "recent",
  query: "",
  details: {},
  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
  setQuery: (query) => set({ query }),
  cacheDetail: (chat) =>
    set((state) => ({ details: { ...state.details, [chat.id]: chat } })),
  clearChatUi: () =>
    set({ filter: "all", sort: "recent", query: "", details: {} }),
}));

interface FriendState {
  tab: FriendsTab;
  discoverQuery: string;
  setTab: (tab: FriendsTab) => void;
  setDiscoverQuery: (discoverQuery: string) => void;
}

export const useFriendStore = create<FriendState>((set) => ({
  tab: "friends",
  discoverQuery: "",
  setTab: (tab) => set({ tab }),
  setDiscoverQuery: (discoverQuery) => set({ discoverQuery }),
}));

interface SearchState {
  query: string;
  activeTab: "all" | "users" | "chats" | "groups" | "messages" | "files";
  recent: string[];
  saved: string[];
  sort: "relevance" | "newest";
  setQuery: (query: string) => void;
  setActiveTab: (activeTab: SearchState["activeTab"]) => void;
  addRecent: (query: string) => void;
  toggleSaved: (query: string) => void;
  setSort: (sort: SearchState["sort"]) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  activeTab: "all",
  recent: [],
  saved: [],
  sort: "relevance",
  setQuery: (query) => set({ query }),
  setActiveTab: (activeTab) => set({ activeTab }),
  addRecent: (query) =>
    set((state) => ({
      recent: [
        query,
        ...state.recent.filter((item) => item !== query),
      ].slice(0, 8),
    })),
  toggleSaved: (query) =>
    set((state) => ({
      saved: state.saved.includes(query)
        ? state.saved.filter((item) => item !== query)
        : [query, ...state.saved].slice(0, 12),
    })),
  setSort: (sort) => set({ sort }),
  reset: () => set({ query: "", activeTab: "all" }),
}));

interface NotificationState {
  category:
    | "all"
    | "friend_request"
    | "mention"
    | "message"
    | "call"
    | "group"
    | "status"
    | "system";
  setCategory: (category: NotificationState["category"]) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  category: "all",
  setCategory: (category) => set({ category }),
}));

interface ProfileDrawerState {
  username: string | null;
  open: boolean;
  profile: ProfilePublic | null;
  user: UserPublic | null;
  openProfile: (username: string) => void;
  closeProfile: () => void;
  setProfileData: (profile: ProfilePublic | null, user: UserPublic | null) => void;
}

export const useProfileStore = create<ProfileDrawerState>((set) => ({
  username: null,
  open: false,
  profile: null,
  user: null,
  openProfile: (username) =>
    set({ username, open: true, profile: null, user: null }),
  closeProfile: () =>
    set({ open: false, username: null, profile: null, user: null }),
  setProfileData: (profile, user) => set({ profile, user }),
}));
