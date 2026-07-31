"use client";

import {
  acquireLocalMedia,
  setTrackEnabled,
  switchVideoInput,
} from "@/src/services/webrtc/MediaDevices";

/** Video-track helpers for camera toggle / device switch. */
export class VideoManager {
  async ensureCamera(stream: MediaStream | null) {
    if (stream?.getVideoTracks().length) return stream;
    return acquireLocalMedia("video");
  }

  setEnabled(stream: MediaStream | null | undefined, enabled: boolean) {
    setTrackEnabled(stream, "video", enabled);
  }

  async switchCamera(stream: MediaStream, deviceId: string) {
    return switchVideoInput(stream, deviceId);
  }
}

export const videoManager = new VideoManager();
