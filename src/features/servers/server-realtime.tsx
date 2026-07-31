"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeServer } from "@/src/lib/websocket";
import { SERVER_QUERY_KEYS } from "@/src/services/servers-api";
import { useServerStore } from "@/src/stores/server-stores";
import type { ServerMessage, ServerVoiceParticipant } from "@/src/types/servers";

export function ServerRealtime() {
  const queryClient = useQueryClient();
  const serverId = useServerStore((state) => state.selectedServerId);
  const setTyping = useServerStore((state) => state.setTyping);
  const setVoice = useServerStore((state) => state.setVoice);
  const activeVoiceChannelId = useServerStore(
    (state) => state.activeVoiceChannelId,
  );

  useEffect(() => {
    if (!serverId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void subscribeServer(serverId, (event) => {
      const type = event.type;
      const payload = event.payload ?? {};

      if (
        type === "message_created" ||
        type === "message_updated" ||
        type === "message_deleted" ||
        type === "reaction_added" ||
        type === "reaction_removed" ||
        type === "mention_created"
      ) {
        const channelId =
          typeof payload.channel_id === "string"
            ? payload.channel_id
            : typeof (payload.message as ServerMessage | undefined)?.channel_id ===
                "string"
              ? (payload.message as ServerMessage).channel_id
              : null;
        if (channelId) {
          void queryClient.invalidateQueries({
            queryKey: SERVER_QUERY_KEYS.messages(serverId, channelId),
          });
        } else {
          void queryClient.invalidateQueries({
            queryKey: ["server-messages", serverId],
          });
        }
        void queryClient.invalidateQueries({
          queryKey: SERVER_QUERY_KEYS.sidebar(serverId),
        });
        void queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      }

      if (
        type === "channel_created" ||
        type === "channel_updated" ||
        type === "channel_deleted" ||
        type === "category_created" ||
        type === "category_updated" ||
        type === "category_deleted" ||
        type === "server_updated" ||
        type === "server_deleted" ||
        type === "unread_updated" ||
        type === "role_updated" ||
        type === "member_joined" ||
        type === "member_left" ||
        type === "member_updated" ||
        type === "invite_created" ||
        type === "invite_revoked"
      ) {
        void queryClient.invalidateQueries({
          queryKey: SERVER_QUERY_KEYS.sidebar(serverId),
        });
        void queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
        void queryClient.invalidateQueries({
          queryKey: SERVER_QUERY_KEYS.members(serverId),
        });
        void queryClient.invalidateQueries({
          queryKey: SERVER_QUERY_KEYS.invites(serverId),
        });
        if (type === "server_deleted") {
          useServerStore.getState().selectServer(null);
        }
      }

      if (type === "typing_started" || type === "typing_stopped") {
        const channelId =
          typeof payload.channel_id === "string" ? payload.channel_id : null;
        const userId =
          typeof payload.user_id === "string" ? payload.user_id : null;
        const username =
          typeof payload.username === "string" ? payload.username : "Someone";
        if (channelId && userId) {
          const current =
            useServerStore.getState().typingByChannel[channelId] ?? [];
          if (type === "typing_started") {
            if (!current.some((item) => item.userId === userId)) {
              setTyping(channelId, [...current, { userId, username }]);
            }
          } else {
            setTyping(
              channelId,
              current.filter((item) => item.userId !== userId),
            );
          }
        }
      }

      if (type === "voice_state_updated") {
        const channelId =
          typeof payload.channel_id === "string" ? payload.channel_id : null;
        if (channelId) {
          void queryClient.invalidateQueries({
            queryKey: SERVER_QUERY_KEYS.voice(serverId, channelId),
          });
          if (activeVoiceChannelId === channelId) {
            const participants = Array.isArray(payload.participants)
              ? (payload.participants as ServerVoiceParticipant[])
              : undefined;
            if (participants) setVoice(channelId, participants);
          }
        }
      }

      if (type.startsWith("webrtc_")) {
        window.dispatchEvent(
          new CustomEvent("chatter:server-webrtc", { detail: payload }),
        );
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unsubscribe = fn;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    activeVoiceChannelId,
    queryClient,
    serverId,
    setTyping,
    setVoice,
  ]);

  return null;
}
