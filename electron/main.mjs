import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  safeStorage,
  shell,
} from "electron";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function loadEnvironment() {
  const candidates = [
    join(process.cwd(), ".env"),
    join(app.getAppPath(), ".env"),
    join(process.resourcesPath, ".env"),
  ];
  const envFile = candidates.find(existsSync);
  if (!envFile) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

loadEnvironment();

const API_ORIGIN = process.env.CHATTER_API_URL || process.env.NEXT_PUBLIC_API_URL;
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api/v1";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_CHAT_MODEL =
  process.env.GROQ_CHAT_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const ALLOWED_OPERATIONS = new Set([
  `POST ${API_PREFIX}/auth/signup`,
  `POST ${API_PREFIX}/auth/login`,
  `POST ${API_PREFIX}/auth/logout`,
  `POST ${API_PREFIX}/auth/password-reset/request`,
  `POST ${API_PREFIX}/auth/password-reset/confirm`,
  `POST ${API_PREFIX}/auth/change-password`,
  `GET ${API_PREFIX}/auth/me`,
  `GET ${API_PREFIX}/users/me`,
  `PATCH ${API_PREFIX}/profiles/me`,
  `GET ${API_PREFIX}/profiles/me`,
  `GET ${API_PREFIX}/settings/`,
  `PATCH ${API_PREFIX}/settings/theme`,
  `PATCH ${API_PREFIX}/settings/notifications`,
  `PATCH ${API_PREFIX}/settings/privacy`,
  `GET ${API_PREFIX}/chats/`,
  `POST ${API_PREFIX}/chats/`,
  `POST ${API_PREFIX}/chats/archive`,
  `POST ${API_PREFIX}/chats/unarchive`,
  `POST ${API_PREFIX}/chats/favorite`,
  `POST ${API_PREFIX}/chats/unfavorite`,
  `POST ${API_PREFIX}/chats/mute`,
  `POST ${API_PREFIX}/chats/unmute`,
  `GET ${API_PREFIX}/users/friends`,
  `GET ${API_PREFIX}/users/friends/requests`,
  `POST ${API_PREFIX}/users/friends/request`,
  `POST ${API_PREFIX}/users/friends/accept`,
  `POST ${API_PREFIX}/users/friends/reject`,
  `POST ${API_PREFIX}/users/block`,
  `DELETE ${API_PREFIX}/users/unblock`,
  `GET ${API_PREFIX}/users/blocked`,
  `POST ${API_PREFIX}/users/report`,
  `GET ${API_PREFIX}/users/search`,
  `GET ${API_PREFIX}/search/users`,
  `GET ${API_PREFIX}/search/groups`,
  `GET ${API_PREFIX}/search/messages`,
  `GET ${API_PREFIX}/search/files`,
  `GET ${API_PREFIX}/notifications/`,
  `PATCH ${API_PREFIX}/notifications/read`,
  `PATCH ${API_PREFIX}/notifications/read-all`,
  `GET ${API_PREFIX}/groups/`,
]);

let accessToken = null;
let refreshToken = null;
let rememberSession = false;
let refreshPromise = null;
const activeAiRequests = new Map();

const defaultPreferences = {
  accent: "purple",
  friend_request_notifications: true,
  who_can_send_friend_requests: "everyone",
  completed_onboarding_user_ids: [],
};

function tokenPath() {
  return join(app.getPath("userData"), "session.vault");
}

function preferencesPath() {
  return join(app.getPath("userData"), "preferences.json");
}

function readPreferences() {
  try {
    return {
      ...defaultPreferences,
      ...JSON.parse(readFileSync(preferencesPath(), "utf8")),
    };
  } catch {
    return { ...defaultPreferences };
  }
}

function writePreferences(patch) {
  const next = { ...readPreferences(), ...patch };
  writeFileSync(preferencesPath(), JSON.stringify(next), {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

function persistRefreshToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable on this device.");
  }
  const encrypted = safeStorage.encryptString(token);
  writeFileSync(tokenPath(), encrypted.toString("base64"), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readPersistedRefreshToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = Buffer.from(readFileSync(tokenPath(), "utf8"), "base64");
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

function clearPersistedRefreshToken() {
  try {
    unlinkSync(tokenPath());
  } catch {
    // The vault is already clear.
  }
}

function clearSession() {
  accessToken = null;
  refreshToken = null;
  rememberSession = false;
  clearPersistedRefreshToken();
}

function pathnameOf(path) {
  return path.split("?")[0];
}

function isAllowedOperation(path, method) {
  const pathname = pathnameOf(path);
  if (ALLOWED_OPERATIONS.has(`${method} ${pathname}`)) return true;
  if (method === "GET" && path.startsWith(`${API_PREFIX}/auth/username/check?`)) {
    const url = new URL(path, "https://chatter.invalid");
    return (
      [...url.searchParams.keys()].length === 1 &&
      url.searchParams.has("username")
    );
  }
  if (method === "GET" && /^\/api\/v1\/chats\/[^/]+$/.test(pathname)) return true;
  if (method === "DELETE" && /^\/api\/v1\/chats\/[^/]+$/.test(pathname)) return true;
  if (method === "DELETE" && /^\/api\/v1\/users\/friends\/[^/]+$/.test(pathname)) {
    return true;
  }
  if (method === "GET" && /^\/api\/v1\/users\/[^/]+$/.test(pathname)) {
    const reserved = new Set([
      "me",
      "search",
      "blocked",
      "friends",
      "block",
      "unblock",
      "report",
    ]);
    return !reserved.has(pathname.split("/").pop());
  }
  if (method === "GET" && /^\/api\/v1\/profiles\/[^/]+$/.test(pathname)) return true;
  if (
    method === "DELETE" &&
    /^\/api\/v1\/notifications\/[^/]+$/.test(pathname)
  ) {
    return true;
  }
  if (
    (method === "GET" || method === "POST" || method === "PATCH" || method === "DELETE") &&
    (pathname.startsWith(`${API_PREFIX}/chats`) ||
      pathname.startsWith(`${API_PREFIX}/users`) ||
      pathname.startsWith(`${API_PREFIX}/profiles`) ||
      pathname.startsWith(`${API_PREFIX}/notifications`) ||
      pathname.startsWith(`${API_PREFIX}/search`) ||
      pathname.startsWith(`${API_PREFIX}/groups`) ||
      pathname.startsWith(`${API_PREFIX}/settings`) ||
      pathname.startsWith(`${API_PREFIX}/messages`) ||
      pathname.startsWith(`${API_PREFIX}/media`) ||
      pathname.startsWith(`${API_PREFIX}/presence`) ||
      pathname.startsWith(`${API_PREFIX}/location`) ||
      pathname.startsWith(`${API_PREFIX}/calls`) ||
      pathname.startsWith(`${API_PREFIX}/ai`))
  ) {
    return true;
  }
  return false;
}

async function parseError(response) {
  try {
    const body = await response.json();
    return {
      status: response.status,
      code: body?.error?.code || "http_error",
      message:
        body?.error?.message ||
        response.statusText ||
        "The request could not be completed.",
      details: body?.error?.details,
      requestId: body?.request_id,
    };
  } catch {
    return {
      status: response.status,
      code: "http_error",
      message: response.statusText || "The request could not be completed.",
    };
  }
}

async function rotateRefreshToken() {
  if (!refreshToken) throw new Error("No refresh session is available.");
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_ORIGIN}${API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Request-ID": crypto.randomUUID(),
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        clearSession();
        throw await parseError(response);
      }
      const result = await response.json();
      accessToken = result.tokens.access_token;
      refreshToken = result.tokens.refresh_token;
      if (rememberSession) persistRefreshToken(refreshToken);
      return result.user;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function performRequest(request, replay = true) {
  if (!API_ORIGIN) {
    throw {
      status: 500,
      code: "configuration_error",
      message: "NEXT_PUBLIC_API_URL is not configured.",
    };
  }
  const method = request.method || "GET";
  if (!isAllowedOperation(request.path, method)) {
    throw {
      status: 403,
      code: "forbidden",
      message: "This API operation is not available to the renderer.",
    };
  }

  const headers = {
    Accept: "application/json",
    "X-Request-ID": crypto.randomUUID(),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_ORIGIN}${request.path}`, {
    method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  const isPublicAuth =
    request.path === `${API_PREFIX}/auth/login` ||
    request.path === `${API_PREFIX}/auth/signup`;
  if (response.status === 401 && accessToken && replay && !isPublicAuth) {
    await rotateRefreshToken();
    return performRequest(request, false);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined;

  const result = await response.json();
  if (isPublicAuth && result.tokens) {
    accessToken = result.tokens.access_token;
    refreshToken = result.tokens.refresh_token;
    rememberSession = request.remember !== false;
    if (rememberSession) persistRefreshToken(refreshToken);
    else clearPersistedRefreshToken();
    return { success: result.success, user: result.user };
  }
  return result;
}

async function performMediaUpload(payload, replay = true) {
  const form = new FormData();
  const field = payload.field || "file";
  form.append(
    field,
    new Blob([payload.file], { type: payload.type }),
    payload.name,
  );
  const response = await fetch(`${API_ORIGIN}${payload.path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken || ""}`,
      "X-Request-ID": crypto.randomUUID(),
    },
    body: form,
  });
  if (response.status === 401 && accessToken && replay) {
    await rotateRefreshToken();
    return performMediaUpload(payload, false);
  }
  if (!response.ok) throw await parseError(response);
  return response.json();
}

function resultFrom(operation) {
  return Promise.resolve()
    .then(operation)
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({
      ok: false,
      error: {
        status: error?.status || 500,
        code: error?.code || "internal_error",
        message: error?.message || "Something went wrong. Please try again.",
        details: error?.details,
        requestId: error?.requestId,
      },
    }));
}

function normalizeAiMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw {
      status: 422,
      code: "validation_error",
      message: "At least one conversation message is required.",
    };
  }
  return messages.slice(-50).map((message) => {
    const role =
      message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
    const content =
      typeof message?.content === "string" ? message.content.trim().slice(0, 20_000) : "";
    if (!role || !content) {
      throw {
        status: 422,
        code: "validation_error",
        message: "The conversation contains an invalid message.",
      };
    }
    return { role, content };
  });
}

async function streamGroqConversation(event, payload) {
  if (!GROQ_API_KEY) {
    throw {
      status: 503,
      code: "groq_not_configured",
      message: "GROQ_API_KEY is not configured for the desktop app.",
    };
  }
  const requestId =
    typeof payload?.requestId === "string" ? payload.requestId.slice(0, 128) : "";
  if (!requestId) {
    throw {
      status: 422,
      code: "validation_error",
      message: "A request ID is required.",
    };
  }

  const controller = new AbortController();
  activeAiRequests.get(requestId)?.abort();
  activeAiRequests.set(requestId, controller);

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_CHAT_MODEL,
        stream: true,
        temperature: 0.65,
        messages: [
          {
            role: "system",
            content:
              "You are Chatter Intelligence, the helpful conversational AI inside Chatter. Be accurate, concise, warm, and practical. Use Markdown when it improves clarity. Never claim to have performed actions you cannot perform.",
          },
          ...normalizeAiMessages(payload?.messages),
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "Groq authentication failed. Check GROQ_API_KEY."
          : response.status === 429
            ? "Groq is temporarily rate limited. Please try again shortly."
            : "Groq could not complete this response.";
      throw {
        status: response.status,
        code: "groq_error",
        message,
      };
    }
    if (!response.body) {
      throw {
        status: 502,
        code: "groq_stream_unavailable",
        message: "Groq did not return a response stream.",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;

    const emitLines = (flush = false) => {
      const lines = buffer.split(/\r?\n/);
      buffer = flush ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          const token = chunk?.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token) {
            emitted = true;
            if (!event.sender.isDestroyed()) {
              event.sender.send("chatter:ai-token", { requestId, token });
            }
          }
        } catch {
          // A malformed provider chunk is ignored; subsequent chunks can continue.
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      emitLines();
    }
    buffer += decoder.decode();
    emitLines(true);

    if (!emitted && !controller.signal.aborted) {
      throw {
        status: 502,
        code: "empty_ai_response",
        message: "Groq returned an empty response.",
      };
    }
    return { completed: true, model: GROQ_CHAT_MODEL };
  } catch (error) {
    if (controller.signal.aborted) {
      throw {
        status: 499,
        code: "request_cancelled",
        message: "Generation stopped.",
      };
    }
    throw error;
  } finally {
    if (activeAiRequests.get(requestId) === controller) {
      activeAiRequests.delete(requestId);
    }
  }
}

function registerIpc() {
  ipcMain.handle("chatter:request", (_event, request) =>
    resultFrom(() => performRequest(request)),
  );
  ipcMain.handle("chatter:restore-session", () =>
    resultFrom(async () => {
      refreshToken = readPersistedRefreshToken();
      rememberSession = Boolean(refreshToken);
      if (!refreshToken) return null;
      await rotateRefreshToken();
      return performRequest({ path: `${API_PREFIX}/auth/me` });
    }),
  );
  ipcMain.handle("chatter:logout", () =>
    resultFrom(async () => {
      try {
        if (accessToken) {
          await performRequest({
            path: `${API_PREFIX}/auth/logout`,
            method: "POST",
            body: { refresh_token: refreshToken },
          });
        }
      } finally {
        clearSession();
      }
    }),
  );
  ipcMain.handle("chatter:upload-avatar", (_event, payload) =>
    resultFrom(() =>
      performMediaUpload({
        ...payload,
        path: `${API_PREFIX}/profiles/me/avatar`,
      }),
    ),
  );
  ipcMain.handle("chatter:upload-media", (_event, payload) =>
    resultFrom(() => performMediaUpload(payload)),
  );
  ipcMain.handle("chatter:get-access-token", () =>
    resultFrom(async () => accessToken),
  );
  ipcMain.handle("chatter:get-preferences", () => readPreferences());
  ipcMain.handle("chatter:set-preferences", (_event, patch) =>
    writePreferences(patch),
  );
  ipcMain.handle("chatter:notify", (_event, payload) => {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: payload?.title || "Chatter",
      body: payload?.body || "",
      silent: Boolean(payload?.silent),
    });
    notification.show();
    return true;
  });
  ipcMain.handle("chatter:ai-chat", (event, payload) =>
    resultFrom(() => streamGroqConversation(event, payload)),
  );
  ipcMain.on("chatter:ai-cancel", (_event, requestId) => {
    if (typeof requestId === "string") activeAiRequests.get(requestId)?.abort();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#f7f7f8",
    webPreferences: {
      preload: join(app.getAppPath(), "electron", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isMac = process.platform === "darwin";
  const menu = Menu.buildFromTemplate([
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: () => win.webContents.send("chatter:menu", "new-chat"),
        },
        {
          label: "New Group",
          accelerator: "CmdOrCtrl+G",
          click: () => win.webContents.send("chatter:menu", "new-group"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Search",
          accelerator: "CmdOrCtrl+K",
          click: () => win.webContents.send("chatter:menu", "search"),
        },
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+B",
          click: () => win.webContents.send("chatter:menu", "toggle-sidebar"),
        },
        {
          label: "Toggle Theme",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => win.webContents.send("chatter:menu", "toggle-theme"),
        },
        { type: "separator" },
        { role: "reload" },
        ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Navigate",
      submenu: [
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => win.webContents.send("chatter:menu", "settings"),
        },
        {
          label: "Groups",
          click: () => win.webContents.send("chatter:menu", "groups"),
        },
        {
          label: "Calls",
          click: () => win.webContents.send("chatter:menu", "calls"),
        },
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);

  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(
        new Set([
          "media",
          "geolocation",
          "notifications",
          "fullscreen",
        ]).has(permission),
      );
    },
  );

  win.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" }, { role: "selectAll" });
    } else {
      template.push({ role: "reload" });
    }
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("mailto:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged
      ? url.startsWith("file://")
      : url.startsWith(
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        );
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("mailto:")) {
        void shell.openExternal(url);
      }
    }
  });

  if (app.isPackaged) {
    void win.loadFile(join(app.getAppPath(), "out", "index.html"));
  } else {
    void win.loadURL(
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    );
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
