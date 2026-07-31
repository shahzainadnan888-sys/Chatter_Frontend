export async function requestMediaPermission(options: {
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  noiseSuppression?: boolean;
}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Media permissions are unavailable on this device.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: options.audio
      ? {
          deviceId: options.audioDeviceId
            ? { exact: options.audioDeviceId }
            : undefined,
          echoCancellation: true,
          noiseSuppression: options.noiseSuppression ?? true,
          autoGainControl: true,
        }
      : false,
    video: options.video
      ? {
          deviceId: options.videoDeviceId
            ? { exact: options.videoDeviceId }
            : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        }
      : false,
  });
}

export async function enumerateMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return navigator.mediaDevices.enumerateDevices();
}

export async function requestLocationPermission(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is unavailable on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 5_000,
    });
  });
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported" as const;
  if (Notification.permission === "granted") return "granted" as const;
  return Notification.requestPermission();
}

export type ChatterPermission = "microphone" | "camera" | "notifications";
export type ChatterPermissionState =
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export async function queryBrowserPermission(
  name: ChatterPermission,
): Promise<ChatterPermissionState> {
  if (name === "notifications") {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission === "default"
      ? "prompt"
      : Notification.permission;
  }
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  if (!navigator.permissions?.query) return "prompt";
  try {
    const result = await navigator.permissions.query({
      name: name as PermissionName,
    });
    return result.state;
  } catch {
    // Safari and older browser versions may support getUserMedia without
    // exposing camera or microphone through the Permissions API.
    return "prompt";
  }
}

export async function requestDevicePermission(
  name: "microphone" | "camera",
): Promise<void> {
  const stream = await requestMediaPermission({
    audio: name === "microphone",
    video: name === "camera",
  });
  stream.getTracks().forEach((track) => track.stop());
}
