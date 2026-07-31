"use client";

import { toast } from "sonner";
import { friendlyError } from "@/src/lib/shell-utils";
import { audioManager } from "@/src/services/webrtc/AudioManager";
import { callDebug, callWarn } from "@/src/services/webrtc/call-debug";
import { callSignaling } from "@/src/services/webrtc/CallSignaling";
import {
  acquireLocalMedia,
  listMediaDevices,
  setTrackEnabled,
  stopMediaStream,
  switchAudioInput,
  switchVideoInput,
} from "@/src/services/webrtc/MediaDevices";
import type { SignalingEvent } from "@/src/services/webrtc/types";
import { WebRTCManager } from "@/src/services/webrtc/WebRTCManager";
import { callsApi } from "@/src/services/prompt4-api";
import { chatsApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import {
  getCallSession,
  useCallMediaStore,
  useCallStore,
  useConnectionStore,
  useDeviceStore,
} from "@/src/stores/call-stores";
import type { Call, CallType, UUID } from "@/src/types/api";

function isVideoCall(call: Call | { type?: string } | null | undefined) {
  return call?.type === "video";
}

function mediaKind(type: CallType | string): "video" | "voice" {
  return type === "video" ? "video" : "voice";
}

/**
 * Orchestrates HTTP call APIs + signaling + WebRTC for one-to-one calls.
 * HTTP accept/reject/cancel/end/mute/video already emit signaling — do not dual-send.
 */
class CallControllerService {
  private webrtc = new WebRTCManager();
  private unsubscribe: (() => void) | null = null;
  private statusUnsub: (() => void) | null = null;
  private bootstrapped = false;
  private starting = false;
  private offerSentFor = new Set<string>();
  private peerReady = false;
  private pendingRemoteOffer: { callId: string; sdp: string } | null = null;
  private pendingLocalOfferCallId: string | null = null;
  private outgoingWatchdog: ReturnType<typeof setTimeout> | null = null;

  bootstrap() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    callDebug("ctrl", "bootstrap");
    this.unsubscribe = callSignaling.subscribe((event) => {
      void this.onSignalingEvent(event);
    });
    this.statusUnsub = callSignaling.onStatus((status) => {
      useConnectionStore.getState().setSignalingStatus(status);
      const phase = useCallStore.getState().phase;
      if (status === "open") {
        callDebug("ctrl", "signaling open — ready for invites");
        if (phase === "reconnecting") {
          useCallStore.getState().setPhase("connected");
          useConnectionStore.getState().setNetworkQuality("good");
        }
      }
      if (
        (status === "closed" || status === "error") &&
        (phase === "connected" || phase === "connecting")
      ) {
        useCallStore.getState().setPhase("reconnecting");
        useConnectionStore.getState().setNetworkQuality("reconnecting");
      }
    });
    void callSignaling.ensureConnected().catch((error) => {
      callWarn("ctrl", "initial signaling connect failed", error);
    });
  }

  /** Keep the call signaling socket alive; required for receiving CALL_INVITE. */
  async ensureSignaling() {
    this.bootstrap();
    await callSignaling.ensureConnected();
  }

  dispose() {
    this.clearOutgoingWatchdog();
    this.unsubscribe?.();
    this.statusUnsub?.();
    this.unsubscribe = null;
    this.statusUnsub = null;
    this.bootstrapped = false;
    this.cleanupMedia();
    callSignaling.disconnect();
  }

  /** HTTP/history fallback when CALL_INVITE was missed (receiver not yet on WS). */
  presentIncomingCall(call: Call) {
    this.bootstrap();
    const store = useCallStore.getState();
    if (store.phase !== "idle" && store.phase !== "ended") return;
    if (store.dismissedCallIds.includes(call.id)) return;
    if (call.status !== "ringing") return;
    const me = useAuthStore.getState().user?.id;
    if (me && (call.caller_id === me || call.initiator_id === me)) return;

    callDebug("ctrl", "incoming via HTTP fallback", { call_id: call.id });
    store.setIncomingCall(call);
    store.setActiveCall(null);
    store.setPhase("incoming");
    store.setIsCaller(false);
    if (!store.ringtoneMuted) audioManager.play("incoming");
    this.notifyIncoming(call);
  }

  async startCall(input: {
    receiver_id?: UUID;
    chat_id?: UUID;
    group_id?: UUID;
    type: CallType;
  }) {
    this.bootstrap();
    const session = getCallSession();
    if (
      (session.phase !== "idle" && session.phase !== "ended") ||
      this.starting
    ) {
      toast.error("Finish your current call first.");
      return;
    }
    if (session.phase === "ended") getCallSession().resetAll();

    if (input.group_id) {
      toast.info("Group calling will arrive in a later update.");
      return;
    }

    this.starting = true;
    this.offerSentFor.clear();
    this.pendingLocalOfferCallId = null;
    this.pendingRemoteOffer = null;
    useCallMediaStore.getState().setVideoEnabled(input.type === "video");
    useCallStore.getState().setPhase("outgoing");
    useCallStore.getState().setIsCaller(true);

    try {
      let receiverId = input.receiver_id;
      if (!receiverId && input.chat_id) {
        receiverId = await this.resolveReceiverFromChat(input.chat_id);
      }
      if (!receiverId) {
        throw new Error("Could not resolve who to call.");
      }

      callDebug("http", "POST /calls/start", {
        receiver_id: receiverId,
        type: input.type,
      });
      await callSignaling.ensureConnected();
      const ice = await callsApi.iceServers();
      callDebug("http", "GET /calls/ice-servers", ice);
      const callType = input.type === "video" ? "video" : "voice";

      const [callResult, mediaResult] = await Promise.allSettled([
        callsApi.start({
          receiver_id: receiverId,
          call_type: callType,
        }),
        acquireLocalMedia(mediaKind(input.type), {
          audioDeviceId: useDeviceStore.getState().audioInputId || undefined,
          videoDeviceId: useDeviceStore.getState().videoInputId || undefined,
          noiseSuppression: useCallMediaStore.getState().noiseSuppression,
        }),
      ]);

      if (callResult.status === "rejected") {
        if (mediaResult.status === "fulfilled") stopMediaStream(mediaResult.value);
        throw callResult.reason;
      }

      const call = callResult.value;
      callDebug("http", "start response", {
        id: call.id,
        status: call.status,
        failure_reason: call.failure_reason,
      });

      if (call.status === "missed" || call.status === "failed") {
        if (mediaResult.status === "fulfilled") stopMediaStream(mediaResult.value);
        audioManager.play("busy");
        useCallStore.getState().setPhase("ended");
        toast.error(call.failure_reason || "The other person is unavailable.");
        window.setTimeout(() => {
          audioManager.stop();
          getCallSession().resetAll();
        }, 900);
        return;
      }

      if (mediaResult.status === "rejected") {
        await callsApi
          .cancel(call.id)
          .catch(() => callsApi.end(call.id).catch(() => undefined));
        getCallSession().resetAll();
        toast.error(
          input.type === "video"
            ? "Camera and microphone access is required."
            : "Microphone access is required.",
        );
        return;
      }

      const stream = mediaResult.value;
      callDebug("media", "local tracks", {
        audio: stream.getAudioTracks().map((t) => t.label),
        video: stream.getVideoTracks().map((t) => t.label),
      });
      useCallMediaStore.getState().setStream(stream);
      useCallStore.getState().setActiveCall(call);
      useCallStore.getState().setIncomingCall(null);
      useCallStore.getState().setPhase(
        call.status === "ringing" ? "ringing" : "outgoing",
      );
      if (!useCallStore.getState().ringtoneMuted) audioManager.play("outgoing");
      void listMediaDevices().then((devices) =>
        useDeviceStore.getState().setDevices(devices),
      );
      this.armOutgoingWatchdog(call.id);

      await this.preparePeer(call, stream, ice.iceServers, { polite: false });
    } catch (error) {
      this.cleanupMedia();
      getCallSession().resetAll();
      toast.error(friendlyError(error));
    } finally {
      this.starting = false;
    }
  }

  async acceptIncoming() {
    const store = useCallStore.getState();
    const incoming = store.incomingCall;
    if (!incoming) return;

    store.setPhase("connecting");
    store.setIsCaller(false);
    audioManager.stop();
    callDebug("http", "POST /calls/accept", { call_id: incoming.id });

    try {
      await callSignaling.ensureConnected();
      const ice = await callsApi.iceServers();
      const stream = await acquireLocalMedia(mediaKind(incoming.type), {
        audioDeviceId: useDeviceStore.getState().audioInputId || undefined,
        videoDeviceId: useDeviceStore.getState().videoInputId || undefined,
        noiseSuppression: useCallMediaStore.getState().noiseSuppression,
      });
      useCallMediaStore.getState().setStream(stream);
      useCallMediaStore.getState().setVideoEnabled(isVideoCall(incoming));
      void listMediaDevices().then((devices) =>
        useDeviceStore.getState().setDevices(devices),
      );

      // Peer must be ready before accept so remote offer/ICE are not dropped.
      await this.preparePeer(incoming, stream, ice.iceServers, { polite: true });

      const accepted = await callsApi.accept(incoming.id);
      callDebug("http", "accept response", {
        id: accepted.id,
        status: accepted.status,
      });
      useCallStore.getState().setActiveCall(accepted);
      useCallStore.getState().setIncomingCall(null);
      useCallStore.getState().setPhase("connecting");
    } catch (error) {
      this.cleanupMedia();
      getCallSession().resetAll();
      toast.error(friendlyError(error));
    }
  }

  async rejectIncoming(reason?: string) {
    const store = useCallStore.getState();
    const incoming = store.incomingCall;
    audioManager.stop();
    if (incoming) {
      store.dismissCall(incoming.id);
      try {
        callDebug("http", "POST /calls/reject", { call_id: incoming.id });
        await callsApi.reject(incoming.id, reason);
      } catch {
        // Local dismiss still stands.
      }
    }
    this.cleanupMedia();
    getCallSession().resetAll();
  }

  dismissIncoming() {
    const store = useCallStore.getState();
    const incoming = store.incomingCall;
    audioManager.stop();
    if (incoming) store.dismissCall(incoming.id);
    store.setIncomingCall(null);
    store.setPhase("idle");
  }

  muteRingtone() {
    useCallStore.getState().setRingtoneMuted(true);
    audioManager.stop();
  }

  async endActive(reason?: string) {
    const call = useCallStore.getState().activeCall;
    const incoming = useCallStore.getState().incomingCall;
    const phase = useCallStore.getState().phase;
    const wasOutgoing = phase === "outgoing" || phase === "ringing";
    const wasRinging =
      call?.status === "ringing" ||
      (!call?.started_at && wasOutgoing);

    this.clearOutgoingWatchdog();
    audioManager.play("ended");
    this.cleanupMedia();
    useCallStore.getState().setPhase("ended");
    if (incoming) useCallStore.getState().dismissCall(incoming.id);
    window.setTimeout(() => {
      audioManager.stop();
      getCallSession().resetAll();
    }, 700);

    if (!call && !incoming) return;

    try {
      if (incoming && !call) {
        callDebug("http", "POST /calls/reject", { call_id: incoming.id });
        await callsApi.reject(incoming.id, reason);
      } else if (call && wasOutgoing && wasRinging) {
        callDebug("http", "POST /calls/cancel", { call_id: call.id });
        await callsApi.cancel(call.id, reason);
      } else if (call) {
        callDebug("http", "POST /calls/end", { call_id: call.id });
        await callsApi.end(call.id, reason);
      }
    } catch (error) {
      toast.error(friendlyError(error));
    }
  }

  async setMuted(muted: boolean) {
    const media = useCallMediaStore.getState();
    setTrackEnabled(media.stream, "audio", !muted);
    media.setMuted(muted);
    const callId = useCallStore.getState().activeCall?.id;
    if (!callId) return;
    try {
      const updated = muted
        ? await callsApi.mute(callId)
        : await callsApi.unmute(callId);
      useCallStore.getState().setActiveCall(updated);
    } catch (error) {
      setTrackEnabled(media.stream, "audio", muted);
      media.setMuted(!muted);
      toast.error(friendlyError(error));
    }
  }

  async setVideoEnabled(enabled: boolean) {
    const media = useCallMediaStore.getState();
    const callId = useCallStore.getState().activeCall?.id;
    if (!callId) return;

    try {
      let stream = media.stream;
      if (enabled && !stream?.getVideoTracks().length) {
        const next = await acquireLocalMedia("video", {
          audioDeviceId: useDeviceStore.getState().audioInputId || undefined,
          videoDeviceId: useDeviceStore.getState().videoInputId || undefined,
        });
        const audio = stream?.getAudioTracks()[0];
        stopMediaStream(stream);
        if (audio) next.addTrack(audio);
        stream = next;
        media.setStream(next);
        this.webrtc.attachLocalStream(next);
      }
      setTrackEnabled(stream, "video", enabled);
      media.setVideoEnabled(enabled);
      const updated = enabled
        ? await callsApi.startVideo(callId)
        : await callsApi.endVideo(callId);
      useCallStore.getState().setActiveCall(updated);
      const videoTrack = stream?.getVideoTracks()[0] ?? null;
      await this.webrtc.replaceTrack("video", enabled ? videoTrack : null);
    } catch (error) {
      media.setVideoEnabled(!enabled);
      toast.error(friendlyError(error));
    }
  }

  async switchMicrophone(deviceId: string) {
    const media = useCallMediaStore.getState();
    if (!media.stream) return;
    useDeviceStore.getState().setAudioInputId(deviceId);
    const track = await switchAudioInput(media.stream, deviceId, {
      noiseSuppression: media.noiseSuppression,
    });
    if (track) await this.webrtc.replaceTrack("audio", track);
  }

  async switchCamera(deviceId: string) {
    const media = useCallMediaStore.getState();
    if (!media.stream) return;
    useDeviceStore.getState().setVideoInputId(deviceId);
    const track = await switchVideoInput(media.stream, deviceId);
    if (track) await this.webrtc.replaceTrack("video", track);
  }

  private async resolveReceiverFromChat(chatId: UUID) {
    const chat = await chatsApi.get(chatId);
    const me = useAuthStore.getState().user;
    const other = chat.participants.find(
      (participant) =>
        participant.user_id !== me?.id &&
        participant.username !== me?.username,
    );
    if (other) {
      useCallStore.getState().setPeerMeta({
        displayName: other.display_name || other.username,
        username: other.username,
        avatarUrl: other.avatar_url,
      });
    }
    return other?.user_id;
  }

  private async preparePeer(
    call: Call,
    stream: MediaStream,
    iceServers: Awaited<ReturnType<typeof callsApi.iceServers>>["iceServers"],
    options: { polite: boolean },
  ) {
    this.peerReady = false;
    this.webrtc.setPolite(options.polite);
    this.webrtc.configure({
      onRemoteStream: (remote) => {
        callDebug("pc", "remote stream", {
          audio: remote.getAudioTracks().length,
          video: remote.getVideoTracks().length,
        });
        useCallMediaStore.getState().setRemoteStream(remote);
      },
      onIceCandidate: (candidate) => {
        callDebug("ice", "local candidate", candidate);
        callSignaling.sendEvent("ICE_CANDIDATE", call.id, {
          call_id: call.id,
          candidate,
        });
      },
      onConnectionState: (state) => {
        callDebug("pc", `connectionState=${state}`);
        if (state === "connected") {
          this.clearOutgoingWatchdog();
          useCallStore.getState().setPhase("connected");
          useConnectionStore.getState().setNetworkQuality("excellent");
          audioManager.play("connected");
          window.setTimeout(() => audioManager.stop(), 400);
        } else if (state === "disconnected" || state === "failed") {
          useCallStore.getState().setPhase("reconnecting");
          useConnectionStore
            .getState()
            .setNetworkQuality(state === "failed" ? "lost" : "reconnecting");
        }
      },
      onIceConnectionState: (state) => {
        callDebug("pc", `iceConnectionState=${state}`);
        if (state === "disconnected" || state === "failed") {
          useConnectionStore.getState().setNetworkQuality("poor");
        }
      },
      onSignalingState: (state) => {
        callDebug("pc", `signalingState=${state}`);
      },
    });
    await this.webrtc.createPeerConnection(iceServers);
    this.webrtc.attachLocalStream(stream);
    this.peerReady = true;
    callDebug("pc", "peer ready", { call_id: call.id, polite: options.polite });

    if (this.pendingRemoteOffer?.callId === call.id) {
      const pending = this.pendingRemoteOffer;
      this.pendingRemoteOffer = null;
      callDebug("sdp", "flush buffered remote offer");
      await this.applyRemoteOffer(pending.callId, pending.sdp);
    }

    const shouldOffer =
      this.pendingLocalOfferCallId === call.id ||
      (useCallStore.getState().isCaller &&
        (useCallStore.getState().activeCall?.status === "accepted" ||
          useCallStore.getState().activeCall?.status === "active"));
    if (shouldOffer) {
      this.pendingLocalOfferCallId = null;
      await this.createAndSendOffer(call.id);
    }
  }

  private async createAndSendOffer(callId: string) {
    if (this.offerSentFor.has(callId)) {
      callDebug("sdp", "offer already sent", { call_id: callId });
      return;
    }
    if (!this.peerReady) {
      callDebug("sdp", "defer offer until peer ready", { call_id: callId });
      this.pendingLocalOfferCallId = callId;
      return;
    }
    this.offerSentFor.add(callId);
    try {
      callDebug("sdp", "createOffer", { call_id: callId });
      const offer = await this.webrtc.createOffer();
      if (offer?.sdp) {
        callDebug("sdp", "send SDP_OFFER", {
          call_id: callId,
          sdpBytes: offer.sdp.length,
        });
        callSignaling.sendEvent("SDP_OFFER", callId, {
          call_id: callId,
          sdp: offer.sdp,
        });
      }
    } catch (error) {
      this.offerSentFor.delete(callId);
      callWarn("sdp", "createOffer failed", error);
      toast.error(friendlyError(error));
    }
  }

  private async applyRemoteOffer(callId: string, sdp: string) {
    callDebug("sdp", "handle remote offer", {
      call_id: callId,
      sdpBytes: sdp.length,
    });
    const answer = await this.webrtc.handleRemoteOffer(sdp);
    if (answer?.sdp) {
      callDebug("sdp", "send SDP_ANSWER", {
        call_id: callId,
        sdpBytes: answer.sdp.length,
      });
      callSignaling.sendEvent("SDP_ANSWER", callId, {
        call_id: callId,
        sdp: answer.sdp,
      });
    }
  }

  private async onSignalingEvent(event: SignalingEvent) {
    const callStore = useCallStore.getState();
    const me = useAuthStore.getState().user?.id;
    const callId = String(event.call_id || event.payload.call_id || "");

    switch (event.type) {
      case "CALL_INVITE": {
        if (callStore.phase !== "idle" && callStore.phase !== "ended") {
          callWarn("ctrl", "invite ignored — busy", {
            phase: callStore.phase,
            callId,
          });
          return;
        }
        if (callStore.dismissedCallIds.includes(callId)) return;
        const inviteCall = this.inviteToCall(event);
        callDebug("ctrl", "CALL_INVITE → incoming UI", {
          call_id: inviteCall.id,
          type: inviteCall.type,
        });
        callStore.setIncomingCall(inviteCall);
        callStore.setActiveCall(null);
        callStore.setPhase("incoming");
        callStore.setIsCaller(false);
        if (!callStore.ringtoneMuted) audioManager.play("incoming");
        this.notifyIncoming(inviteCall);
        break;
      }
      case "CALL_RINGING": {
        if (callStore.activeCall?.id === callId || callStore.isCaller) {
          callStore.setPhase("ringing");
          if (callStore.activeCall && callStore.activeCall.id === callId) {
            callStore.setActiveCall({
              ...callStore.activeCall,
              status: "ringing",
            });
          }
        }
        break;
      }
      case "CALL_ACCEPT": {
        if (
          callStore.activeCall?.id !== callId &&
          callStore.incomingCall?.id !== callId
        ) {
          break;
        }
        this.clearOutgoingWatchdog();
        const active = callStore.activeCall;
        if (active && active.id === callId) {
          callStore.setActiveCall({
            ...active,
            status: "accepted",
            started_at: active.started_at || new Date().toISOString(),
          });
        }
        callStore.setPhase("connecting");
        audioManager.stop();
        const amCaller =
          callStore.isCaller ||
          active?.caller_id === me ||
          active?.initiator_id === me;
        if (amCaller) {
          callDebug("sdp", "CALL_ACCEPT → create offer");
          await this.createAndSendOffer(callId);
        }
        break;
      }
      case "CALL_REJECT":
      case "CALL_CANCEL":
      case "CALL_END":
      case "CALL_TIMEOUT":
      case "CALL_FAILED": {
        if (
          callStore.activeCall?.id === callId ||
          callStore.incomingCall?.id === callId ||
          (callStore.isCaller &&
            (callStore.phase === "outgoing" || callStore.phase === "ringing"))
        ) {
          this.clearOutgoingWatchdog();
          if (event.type === "CALL_FAILED") audioManager.play("busy");
          else audioManager.play("ended");
          this.cleanupMedia();
          callStore.setPhase("ended");
          if (event.type === "CALL_TIMEOUT") toast.message("No answer");
          if (event.type === "CALL_FAILED") {
            toast.message(
              String(event.payload.reason || "Call failed").replaceAll("_", " "),
            );
          }
          if (event.type === "CALL_REJECT") toast.message("Call declined");
          if (event.type === "CALL_CANCEL") toast.message("Call cancelled");
          window.setTimeout(() => {
            audioManager.stop();
            getCallSession().resetAll();
          }, 800);
        }
        break;
      }
      case "CALL_BUSY": {
        this.clearOutgoingWatchdog();
        audioManager.play("busy");
        this.cleanupMedia();
        callStore.setPhase("ended");
        toast.message("User is busy");
        window.setTimeout(() => {
          audioManager.stop();
          getCallSession().resetAll();
        }, 900);
        break;
      }
      case "SDP_OFFER": {
        const sdp = String(event.payload.sdp ?? "");
        if (!sdp) break;
        if (!this.peerReady) {
          callDebug("sdp", "buffer remote offer (peer not ready)");
          this.pendingRemoteOffer = { callId, sdp };
          break;
        }
        await this.applyRemoteOffer(callId, sdp);
        break;
      }
      case "SDP_ANSWER": {
        const sdp = String(event.payload.sdp ?? "");
        if (!sdp) break;
        callDebug("sdp", "handle remote answer", {
          call_id: callId,
          sdpBytes: sdp.length,
        });
        await this.webrtc.handleRemoteAnswer(sdp);
        break;
      }
      case "ICE_CANDIDATE": {
        const candidate = event.payload.candidate as
          | RTCIceCandidateInit
          | undefined;
        if (candidate) {
          callDebug("ice", "remote candidate", candidate);
          await this.webrtc.addIceCandidate(candidate);
        }
        break;
      }
      case "MIC_MUTED":
        useCallMediaStore.getState().setPeerMuted(true);
        break;
      case "MIC_UNMUTED":
        useCallMediaStore.getState().setPeerMuted(false);
        break;
      case "CAMERA_ENABLED":
        useCallMediaStore.getState().setPeerVideoEnabled(true);
        break;
      case "CAMERA_DISABLED":
        useCallMediaStore.getState().setPeerVideoEnabled(false);
        break;
      case "NETWORK_QUALITY": {
        const level = event.payload.level;
        if (typeof level === "string") {
          useConnectionStore.getState().setNetworkQuality(level as never);
        }
        break;
      }
      case "ERROR": {
        callWarn("ws", "signaling ERROR", event.payload);
        break;
      }
      default:
        break;
    }
  }

  private inviteToCall(event: SignalingEvent): Call {
    const payload = event.payload;
    const callType =
      payload.call_type === "video" || payload.type === "video"
        ? "video"
        : payload.call_type === "voice" || payload.type === "voice"
          ? "voice"
          : "audio";
    const now = new Date().toISOString();
    return {
      id: String(payload.call_id ?? event.call_id),
      chat_id: null,
      group_id: null,
      initiator_id: String(payload.caller_id ?? event.sender_id ?? ""),
      caller_id: String(payload.caller_id ?? event.sender_id ?? ""),
      receiver_id: String(payload.receiver_id ?? ""),
      type: callType,
      status: "ringing",
      started_at: null,
      answered_at: null,
      ended_at: null,
      duration_seconds: null,
      ended_by: null,
      room_id: String(payload.room_id ?? ""),
      is_group_call: false,
      video_enabled: callType === "video",
      failure_reason: null,
      participants: [],
      created_at: now,
      updated_at: now,
    };
  }

  private notifyIncoming(call: Call) {
    if (window.chatter?.notify) {
      void window.chatter.notify({
        title: "Incoming Chatter call",
        body:
          call.type === "video" ? "Incoming video call" : "Incoming voice call",
      });
    } else if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      new Notification("Incoming Chatter call", {
        body:
          call.type === "video" ? "Incoming video call" : "Incoming voice call",
      });
    }
  }

  private armOutgoingWatchdog(callId: string) {
    this.clearOutgoingWatchdog();
    // Backend ring timeout is typically ~30–45s; fail closed if we stall.
    this.outgoingWatchdog = setTimeout(() => {
      const store = useCallStore.getState();
      if (
        store.activeCall?.id === callId &&
        (store.phase === "outgoing" || store.phase === "ringing")
      ) {
        callWarn("ctrl", "outgoing watchdog — ending stuck call");
        void this.endActive("timeout");
        toast.message("No answer");
      }
    }, 60_000);
  }

  private clearOutgoingWatchdog() {
    if (this.outgoingWatchdog) {
      clearTimeout(this.outgoingWatchdog);
      this.outgoingWatchdog = null;
    }
  }

  private cleanupMedia() {
    const media = useCallMediaStore.getState();
    stopMediaStream(media.stream);
    stopMediaStream(media.remoteStream);
    this.webrtc.close();
    media.setStream(null);
    media.setRemoteStream(null);
    this.peerReady = false;
    this.offerSentFor.clear();
    this.pendingRemoteOffer = null;
    this.pendingLocalOfferCallId = null;
  }
}

export const callController = new CallControllerService();
