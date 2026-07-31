import { create } from "zustand";
import type { StatusSection } from "@/src/features/status/status-types";
import type { UUID } from "@/src/types/api";

type StatusDetailsTab = "details" | "viewers" | "replies";
type StatusUploadPhase = "idle" | "preparing" | "uploading" | "failed";

interface StatusUiState {
  creatorOpen: boolean;
  selectedAuthorId: UUID | null;
  selectedStatusId: UUID | null;
  activeSection: StatusSection;
  detailsTab: StatusDetailsTab;
  searchQuery: string;
  paused: boolean;
  uploadPhase: StatusUploadPhase;
  uploadProgress: number | null;
  openCreator: () => void;
  closeCreator: () => void;
  selectStatus: (authorId: UUID, statusId: UUID) => void;
  clearSelection: () => void;
  setActiveSection: (section: StatusSection) => void;
  setDetailsTab: (tab: StatusDetailsTab) => void;
  setSearchQuery: (query: string) => void;
  setPaused: (paused: boolean) => void;
  setUpload: (phase: StatusUploadPhase, progress?: number | null) => void;
  resetUpload: () => void;
}

export const useStatusStore = create<StatusUiState>((set) => ({
  creatorOpen: false,
  selectedAuthorId: null,
  selectedStatusId: null,
  activeSection: "recent",
  detailsTab: "details",
  searchQuery: "",
  paused: false,
  uploadPhase: "idle",
  uploadProgress: null,
  openCreator: () => set({ creatorOpen: true }),
  closeCreator: () =>
    set({
      creatorOpen: false,
      uploadPhase: "idle",
      uploadProgress: null,
    }),
  selectStatus: (selectedAuthorId, selectedStatusId) =>
    set({ selectedAuthorId, selectedStatusId, detailsTab: "details" }),
  clearSelection: () =>
    set({ selectedAuthorId: null, selectedStatusId: null }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setDetailsTab: (detailsTab) => set({ detailsTab }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setPaused: (paused) => set({ paused }),
  setUpload: (uploadPhase, uploadProgress = null) =>
    set({ uploadPhase, uploadProgress }),
  resetUpload: () => set({ uploadPhase: "idle", uploadProgress: null }),
}));
