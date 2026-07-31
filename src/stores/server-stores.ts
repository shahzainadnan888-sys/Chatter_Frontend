import { create } from "zustand";
import type { UUID } from "@/src/types/api";
import type {
  ServerSettingsTab,
  ServerSidebar,
  ServerVoiceParticipant,
} from "@/src/types/servers";

interface ServerUiState {
  selectedServerId: UUID | null;
  selectedChannelId: UUID | null;
  createOpen: boolean;
  joinOpen: boolean;
  settingsOpen: boolean;
  settingsTab: ServerSettingsTab;
  membersOpen: boolean;
  collapsedCategories: Record<string, boolean>;
  typingByChannel: Record<string, Array<{ userId: UUID; username: string }>>;
  activeVoiceChannelId: UUID | null;
  voiceParticipants: ServerVoiceParticipant[];
  voiceMuted: boolean;
  voiceDeafened: boolean;
  replyToId: UUID | null;
  selectServer: (serverId: UUID | null) => void;
  selectChannel: (channelId: UUID | null) => void;
  openCreate: () => void;
  closeCreate: () => void;
  openJoin: () => void;
  closeJoin: () => void;
  openSettings: (tab?: ServerSettingsTab) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: ServerSettingsTab) => void;
  setMembersOpen: (open: boolean) => void;
  toggleCategory: (categoryId: string) => void;
  setTyping: (
    channelId: UUID,
    users: Array<{ userId: UUID; username: string }>,
  ) => void;
  setVoice: (
    channelId: UUID | null,
    participants?: ServerVoiceParticipant[],
  ) => void;
  setVoiceControls: (patch: {
    muted?: boolean;
    deafened?: boolean;
  }) => void;
  setReplyTo: (messageId: UUID | null) => void;
  applySidebarDefaults: (sidebar: ServerSidebar) => void;
  reset: () => void;
}

export const useServerStore = create<ServerUiState>((set, get) => ({
  selectedServerId: null,
  selectedChannelId: null,
  createOpen: false,
  joinOpen: false,
  settingsOpen: false,
  settingsTab: "overview",
  membersOpen: true,
  collapsedCategories: {},
  typingByChannel: {},
  activeVoiceChannelId: null,
  voiceParticipants: [],
  voiceMuted: false,
  voiceDeafened: false,
  replyToId: null,
  selectServer: (selectedServerId) =>
    set({
      selectedServerId,
      selectedChannelId: null,
      settingsOpen: false,
      replyToId: null,
    }),
  selectChannel: (selectedChannelId) =>
    set({ selectedChannelId, replyToId: null }),
  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),
  openJoin: () => set({ joinOpen: true }),
  closeJoin: () => set({ joinOpen: false }),
  openSettings: (tab = "overview") =>
    set({ settingsOpen: true, settingsTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  setMembersOpen: (membersOpen) => set({ membersOpen }),
  toggleCategory: (categoryId) => {
    const current = get().collapsedCategories;
    set({
      collapsedCategories: {
        ...current,
        [categoryId]: !current[categoryId],
      },
    });
  },
  setTyping: (channelId, users) =>
    set((state) => ({
      typingByChannel: { ...state.typingByChannel, [channelId]: users },
    })),
  setVoice: (channelId, participants = []) =>
    set({
      activeVoiceChannelId: channelId,
      voiceParticipants: participants,
    }),
  setVoiceControls: (patch) =>
    set((state) => ({
      voiceMuted: patch.muted ?? state.voiceMuted,
      voiceDeafened: patch.deafened ?? state.voiceDeafened,
    })),
  setReplyTo: (replyToId) => set({ replyToId }),
  applySidebarDefaults: (sidebar) => {
    const state = get();
    if (state.selectedChannelId) {
      const stillThere = sidebar.channels.some(
        (channel) => channel.id === state.selectedChannelId,
      );
      if (stillThere) return;
    }
    const preferred =
      sidebar.channels.find((channel) => channel.type === "text") ||
      sidebar.channels.find((channel) => channel.type === "announcement") ||
      sidebar.channels[0] ||
      null;
    set({ selectedChannelId: preferred?.id ?? null });
  },
  reset: () =>
    set({
      selectedServerId: null,
      selectedChannelId: null,
      createOpen: false,
      joinOpen: false,
      settingsOpen: false,
      settingsTab: "overview",
      membersOpen: true,
      collapsedCategories: {},
      typingByChannel: {},
      activeVoiceChannelId: null,
      voiceParticipants: [],
      voiceMuted: false,
      voiceDeafened: false,
      replyToId: null,
    }),
}));

/** Convenience aliases matching the requested store names. */
export const useChannelStore = useServerStore;
export const useMemberStore = useServerStore;
export const useRoleStore = useServerStore;
export const useInviteStore = useServerStore;
export const useThreadStore = useServerStore;
