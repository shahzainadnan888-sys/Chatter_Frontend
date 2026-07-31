"use client";

import type { IceServerConfig } from "@/src/services/webrtc/types";

type PcListener = {
  onRemoteStream?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceConnectionState?: (state: RTCIceConnectionState) => void;
  onSignalingState?: (state: RTCSignalingState) => void;
};

/**
 * Thin wrapper around RTCPeerConnection for one-to-one calls.
 */
export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private listeners: PcListener = {};
  private makingOffer = false;
  private ignoreOffer = false;
  private isPolite = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  configure(listeners: PcListener) {
    this.listeners = listeners;
  }

  setPolite(polite: boolean) {
    this.isPolite = polite;
  }

  async createPeerConnection(iceServers: IceServerConfig[]) {
    this.close();
    this.pc = new RTCPeerConnection({
      iceServers: iceServers.map((server) => ({
        urls: server.urls,
        username: server.username ?? undefined,
        credential: server.credential ?? undefined,
      })),
      iceCandidatePoolSize: 4,
    });

    this.remoteStream = new MediaStream();
    // Always negotiate audio + video m-lines so voice/video answer paths stay reliable.
    this.pc.addTransceiver("audio", { direction: "recvonly" });
    this.pc.addTransceiver("video", { direction: "recvonly" });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.listeners.onIceCandidate?.(event.candidate.toJSON());
      }
    };
    this.pc.ontrack = (event) => {
      const stream = this.remoteStream;
      if (!stream) return;
      const tracks =
        event.streams[0]?.getTracks()?.length
          ? event.streams[0].getTracks()
          : event.track
            ? [event.track]
            : [];
      tracks.forEach((track) => {
        const exists = stream
          .getTracks()
          .some((existing) => existing.id === track.id);
        if (!exists) stream.addTrack(track);
      });
      this.listeners.onRemoteStream?.(stream);
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc) this.listeners.onConnectionState?.(this.pc.connectionState);
    };
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc) {
        this.listeners.onIceConnectionState?.(this.pc.iceConnectionState);
      }
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc) this.listeners.onSignalingState?.(this.pc.signalingState);
    };
    return this.pc;
  }

  attachLocalStream(stream: MediaStream) {
    this.localStream = stream;
    if (!this.pc) return;
    stream.getTracks().forEach((track) => {
      const transceiver = this.pc
        ?.getTransceivers()
        .find((item) => item.receiver.track.kind === track.kind);
      if (transceiver) {
        void transceiver.sender.replaceTrack(track);
        transceiver.direction = "sendrecv";
        return;
      }
      const existing = this.pc
        ?.getSenders()
        .find((sender) => sender.track?.kind === track.kind);
      if (existing) {
        void existing.replaceTrack(track);
      } else {
        this.pc?.addTrack(track, stream);
      }
    });
  }

  async replaceTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
    const sender = this.pc
      ?.getSenders()
      .find((item) => item.track?.kind === kind);
    if (sender) {
      await sender.replaceTrack(track);
      return;
    }
    if (track && this.localStream) {
      this.pc?.addTrack(track, this.localStream);
    }
  }

  async createOffer() {
    if (!this.pc) throw new Error("Peer connection is not ready.");
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(offer);
      return this.pc.localDescription;
    } finally {
      this.makingOffer = false;
    }
  }

  async handleRemoteOffer(sdp: string) {
    if (!this.pc) throw new Error("Peer connection is not ready.");
    const offerCollision =
      this.makingOffer || this.pc.signalingState !== "stable";
    this.ignoreOffer = !this.isPolite && offerCollision;
    if (this.ignoreOffer) return null;

    await this.pc.setRemoteDescription({ type: "offer", sdp });
    await this.flushPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription;
  }

  async handleRemoteAnswer(sdp: string) {
    if (!this.pc) throw new Error("Peer connection is not ready.");
    if (this.pc.signalingState !== "have-local-offer") return;
    await this.pc.setRemoteDescription({ type: "answer", sdp });
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc) return;
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Candidate may be obsolete after renegotiation.
    }
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  close() {
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onsignalingstatechange = null;
      this.pc.close();
    }
    this.pc = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.makingOffer = false;
    this.ignoreOffer = false;
  }

  private async flushPendingCandidates() {
    const pending = [...this.pendingCandidates];
    this.pendingCandidates = [];
    for (const candidate of pending) {
      try {
        await this.pc?.addIceCandidate(candidate);
      } catch {
        // ignore
      }
    }
  }
}
