import { QueryClient } from "@tanstack/react-query";
import { logoutSession } from "@/src/lib/api-client";
import { closeAllSockets } from "@/src/lib/websocket";
import { callController } from "@/src/services/webrtc/CallController";
import {
  useAuthStore,
  useSettingsStore,
  useUserStore,
} from "@/src/stores/app-stores";
import { useMessagingStore } from "@/src/stores/messaging-store";
import { getCallSession } from "@/src/stores/call-stores";

/** Clear credentials, sockets, and client state after logout or revoked sessions. */
export async function forceSignOut(queryClient?: QueryClient) {
  try {
    callController.dispose();
  } catch {
    // Best-effort call teardown.
  }
  try {
    closeAllSockets();
  } catch {
    // Best-effort socket teardown.
  }
  try {
    await logoutSession();
  } catch {
    // Always clear local credentials even if logout fails.
  }
  getCallSession().resetAll();
  useAuthStore.getState().clearSession();
  useUserStore.getState().setProfile(null);
  useSettingsStore.getState().clearSettings();
  useMessagingStore.getState().clearSessionState();
  queryClient?.clear();
}
