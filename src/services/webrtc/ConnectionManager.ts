"use client";

/** Lightweight connection quality helpers for the call UI. */
export type ConnectionLabel =
  | "Excellent"
  | "Good"
  | "Fair"
  | "Poor"
  | "Reconnecting"
  | "Disconnected"
  | "Lost";

export function connectionLabel(
  quality: string | null | undefined,
): ConnectionLabel {
  switch (quality) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
    case "lost":
      return "Lost";
    default:
      return "Good";
  }
}

export function connectionTone(
  quality: string | null | undefined,
): "good" | "warn" | "bad" {
  if (quality === "excellent" || quality === "good") return "good";
  if (quality === "fair") return "warn";
  return "bad";
}
