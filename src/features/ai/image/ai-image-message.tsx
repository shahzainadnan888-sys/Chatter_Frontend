"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ImageIcon } from "lucide-react";
import { resolveApiAssetUrl } from "@/src/lib/api-client";
import { GeneratedImageCard } from "@/src/features/ai/image/generated-image-card";
import {
  ImageErrorCard,
  ImageGeneratingCard,
} from "@/src/features/ai/image/image-generating-card";
import {
  resolveImagePhase,
  type AIImagePhase,
} from "@/src/features/ai/image/types";

export interface AIImageMessageModel {
  id: string;
  createdAt: string;
  status: string;
  imageUrl?: string | null;
  imagePrompt?: string | null;
  error?: string | null;
}

export const AIImageMessage = memo(function AIImageMessage({
  message,
  busy,
  onRegenerate,
  onRetry,
}: {
  message: AIImageMessageModel;
  busy?: boolean;
  onRegenerate: () => void;
  onRetry: () => void;
}) {
  const [assetError, setAssetError] = useState<string | null>(null);
  const absoluteUrl = message.imageUrl
    ? resolveApiAssetUrl(message.imageUrl)
    : null;

  useEffect(() => {
    setAssetError(null);
  }, [message.imageUrl, message.status]);

  const phase: AIImagePhase = useMemo(() => {
    if (assetError) return "error";
    return resolveImagePhase({
      status: message.status,
      imageUrl: message.imageUrl,
      error: message.error,
    });
  }, [assetError, message.error, message.imageUrl, message.status]);

  const handleAssetError = useCallback((detail: string) => {
    setAssetError(detail);
  }, []);

  const statusLabel =
    phase === "loading"
      ? "Generating"
      : phase === "timeout"
        ? "Timed out"
        : phase === "error"
          ? "Failed"
          : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="group mb-8 flex gap-3"
    >
      <span
        className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white shadow-lg shadow-[var(--accent)]/20"
        aria-hidden
      >
        <ImageIcon size={16} strokeWidth={1.8} />
      </span>

      {/*
        Do NOT use w-fit around aspect-square cards — width collapses to ~0
        and you get a tiny circle. Use block + explicit card widths instead.
      */}
      <div className="min-w-0 flex-1">
        {phase === "loading" || phase === "idle" ? (
          <ImageGeneratingCard />
        ) : phase === "timeout" ? (
          <ImageErrorCard
            title="Image generation timed out"
            detail="No response within 60 seconds. Please try again."
            busy={busy}
            onRetry={onRetry}
          />
        ) : phase === "error" ? (
          <ImageErrorCard
            title="Couldn't generate image"
            detail={assetError || message.error || "Please try again."}
            busy={busy}
            onRetry={onRetry}
          />
        ) : absoluteUrl ? (
          <GeneratedImageCard
            url={absoluteUrl}
            alt={message.imagePrompt || "AI generated image"}
            prompt={message.imagePrompt}
            busy={busy}
            onRegenerate={onRegenerate}
            onLoadError={handleAssetError}
          />
        ) : (
          <ImageErrorCard
            title="Couldn't generate image"
            detail="The response did not include an image."
            busy={busy}
            onRetry={onRetry}
          />
        )}

        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-[var(--muted-2)]">
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {statusLabel && (
            <>
              <span aria-hidden>·</span>
              <span>{statusLabel}</span>
            </>
          )}
        </div>
      </div>
    </motion.article>
  );
});

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
