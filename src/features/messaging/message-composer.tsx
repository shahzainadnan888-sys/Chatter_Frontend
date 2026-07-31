"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  ImagePlus,
  MapPin,
  Mic,
  Paperclip,
  Pause,
  Play,
  SendHorizontal,
  Smile,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import {
  encodeLiveLocationContent,
  LiveLocationDurationDialog,
  type LocationDurationMinutes,
} from "@/src/features/messaging/live-location-card";
import { friendlyError } from "@/src/lib/shell-utils";
import { requestLocationPermission } from "@/src/lib/permissions";
import {
  broadcastChatEvent,
  broadcastRecording,
  broadcastTyping,
} from "@/src/lib/websocket";
import {
  locationApi,
  mediaApi,
  messagesApi,
  uploadByKind,
} from "@/src/services/messaging-api";
import { useAuthStore } from "@/src/stores/app-stores";
import {
  useLocationStore,
  usePermissionStore,
} from "@/src/stores/feature-stores";
import {
  useMessagingStore,
  type ComposerAttachment,
} from "@/src/stores/messaging-store";
import type { ChatMessage, Paginated, UUID } from "@/src/types/api";

const EMOJIS = [
  "😀", "😁", "😂", "🥹", "😊", "😍", "🤔", "😎",
  "😭", "🔥", "✨", "💯", "👍", "👏", "🙌", "❤️",
  "💙", "💜", "🎉", "☕", "✅", "📎", "📍", "🎤",
];

const MAX_CHARS = 10_000;

type MessagePages = InfiniteData<Paginated<ChatMessage>, number>;
type SendSubmission = {
  text: string;
  editing: ChatMessage | null;
  replyTo: ChatMessage | null;
  ready: ComposerAttachment[];
};

function putMessageInCache(
  data: MessagePages | undefined,
  message: ChatMessage,
  replaceId?: string,
) {
  if (!data?.pages.length) {
    return {
      pages: [
        {
          data: [message],
          total: 1,
          page: 1,
          page_size: 40,
          has_more: false,
        },
      ],
      pageParams: [1],
    };
  }
  return {
    ...data,
    pages: data.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            data: [
              ...page.data.filter(
                (item) => item.id !== message.id && item.id !== replaceId,
              ),
              message,
            ],
          }
        : page,
    ),
  };
}

function preferredRecorderMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function createAttachment(file: File): ComposerAttachment {
  const kind =
    file.type.startsWith("image/") || file.type === "image/gif"
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "voice"
          : "document";
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl:
      kind === "image" || kind === "video"
        ? URL.createObjectURL(file)
        : undefined,
    progress: 0,
    status: "pending",
    kind,
  };
}

export function MessageComposer({ chatId }: { chatId: UUID }) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const replyTo = useMessagingStore((state) => state.replyTo);
  const editing = useMessagingStore((state) => state.editing);
  const setReplyTo = useMessagingStore((state) => state.setReplyTo);
  const setEditing = useMessagingStore((state) => state.setEditing);
  const attachments = useMessagingStore((state) => state.attachments);
  const upsertAttachment = useMessagingStore((state) => state.upsertAttachment);
  const removeAttachment = useMessagingStore((state) => state.removeAttachment);
  const clearAttachments = useMessagingStore((state) => state.clearAttachments);
  const enqueuePending = useMessagingStore((state) => state.enqueuePending);
  const removePending = useMessagingStore((state) => state.removePending);
  const setLiveLocation = useMessagingStore((state) => state.setLiveLocation);
  const cacheMedia = useMessagingStore((state) => state.cacheMedia);
  const locationWatchId = useLocationStore((state) => state.watchId);
  const setLocationWatchId = useLocationStore((state) => state.setWatchId);
  const setLocationRemaining = useLocationStore(
    (state) => state.setRemainingSeconds,
  );
  const setPermission = usePermissionStore((state) => state.setState);
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const locationDurationRef = useRef<LocationDurationMinutes>(60);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [microphonePrompt, setMicrophonePrompt] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingPulse = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledUploadIds = useRef(new Set<string>());
  const uploadControllers = useRef(new Map<string, AbortController>());
  const componentActive = useRef(true);

  if ((editing?.id ?? null) !== editId) {
    setEditId(editing?.id ?? null);
    setText(editing?.content || "");
  }

  useEffect(() => {
    const activeUploadControllers = uploadControllers.current;
    return () => {
      componentActive.current = false;
      activeUploadControllers.forEach((controller) => controller.abort());
      activeUploadControllers.clear();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingHeartbeatRef.current) {
        clearInterval(recordingHeartbeatRef.current);
      }
      if (typingTimer.current) clearTimeout(typingTimer.current);
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      broadcastRecording(chatId, false);
      clearAttachments();
      attachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editPending = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          id: string;
          chatId: string;
          content: string;
        }>
      ).detail;
      if (!detail || detail.chatId !== chatId) return;
      removePending(detail.id);
      setText(detail.content);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("chatter:edit-pending-message", editPending);
    return () =>
      window.removeEventListener("chatter:edit-pending-message", editPending);
  }, [chatId, removePending]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(160, textarea.scrollHeight)}px`;
  }, [text]);

  function signalTyping() {
    const now = Date.now();
    if (now - typingPulse.current > 1200) {
      typingPulse.current = now;
      broadcastTyping(chatId, true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => broadcastTyping(chatId, false), 1800);
  }

  async function uploadAttachment(attachment: ComposerAttachment) {
    cancelledUploadIds.current.delete(attachment.id);
    uploadControllers.current.get(attachment.id)?.abort();
    const controller = new AbortController();
    uploadControllers.current.set(attachment.id, controller);
    upsertAttachment({ ...attachment, status: "uploading", progress: 8 });
    let progress = 8;
    const progressTimer = window.setInterval(() => {
      if (!componentActive.current) return;
      if (progress >= 90) return;
      progress = Math.min(90, progress + Math.max(1, (92 - progress) * 0.08));
      upsertAttachment({
        ...attachment,
        status: "uploading",
        progress: Math.round(progress),
      });
    }, 250);
    try {
      const uploaded = await uploadByKind(attachment.file, {
        signal: controller.signal,
        onProgress: (percentage) => {
          progress = Math.max(progress, percentage);
          if (!componentActive.current) return;
          upsertAttachment({
            ...attachment,
            status: "uploading",
            progress: Math.round(progress),
          });
        },
      });
      if (
        !componentActive.current ||
        cancelledUploadIds.current.has(attachment.id)
      ) {
        void mediaApi.remove(uploaded.media.id).catch(() => undefined);
        return;
      }
      cacheMedia(uploaded.media);
      upsertAttachment({
        ...attachment,
        status: "ready",
        progress: 100,
        media: uploaded.media,
        kind: uploaded.kind,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        !componentActive.current ||
        cancelledUploadIds.current.has(attachment.id)
      ) {
        return;
      }
      upsertAttachment({
        ...attachment,
        status: "error",
        progress: 0,
        error: friendlyError(error),
      });
    } finally {
      window.clearInterval(progressTimer);
      uploadControllers.current.delete(attachment.id);
    }
  }

  async function enqueueFiles(files: FileList | File[]) {
    const list = [...files];
    const uploadOne = async (file: File) => {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} exceeds the 25 MiB limit.`);
        return;
      }
      const attachment = createAttachment(file);
      upsertAttachment(attachment);
      await uploadAttachment(attachment);
    };
    // Bounded concurrency keeps the composer responsive without flooding uploads.
    const limit = 3;
    for (let index = 0; index < list.length; index += limit) {
      await Promise.all(list.slice(index, index + limit).map(uploadOne));
    }
  }

  const send = useMutation({
    mutationFn: async (submission: SendSubmission) => {
      if (submission.editing) {
        if (!navigator.onLine) {
          throw new Error("Message edits need a connection. Try again when online.");
        }
        return [await messagesApi.edit(submission.editing.id, submission.text)];
      }

      const { ready } = submission;
      if (ready.length === 0 && !submission.text) {
        throw new Error("Write a message or attach a file.");
      }
      if (!navigator.onLine) {
        if (ready.length > 0) {
          throw new Error(
            "Attachment messages need a connection. Your files remain ready to send.",
          );
        }
        enqueuePending({
          id: crypto.randomUUID(),
          chatId,
          content: submission.text,
          replyToId: submission.replyTo?.id,
          createdAt: Date.now(),
        });
        toast.info("Message queued. It will send when you’re back online.");
        return null;
      }

      const sent: ChatMessage[] = [];
      if (ready.length === 0) {
        if (submission.replyTo) {
          sent.push(
            await messagesApi.reply({
              chat_id: chatId,
              reply_to_id: submission.replyTo.id,
              content: submission.text,
              type: "text",
            }),
          );
        } else {
          sent.push(
            await messagesApi.send({
              chat_id: chatId,
              content: submission.text,
              type: "text",
            }),
          );
        }
      } else {
        for (let index = 0; index < ready.length; index += 1) {
          const item = ready[index];
          const content =
            index === ready.length - 1 ? submission.text || null : null;
          const body = {
            chat_id: chatId,
            content,
            type: item.kind,
            media_id: item.media!.id,
            reply_to_id:
              index === 0 ? submission.replyTo?.id : undefined,
          } as const;
          sent.push(
            submission.replyTo && index === 0
              ? await messagesApi.reply({
                  chat_id: chatId,
                  reply_to_id: submission.replyTo.id,
                  content,
                  type: item.kind,
                  media_id: item.media!.id,
                })
              : await messagesApi.send(body),
          );
        }
      }
      return sent;
    },
    onMutate: (submission) => {
      const { ready } = submission;
      if (
        submission.editing ||
        !navigator.onLine ||
        !currentUser ||
        (!submission.text && ready.length === 0)
      ) {
        return null;
      }

      const now = new Date().toISOString();
      const optimisticIds: string[] = [];
      const optimisticItems =
        ready.length > 0
          ? ready.map((item, index) => ({
              type: item.kind,
              mediaId: item.media!.id,
              content:
                index === ready.length - 1 ? submission.text || null : null,
              replyTo: index === 0 ? submission.replyTo : null,
            }))
          : [
              {
                type: "text" as const,
                mediaId: null,
                content: submission.text,
                replyTo: submission.replyTo,
              },
            ];
      optimisticItems.forEach((item, index) => {
        const optimisticId = `optimistic-${crypto.randomUUID()}`;
        optimisticIds.push(optimisticId);
        const optimistic: ChatMessage = {
          id: optimisticId,
          chat_id: chatId,
          sender: { id: currentUser.id, username: currentUser.username },
          type: item.type,
          content: item.content,
          media_id: item.mediaId,
          reply_to: item.replyTo
            ? {
                id: item.replyTo.id,
                sender_id: item.replyTo.sender.id,
                type: item.replyTo.type,
                content: item.replyTo.content,
                is_deleted: item.replyTo.is_deleted,
                deleted_for_everyone: item.replyTo.deleted_for_everyone,
              }
            : null,
          forwarded_from_id: null,
          is_edited: false,
          edited_at: null,
          is_deleted: false,
          deleted_for_everyone: false,
          deleted_at: null,
          is_pinned: false,
          reactions: [],
          delivered_count: 0,
          read_count: 0,
          created_at: new Date(new Date(now).getTime() + index).toISOString(),
          updated_at: now,
        };
        queryClient.setQueryData<MessagePages>(
          ["messages", chatId],
          (data) => putMessageInCache(data, optimistic),
        );
      });
      setText("");
      setReplyTo(null);
      if (ready.length > 0) clearAttachments();
      broadcastTyping(chatId, false);
      return {
        optimisticIds,
        submittedText: submission.text,
        submittedReply: submission.replyTo,
        submittedAttachments: ready,
      };
    },
    onSuccess: (sentMessages, _submission, optimisticContext) => {
      setText("");
      clearAttachments();
      setReplyTo(null);
      setEditing(null);
      broadcastTyping(chatId, false);
      // Offline queueing returns null — do not invalidate or await network here.
      if (!sentMessages) return;
      sentMessages.forEach((message, index) => {
        queryClient.setQueryData<MessagePages>(
          ["messages", chatId],
          (data) =>
            putMessageInCache(
              data,
              {
                ...message,
                delivered_count: Math.max(1, message.delivered_count),
              },
              optimisticContext?.optimisticIds[index],
            ),
        );
        broadcastChatEvent(chatId, "message.created", {
          message_id: message.id,
          sender_id: currentUser?.id,
        });
      });
      optimisticContext?.submittedAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      // Background only — keep send.isPending false so the next message is not blocked.
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (error, submission, optimisticContext) => {
      if (optimisticContext?.optimisticIds.length) {
        queryClient.setQueryData<MessagePages>(
          ["messages", chatId],
          (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                    ...page,
                    data: page.data.filter(
                      (item) =>
                        !optimisticContext.optimisticIds.includes(item.id),
                    ),
                  })),
                }
              : data,
        );
      }
      const connectionFailed =
        !navigator.onLine ||
        (error instanceof TypeError &&
          /fetch|network|connection/i.test(error.message));
      if (
        !submission.editing &&
        submission.ready.length === 0 &&
        submission.text &&
        connectionFailed
      ) {
        enqueuePending({
          id: crypto.randomUUID(),
          chatId,
          content: submission.text,
          replyToId: submission.replyTo?.id,
          createdAt: Date.now(),
        });
        setText("");
        setReplyTo(null);
        broadcastTyping(chatId, false);
        toast.info("Connection lost. Your message was queued.");
        return;
      }
      if (
        !submission.editing &&
        submission.ready.length === 0 &&
        submission.text
      ) {
        enqueuePending({
          id: optimisticContext?.optimisticIds[0] ?? crypto.randomUUID(),
          chatId,
          content: submission.text,
          replyToId: submission.replyTo?.id,
          createdAt: Date.now(),
          status: "failed",
          error: friendlyError(error),
        });
        setText("");
        setReplyTo(null);
        broadcastTyping(chatId, false);
        toast.error(`${friendlyError(error)} You can retry this message.`);
        return;
      }
      if (optimisticContext?.submittedText) {
        setText((current) => current || optimisticContext.submittedText);
        setReplyTo(optimisticContext.submittedReply);
      }
      optimisticContext?.submittedAttachments.forEach(upsertAttachment);
      toast.error(friendlyError(error));
    },
  });

  const shareLocation = useMutation({
    mutationFn: async (durationMinutes: LocationDurationMinutes) => {
      locationDurationRef.current = durationMinutes;
      const position = await requestLocationPermission();
      return locationApi.shareLive({
        chat_id: chatId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        duration_minutes: durationMinutes,
      });
    },
    onSuccess: async (location) => {
      setLocationPickerOpen(false);
      setPermission("location", "granted");
      setLiveLocation(location);
      setLocationRemaining(
        Math.max(
          0,
          Math.floor(
            (new Date(location.expires_at).getTime() - Date.now()) / 1000,
          ),
        ),
      );
      if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
      }
      let lastUpdate = 0;
      const durationMinutes = locationDurationRef.current;
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (Date.now() - lastUpdate < 10_000) return;
          lastUpdate = Date.now();
          void locationApi
            .shareLive({
              chat_id: chatId,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading,
              speed: position.coords.speed,
              duration_minutes: durationMinutes,
            })
            .then(setLiveLocation)
            .catch(() => undefined);
        },
        () => setPermission("location", "denied"),
        { enableHighAccuracy: true, maximumAge: 5_000 },
      );
      setLocationWatchId(watchId);
      await messagesApi.send({
        chat_id: chatId,
        type: "location",
        content: encodeLiveLocationContent(
          location.latitude,
          location.longitude,
        ),
      });
      broadcastChatEvent(chatId, "message.created", { location_id: location.id });
      toast.success("Live location shared");
      void queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (error) => {
      setPermission("location", "denied");
      toast.error(friendlyError(error));
    },
  });

  const stopLocation = useMutation({
    mutationFn: () => locationApi.stopSharing(),
    onSuccess: () => {
      if (locationWatchId !== null) {
        navigator.geolocation.clearWatch(locationWatchId);
        setLocationWatchId(null);
      }
      setLocationRemaining(0);
      setLiveLocation(null);
      toast.success("Stopped sharing location");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Voice recording is unavailable in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 24_000 },
          sampleSize: { ideal: 16 },
        },
      });
      streamRef.current = stream;
      const mimeType = preferredRecorderMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        toast.error("Voice recording stopped unexpectedly. Please try again.");
        cancelRecording(true);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1_000);
      setRecording(true);
      setPaused(false);
      setRecordSeconds(0);
      setPermission("microphone", "granted");
      broadcastRecording(chatId, true);
      if (recordingHeartbeatRef.current) {
        clearInterval(recordingHeartbeatRef.current);
      }
      recordingHeartbeatRef.current = setInterval(() => {
        broadcastRecording(chatId, true);
      }, 2_000);
      timerRef.current = setInterval(() => {
        setRecordSeconds((value) => value + 1);
      }, 1000);
    } catch (error) {
      setPermission("microphone", "denied");
      toast.error(
        error instanceof Error
          ? error.message
          : "Microphone permission is required for voice messages.",
      );
    }
  }

  function pauseRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingHeartbeatRef.current) {
        clearInterval(recordingHeartbeatRef.current);
        recordingHeartbeatRef.current = null;
      }
      broadcastRecording(chatId, false);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setPaused(false);
      broadcastRecording(chatId, true);
      recordingHeartbeatRef.current = setInterval(() => {
        broadcastRecording(chatId, true);
      }, 2_000);
      timerRef.current = setInterval(() => {
        setRecordSeconds((value) => value + 1);
      }, 1000);
    }
  }

  function cancelRecording(silent = false) {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recordingHeartbeatRef.current) {
      clearInterval(recordingHeartbeatRef.current);
      recordingHeartbeatRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setPaused(false);
    setRecordSeconds(0);
    broadcastRecording(chatId, false);
    if (!silent) toast.message("Recording discarded");
  }

  async function sendRecording() {
    if (voiceSending) return;
    setVoiceSending(true);
    const recorder = mediaRecorderRef.current;
    let optimisticId: string | null = null;
    let localVoiceUrl: string | null = null;
    let recordedFile: File | null = null;
    try {
      if (!recorder) throw new Error("No active voice recording was found.");
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve, reject) => {
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.addEventListener(
            "error",
            () => reject(new Error("The recording could not be completed.")),
            { once: true },
          );
          recorder.stop();
        });
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const contentType = (recorder.mimeType || "audio/webm").split(";")[0];
      const extension =
        contentType === "audio/mp4"
          ? "m4a"
          : contentType === "audio/ogg"
            ? "ogg"
            : "webm";
      const blob = new Blob(chunksRef.current, { type: contentType });
      if (blob.size === 0) {
        throw new Error("The recording is empty. Please record again.");
      }
      const file = new File([blob], `voice-${Date.now()}.${extension}`, {
        type: contentType,
      });
      recordedFile = file;
      const submittedText = text.trim();
      if (currentUser) {
        optimisticId = `optimistic-voice-${crypto.randomUUID()}`;
        const optimisticMediaId = `optimistic-media-${crypto.randomUUID()}`;
        localVoiceUrl = URL.createObjectURL(file);
        const now = new Date().toISOString();
        cacheMedia({
          id: optimisticMediaId,
          uploader_id: currentUser.id,
          kind: "voice",
          public_id: optimisticMediaId,
          url: localVoiceUrl,
          resource_type: "video",
          format: extension,
          content_type: contentType,
          original_filename: file.name,
          bytes: file.size,
          width: null,
          height: null,
          duration: recordSeconds,
          chat_id: chatId,
          created_at: now,
        });
        const optimistic: ChatMessage = {
          id: optimisticId,
          chat_id: chatId,
          sender: { id: currentUser.id, username: currentUser.username },
          type: "voice",
          content: submittedText || null,
          media_id: optimisticMediaId,
          reply_to: null,
          forwarded_from_id: null,
          is_edited: false,
          edited_at: null,
          is_deleted: false,
          deleted_for_everyone: false,
          deleted_at: null,
          is_pinned: false,
          reactions: [],
          delivered_count: 0,
          read_count: 0,
          created_at: now,
          updated_at: now,
        };
        queryClient.setQueryData<MessagePages>(
          ["messages", chatId],
          (data) => putMessageInCache(data, optimistic),
        );
      }
      broadcastRecording(chatId, false);
      cancelRecording(true);
      setText("");
      const uploaded = await uploadByKind(file);
      cacheMedia(uploaded.media);
      const message = await messagesApi.send({
        chat_id: chatId,
        type: "voice",
        media_id: uploaded.media.id,
        content: submittedText || null,
      });
      queryClient.setQueryData<MessagePages>(
        ["messages", chatId],
        (data) =>
          putMessageInCache(
            data,
            {
              ...message,
              delivered_count: Math.max(1, message.delivered_count),
            },
            optimisticId ?? undefined,
          ),
      );
      broadcastChatEvent(chatId, "message.created", { message_id: message.id });
      if (localVoiceUrl) URL.revokeObjectURL(localVoiceUrl);
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    } catch (error) {
      if (optimisticId) {
        queryClient.setQueryData<MessagePages>(
          ["messages", chatId],
          (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                    ...page,
                    data: page.data.filter(
                      (message) => message.id !== optimisticId,
                    ),
                  })),
                }
              : data,
        );
      }
      if (localVoiceUrl) URL.revokeObjectURL(localVoiceUrl);
      if (recordedFile) {
        const retryAttachment = createAttachment(recordedFile);
        upsertAttachment({
          ...retryAttachment,
          kind: "voice",
          status: "error",
          error: friendlyError(error),
        });
      }
      toast.error(friendlyError(error));
    } finally {
      setVoiceSending(false);
    }
  }

  const canSend =
    Boolean(text.trim()) ||
    attachments.some((item) => item.status === "ready") ||
    Boolean(editing);

  function submitMessage() {
    const ready = attachments.filter(
      (item) => item.status === "ready" && item.media,
    );
    const submittedText = text.trim();
    if (!editing && !submittedText && ready.length === 0) return;
    send.mutate({
      text: submittedText,
      editing,
      replyTo,
      ready,
    });
  }

  return (
    <div
      className={cx(
        "relative border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] px-3 py-3 backdrop-blur-2xl sm:px-4",
        dragOver && "bg-[var(--accent-soft)]",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files?.length) {
          void enqueueFiles(event.dataTransfer.files);
        }
      }}
    >
      <AnimatePresence>
        {(replyTo || editing) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="mb-2 flex items-center justify-between rounded-2xl bg-[var(--surface-2)] px-3 py-2 text-sm"
          >
            <span className="truncate text-[var(--muted)]">
              {editing ? "Editing message" : `Replying to ${replyTo?.content || replyTo?.type}`}
            </span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
                if (editing) setText("");
              }}
              className="grid size-7 place-items-center rounded-lg hover:bg-[var(--surface)]"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((item) => (
            <div
              key={item.id}
              className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2"
            >
              {item.previewUrl && item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
              ) : item.previewUrl && item.kind === "video" ? (
                <video
                  src={item.previewUrl}
                  muted
                  preload="metadata"
                  aria-label={`Preview of ${item.file.name}`}
                  className="h-16 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-16 w-36 items-center gap-2 px-2 text-xs">
                  <FileText size={16} />
                  <span className="truncate">{item.file.name}</span>
                </div>
              )}
              {item.status === "uploading" && (
                <>
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                    {item.progress}%
                  </span>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-[var(--surface-2)]">
                    <div
                      className="h-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                </>
              )}
              {item.status === "error" && (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-red-600"
                  onClick={() => void uploadAttachment(item)}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                aria-label={
                  item.status === "uploading"
                    ? "Cancel upload"
                    : "Remove attachment"
                }
                onClick={() => {
                  cancelledUploadIds.current.add(item.id);
                  uploadControllers.current.get(item.id)?.abort();
                  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
                  removeAttachment(item.id);
                }}
                className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/50 text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {recording ? (
        <motion.div
          layout
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex min-h-14 items-center gap-3 rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-1.5 pl-4 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.65)]"
        >
          <motion.span
            animate={{ opacity: paused ? 0.45 : [1, 0.35, 1] }}
            transition={{ duration: 1.25, repeat: paused ? 0 : Infinity }}
            className="size-2 shrink-0 rounded-full bg-red-500"
            aria-hidden="true"
          />
          <Waveform active={!paused} />
          <span className="min-w-14 text-sm font-medium tabular-nums">
            {Math.floor(recordSeconds / 60)
              .toString()
              .padStart(2, "0")}
            :{(recordSeconds % 60).toString().padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label={paused ? "Resume" : "Pause"}
            onClick={pauseRecording}
            title={paused ? "Resume recording" : "Pause recording"}
            className="grid size-10 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            type="button"
            aria-label="Cancel recording"
            onClick={() => cancelRecording()}
            title="Discard recording"
            className="grid size-10 place-items-center rounded-xl text-red-500 transition hover:bg-red-500/10"
          >
            <X size={16} />
          </button>
          <Button
            onClick={() => void sendRecording()}
            className="ml-auto h-11 rounded-2xl px-4"
            loading={voiceSending}
            disabled={voiceSending}
          >
            <SendHorizontal size={16} />
            {voiceSending ? "Sending…" : "Send"}
          </Button>
        </motion.div>
      ) : (
        <motion.div
          layout
          animate={{ scale: focused ? 1.002 : 1 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={cx(
            "flex min-w-0 items-end gap-1 rounded-[22px] border bg-[var(--surface)]/90 p-1.5 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.65)] transition-[border-color,box-shadow] duration-200",
            focused
              ? "border-[var(--accent)]/45 shadow-[0_0_0_3px_var(--accent-soft),0_12px_32px_-24px_rgba(0,0,0,0.75)]"
              : "border-[var(--border)] hover:border-[var(--border-strong)]",
          )}
        >
          <div className="relative">
            <ComposerIconButton
              label="Add attachment"
              active={attachOpen}
              onClick={() => setAttachOpen((value) => !value)}
            >
              <Paperclip size={18} />
            </ComposerIconButton>
            <AnimatePresence>
              {attachOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-14 left-0 z-20 w-48 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] py-1 shadow-lg"
                >
                  <AttachItem
                    icon={ImagePlus}
                    label="Image / GIF"
                    onClick={() => {
                      setAttachOpen(false);
                      imageRef.current?.click();
                    }}
                  />
                  <AttachItem
                    icon={Play}
                    label="Video"
                    onClick={() => {
                      setAttachOpen(false);
                      videoRef.current?.click();
                    }}
                  />
                  <AttachItem
                    icon={FileText}
                    label="Document"
                    onClick={() => {
                      setAttachOpen(false);
                      fileRef.current?.click();
                    }}
                  />
                  <AttachItem
                    icon={MapPin}
                    label="Live location"
                    onClick={() => {
                      setAttachOpen(false);
                      setLocationPickerOpen(true);
                    }}
                  />
                  <AttachItem
                    icon={X}
                    label="Stop location"
                    onClick={() => {
                      setAttachOpen(false);
                      stopLocation.mutate();
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <ComposerIconButton
              label="Choose emoji"
              active={emojiOpen}
              onClick={() => setEmojiOpen((value) => !value)}
            >
              <Smile size={18} />
            </ComposerIconButton>
            <AnimatePresence>
              {emojiOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-14 left-0 z-20 grid w-64 grid-cols-8 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg"
                >
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="grid size-7 place-items-center rounded-lg text-base hover:bg-[var(--surface-2)]"
                      onClick={() => {
                        setText((value) => `${value}${emoji}`);
                        textareaRef.current?.focus();
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative min-w-0 flex-1">
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              maxLength={MAX_CHARS}
              placeholder="Write a message"
              aria-label="Message"
              className="block max-h-40 min-h-11 w-full resize-none overflow-y-auto bg-transparent px-3 py-3 pr-20 text-sm leading-5 outline-none transition-[height] duration-150 placeholder:text-[var(--muted-2)]"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(event) => {
                setText(event.target.value);
                signalTyping();
              }}
              onPaste={(event) => {
                const files = event.clipboardData.files;
                if (files?.length) {
                  event.preventDefault();
                  void enqueueFiles(files);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSend) submitMessage();
                }
              }}
            />
            <span className="pointer-events-none absolute bottom-3 right-2.5 rounded-md bg-[var(--surface)]/80 px-1 text-[10px] tabular-nums text-[var(--muted-2)]">
              {text.length}/{MAX_CHARS}
            </span>
          </div>

          <AnimatePresence initial={false} mode="wait">
            {canSend ? (
              <motion.button
                key="send"
                type="button"
                aria-label="Send message"
                title="Send message"
                disabled={
                  attachments.some((item) => item.status === "uploading")
                }
                onClick={submitMessage}
                initial={{ opacity: 0, scale: 0.86, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.86, rotate: 8 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.15 }}
                className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-[0_8px_20px_-12px_var(--accent)] outline-none transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <SendHorizontal size={17} />
              </motion.button>
            ) : (
              <motion.button
                key="voice"
                type="button"
                aria-label="Record voice message"
                title="Record voice message"
                onClick={() => setMicrophonePrompt(true)}
                initial={{ opacity: 0, scale: 0.86, rotate: 8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.86, rotate: -8 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.15 }}
                className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-[0_8px_20px_-12px_var(--accent)] outline-none transition-opacity hover:opacity-95"
              >
                <Mic size={17} />
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <input
        ref={imageRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void enqueueFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void enqueueFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,text/plain"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void enqueueFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <AnimatePresence>
        {microphonePrompt && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-20 right-4 z-30 w-80 rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Mic size={19} />
            </span>
            <h3 className="mt-4 font-semibold">Allow microphone access</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Chatter only uses your microphone while you record this voice
              message.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setMicrophonePrompt(false)}
              >
                Not now
              </Button>
              <Button
                onClick={() => {
                  setMicrophonePrompt(false);
                  void startRecording();
                }}
              >
                Continue
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <LiveLocationDurationDialog
        open={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        loading={shareLocation.isPending}
        onConfirm={(minutes) => shareLocation.mutate(minutes)}
      />
    </div>
  );
}

function ComposerIconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.14 }}
      className={cx(
        "group grid size-11 place-items-center rounded-2xl outline-none transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
      )}
    >
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1 text-[10px] font-medium text-[var(--ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </motion.button>
  );
}

function AttachItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Paperclip;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-end gap-0.5" aria-hidden="true">
      {Array.from({ length: 16 }).map((_, index) => (
        <motion.span
          key={index}
          className="w-1 rounded-full bg-[var(--accent)]"
          animate={
            active
              ? { height: [6, 18 + (index % 5) * 3, 8] }
              : { height: 6 }
          }
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: index * 0.04,
          }}
        />
      ))}
      {!active && <Square size={0} />}
    </div>
  );
}
