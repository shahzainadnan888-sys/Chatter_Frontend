import { create } from "zustand";
import type {
  LocalPreferences,
  MediaFile,
  ProfileDetail,
  Settings,
} from "@/src/types/api";

export {
  useCallStore,
  useCallMediaStore,
  useConnectionStore,
  useDeviceStore,
  getCallSession,
} from "@/src/stores/call-stores";

type PermissionName = "microphone" | "camera" | "location" | "notifications";
type PermissionState = "prompt" | "granted" | "denied" | "unsupported";

interface PermissionStore {
  states: Record<PermissionName, PermissionState>;
  pending: PermissionName | null;
  setState: (name: PermissionName, state: PermissionState) => void;
  setPending: (name: PermissionName | null) => void;
}

export const usePermissionStore = create<PermissionStore>((set) => ({
  states: {
    microphone: "prompt",
    camera: "prompt",
    location: "prompt",
    notifications:
      typeof Notification !== "undefined"
        ? (Notification.permission as PermissionState)
        : "unsupported",
  },
  pending: null,
  setState: (name, state) =>
    set((current) => ({
      states: { ...current.states, [name]: state },
    })),
  setPending: (pending) => set({ pending }),
}));

interface ProfileEditorStore {
  draft: Partial<ProfileDetail>;
  previewAvatar: string | null;
  previewCover: string | null;
  setDraft: (draft: Partial<ProfileDetail>) => void;
  setPreviewAvatar: (url: string | null) => void;
  setPreviewCover: (url: string | null) => void;
  reset: () => void;
}

export const useProfileEditorStore = create<ProfileEditorStore>((set) => ({
  draft: {},
  previewAvatar: null,
  previewCover: null,
  setDraft: (draft) => set({ draft }),
  setPreviewAvatar: (previewAvatar) => set({ previewAvatar }),
  setPreviewCover: (previewCover) => set({ previewCover }),
  reset: () => set({ draft: {}, previewAvatar: null, previewCover: null }),
}));

interface MediaStore {
  open: boolean;
  item: MediaFile | null;
  zoom: number;
  openMedia: (item: MediaFile) => void;
  close: () => void;
  setZoom: (zoom: number) => void;
}

export const useMediaStore = create<MediaStore>((set) => ({
  open: false,
  item: null,
  zoom: 1,
  openMedia: (item) => set({ open: true, item, zoom: 1 }),
  close: () => set({ open: false, item: null, zoom: 1 }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.5, zoom)) }),
}));

interface LocationStore {
  permission: PermissionState;
  watchId: number | null;
  remainingSeconds: number;
  setPermission: (permission: PermissionState) => void;
  setWatchId: (watchId: number | null) => void;
  setRemainingSeconds: (seconds: number) => void;
}

export const useLocationStore = create<LocationStore>((set) => ({
  permission: "prompt",
  watchId: null,
  remainingSeconds: 0,
  setPermission: (permission) => set({ permission }),
  setWatchId: (watchId) => set({ watchId }),
  setRemainingSeconds: (remainingSeconds) => set({ remainingSeconds }),
}));

interface FeatureSettingsStore {
  server: Settings | null;
  local: Partial<LocalPreferences>;
  activeSection:
    | "general"
    | "appearance"
    | "privacy"
    | "notifications"
    | "security"
    | "media"
    | "accessibility"
    | "about";
  setServer: (settings: Settings) => void;
  setLocal: (local: Partial<LocalPreferences>) => void;
  setActiveSection: (section: FeatureSettingsStore["activeSection"]) => void;
}

export const useFeatureSettingsStore = create<FeatureSettingsStore>((set) => ({
  server: null,
  local: {},
  activeSection: "general",
  setServer: (server) => set({ server }),
  setLocal: (local) => set({ local }),
  setActiveSection: (activeSection) => set({ activeSection }),
}));
