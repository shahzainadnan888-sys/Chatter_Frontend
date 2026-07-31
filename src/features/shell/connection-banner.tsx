"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, RefreshCw, CloudOff } from "lucide-react";
import { flushPendingMessages } from "@/src/lib/pending-messages";
import { useMessagingStore } from "@/src/stores/messaging-store";

export function ConnectionBanner() {
  const queryClient = useQueryClient();
  const offline = useMessagingStore((state) => state.offline);
  const wsConnected = useMessagingStore((state) => state.wsConnected);
  const pendingCount = useMessagingStore((state) => state.pendingQueue.length);

  const show = offline || !wsConnected || pendingCount > 0;
  if (!show) return null;

  const message = offline
    ? "You’re offline. Messages will send when connection returns."
    : !wsConnected
      ? "Reconnecting to realtime…"
      : `${pendingCount} message${pendingCount === 1 ? "" : "s"} waiting to send`;

  const Icon = offline ? WifiOff : pendingCount > 0 ? CloudOff : RefreshCw;

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="overflow-hidden border-b border-amber-200/80 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100"
      >
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium">
          <Icon
            size={14}
            className={!offline && !wsConnected ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          {message}
          {!offline && pendingCount > 0 && (
            <button
              type="button"
              onClick={() => {
                void flushPendingMessages().finally(() => {
                  void queryClient.invalidateQueries({ queryKey: ["messages"] });
                  void queryClient.invalidateQueries({ queryKey: ["chats"] });
                });
              }}
              className="electron-no-drag rounded-full border border-current/20 px-2 py-0.5 font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              Retry
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
