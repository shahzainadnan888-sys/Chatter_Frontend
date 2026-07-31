import { messagesApi } from "@/src/services/messaging-api";
import { useMessagingStore } from "@/src/stores/messaging-store";
import { broadcastChatEvent } from "@/src/lib/websocket";

let flushing = false;
let flushAgain = false;

export async function flushPendingMessages() {
  if (flushing) {
    flushAgain = true;
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  flushing = true;
  try {
    do {
      flushAgain = false;
      const store = useMessagingStore.getState();
      // Reclaim orphaned "sending" items left behind by a crashed flush.
      for (const item of store.pendingQueue) {
        if (item.status === "sending") {
          store.updatePending(item.id, { status: "queued" });
        }
      }
      const queued = useMessagingStore
        .getState()
        .pendingQueue.filter(
          (item) => item.status === "queued" || item.status === "failed",
        );
      if (queued.length === 0) break;

      for (const item of queued) {
        useMessagingStore.getState().updatePending(item.id, {
          status: "sending",
          error: undefined,
        });
        try {
          const message = item.replyToId
            ? await messagesApi.reply({
                chat_id: item.chatId,
                reply_to_id: item.replyToId,
                content: item.content,
                type: "text",
              })
            : await messagesApi.send({
                chat_id: item.chatId,
                content: item.content,
                type: "text",
              });
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("chatter:pending-message-sent", {
                detail: { pendingId: item.id, message },
              }),
            );
          }
          useMessagingStore.getState().removePending(item.id);
          broadcastChatEvent(item.chatId, "message.created", {
            message_id: message.id,
            sender_id: message.sender.id,
          });
        } catch (error) {
          useMessagingStore.getState().updatePending(item.id, {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Failed to send. Will retry when online.",
          });
        }
      }
    } while (flushAgain);
  } finally {
    flushing = false;
  }
}
