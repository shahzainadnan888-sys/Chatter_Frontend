"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function Brand({
  compact = false,
  tone = "primary",
}: {
  compact?: boolean;
  tone?: "primary" | "adaptive" | "light" | "dark";
}) {
  return (
    <div className="flex items-center gap-2.5" aria-label="Chatter">
      <span className="relative block size-9 shrink-0" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            tone === "light"
              ? "./chatter-logo-light.png"
              : tone === "dark" || tone === "adaptive"
                ? "./chatter-logo-dark.png"
                : "./chatter-logo-primary.png"
          }
          alt=""
          className={cx(
            "size-full object-contain",
            tone === "adaptive" && "dark:hidden",
          )}
        />
        {tone === "adaptive" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="./chatter-logo-light.png"
            alt=""
            className="absolute inset-0 hidden size-full object-contain dark:block"
          />
        )}
      </span>
      {!compact && (
        <span className="text-[17px] font-semibold tracking-[-0.02em]">
          Chatter
        </span>
      )}
    </div>
  );
}

export function AuthShell({
  children,
  eyebrow,
  title,
  description,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <aside className="relative hidden w-[43%] flex-col justify-between border-r border-[var(--border)] p-12 lg:flex">
        <Brand />
        <div className="max-w-md pb-12">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {eyebrow}
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.045em]">
            {title}
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-7 text-[var(--muted)]">
            {description}
          </p>
        </div>
        <p className="text-xs text-[var(--muted)]">
          Private by design. Built for real conversations.
        </p>
      </aside>
      <section className="relative flex min-h-screen flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="absolute left-6 top-6 lg:hidden">
          <Brand />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[440px]"
        >
          {children}
        </motion.div>
      </section>
    </main>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    error?: string;
    hint?: ReactNode;
    leading?: ReactNode;
  }
>(function Input({ label, error, hint, leading, className, ...props }, ref) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between text-[13px] font-medium">
        {label}
        {hint}
      </span>
      <span className="relative block">
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-[var(--muted)]">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          className={cx(
            "field h-11 w-full rounded-xl border bg-[var(--surface)] px-3.5 text-[14px] outline-none transition placeholder:text-[var(--muted-2)]",
            Boolean(leading) && "pl-8",
            error
              ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/10"
              : "border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]",
            className,
          )}
          aria-invalid={Boolean(error)}
          {...props}
        />
      </span>
      <AnimatePresence initial={false}>
        {error && (
          <motion.span
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 block text-xs text-red-600 dark:text-red-400"
            role="alert"
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </label>
  );
});

export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
    label: string;
    error?: string;
    hint?: ReactNode;
  }
>(function PasswordInput({ label, error, hint, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        label={label}
        error={error}
        hint={hint}
        type={visible ? "text" : "password"}
        className="pr-11"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute right-3 top-[35px] rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
});

export function Button({
  children,
  loading,
  variant = "primary",
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      className={cx(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" &&
          "brand-button text-white shadow-sm hover:brightness-95 active:scale-[0.99]",
        variant === "secondary" &&
          "border border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]",
        variant === "ghost" && "hover:bg-[var(--surface-2)]",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle size={17} className="animate-spin" />}
      {children}
    </button>
  );
}

export function FormHeader({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <header className="mb-7">
      <h2 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {description}
      </div>
    </header>
  );
}

export function InlineError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
    >
      {message}
    </div>
  );
}

export function SkeletonScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)]">
      <div className="flex flex-col items-center gap-4">
        <Brand compact />
        <LoaderCircle
          className="animate-spin text-[var(--muted)]"
          size={20}
          aria-label="Loading Chatter"
        />
      </div>
    </main>
  );
}

export { cx };
