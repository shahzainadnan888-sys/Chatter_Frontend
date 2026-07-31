import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chatter", {
  request: (request) => ipcRenderer.invoke("chatter:request", request),
  restoreSession: () => ipcRenderer.invoke("chatter:restore-session"),
  logout: () => ipcRenderer.invoke("chatter:logout"),
  uploadAvatar: (file, name, type) =>
    ipcRenderer.invoke("chatter:upload-avatar", { file, name, type }),
  uploadMedia: (path, file, name, type, field) =>
    ipcRenderer.invoke("chatter:upload-media", {
      path,
      file,
      name,
      type,
      field,
    }),
  getAccessToken: () => ipcRenderer.invoke("chatter:get-access-token"),
  getPreferences: () => ipcRenderer.invoke("chatter:get-preferences"),
  setPreferences: (patch) =>
    ipcRenderer.invoke("chatter:set-preferences", patch),
  notify: (payload) => ipcRenderer.invoke("chatter:notify", payload),
  streamAIConversation: (payload, onToken) => {
    const listener = (_event, chunk) => {
      if (chunk?.requestId === payload?.requestId && typeof chunk?.token === "string") {
        onToken(chunk.token);
      }
    };
    ipcRenderer.on("chatter:ai-token", listener);
    return ipcRenderer
      .invoke("chatter:ai-chat", payload)
      .finally(() => ipcRenderer.removeListener("chatter:ai-token", listener));
  },
  cancelAIConversation: (requestId) =>
    ipcRenderer.send("chatter:ai-cancel", requestId),
  onMenuAction: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on("chatter:menu", listener);
    return () => ipcRenderer.removeListener("chatter:menu", listener);
  },
});
