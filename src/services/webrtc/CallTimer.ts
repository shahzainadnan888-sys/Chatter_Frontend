"use client";

/** Elapsed call time helpers. */
export function formatCallDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function elapsedSecondsSince(startedAt?: string | null) {
  const base = startedAt ? new Date(startedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((Date.now() - base) / 1000));
}
