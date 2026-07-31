"use client";

import { create } from "zustand";
import type { Call } from "@/src/types/api";
import type { NetworkQualityLevel } from "@/src/services/webrtc/types";

export type CallPhase =
  | "idle"
  | "permission"
  | "outgoing"
  | "ringing"
  | "incoming"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended";

interface CallStoreState {
  activeCall: Call | null;
  incomingCall: Call | null;
  phase: CallPhase;
  isCaller: boolean;
  peerDisplayName: string | null;
  peerUsername: string | null;
  peerAvatarUrl: string | null;
  dismissedCallIds: string[];
  ringtoneMuted: boolean;
  setActiveCall: (call: Call | null) => void;
  setIncomingCall: (call: Call | null) => void;
  dismissCall: (callId: string) => void;
  setPhase: (phase: CallPhase) => void;
  setIsCaller: (isCaller: boolean) => void;
  setPeerMeta: (meta: {
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  }) => void;
  setRingtoneMuted: (muted: boolean) => void;
  reset: () => void;
}

interface CallMediaStoreState {
  muted: boolean;
  videoEnabled: boolean;
  speakerEnabled: boolean;
  noiseSuppression: boolean;
  mirrored: boolean;
  backgroundBlur: boolean;
  volume: number;
  stream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerMuted: boolean;
  peerVideoEnabled: boolean;
  setMuted: (muted: boolean) => void;
  setVideoEnabled: (enabled: boolean) => void;
  setSpeakerEnabled: (enabled: boolean) => void;
  setNoiseSuppression: (enabled: boolean) => void;
  setMirrored: (mirrored: boolean) => void;
  setBackgroundBlur: (blurred: boolean) => void;
  setVolume: (volume: number) => void;
  setStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  setPeerMuted: (muted: boolean) => void;
  setPeerVideoEnabled: (enabled: boolean) => void;
  reset: () => void;
}

interface DeviceStoreState {
  devices: MediaDeviceInfo[];
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
  setDevices: (devices: MediaDeviceInfo[]) => void;
  setAudioInputId: (id: string) => void;
  setVideoInputId: (id: string) => void;
  setAudioOutputId: (id: string) => void;
  reset: () => void;
}

interface ConnectionStoreState {
  networkQuality: NetworkQualityLevel;
  signalingStatus: "connecting" | "open" | "closed" | "error";
  setNetworkQuality: (quality: NetworkQualityLevel) => void;
  setSignalingStatus: (status: ConnectionStoreState["signalingStatus"]) => void;
  reset: () => void;
}

const initialCall = {
  activeCall: null as Call | null,
  incomingCall: null as Call | null,
  phase: "idle" as CallPhase,
  isCaller: false,
  peerDisplayName: null as string | null,
  peerUsername: null as string | null,
  peerAvatarUrl: null as string | null,
  dismissedCallIds: [] as string[],
  ringtoneMuted: false,
};

const initialMedia = {
  muted: false,
  videoEnabled: false,
  speakerEnabled: true,
  noiseSuppression: true,
  mirrored: true,
  backgroundBlur: false,
  volume: 100,
  stream: null as MediaStream | null,
  remoteStream: null as MediaStream | null,
  peerMuted: false,
  peerVideoEnabled: true,
};

export const useCallStore = create<CallStoreState>((set) => ({
  ...initialCall,
  setActiveCall: (activeCall) => set({ activeCall }),
  setIncomingCall: (incomingCall) => set({ incomingCall }),
  dismissCall: (callId) =>
    set((state) => ({
      incomingCall:
        state.incomingCall?.id === callId ? null : state.incomingCall,
      dismissedCallIds: [...state.dismissedCallIds, callId].slice(-30),
    })),
  setPhase: (phase) => set({ phase }),
  setIsCaller: (isCaller) => set({ isCaller }),
  setPeerMeta: (meta) =>
    set({
      peerDisplayName: meta.displayName ?? null,
      peerUsername: meta.username ?? null,
      peerAvatarUrl: meta.avatarUrl ?? null,
    }),
  setRingtoneMuted: (ringtoneMuted) => set({ ringtoneMuted }),
  reset: () =>
    set((state) => ({
      ...initialCall,
      dismissedCallIds: state.dismissedCallIds,
      ringtoneMuted: false,
    })),
}));

export const useCallMediaStore = create<CallMediaStoreState>((set) => ({
  ...initialMedia,
  setMuted: (muted) => set({ muted }),
  setVideoEnabled: (videoEnabled) => set({ videoEnabled }),
  setSpeakerEnabled: (speakerEnabled) => set({ speakerEnabled }),
  setNoiseSuppression: (noiseSuppression) => set({ noiseSuppression }),
  setMirrored: (mirrored) => set({ mirrored }),
  setBackgroundBlur: (backgroundBlur) => set({ backgroundBlur }),
  setVolume: (volume) => set({ volume }),
  setStream: (stream) => set({ stream }),
  setRemoteStream: (remoteStream) => set({ remoteStream }),
  setPeerMuted: (peerMuted) => set({ peerMuted }),
  setPeerVideoEnabled: (peerVideoEnabled) => set({ peerVideoEnabled }),
  reset: () => set({ ...initialMedia }),
}));

export const useDeviceStore = create<DeviceStoreState>((set) => ({
  devices: [],
  audioInputId: "",
  videoInputId: "",
  audioOutputId: "",
  setDevices: (devices) => set({ devices }),
  setAudioInputId: (audioInputId) => set({ audioInputId }),
  setVideoInputId: (videoInputId) => set({ videoInputId }),
  setAudioOutputId: (audioOutputId) => set({ audioOutputId }),
  reset: () =>
    set({
      devices: [],
      audioInputId: "",
      videoInputId: "",
      audioOutputId: "",
    }),
}));

export const useConnectionStore = create<ConnectionStoreState>((set) => ({
  networkQuality: "good",
  signalingStatus: "closed",
  setNetworkQuality: (networkQuality) => set({ networkQuality }),
  setSignalingStatus: (signalingStatus) => set({ signalingStatus }),
  reset: () => set({ networkQuality: "good", signalingStatus: "closed" }),
}));

/** Imperative snapshot used by CallController (outside React). */
export function getCallSession() {
  const call = useCallStore.getState();
  const media = useCallMediaStore.getState();
  const connection = useConnectionStore.getState();
  return {
    ...call,
    ...media,
    networkQuality: connection.networkQuality,
    signalingStatus: connection.signalingStatus,
    setNetworkQuality: connection.setNetworkQuality,
    setSignalingStatus: connection.setSignalingStatus,
    resetAll: () => {
      useCallStore.getState().reset();
      useCallMediaStore.getState().reset();
      useConnectionStore.getState().reset();
    },
  };
}
