"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cx } from "@/src/components/ui";
import { initials } from "@/src/lib/shell-utils";

export function Avatar({
  name,
  src,
  online,
  size = "md",
}: {
  name?: string | null;
  src?: string | null;
  online?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = {
    sm: "size-8 text-[11px]",
    md: "size-10 text-xs",
    lg: "size-12 text-sm",
    xl: "size-16 text-lg",
  };
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", sizes[size])}>
      <span
        className={cx(
          "grid size-full place-items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] font-semibold text-[var(--muted)]",
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="size-full object-cover" />
        ) : (
          initials(name)
        )}
      </span>
      {online !== undefined && (
        <span
          className={cx(
            "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-[var(--surface)]",
            online ? "bg-emerald-500" : "bg-zinc-400",
          )}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="electron-drag flex min-h-[78px] items-center justify-between gap-4 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] px-5 py-4 backdrop-blur-xl sm:px-6">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.035em]">{title}</h1>
        {description && (
          <div className="mt-1 text-sm text-[var(--muted)]">{description}</div>
        )}
      </div>
      {actions && (
        <div className="electron-no-drag flex shrink-0 items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
  illustration,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  illustration: "chats" | "friends" | "search" | "notifications" | "groups" | "activity";
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <EmptyIllustration kind={illustration} />
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function EmptyIllustration({
  kind,
}: {
  kind: "chats" | "friends" | "search" | "notifications" | "groups" | "activity";
}) {
  const paths: Record<typeof kind, ReactNode> = {
    chats: (
      <>
        <rect x="18" y="28" width="84" height="58" rx="16" fill="var(--surface-2)" />
        <rect x="34" y="44" width="40" height="8" rx="4" fill="var(--border-strong)" />
        <rect x="34" y="60" width="28" height="8" rx="4" fill="var(--border)" />
        <circle cx="92" cy="34" r="14" fill="var(--accent-soft)" />
      </>
    ),
    friends: (
      <>
        <circle cx="44" cy="48" r="18" fill="var(--surface-2)" />
        <circle cx="76" cy="48" r="18" fill="var(--accent-soft)" />
        <rect x="28" y="74" width="64" height="10" rx="5" fill="var(--border)" />
      </>
    ),
    search: (
      <>
        <circle cx="54" cy="50" r="24" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="4" />
        <rect x="74" y="74" width="28" height="8" rx="4" transform="rotate(40 74 74)" fill="var(--accent)" />
      </>
    ),
    notifications: (
      <>
        <path d="M40 70c0-18 10-28 20-28s20 10 20 28v8H40v-8Z" fill="var(--surface-2)" />
        <rect x="54" y="28" width="12" height="12" rx="6" fill="var(--accent)" />
        <rect x="48" y="82" width="24" height="8" rx="4" fill="var(--border-strong)" />
      </>
    ),
    groups: (
      <>
        <rect x="24" y="34" width="72" height="52" rx="16" fill="var(--surface-2)" />
        <circle cx="48" cy="58" r="10" fill="var(--accent-soft)" />
        <circle cx="68" cy="58" r="10" fill="var(--border-strong)" />
      </>
    ),
    activity: (
      <>
        <rect x="22" y="30" width="76" height="60" rx="16" fill="var(--surface-2)" />
        <rect x="36" y="46" width="48" height="6" rx="3" fill="var(--border-strong)" />
        <rect x="36" y="60" width="32" height="6" rx="3" fill="var(--border)" />
        <rect x="36" y="74" width="40" height="6" rx="3" fill="var(--accent-soft)" />
      </>
    ),
  };
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="28" fill="var(--panel)" />
      {paths[kind]}
    </svg>
  );
}

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2 p-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="flex animate-pulse items-center gap-3 rounded-2xl px-3 py-3"
        >
          <div className="size-10 rounded-full bg-[var(--surface-2)]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-[var(--surface-2)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--surface-2)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/75 shadow-[0_20px_55px_-42px_rgba(0,0,0,0.7)] backdrop-blur-xl transition duration-200 hover:border-[var(--border-strong)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-sm font-semibold tracking-[-0.015em]">{title}</h2>
        {action}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

export function SoftBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "danger" | "success";
}) {
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
        tone === "neutral" && "bg-[var(--surface-2)] text-[var(--muted)]",
        tone === "accent" && "bg-[var(--accent)] text-white",
        tone === "danger" && "bg-red-500 text-white",
        tone === "success" && "bg-emerald-500 text-white",
      )}
    >
      {children}
    </span>
  );
}

export function PageFade({ children, pageKey }: { children: ReactNode; pageKey: string }) {
  return (
    <motion.div
      key={pageKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full min-h-0 flex-col"
    >
      {children}
    </motion.div>
  );
}
