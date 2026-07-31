import { getApiOrigin } from "@/src/lib/api-config";
import type {
  ApiErrorBody,
  ApiRequest,
  AuthUser,
  LocalPreferences,
  LoginResponse,
  RendererLoginResponse,
  TokenResponse,
  TransportError,
  TransportResult,
} from "@/src/types/api";

const BROWSER_REFRESH_KEY = "chatter.refresh-token";
const DEFAULT_PREFERENCES: LocalPreferences = {
  accent: "purple",
  friend_request_notifications: true,
  who_can_send_friend_requests: "everyone",
  completed_onboarding_user_ids: [],
};

function readStoredBrowserSession(): {
  tokens: TokenResponse | null;
  remember: boolean;
} {
  if (typeof window === "undefined") return { tokens: null, remember: false };
  try {
    const persistent = window.localStorage.getItem(BROWSER_REFRESH_KEY);
    const session =
      persistent ?? window.sessionStorage.getItem(BROWSER_REFRESH_KEY);
    return {
      tokens: session
        ? { access_token: "", refresh_token: session, expires_in: 0 }
        : null,
      remember: Boolean(persistent),
    };
  } catch {
    return { tokens: null, remember: false };
  }
}

const storedBrowserSession = readStoredBrowserSession();
let browserTokens: TokenResponse | null = storedBrowserSession.tokens;
let rememberBrowserSession = storedBrowserSession.remember;
let refreshInFlight: Promise<void> | null = null;

function persistBrowserSession(tokens: TokenResponse, remember: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BROWSER_REFRESH_KEY);
    window.sessionStorage.removeItem(BROWSER_REFRESH_KEY);
    const storage = remember ? window.localStorage : window.sessionStorage;
    storage.setItem(BROWSER_REFRESH_KEY, tokens.refresh_token);
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }
}

function clearBrowserSession() {
  browserTokens = null;
  rememberBrowserSession = false;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BROWSER_REFRESH_KEY);
    window.sessionStorage.removeItem(BROWSER_REFRESH_KEY);
  } catch {
    // Best-effort credential cleanup.
  }
}

function notifyExpiredSession(request: ApiRequest, status?: number) {
  if (status !== 401 || typeof window === "undefined") return;
  const publicAuthPaths = new Set([
    "/api/v1/auth/login",
    "/api/v1/auth/signup",
    "/api/v1/auth/password-reset/request",
    "/api/v1/auth/password-reset/confirm",
  ]);
  if (!publicAuthPaths.has(request.path.split("?")[0])) {
    window.dispatchEvent(new Event("chatter:session-expired"));
  }
}

function apiOrigin(): string {
  return getApiOrigin();
}

/** Resolve backend-relative asset paths like `/uploads/ai-images/...`. */
export function resolveApiAssetUrl(path: string): string {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${apiOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: TransportError["details"],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  fieldMessage(field: string): string | undefined {
    return this.details?.find((detail) => detail.loc?.at(-1) === field)?.msg;
  }
}

function throwTransportError(error?: TransportError): never {
  throw new ApiError(
    error?.status ?? 500,
    error?.code ?? "internal_error",
    error?.message ?? "Something went wrong. Please try again.",
    error?.details,
    error?.requestId,
  );
}

async function parseBrowserError(response: Response): Promise<TransportError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return {
      status: response.status,
      code: body.error?.code ?? "http_error",
      message: body.error?.message ?? response.statusText,
      details: body.error?.details,
      requestId: body.request_id,
    };
  } catch {
    return {
      status: response.status,
      code: "http_error",
      message: response.statusText || "The request could not be completed.",
    };
  }
}

async function refreshBrowserSession(): Promise<void> {
  if (!browserTokens) throw new Error("No refresh token");
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch(`${apiOrigin()}/api/v1/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Request-ID": crypto.randomUUID(),
        },
        body: JSON.stringify({ refresh_token: browserTokens?.refresh_token }),
      });
      if (!response.ok) {
        clearBrowserSession();
        throwTransportError(await parseBrowserError(response));
      }
      const result = (await response.json()) as LoginResponse;
      browserTokens = result.tokens;
      persistBrowserSession(result.tokens, rememberBrowserSession);
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function browserRequest<T>(
  request: ApiRequest,
  replay = true,
): Promise<T> {
  const headers = new Headers({
    Accept: "application/json",
    "X-Request-ID": crypto.randomUUID(),
  });
  if (browserTokens) {
    headers.set("Authorization", `Bearer ${browserTokens.access_token}`);
  }
  if (request.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiOrigin()}${request.path}`, {
    method: request.method ?? "GET",
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  if (response.status === 401 && browserTokens && replay) {
    await refreshBrowserSession();
    return browserRequest<T>(request, false);
  }
  if (!response.ok) {
    const error = await parseBrowserError(response);
    notifyExpiredSession(request, error.status);
    throwTransportError(error);
  }
  if (response.status === 204) return undefined as T;

  const data = (await response.json()) as T | LoginResponse;
  if (
    request.path === "/api/v1/auth/login" ||
    request.path === "/api/v1/auth/signup"
  ) {
    const login = data as LoginResponse;
    browserTokens = login.tokens;
    rememberBrowserSession = request.remember !== false;
    persistBrowserSession(login.tokens, rememberBrowserSession);
    return { success: login.success, user: login.user } as T;
  }
  return data as T;
}

export async function apiRequest<T>(request: ApiRequest): Promise<T> {
  if (typeof window !== "undefined" && window.chatter) {
    const result = await window.chatter.request<T>(request);
    if (!result.ok) {
      notifyExpiredSession(request, result.error?.status);
      throwTransportError(result.error);
    }
    return result.data as T;
  }
  return browserRequest<T>(request);
}

export async function restoreSession(): Promise<AuthUser | null> {
  if (typeof window !== "undefined" && window.chatter) {
    const result = await window.chatter.restoreSession();
    if (!result.ok) throwTransportError(result.error);
    return result.data ?? null;
  }
  if (!browserTokens) return null;
  try {
    await refreshBrowserSession();
    return apiRequest<AuthUser>({ path: "/api/v1/auth/me" });
  } catch {
    clearBrowserSession();
    return null;
  }
}

export async function logoutSession(): Promise<void> {
  if (typeof window !== "undefined" && window.chatter) {
    const result = await window.chatter.logout();
    if (!result.ok) throwTransportError(result.error);
    return;
  }
  if (browserTokens) {
    try {
      await browserRequest({
        path: "/api/v1/auth/logout",
        method: "POST",
        body: { refresh_token: browserTokens.refresh_token },
      });
    } finally {
      clearBrowserSession();
    }
  }
  clearBrowserSession();
}

export async function uploadAvatar(file: File): Promise<unknown> {
  return uploadMediaFile("/api/v1/profiles/me/avatar", file);
}

export interface UploadOptions {
  signal?: AbortSignal;
  onProgress?: (percentage: number) => void;
}

export async function uploadMediaFile<T = unknown>(
  path: string,
  file: File,
  fieldName = "file",
  options: UploadOptions = {},
): Promise<T> {
  if (file.size > 25 * 1024 * 1024) {
    throw new ApiError(
      422,
      "validation_error",
      "Files must be 25 MiB or smaller.",
    );
  }

  if (typeof window !== "undefined" && window.chatter?.uploadMedia) {
    if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    options.onProgress?.(8);
    const result = await window.chatter.uploadMedia(
      path,
      await file.arrayBuffer(),
      file.name,
      file.type || "application/octet-stream",
      fieldName,
    );
    if (options.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    if (!result.ok) throwTransportError(result.error);
    options.onProgress?.(100);
    return result.data as T;
  }

  if (typeof window !== "undefined" && window.chatter?.uploadAvatar && path.endsWith("/avatar")) {
    const result = await window.chatter.uploadAvatar(
      await file.arrayBuffer(),
      file.name,
      file.type,
    );
    if (!result.ok) throwTransportError(result.error);
    return result.data as T;
  }

  const upload = () =>
    new Promise<T>((resolve, reject) => {
      const form = new FormData();
      form.append(fieldName, file);
      const request = new XMLHttpRequest();
      const abort = () => request.abort();
      request.open("POST", `${apiOrigin()}${path}`);
      request.responseType = "json";
      request.setRequestHeader("Accept", "application/json");
      request.setRequestHeader(
        "Authorization",
        `Bearer ${browserTokens?.access_token ?? ""}`,
      );
      request.setRequestHeader("X-Request-ID", crypto.randomUUID());
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        options.onProgress?.(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
      };
      request.onload = () => {
        options.signal?.removeEventListener("abort", abort);
        if (request.status >= 200 && request.status < 300) {
          options.onProgress?.(100);
          resolve(request.response as T);
          return;
        }
        const body = request.response as ApiErrorBody | null;
        reject(
          new ApiError(
            request.status,
            body?.error?.code ?? "http_error",
            body?.error?.message ?? request.statusText,
            body?.error?.details,
            body?.request_id,
          ),
        );
      };
      request.onerror = () => {
        options.signal?.removeEventListener("abort", abort);
        reject(new TypeError("Network connection failed during upload."));
      };
      request.onabort = () => {
        options.signal?.removeEventListener("abort", abort);
        reject(new DOMException("Upload cancelled", "AbortError"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) {
        request.abort();
        return;
      }
      request.send(form);
    });

  try {
    return await upload();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && browserTokens) {
      await refreshBrowserSession();
      return uploadMediaFile<T>(path, file, fieldName, options);
    }
    throw error;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window !== "undefined" && window.chatter?.getAccessToken) {
    const result = await window.chatter.getAccessToken();
    if (!result.ok) throwTransportError(result.error);
    return result.data ?? null;
  }
  if (browserTokens?.access_token) return browserTokens.access_token;
  // After reload we may only have a refresh token until the first API call.
  if (browserTokens?.refresh_token) {
    try {
      await refreshBrowserSession();
      return browserTokens?.access_token || null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function getLocalPreferences(): Promise<LocalPreferences> {
  if (typeof window !== "undefined" && window.chatter) {
    return window.chatter.getPreferences();
  }
  const stored = window.localStorage.getItem("chatter.preferences");
  return stored
    ? { ...DEFAULT_PREFERENCES, ...(JSON.parse(stored) as LocalPreferences) }
    : DEFAULT_PREFERENCES;
}

export async function setLocalPreferences(
  patch: Partial<LocalPreferences>,
): Promise<LocalPreferences> {
  if (typeof window !== "undefined" && window.chatter) {
    return window.chatter.setPreferences(patch);
  }
  const next = { ...(await getLocalPreferences()), ...patch };
  window.localStorage.setItem("chatter.preferences", JSON.stringify(next));
  return next;
}

export type { RendererLoginResponse, TransportResult };
