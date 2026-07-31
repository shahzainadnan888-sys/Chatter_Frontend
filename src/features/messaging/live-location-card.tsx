"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, MapPin, Navigation, Radio } from "lucide-react";
import { Button, cx } from "@/src/components/ui";
import {
  encodeLiveLocationContent,
  mapsUrl,
  openInMaps,
  parseLocationCoords,
} from "@/src/lib/maps";
import { formatRelativeTime } from "@/src/lib/shell-utils";
import { locationApi } from "@/src/services/messaging-api";
import type { LiveLocation, UUID } from "@/src/types/api";

export const LOCATION_DURATIONS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 480, label: "8 hours" },
  { minutes: 43_200, label: "Until I stop" },
] as const;

export type LocationDurationMinutes =
  (typeof LOCATION_DURATIONS)[number]["minutes"];

export { encodeLiveLocationContent, parseLocationCoords };

export function LiveLocationMessageCard({
  content,
  senderName,
  senderId,
  mine,
  chatId,
}: {
  content: string;
  senderName: string;
  senderId: UUID;
  mine: boolean;
  chatId: UUID;
}) {
  const parsed = parseLocationCoords(content);
  const [live, setLive] = useState<LiveLocation | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setUpdating(true);
      void locationApi
        .get(senderId)
        .then((location) => {
          if (cancelled) return;
          if (location.chat_id && location.chat_id !== chatId) return;
          setLive(location);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setUpdating(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatId, senderId]);

  const latitude = live?.latitude ?? parsed?.latitude;
  const longitude = live?.longitude ?? parsed?.longitude;
  const isLive = Boolean(live?.is_active);
  const remainingMs = live?.expires_at
    ? new Date(live.expires_at).getTime() - Date.now()
    : null;
  const remainingLabel =
    remainingMs != null && remainingMs > 0
      ? `${Math.floor(remainingMs / 60_000)}:${String(
          Math.floor((remainingMs % 60_000) / 1000),
        ).padStart(2, "0")} left`
      : isLive
        ? "Live"
        : "Ended";

  if (latitude == null || longitude == null) {
    return (
      <p className="text-sm leading-6">{content || "Location shared"}</p>
    );
  }

  return (
    <div
      className={cx(
        "min-w-[220px] max-w-[320px] overflow-hidden rounded-2xl border",
        mine
          ? "border-white/20 bg-black/15"
          : "border-[var(--border)] bg-[var(--surface-2)]/80",
      )}
    >
      <div className="relative h-28 overflow-hidden bg-[radial-gradient(circle_at_30%_40%,var(--accent-soft),transparent_55%),linear-gradient(135deg,var(--surface),var(--panel))]">
        <span className="absolute inset-0 opacity-40 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:18px_18px]" />
        <motion.span
          animate={
            isLive
              ? { scale: [1, 1.35, 1], opacity: [1, 0.45, 1] }
              : { scale: 1, opacity: 0.7 }
          }
          transition={{ duration: 1.6, repeat: isLive ? Infinity : 0 }}
          className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--accent)] text-white shadow-lg"
        >
          <MapPin size={16} />
        </motion.span>
        <span
          className={cx(
            "absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isLive
              ? "bg-emerald-500/90 text-white"
              : "bg-black/45 text-white/85",
          )}
        >
          <Radio size={10} />
          {updating ? "Updating…" : isLive ? "Live" : "Ended"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <div>
          <p className={cx("text-sm font-semibold", mine && "text-white")}>
            Live location
          </p>
          <p
            className={cx(
              "text-xs",
              mine ? "text-white/70" : "text-[var(--muted)]",
            )}
          >
            {senderName}
            {live?.last_updated_at
              ? ` · updated ${formatRelativeTime(live.last_updated_at)}`
              : ""}
          </p>
        </div>
        <p
          className={cx(
            "text-[11px]",
            mine ? "text-white/65" : "text-[var(--muted-2)]",
          )}
        >
          {remainingLabel}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={mapsUrl(latitude, longitude)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openInMaps(latitude, longitude);
            }}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              mine
                ? "bg-white text-[var(--ink)] hover:bg-white/90"
                : "bg-[var(--accent)] text-white hover:opacity-95",
            )}
          >
            <Navigation size={12} />
            Open in Maps
            <ExternalLink size={11} />
          </a>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className={cx(
              "rounded-xl px-2.5 py-1.5 text-[11px] font-medium",
              mine
                ? "text-white/75 hover:bg-white/10"
                : "text-[var(--muted)] hover:bg-[var(--surface)]",
            )}
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        </div>
        <AnimatePresence>
          {expanded && (
            <motion.p
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className={cx(
                "overflow-hidden font-mono text-[10px]",
                mine ? "text-white/55" : "text-[var(--muted-2)]",
              )}
            >
              {latitude.toFixed(5)}, {longitude.toFixed(5)}
              {live?.accuracy != null
                ? ` · ±${Math.round(live.accuracy)} m`
                : ""}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function LiveLocationDurationDialog({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (minutes: LocationDurationMinutes) => void;
  loading?: boolean;
}) {
  const [selected, setSelected] =
    useState<LocationDurationMinutes>(60);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-location-title"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md rounded-[28px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
      >
        <h2 id="live-location-title" className="text-lg font-semibold">
          Share live location
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Choose how long others can follow your position. You can stop anytime.
        </p>
        <div className="mt-4 grid gap-2">
          {LOCATION_DURATIONS.map((option) => (
            <button
              key={option.minutes}
              type="button"
              onClick={() => setSelected(option.minutes)}
              className={cx(
                "rounded-2xl border px-4 py-3 text-left text-sm transition",
                selected === option.minutes
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] hover:border-[var(--border-strong)]",
              )}
            >
              <span className="font-semibold">{option.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => onConfirm(selected)}>
            <MapPin size={14} /> Share location
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
