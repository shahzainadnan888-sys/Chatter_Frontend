"use client";

const ENABLED =
  typeof process !== "undefined"
    ? process.env.NODE_ENV !== "production" ||
      process.env.NEXT_PUBLIC_CALL_DEBUG === "1"
    : true;

export function callDebug(scope: string, message: string, data?: unknown) {
  if (!ENABLED) return;
  if (data !== undefined) {
    console.info(`[calls:${scope}] ${message}`, data);
  } else {
    console.info(`[calls:${scope}] ${message}`);
  }
}

export function callWarn(scope: string, message: string, data?: unknown) {
  if (!ENABLED) return;
  if (data !== undefined) {
    console.warn(`[calls:${scope}] ${message}`, data);
  } else {
    console.warn(`[calls:${scope}] ${message}`);
  }
}
