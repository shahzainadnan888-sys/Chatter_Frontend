import { create } from "zustand";
import type {
  AuthUser,
  LocalPreferences,
  Settings,
  ThemePreference,
  UserDetail,
} from "@/src/types/api";

interface AuthState {
  status: "booting" | "anonymous" | "authenticated";
  user: AuthUser | null;
  setSession: (user: AuthUser) => void;
  clearSession: () => void;
  finishBoot: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "booting",
  user: null,
  setSession: (user) => set({ status: "authenticated", user }),
  clearSession: () => set({ status: "anonymous", user: null }),
  finishBoot: () =>
    set((state) => ({
      status: state.user ? "authenticated" : "anonymous",
    })),
}));

interface UserState {
  profile: UserDetail | null;
  setProfile: (profile: UserDetail | null) => void;
  setAvatar: (avatarUrl: string | null) => void;
}

export const useUserStore = create<UserState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
  setAvatar: (avatar_url) =>
    set((state) => ({
      profile: state.profile ? { ...state.profile, avatar_url } : null,
    })),
}));

interface SettingsState {
  settings: Settings | null;
  setSettings: (settings: Settings) => void;
  clearSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  setSettings: (settings) => set({ settings }),
  clearSettings: () => set({ settings: null }),
}));

interface ThemeState {
  theme: ThemePreference;
  accent: LocalPreferences["accent"];
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: LocalPreferences["accent"]) => void;
}

function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  accent: "purple",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setAccent: (accent) => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.accent = accent;
    }
    set({ accent });
  },
}));
