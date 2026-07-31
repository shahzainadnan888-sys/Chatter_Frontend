"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { useMediaStore } from "@/src/stores/feature-stores";

export function MediaViewer() {
  const open = useMediaStore((state) => state.open);
  const item = useMediaStore((state) => state.item);
  const zoom = useMediaStore((state) => state.zoom);
  const close = useMediaStore((state) => state.close);
  const setZoom = useMediaStore((state) => state.setZoom);

  return (
    <AnimatePresence>
      {open && item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[75] flex flex-col bg-black/90 text-white backdrop-blur-xl"
          onClick={close}
        >
          <header className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {item.original_filename || item.kind}
              </p>
              <p className="mt-0.5 text-xs text-white/50">
                {item.content_type} · {Math.max(1, Math.round(item.bytes / 1024))} KB
              </p>
            </div>
            <div className="flex items-center gap-1">
              <ViewerButton label="Zoom out" onClick={() => setZoom(zoom - 0.25)}>
                <Minus size={16} />
              </ViewerButton>
              <span className="w-12 text-center text-xs tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <ViewerButton label="Zoom in" onClick={() => setZoom(zoom + 0.25)}>
                <Plus size={16} />
              </ViewerButton>
              <a
                href={item.url}
                download={item.original_filename || true}
                onClick={(event) => event.stopPropagation()}
                className="grid size-9 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Download"
              >
                <Download size={16} />
              </a>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="grid size-9 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Open externally"
              >
                <ExternalLink size={16} />
              </a>
              <ViewerButton
                label="Fullscreen"
                onClick={() => void document.documentElement.requestFullscreen?.()}
              >
                <Maximize2 size={16} />
              </ViewerButton>
              <ViewerButton label="Close" onClick={close}>
                <X size={17} />
              </ViewerButton>
            </div>
          </header>
          <div
            className="grid min-h-0 flex-1 place-items-center overflow-auto p-6"
            onClick={(event) => event.stopPropagation()}
          >
            {item.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.original_filename || "Media"}
                className="max-h-full max-w-full rounded-xl object-contain transition-transform"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : item.kind === "video" ? (
              <video src={item.url} controls autoPlay className="max-h-full max-w-full rounded-xl" />
            ) : item.kind === "voice" ? (
              <div className="w-full max-w-xl rounded-3xl bg-white/10 p-8">
                <audio src={item.url} controls autoPlay className="w-full" />
              </div>
            ) : (
              <div className="rounded-3xl bg-white/10 p-8 text-center">
                <p className="font-semibold">
                  {item.original_filename || "Document"}
                </p>
                <p className="mt-2 text-sm text-white/55">
                  Open or download this document to preview it.
                </p>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black"
                >
                  <ExternalLink size={15} /> Open document
                </a>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ViewerButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid size-9 place-items-center rounded-xl hover:bg-white/10"
    >
      {children}
    </button>
  );
}
