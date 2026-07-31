"use client";

import { useSyncExternalStore } from "react";

let hydrated = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!hydrated) {
    hydrated = true;
    queueMicrotask(() => {
      for (const notify of [...listeners]) notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Router and storage APIs need a real document, so gate them until hydration. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hydrated,
    () => false,
  );
}
