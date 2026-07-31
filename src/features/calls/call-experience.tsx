"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CameraOff,
  ChevronDown,
  Clock3,
  Expand,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PictureInPicture,
  Settings2,
  ShieldCheck,
  Speaker,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import { Avatar, EmptyState, PanelHeader } from "@/src/features/shell/shell-ui";
import { formatRelativeTime } from "@/src/lib/shell-utils";
import { requestNotificationPermission } from "@/src/lib/permissions";
import { callController } from "@/src/services/webrtc/CallController";
import {
  connectionLabel,
  connectionTone,
  formatCallDuration,
  listMediaDevices,
} from "@/src/services/webrtc";
import { callsApi } from "@/src/services/prompt4-api";
import { chatsApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import {
  useCallMediaStore,
  useCallStore,
  useConnectionStore,
  useDeviceStore,
} from "@/src/stores/call-stores";
import type { Call, CallType, UUID } from "@/src/types/api";

function statusLabel(status: Call["status"]) {
  switch (status) {
    case "missed":
      return "Missed";
    case "rejected":
    case "declined":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    case "ended":
      return "Ended";
    case "failed":
      return "Failed";
    case "accepted":
    case "active":
      return "Completed";
    case "ringing":
      return "Ringing";
    default:
      return status;
  }
}

function callDirection(call: Call, userId?: string | null) {
  const caller = call.caller_id || call.initiator_id;
  if (call.status === "missed" && caller !== userId) return "Missed";
  if (caller === userId) return "Outgoing";
  return "Incoming";
}

export function useStartCall() {
  return async (
    target: { receiver_id?: UUID; chat_id?: UUID; group_id?: UUID },
    type: CallType,
  ) => {
    await callController.startCall({ ...target, type });
  };
}

export function CallsPage() {
  const startCall = useStartCall();
  const currentUser = useAuthStore((state) => state.user);
  const history = useQuery({
    queryKey: ["calls-history", 1, 20],
    queryFn: () => callsApi.history(1, 20),
    refetchInterval: 10_000,
  });
  const active = useQuery({
    queryKey: ["calls-active"],
    queryFn: () => callsApi.active(),
    refetchInterval: 15_000,
  });
  const chats = useQuery({
    queryKey: ["chats", false, "calls"],
    queryFn: () => chatsApi.list({ page: 1, page_size: 20, archived: false }),
  });
  const completedCalls =
    history.data?.filter(
      (call) =>
        call.status === "ended" ||
        call.status === "accepted" ||
        call.status === "active",
    ).length ?? 0;
  const missedCalls =
    history.data?.filter((call) => call.status === "missed").length ?? 0;
  const videoCalls =
    history.data?.filter((call) => call.type === "video").length ?? 0;

  async function retryCall(call: Call) {
    const me = currentUser?.id;
    const peer =
      call.caller_id === me || call.initiator_id === me
        ? call.receiver_id
        : call.caller_id || call.initiator_id;
    if (!peer) {
      toast.error("Cannot retry this call.");
      return;
    }
    await startCall(
      { receiver_id: peer },
      call.type === "video" ? "video" : "voice",
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Calls"
        description="Connect instantly with voice and video."
        actions={
          <div className="flex items-center gap-2">
            {active.data?.call && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                Active call
              </span>
            )}
            <Button
              variant="secondary"
              onClick={() => void requestNotificationPermission()}
            >
              Enable alerts
            </Button>
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,var(--accent-soft),transparent_32%)] p-4 sm:p-5">
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            {
              label: "Recent",
              value: completedCalls,
              icon: PhoneIncoming,
              color: "bg-emerald-500",
            },
            {
              label: "Missed",
              value: missedCalls,
              icon: PhoneMissed,
              color: "bg-rose-500",
            },
            {
              label: "Video",
              value: videoCalls,
              icon: Camera,
              color: "bg-violet-500",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.label}
                whileHover={{ y: -2 }}
                className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/80 p-4 shadow-[0_18px_45px_-35px_rgba(0,0,0,0.7)]"
              >
                <span
                  className={cx(
                    "grid size-9 place-items-center rounded-xl text-white shadow-lg",
                    item.color,
                  )}
                >
                  <Icon size={16} />
                </span>
                <p className="mt-3 text-xl font-semibold">{item.value}</p>
                <p className="text-xs text-[var(--muted)]">{item.label} calls</p>
              </motion.div>
            );
          })}
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Start a call
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(chats.data?.data ?? []).slice(0, 8).map((chat) => (
              <div
                key={chat.id}
                className="group flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/80 p-3.5 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.8)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
              >
                <Avatar name={chat.title || "Conversation"} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {chat.title || "Conversation"}
                </span>
                <CallButton
                  label="Voice call"
                  onClick={() => void startCall({ chat_id: chat.id }, "voice")}
                >
                  <Phone size={15} />
                </CallButton>
                <CallButton
                  label="Video call"
                  onClick={() => void startCall({ chat_id: chat.id }, "video")}
                >
                  <Camera size={15} />
                </CallButton>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Call history
          </h2>
          {history.isLoading && (
            <div className="mt-3 space-y-2 animate-pulse">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-16 rounded-2xl bg-[var(--surface-2)]" />
              ))}
            </div>
          )}
          {!history.isLoading && (history.data?.length ?? 0) === 0 && (
            <EmptyState
              illustration="activity"
              title="No calls yet"
              description="Your voice and video call history will appear here."
            />
          )}
          <div className="mt-3 space-y-2">
            {history.data?.map((call) => (
              <div
                key={call.id}
                className="flex items-center gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--surface)]/75 px-4 py-3.5 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface)]"
              >
                <span
                  className={cx(
                    "grid size-10 place-items-center rounded-xl",
                    call.status === "missed"
                      ? "bg-red-500/10 text-red-500"
                      : "bg-[var(--surface-2)] text-[var(--muted)]",
                  )}
                >
                  {call.type === "video" ? <Camera size={17} /> : <Phone size={17} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold capitalize">
                    {call.type === "voice" || call.type === "audio"
                      ? "Voice"
                      : "Video"}{" "}
                    · {callDirection(call, currentUser?.id)}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {statusLabel(call.status)} ·{" "}
                    {formatRelativeTime(call.created_at)}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={12} />
                    {formatCallDuration(call.duration_seconds || 0)}
                  </span>
                </span>
                <CallButton
                  label="Retry call"
                  onClick={() => void retryCall(call)}
                >
                  <Phone size={15} />
                </CallButton>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function CallsBootstrap() {
  const currentUser = useAuthStore((state) => state.user);
  const phase = useCallStore((state) => state.phase);
  const dismissedCallIds = useCallStore((state) => state.dismissedCallIds);

  useEffect(() => {
    if (!currentUser?.id) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        await callController.ensureSignaling();
      } catch {
        if (!cancelled) {
          retryTimer = setTimeout(() => {
            void connect();
          }, 2_000);
        }
      }
    };
    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [currentUser?.id]);

  // Fallback: catch ringing calls if CALL_INVITE was missed (e.g. WS late).
  const ringingPoll = useQuery({
    queryKey: ["calls-ringing-poll", currentUser?.id],
    queryFn: async () => {
      const [active, history] = await Promise.all([
        callsApi.active(),
        callsApi.history(1, 10),
      ]);
      return { active, history };
    },
    enabled: Boolean(currentUser?.id) && (phase === "idle" || phase === "ended"),
    refetchInterval: 2_000,
    staleTime: 0,
  });

  useEffect(() => {
    if (phase !== "idle" && phase !== "ended") return;
    const me = currentUser?.id;
    if (!me) return;

    const fromActive = ringingPoll.data?.active?.call ?? null;
    const fromHistory =
      ringingPoll.data?.history?.find(
        (call) =>
          call.status === "ringing" &&
          call.initiator_id !== me &&
          call.caller_id !== me &&
          !dismissedCallIds.includes(call.id),
      ) ?? null;

    const incoming =
      fromActive &&
      fromActive.status === "ringing" &&
      fromActive.initiator_id !== me &&
      fromActive.caller_id !== me &&
      !dismissedCallIds.includes(fromActive.id)
        ? fromActive
        : fromHistory;

    if (incoming) callController.presentIncomingCall(incoming);
  }, [
    currentUser?.id,
    dismissedCallIds,
    phase,
    ringingPoll.data?.active,
    ringingPoll.data?.history,
  ]);

  return null;
}

export function CallOverlay() {
  const queryClient = useQueryClient();
  const activeCall = useCallStore((state) => state.activeCall);
  const incomingCall = useCallStore((state) => state.incomingCall);
  const phase = useCallStore((state) => state.phase);
  const peerDisplayName = useCallStore((state) => state.peerDisplayName);
  const peerUsername = useCallStore((state) => state.peerUsername);
  const peerAvatarUrl = useCallStore((state) => state.peerAvatarUrl);
  const ringtoneMuted = useCallStore((state) => state.ringtoneMuted);

  const muted = useCallMediaStore((state) => state.muted);
  const videoEnabled = useCallMediaStore((state) => state.videoEnabled);
  const speakerEnabled = useCallMediaStore((state) => state.speakerEnabled);
  const noiseSuppression = useCallMediaStore((state) => state.noiseSuppression);
  const mirrored = useCallMediaStore((state) => state.mirrored);
  const backgroundBlur = useCallMediaStore((state) => state.backgroundBlur);
  const volume = useCallMediaStore((state) => state.volume);
  const stream = useCallMediaStore((state) => state.stream);
  const remoteStream = useCallMediaStore((state) => state.remoteStream);
  const peerMuted = useCallMediaStore((state) => state.peerMuted);
  const peerVideoEnabled = useCallMediaStore((state) => state.peerVideoEnabled);

  const networkQuality = useConnectionStore((state) => state.networkQuality);
  const devices = useDeviceStore((state) => state.devices);
  const audioDevice = useDeviceStore((state) => state.audioInputId);
  const videoDevice = useDeviceStore((state) => state.videoInputId);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const call = activeCall || incomingCall;

  const attachLocalVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      localVideoRef.current = node;
      if (node && node.srcObject !== stream) node.srcObject = stream;
    },
    [stream],
  );

  const attachRemoteVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      remoteVideoRef.current = node;
      if (node && node.srcObject !== remoteStream) node.srcObject = remoteStream;
    },
    [remoteStream],
  );

  useEffect(() => {
    const node = localVideoRef.current;
    if (node && node.srcObject !== stream) node.srcObject = stream;
  }, [stream, videoEnabled, phase]);

  useEffect(() => {
    const node = remoteVideoRef.current;
    if (node && node.srcObject !== remoteStream) node.srcObject = remoteStream;
    const audio = remoteAudioRef.current;
    if (audio && audio.srcObject !== remoteStream) {
      audio.srcObject = remoteStream;
      audio.volume = Math.min(1, Math.max(0, volume / 100));
      void audio.play().catch(() => undefined);
    }
  }, [remoteStream, volume, speakerEnabled]);

  useEffect(() => {
    if (!speakerEnabled && remoteAudioRef.current) {
      remoteAudioRef.current.muted = true;
    } else if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = false;
    }
  }, [speakerEnabled]);

  useEffect(() => {
    void listMediaDevices().then((list) =>
      useDeviceStore.getState().setDevices(list),
    );
  }, [phase]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (phase === "idle") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (phase === "incoming") void callController.rejectIncoming();
        else if (settingsOpen) setSettingsOpen(false);
        else void callController.endActive();
        return;
      }

      if (event.code === "Space" && phase !== "incoming") {
        event.preventDefault();
        void callController.setMuted(!useCallMediaStore.getState().muted);
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "v"
      ) {
        event.preventDefault();
        void callController.setVideoEnabled(
          !useCallMediaStore.getState().videoEnabled,
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, settingsOpen]);

  async function endCall() {
    await callController.endActive();
    void queryClient.invalidateQueries({ queryKey: ["calls-history"] });
    void queryClient.invalidateQueries({ queryKey: ["calls-active"] });
  }

  const visible = phase !== "idle" && (Boolean(call) || phase === "connecting");
  const connected = phase === "connected" || phase === "reconnecting";
  const showVideo = videoEnabled || Boolean(remoteStream?.getVideoTracks().length);
  const qualityTone = connectionTone(networkQuality);
  const peerName =
    peerDisplayName ||
    (phase === "incoming" ? "Incoming caller" : "Chatter call");

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="call-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="fixed inset-0 z-[80] flex flex-col bg-[#101012] text-white"
          role="dialog"
          aria-modal="true"
          aria-label="Call"
        >
          <audio ref={remoteAudioRef} autoPlay playsInline />
          <header className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="text-sm font-semibold">
                {call?.type === "video" ? "Video call" : "Voice call"}
              </p>
              <p className="mt-0.5 text-xs text-white/55">
                {phase === "incoming" ? (
                  "Incoming call"
                ) : phase === "outgoing" ? (
                  "Calling…"
                ) : phase === "ringing" ? (
                  "Ringing…"
                ) : phase === "connecting" ? (
                  "Connecting…"
                ) : phase === "reconnecting" ? (
                  "Reconnecting…"
                ) : phase === "ended" ? (
                  "Call ended"
                ) : (
                  <CallTimer startedAt={activeCall?.started_at} />
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-white/60">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cx(
                    "size-2 rounded-full",
                    qualityTone === "good"
                      ? "bg-emerald-400"
                      : qualityTone === "warn"
                        ? "bg-amber-400"
                        : "bg-red-400",
                  )}
                />
                {connectionLabel(networkQuality)}
              </span>
            </div>
          </header>

          <main className="relative min-h-0 flex-1 p-5">
            {showVideo && (remoteStream || stream) ? (
              <div className="relative grid h-full place-items-center overflow-hidden rounded-3xl bg-black/40">
                {remoteStream?.getVideoTracks().length && peerVideoEnabled ? (
                  <video
                    ref={attachRemoteVideo}
                    autoPlay
                    playsInline
                    className={cx(
                      "max-h-full max-w-full object-cover",
                      backgroundBlur && "blur-[2px]",
                    )}
                  />
                ) : (
                  <div className="grid place-items-center text-center">
                    <Avatar
                      name={peerName}
                      src={peerAvatarUrl}
                      size="xl"
                    />
                    <p className="mt-4 text-lg font-semibold">{peerName}</p>
                    {peerUsername && (
                      <p className="text-sm text-white/50">@{peerUsername}</p>
                    )}
                  </div>
                )}
                {stream && videoEnabled && (
                  <div className="absolute bottom-6 right-6 overflow-hidden rounded-2xl border border-white/10 bg-black/35 shadow-2xl backdrop-blur-xl">
                    <video
                      ref={attachLocalVideo}
                      autoPlay
                      muted
                      playsInline
                      className={cx(
                        "h-36 w-56 object-cover",
                        mirrored && "-scale-x-100",
                      )}
                    />
                    <p className="px-3 py-1.5 text-[11px] text-white/55">You</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <motion.div
                    className="relative mx-auto grid size-28 place-items-center rounded-full bg-white/10"
                    animate={{
                      boxShadow: [
                        "0 0 0 0 rgba(118,86,201,.25)",
                        "0 0 0 28px rgba(118,86,201,0)",
                      ],
                    }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  >
                    <Avatar
                      name={peerName}
                      src={peerAvatarUrl}
                      size="xl"
                    />
                  </motion.div>
                  <h2 className="mt-5 text-2xl font-semibold">{peerName}</h2>
                  {peerUsername && (
                    <p className="mt-1 text-sm text-white/50">@{peerUsername}</p>
                  )}
                  <p className="mt-2 text-sm text-white/45">
                    {phase === "incoming"
                      ? call?.type === "video"
                        ? "Incoming video call"
                        : "Incoming voice call"
                      : phase === "outgoing"
                        ? "Calling…"
                        : phase === "ringing"
                          ? "Ringing…"
                          : "Voice call"}
                  </p>
                  {connected && <Waveform muted={muted || peerMuted} />}
                  {peerMuted && (
                    <p className="mt-3 text-xs text-white/45">
                      Their microphone is muted
                    </p>
                  )}
                </div>
              </div>
            )}
          </main>

          {phase === "incoming" ? (
            <div className="flex flex-wrap items-center justify-center gap-4 p-7">
              <RoundControl
                danger
                label="Decline"
                onClick={() => void callController.rejectIncoming()}
              >
                <PhoneOff size={20} />
              </RoundControl>
              <RoundControl
                success
                label="Answer"
                onClick={() => void callController.acceptIncoming()}
              >
                <Phone size={20} />
              </RoundControl>
              <RoundControl
                active={ringtoneMuted}
                label="Mute ringtone"
                onClick={() => callController.muteRingtone()}
              >
                <VolumeX size={18} />
              </RoundControl>
              <RoundControl
                label="Dismiss"
                onClick={() => callController.dismissIncoming()}
              >
                <PhoneMissed size={18} />
              </RoundControl>
            </div>
          ) : (
            <footer className="flex items-center justify-center gap-3 p-6">
              <RoundControl
                active={muted}
                disabled={
                  !activeCall && phase !== "outgoing" && phase !== "ringing"
                }
                label={muted ? "Unmute" : "Mute"}
                onClick={() => void callController.setMuted(!muted)}
              >
                {muted ? <MicOff size={19} /> : <Mic size={19} />}
              </RoundControl>
              <RoundControl
                active={!videoEnabled}
                disabled={
                  !activeCall && phase !== "outgoing" && phase !== "ringing"
                }
                label="Camera"
                onClick={() => void callController.setVideoEnabled(!videoEnabled)}
              >
                {videoEnabled ? <Camera size={19} /> : <CameraOff size={19} />}
              </RoundControl>
              <RoundControl
                active={!speakerEnabled}
                label="Speaker"
                onClick={() =>
                  useCallMediaStore
                    .getState()
                    .setSpeakerEnabled(!speakerEnabled)
                }
              >
                <Speaker size={19} />
              </RoundControl>
              <RoundControl
                label="Picture in picture"
                disabled={!videoEnabled || !document.pictureInPictureEnabled}
                onClick={() =>
                  void (
                    remoteVideoRef.current || localVideoRef.current
                  )?.requestPictureInPicture?.()
                }
              >
                <PictureInPicture size={19} />
              </RoundControl>
              <RoundControl
                label="Full screen"
                onClick={() =>
                  void document.documentElement.requestFullscreen?.()
                }
              >
                <Expand size={19} />
              </RoundControl>
              <RoundControl
                label="Devices"
                onClick={() => setSettingsOpen((value) => !value)}
              >
                <Settings2 size={19} />
              </RoundControl>
              <RoundControl danger label="End" onClick={() => void endCall()}>
                <PhoneOff size={20} />
              </RoundControl>
            </footer>
          )}

          <AnimatePresence>
            {settingsOpen && (
              <motion.aside
                initial={{ x: 360 }}
                animate={{ x: 0 }}
                exit={{ x: 360 }}
                className="absolute right-4 top-16 w-80 rounded-3xl border border-white/10 bg-[#1b1b1f]/95 p-5 shadow-2xl backdrop-blur-xl"
              >
                <h3 className="font-semibold">Call settings</h3>
                <DeviceSelect
                  label="Microphone"
                  value={audioDevice}
                  onChange={(id) => void callController.switchMicrophone(id)}
                  devices={devices.filter(
                    (device) => device.kind === "audioinput",
                  )}
                />
                <DeviceSelect
                  label="Camera"
                  value={videoDevice}
                  onChange={(id) => void callController.switchCamera(id)}
                  devices={devices.filter(
                    (device) => device.kind === "videoinput",
                  )}
                />
                <label className="mt-4 block text-xs text-white/60">
                  Output volume
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(event) =>
                      useCallMediaStore
                        .getState()
                        .setVolume(Number(event.target.value))
                    }
                    className="mt-2 w-full"
                  />
                </label>
                <ToggleLine
                  label="Noise suppression"
                  checked={noiseSuppression}
                  onChange={useCallMediaStore.getState().setNoiseSuppression}
                />
                <ToggleLine
                  label="Mirror camera"
                  checked={mirrored}
                  onChange={useCallMediaStore.getState().setMirrored}
                />
                <ToggleLine
                  label="Background blur"
                  checked={backgroundBlur}
                  onChange={useCallMediaStore.getState().setBackgroundBlur}
                />
                <p className="mt-4 flex gap-2 text-[11px] leading-5 text-white/45">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  Media is encrypted peer-to-peer. ICE servers and signaling come
                  from Chatter’s call API.
                </p>
              </motion.aside>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CallTimer({ startedAt }: { startedAt?: string | null }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const base = startedAt ? new Date(startedAt).getTime() : Date.now();
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return <>{formatCallDuration(seconds)}</>;
}

function CallButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      {children}
    </button>
  );
}

function RoundControl({
  children,
  label,
  onClick,
  active,
  danger,
  success,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  success?: boolean;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.05 }}
      whileTap={{ scale: disabled ? 1 : 0.96 }}
      className={cx(
        "grid size-12 place-items-center rounded-2xl bg-white/10 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-35",
        active && "bg-white text-black",
        danger && "bg-red-600 hover:bg-red-500",
        success && "bg-emerald-600 hover:bg-emerald-500",
      )}
    >
      {children}
    </motion.button>
  );
}

function Waveform({ muted }: { muted: boolean }) {
  return (
    <div className="mt-7 flex h-9 items-center justify-center gap-1">
      {Array.from({ length: 20 }).map((_, index) => (
        <motion.span
          key={index}
          className="w-1 rounded-full bg-[var(--accent)]"
          animate={{ height: muted ? 4 : [4, 10 + (index % 6) * 4, 4] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: index * 0.035 }}
        />
      ))}
    </div>
  );
}

function DeviceSelect({
  label,
  value,
  onChange,
  devices,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  devices: MediaDeviceInfo[];
}) {
  return (
    <label className="mt-4 block text-xs text-white/60">
      {label}
      <span className="relative mt-2 block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 pr-8 text-sm text-white outline-none"
        >
          <option value="">System default</option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${index + 1}`}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-2.5" />
      </span>
    </label>
  );
}

function ToggleLine({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-6 w-11 rounded-full transition",
          checked ? "bg-[var(--accent)]" : "bg-white/15",
        )}
      >
        <span
          className={cx(
            "absolute top-1 size-4 rounded-full bg-white transition",
            checked ? "left-6" : "left-1",
          )}
        />
      </button>
    </label>
  );
}
