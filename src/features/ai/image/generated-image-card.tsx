"use client";

import { memo, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { cx } from "@/src/components/ui";
import { ImageActions } from "@/src/features/ai/image/image-actions";
import { ImageGeneratingCard } from "@/src/features/ai/image/image-generating-card";
import { ImageViewerModal } from "@/src/features/ai/image/image-viewer-modal";
import { IMAGE_ASSET_LOAD_TIMEOUT_MS } from "@/src/features/ai/image/types";

const FRAME =
  "relative w-[min(100%,420px)] shrink-0 aspect-square min-h-[280px] sm:min-h-[320px] overflow-hidden rounded-[24px]";

export const GeneratedImageCard = memo(function GeneratedImageCard({
  url,
  alt,
  prompt,
  busy,
  onRegenerate,
  onLoadError,
}: {
  url: string;
  alt: string;
  prompt?: string | null;
  busy?: boolean;
  onRegenerate: () => void;
  onLoadError: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [url]);

  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => {
      onLoadError("The image took too long to load.");
    }, IMAGE_ASSET_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, onLoadError, url]);

  return (
    <div className="w-full max-w-[420px]">
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={cx(
          FRAME,
          "group/image border border-white/[0.08] bg-[#121820] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)]",
        )}
      >
        <AnimatePresence initial={false}>
          {!loaded && (
            <motion.div
              key="placeholder"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 z-[1]"
            >
              <ImageGeneratingCard compact />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          aria-label="Open generated image"
          initial={{ opacity: 0, scale: 1.01, filter: "blur(8px)" }}
          animate={{
            opacity: loaded ? 1 : 0,
            scale: loaded ? 1 : 1.01,
            filter: loaded ? "blur(0px)" : "blur(8px)",
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => setViewerOpen(true)}
          className="absolute inset-0 z-[2] overflow-hidden rounded-[20px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- remote API asset */}
          <img
            src={url}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => onLoadError("The image could not be loaded.")}
            className="size-full object-cover transition duration-300 group-hover/image:scale-[1.03]"
          />
        </motion.button>

        {loaded && (
          <div
            className={cx(
              "absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/60 via-black/15 to-transparent px-3 pb-3 pt-12 opacity-0 transition duration-200",
              "pointer-events-none group-hover/image:pointer-events-auto group-hover/image:opacity-100",
              "group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100",
            )}
          >
            <ImageActions
              className="ml-auto"
              busy={busy}
              onDownload={() => void downloadImage(url, prompt)}
              onCopy={() => void copyImage(url)}
              onOpen={() => setViewerOpen(true)}
              onRegenerate={onRegenerate}
            />
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {viewerOpen && (
          <ImageViewerModal
            src={url}
            alt={alt}
            onClose={() => setViewerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}, (prev, next) =>
  prev.url === next.url &&
  prev.alt === next.alt &&
  prev.prompt === next.prompt &&
  prev.busy === next.busy,
);

async function downloadImage(url: string, prompt?: string | null) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const slug = (prompt || "chatter-ai-image")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    anchor.href = objectUrl;
    anchor.download = `${slug || "chatter-ai-image"}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    toast.error("Could not download the image.");
  }
}

async function copyImage(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Copy failed");
    const blob = await response.blob();
    const type = blob.type || "image/png";
    if (!navigator.clipboard?.write) throw new Error("Clipboard unavailable");
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    toast.success("Image copied");
  } catch {
    toast.error("Could not copy the image.");
  }
}
