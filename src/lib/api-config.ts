/**
 * Single source of truth for the production Chatter backend.
 * All HTTP and WebSocket clients must use these helpers — never localhost.
 */

export const PRODUCTION_API_ORIGIN =
  "https://chatter-backend.fastapicloud.dev";

export const API_PREFIX =
  process.env.NEXT_PUBLIC_API_PREFIX?.trim() || "/api/v1";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

/** HTTP origin for REST, media, and asset URLs. */
export function getApiOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  return trimTrailingSlash(fromEnv || PRODUCTION_API_ORIGIN);
}

/**
 * WebSocket base including `/ws` (e.g. `wss://host/ws`).
 * Derives `wss:` from `https:` API origin when `NEXT_PUBLIC_WS_URL` is unset.
 */
export function getWsBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (fromEnv) return trimTrailingSlash(fromEnv);

  const api = new URL(getApiOrigin());
  api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  return `${trimTrailingSlash(api.origin)}/ws`;
}
