"use client";

import type { NetworkQualityLevel } from "@/src/services/webrtc/types";

/**
 * Derives a coarse network quality level from WebRTC stats when the backend
 * has not recently pushed a NETWORK_QUALITY event.
 */
export class NetworkMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pc: RTCPeerConnection | null = null;
  private onQuality: ((level: NetworkQualityLevel) => void) | null = null;

  start(
    pc: RTCPeerConnection,
    onQuality: (level: NetworkQualityLevel) => void,
  ) {
    this.stop();
    this.pc = pc;
    this.onQuality = onQuality;
    this.timer = setInterval(() => {
      void this.sample();
    }, 4_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pc = null;
    this.onQuality = null;
  }

  private async sample() {
    if (!this.pc || !this.onQuality) return;
    try {
      const stats = await this.pc.getStats();
      let rtt = 0;
      let loss = 0;
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          rtt = Number(report.currentRoundTripTime ?? 0) * 1000;
        }
        if (report.type === "inbound-rtp" && !report.isRemote) {
          const packets = Number(report.packetsReceived ?? 0);
          const lost = Number(report.packetsLost ?? 0);
          if (packets + lost > 0) loss = (lost / (packets + lost)) * 100;
        }
      });
      if (rtt > 400 || loss > 8) this.onQuality("poor");
      else if (rtt > 200 || loss > 3) this.onQuality("fair");
      else if (rtt > 100) this.onQuality("good");
      else this.onQuality("excellent");
    } catch {
      // Stats may be unavailable mid-renegotiation.
    }
  }
}

export const networkMonitor = new NetworkMonitor();
