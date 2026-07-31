"use client";

export interface MediaDeviceSelection {
  audioDeviceId?: string;
  videoDeviceId?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
}

export async function listMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return navigator.mediaDevices.enumerateDevices();
}

export async function acquireLocalMedia(
  kind: "audio" | "video" | "voice",
  selection: MediaDeviceSelection = {},
) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Media devices are unavailable in this environment.");
  }

  const wantsVideo = kind === "video";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: selection.audioDeviceId
        ? { exact: selection.audioDeviceId }
        : undefined,
      echoCancellation: selection.echoCancellation ?? true,
      noiseSuppression: selection.noiseSuppression ?? true,
      autoGainControl: true,
    },
    video: wantsVideo
      ? {
          deviceId: selection.videoDeviceId
            ? { exact: selection.videoDeviceId }
            : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        }
      : false,
  });

  return stream;
}

export function stopMediaStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
}

export function setTrackEnabled(
  stream: MediaStream | null | undefined,
  kind: "audio" | "video",
  enabled: boolean,
) {
  const tracks =
    kind === "audio" ? stream?.getAudioTracks() : stream?.getVideoTracks();
  tracks?.forEach((track) => {
    track.enabled = enabled;
  });
}

export async function switchAudioInput(
  stream: MediaStream,
  deviceId: string,
  options: MediaDeviceSelection = {},
) {
  const next = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
    },
  });
  const newTrack = next.getAudioTracks()[0];
  const oldTrack = stream.getAudioTracks()[0];
  if (oldTrack) {
    stream.removeTrack(oldTrack);
    oldTrack.stop();
  }
  if (newTrack) stream.addTrack(newTrack);
  next.getVideoTracks().forEach((track) => track.stop());
  return newTrack ?? null;
}

export async function switchVideoInput(stream: MediaStream, deviceId: string) {
  const next = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  const newTrack = next.getVideoTracks()[0];
  const oldTrack = stream.getVideoTracks()[0];
  if (oldTrack) {
    stream.removeTrack(oldTrack);
    oldTrack.stop();
  }
  if (newTrack) stream.addTrack(newTrack);
  next.getAudioTracks().forEach((track) => track.stop());
  return newTrack ?? null;
}
