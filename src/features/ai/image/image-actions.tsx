"use client";

import { motion } from "framer-motion";
import { Copy, Download, Maximize2, RefreshCw } from "lucide-react";
import { cx } from "@/src/components/ui";

export function ImageActions({
  busy,
  onDownload,
  onCopy,
  onOpen,
  onRegenerate,
  className,
}: {
  busy?: boolean;
  onDownload: () => void;
  onCopy: () => void;
  onOpen: () => void;
  onRegenerate: () => void;
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Image actions"
      className={cx(
        "flex w-fit items-center gap-1 rounded-2xl border border-white/15 bg-black/50 p-1.5 shadow-lg backdrop-blur-xl",
        className,
      )}
    >
      <ActionButton label="Download" onClick={onDownload}>
        <Download size={14} />
      </ActionButton>
      <ActionButton label="Copy Image" onClick={onCopy}>
        <Copy size={14} />
      </ActionButton>
      <ActionButton label="Open" onClick={onOpen}>
        <Maximize2 size={14} />
      </ActionButton>
      <ActionButton label="Regenerate" disabled={busy} onClick={onRegenerate}>
        <RefreshCw size={14} />
      </ActionButton>
    </div>
  );
}

function ActionButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid size-9 place-items-center rounded-xl text-white/90 transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </motion.button>
  );
}
