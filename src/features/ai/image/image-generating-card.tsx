"use client";

import { motion } from "framer-motion";
import { AlertCircle, ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import { cx } from "@/src/components/ui";

/** Explicit size — never rely on w-fit + w-full or the square collapses. */
const FRAME =
  "relative w-[min(100%,420px)] shrink-0 overflow-hidden rounded-[24px]";
const FRAME_RATIO = "aspect-square min-h-[280px] sm:min-h-[320px]";

export function ImageGeneratingCard({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading generated image"
        className={cx(
          "absolute inset-0 overflow-hidden rounded-[20px] bg-[#121820]",
          className,
        )}
      >
        <ShimmerLayers />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
            className="text-[var(--accent)]"
          >
            <LoaderCircle size={28} strokeWidth={2} />
          </motion.span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Generating image"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cx(
        FRAME,
        FRAME_RATIO,
        "border border-white/[0.08] bg-[#121820] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)]",
        className,
      )}
    >
      <ShimmerLayers />

      {/* Soft grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
        <motion.div
          animate={{ scale: [1, 1.05, 1], opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="relative grid size-16 place-items-center rounded-[20px] border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-md"
        >
          <span className="absolute -inset-3 rounded-[28px] bg-[var(--accent)]/15 blur-xl" />
          <ImageIcon size={28} strokeWidth={1.6} className="relative text-white/90" />
          <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[var(--accent)] text-white shadow-lg">
            <Sparkles size={10} />
          </span>
        </motion.div>

        <div className="space-y-2">
          <p className="text-base font-semibold tracking-tight text-white">
            Generating image...
          </p>
          <p className="text-[13px] leading-5 text-white/45">
            This usually takes 5–20 seconds
          </p>
        </div>

        <div className="flex items-center gap-3">
          <motion.span
            aria-hidden
            animate={{ rotate: 360 }}
            transition={{ duration: 1.05, repeat: Infinity, ease: "linear" }}
            className="text-[var(--accent)]"
          >
            <LoaderCircle size={20} strokeWidth={2.2} />
          </motion.span>
          <span className="flex items-center gap-1.5">
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1, 0.85] }}
                transition={{
                  duration: 1.1,
                  repeat: Infinity,
                  delay: index * 0.18,
                  ease: "easeInOut",
                }}
                className="size-1.5 rounded-full bg-[var(--accent)]"
              />
            ))}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function ShimmerLayers() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.22),transparent_55%),radial-gradient(circle_at_70%_80%,rgba(236,72,153,0.12),transparent_50%),linear-gradient(160deg,#151b24_0%,#0e131a_50%,#121820_100%)]"
      />
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
        animate={{ x: ["-130%", "130%"] }}
        transition={{ duration: 1.9, repeat: Infinity, ease: "linear" }}
      />
    </>
  );
}

export function ImageErrorCard({
  title,
  detail,
  busy,
  onRetry,
}: {
  title: string;
  detail?: string | null;
  busy?: boolean;
  onRetry: () => void;
}) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cx(
        FRAME,
        FRAME_RATIO,
        "flex flex-col items-center justify-center border border-rose-500/30 bg-[#1a1216] px-8 text-center shadow-[0_24px_60px_-28px_rgba(244,63,94,0.35)]",
      )}
    >
      <span className="grid size-14 place-items-center rounded-2xl bg-rose-500/15 text-rose-400">
        <AlertCircle size={26} strokeWidth={1.8} />
      </span>
      <h3 className="mt-5 text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-[280px] text-[13px] leading-5 text-white/50">
        {detail?.trim() || "Please try again."}
      </p>
      <motion.button
        type="button"
        aria-label="Try again"
        disabled={busy}
        whileHover={busy ? undefined : { scale: 1.04 }}
        whileTap={busy ? undefined : { scale: 0.97 }}
        onClick={onRetry}
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-[#0e131a] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Try Again
      </motion.button>
    </motion.div>
  );
}
