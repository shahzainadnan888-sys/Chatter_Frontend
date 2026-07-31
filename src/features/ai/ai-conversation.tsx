"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  Copy,
  File,
  History,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cx } from "@/src/components/ui";
import { AIImageMessage } from "@/src/features/ai/image";
import { IMAGE_GENERATION_TIMEOUT_MS } from "@/src/features/ai/image/types";
import { friendlyError } from "@/src/lib/shell-utils";
import {
  aiConversationService,
  type AIConversationAttachment,
  type AIConversationInput,
} from "@/src/services/ai-conversation";
import { aiApi } from "@/src/services/prompt4-api";

type AIMessageKind = "text" | "image";
type AIMessageStatus =
  | "streaming"
  | "generating"
  | "complete"
  | "stopped"
  | "error"
  | "timeout";

interface AIMessageModel {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: AIMessageStatus;
  kind?: AIMessageKind;
  imageUrl?: string | null;
  imagePrompt?: string | null;
  error?: string | null;
}

interface AIConversationModel {
  id: string;
  title: string;
  messages: AIMessageModel[];
  updatedAt: string;
}

const STORAGE_KEY = "chatter.ai.conversations.v1";
const MAX_CHARACTERS = 8000;

const suggestions = [
  "Help me improve my English",
  "Rewrite this professionally",
  "Generate an image of a calm mountain lake at sunrise",
  "Translate into Urdu",
  "Create a picture of a futuristic city skyline",
  "Summarize this text",
  "Draw a minimal logo for a coffee brand",
  "Practice interview questions",
];

const capabilities = [
  "Ask anything",
  "Generate images",
  "Write better",
  "Translate",
  "Learn",
  "Brainstorm",
  "Practice interviews",
  "Get coding help",
];

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isImageGenerationPrompt(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;

  const patterns = [
    /\b(generate|create|make|draw|paint|render|design|illustrate|sketch)\b.{0,60}\b(an?\s+)?(image|picture|photo|illustration|artwork|drawing|painting|wallpaper|logo|icon|banner|poster)\b/,
    /\b(an?\s+)?(image|picture|photo|illustration|artwork|drawing|painting)\b.{0,24}\b(of|showing|with|featuring)\b/,
    /^(please\s+)?(can you\s+)?(generate|create|make|draw|paint|render|design|illustrate)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|art)\b/,
    /\b(text[\s-]?to[\s-]?image|ai\s+image|image\s+generation)\b/,
    /\b(generate|create|make)\s+(me\s+)?(another\s+)?(variation|version)\b/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function extractImagePrompt(text: string): string {
  const cleaned = text
    .trim()
    .replace(
      /^(please\s+)?(can you\s+|could you\s+)?(generate|create|make|draw|paint|render|design|illustrate|sketch)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|artwork|art|drawing|painting|wallpaper|logo|icon|banner|poster)\s*((of|showing|with|featuring)\s+)?/i,
      "",
    )
    .trim();
  return cleaned || text.trim();
}

export function AIConversation() {
  const [conversations, setConversations] = useState<AIConversationModel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AIConversationAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationTokenRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as AIConversationModel[];
          setConversations(parsed);
          setActiveId(parsed[0]?.id ?? null);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, hydrated]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [activeId, conversations],
  );

  const activeContent = activeConversation?.messages
    .map(
      (message) =>
        `${message.id}:${message.content}:${message.imageUrl ?? ""}:${message.status}`,
    )
    .join("|");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: generating ? "smooth" : "auto" });
  }, [activeContent, generating]);

  function updateConversation(
    conversationId: string,
    updater: (conversation: AIConversationModel) => AIConversationModel,
  ) {
    setConversations((current) =>
      current
        .map((conversation) =>
          conversation.id === conversationId ? updater(conversation) : conversation,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async function requestResponse(
    conversationId: string,
    messages: AIMessageModel[],
    files: AIConversationAttachment[],
  ) {
    if (!aiConversationService.available) {
      toast.info("Chatter Intelligence is ready for the conversational backend.");
      return;
    }

    const assistantId = makeId();
    const token = ++generationTokenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setGeneratingImage(false);
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          status: "streaming",
          kind: "text",
        },
      ],
      updatedAt: new Date().toISOString(),
    }));

    try {
      await aiConversationService.stream(
        {
          conversationId,
          messages: messages.map(
            ({ role, content }): AIConversationInput => ({ role, content }),
          ),
          attachments: files,
        },
        {
          signal: controller.signal,
          onToken: (tokenText) => {
            if (controller.signal.aborted || token !== generationTokenRef.current) return;
            updateConversation(conversationId, (conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + tokenText }
                  : message,
              ),
              updatedAt: new Date().toISOString(),
            }));
          },
        },
      );
      if (controller.signal.aborted || token !== generationTokenRef.current) return;
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId ? { ...message, status: "complete" } : message,
        ),
      }));
    } catch (error) {
      if (!controller.signal.aborted && token === generationTokenRef.current) {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.filter(
            (message) => message.id !== assistantId || message.content,
          ),
        }));
        toast.error(
          error instanceof Error
            ? error.message
            : "Chatter Intelligence could not complete that response.",
        );
      }
    } finally {
      if (token === generationTokenRef.current) {
        abortRef.current = null;
        setGenerating(false);
        setGeneratingImage(false);
      }
    }
  }

  async function requestImage(
    conversationId: string,
    prompt: string,
    options: { replaceMessageId?: string } = {},
  ) {
    const imagePrompt = extractImagePrompt(prompt);
    const token = ++generationTokenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setGeneratingImage(true);

    const assistantId = options.replaceMessageId ?? makeId();
    const now = new Date().toISOString();

    updateConversation(conversationId, (conversation) => {
      const placeholder: AIMessageModel = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: options.replaceMessageId
          ? conversation.messages.find((message) => message.id === assistantId)
              ?.createdAt ?? now
          : now,
        status: "generating",
        kind: "image",
        imageUrl: null,
        imagePrompt,
        error: null,
      };

      if (options.replaceMessageId) {
        return {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === options.replaceMessageId ? placeholder : message,
          ),
          updatedAt: now,
        };
      }

      return {
        ...conversation,
        messages: [...conversation.messages, placeholder],
        updatedAt: now,
      };
    });

    const timedOut = Symbol("image-timeout");
    let timeoutId: number | undefined;

    try {
      const result = await Promise.race([
        aiApi.generateImage(imagePrompt),
        new Promise<typeof timedOut>((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve(timedOut),
            IMAGE_GENERATION_TIMEOUT_MS,
          );
        }),
      ]);

      if (controller.signal.aborted || token !== generationTokenRef.current) return;

      if (result === timedOut) {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  status: "timeout",
                  kind: "image",
                  imageUrl: null,
                  imagePrompt,
                  error: "Image generation timed out after 60 seconds.",
                }
              : message,
          ),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      if (!result.success || !result.image_url) {
        throw new Error("Image generation did not return an image.");
      }

      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: "",
                status: "complete",
                kind: "image",
                imageUrl: result.image_url,
                imagePrompt,
                error: null,
              }
            : message,
        ),
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (controller.signal.aborted || token !== generationTokenRef.current) return;
      const message = friendlyError(error);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: "",
                status: "error",
                kind: "image",
                imageUrl: null,
                imagePrompt,
                error: message,
              }
            : item,
        ),
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (token === generationTokenRef.current) {
        abortRef.current = null;
        setGenerating(false);
        setGeneratingImage(false);
      }
    }
  }

  function sendMessage(value = draft) {
    const content = value.trim();
    if (!content || generating || content.length > MAX_CHARACTERS) return;

    const now = new Date().toISOString();
    const selectedFiles = attachments;
    const imageRequest = isImageGenerationPrompt(content);
    setDraft("");
    setAttachments([]);

    if (editingMessageId && activeConversation) {
      const index = activeConversation.messages.findIndex(
        (message) => message.id === editingMessageId,
      );
      if (index >= 0) {
        const updatedMessages = activeConversation.messages
          .slice(0, index + 1)
          .map((message) =>
            message.id === editingMessageId
              ? { ...message, content, createdAt: now }
              : message,
          );
        updateConversation(activeConversation.id, (conversation) => ({
          ...conversation,
          messages: updatedMessages,
          updatedAt: now,
        }));
        setEditingMessageId(null);
        if (imageRequest) {
          void requestImage(activeConversation.id, content);
        } else {
          void requestResponse(activeConversation.id, updatedMessages, selectedFiles);
        }
      }
      return;
    }

    const userMessage: AIMessageModel = {
      id: makeId(),
      role: "user",
      content,
      createdAt: now,
      status: "complete",
      kind: "text",
    };

    if (activeConversation) {
      const updatedMessages = [...activeConversation.messages, userMessage];
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: updatedMessages,
        updatedAt: now,
      }));
      if (imageRequest) {
        void requestImage(activeConversation.id, content);
      } else {
        void requestResponse(activeConversation.id, updatedMessages, selectedFiles);
      }
      return;
    }

    const conversation: AIConversationModel = {
      id: makeId(),
      title: content.length > 42 ? `${content.slice(0, 42)}…` : content,
      messages: [userMessage],
      updatedAt: now,
    };
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    if (imageRequest) {
      void requestImage(conversation.id, content);
    } else {
      void requestResponse(conversation.id, conversation.messages, selectedFiles);
    }
  }

  function startNewConversation() {
    abortRef.current?.abort();
    generationTokenRef.current += 1;
    setGenerating(false);
    setGeneratingImage(false);
    setActiveId(null);
    setDraft("");
    setAttachments([]);
    setEditingMessageId(null);
  }

  function deleteConversation() {
    if (!activeConversation) return;
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== activeConversation.id),
    );
    setActiveId(
      conversations.find((conversation) => conversation.id !== activeConversation.id)
        ?.id ?? null,
    );
  }

  function renameConversation() {
    if (!activeConversation) return;
    const title = window.prompt("Rename conversation", activeConversation.title)?.trim();
    if (!title) return;
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      title: title.slice(0, 80),
    }));
  }

  function editMessage(message: AIMessageModel) {
    setEditingMessageId(message.id);
    setDraft(message.content);
  }

  function stopGenerating() {
    abortRef.current?.abort();
    generationTokenRef.current += 1;
    if (activeConversation) {
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.status === "streaming" || message.status === "generating"
            ? {
                ...message,
                status: "stopped",
                content:
                  message.kind === "image" && !message.imageUrl
                    ? "Image generation stopped."
                    : message.content,
              }
            : message,
        ),
      }));
    }
    setGenerating(false);
    setGeneratingImage(false);
  }

  function regenerate(messageId: string) {
    if (!activeConversation || generating) return;
    const assistantIndex = activeConversation.messages.findIndex(
      (message) => message.id === messageId,
    );
    if (assistantIndex < 0) return;
    const target = activeConversation.messages[assistantIndex];
    const prior = activeConversation.messages.slice(0, assistantIndex);
    const lastUser = [...prior].reverse().find((message) => message.role === "user");
    if (!lastUser) return;

    if (target.kind === "image") {
      void requestImage(
        activeConversation.id,
        target.imagePrompt || lastUser.content,
        { replaceMessageId: messageId },
      );
      return;
    }

    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: prior,
      updatedAt: new Date().toISOString(),
    }));
    void requestResponse(activeConversation.id, prior, []);
  }

  function retryImage(messageId: string) {
    if (!activeConversation || generating) return;
    const target = activeConversation.messages.find((message) => message.id === messageId);
    if (!target?.imagePrompt) return;
    void requestImage(activeConversation.id, target.imagePrompt, {
      replaceMessageId: messageId,
    });
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <AIConversationList
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={startNewConversation}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AIHeader
          conversation={activeConversation}
          generating={generating}
          generatingImage={generatingImage}
          onNew={startNewConversation}
          onRename={renameConversation}
          onDelete={deleteConversation}
        />
        <div className="shell-scroll min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            {activeConversation ? (
              <motion.div
                key={activeConversation.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="mx-auto w-full max-w-3xl px-5 py-6"
              >
                {activeConversation.messages.map((message) => (
                  <AIMessage
                    key={message.id}
                    message={message}
                    busy={generating}
                    onEdit={() => editMessage(message)}
                    onRegenerate={() => regenerate(message.id)}
                    onRetryImage={() => retryImage(message.id)}
                  />
                ))}
                {generating &&
                  !generatingImage &&
                  activeConversation.messages.at(-1)?.role !== "assistant" && (
                    <AITypingIndicator />
                  )}
                <div ref={endRef} />
              </motion.div>
            ) : (
              <AIEmptyState key="empty" onSuggestion={setDraft} />
            )}
          </AnimatePresence>
        </div>
        <AIComposer
          value={draft}
          attachments={attachments}
          generating={generating}
          editing={Boolean(editingMessageId)}
          backendAvailable={aiConversationService.available}
          onChange={setDraft}
          onAttachments={setAttachments}
          onSend={() => sendMessage()}
          onStop={stopGenerating}
          onCancelEdit={() => {
            setEditingMessageId(null);
            setDraft("");
          }}
        />
      </div>
    </div>
  );
}

function AIConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: AIConversationModel[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]/45 p-3 lg:flex">
      <button
        type="button"
        onClick={onNew}
        className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)]"
      >
        <Plus size={14} /> New chat
      </button>
      <div className="mt-3 flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/70 px-3 focus-within:border-[var(--accent)]/40">
        <Search size={13} className="shrink-0 text-[var(--muted-2)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search AI conversations"
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--muted-2)]"
        />
      </div>
      <div className="mt-5 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-2)]">
        <History size={12} /> Recent conversations
      </div>
      <div className="shell-scroll mt-2 min-h-0 flex-1 overflow-y-auto">
        {filteredConversations.length ? (
          filteredConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={cx(
                "mb-1 w-full rounded-xl px-3 py-2.5 text-left transition",
                activeId === conversation.id
                  ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
              )}
            >
              <span className="block truncate text-xs font-semibold">
                {conversation.title}
              </span>
              <span className="mt-1 block text-[10px] text-[var(--muted-2)]">
                {formatTime(conversation.updatedAt)}
              </span>
            </button>
          ))
        ) : (
          <p className="px-2 py-4 text-xs leading-5 text-[var(--muted-2)]">
            {query.trim()
              ? "No matching conversations."
              : "Your conversations will appear here."}
          </p>
        )}
      </div>
    </aside>
  );
}

function AIHeader({
  conversation,
  generating,
  generatingImage,
  onNew,
  onRename,
  onDelete,
}: {
  conversation: AIConversationModel | null;
  generating: boolean;
  generatingImage: boolean;
  onNew: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel)]/75 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white shadow-lg shadow-[var(--accent)]/15">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {conversation?.title ?? "Chatter Intelligence"}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            {generatingImage
              ? "Generating image…"
              : generating
                ? "Thinking…"
                : "Your personal AI assistant"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <HeaderAction label="New conversation" onClick={onNew}>
          <Plus size={15} />
        </HeaderAction>
        {conversation && (
          <>
            <HeaderAction label="Rename conversation" onClick={onRename}>
              <Pencil size={14} />
            </HeaderAction>
            <HeaderAction label="Delete conversation" onClick={onDelete}>
              <Trash2 size={14} />
            </HeaderAction>
          </>
        )}
        <HeaderAction label="More options">
          <MoreHorizontal size={16} />
        </HeaderAction>
      </div>
    </header>
  );
}

function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.94 }}
      className="grid size-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      {children}
    </motion.button>
  );
}

function AIEmptyState({ onSuggestion }: { onSuggestion: (value: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-5 py-8"
    >
      <div className="mx-auto max-w-2xl text-center">
        <motion.div
          initial={{ rotate: -8, scale: 0.9 }}
          animate={{ rotate: 0, scale: 1 }}
          className="mx-auto grid size-14 place-items-center rounded-[20px] bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white shadow-xl shadow-[var(--accent)]/20"
        >
          <Sparkles size={24} />
        </motion.div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          Chatter Intelligence
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your personal AI assistant inside Chatter.
        </p>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[var(--muted)]">
          {capabilities.join(" · ")}
        </p>
      </div>
      <AISuggestionChips onSelect={onSuggestion} />
    </motion.div>
  );
}

function AISuggestionChips({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <div className="mx-auto mt-7 flex w-full max-w-3xl flex-wrap justify-center gap-2">
      {suggestions.map((suggestion) => (
        <motion.button
          key={suggestion}
          type="button"
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          onClick={() => onSelect(suggestion)}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)]/70 px-4 py-2.5 text-xs font-medium text-[var(--muted)] shadow-sm transition hover:border-[var(--accent)]/30 hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  );
}

const AIMessage = memo(function AIMessage({
  message,
  busy,
  onEdit,
  onRegenerate,
  onRetryImage,
}: {
  message: AIMessageModel;
  busy: boolean;
  onEdit: () => void;
  onRegenerate: () => void;
  onRetryImage: () => void;
}) {
  const user = message.role === "user";

  if (message.kind === "image" && !user) {
    return (
      <AIImageMessage
        message={message}
        busy={busy}
        onRegenerate={onRegenerate}
        onRetry={onRetryImage}
      />
    );
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cx("group mb-6 flex gap-3", user && "justify-end")}
    >
      {!user && (
        <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white">
          <Sparkles size={14} />
        </span>
      )}
      <div className={cx("min-w-0 max-w-[88%]", user && "flex flex-col items-end")}>
        <div
          className={cx(
            "text-sm leading-6",
            user
              ? "rounded-[20px] rounded-br-md bg-[var(--accent)] px-4 py-2.5 text-white shadow-md shadow-[var(--accent)]/10"
              : "w-full py-1 text-[var(--ink)]",
          )}
        >
          {user ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : message.content ? (
            <MarkdownContent content={message.content} />
          ) : (
            <AITypingIndicator compact />
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--muted-2)]">
          <span>{formatTime(message.createdAt)}</span>
          {message.status === "stopped" && <span>Stopped</span>}
          {user ? (
            <button
              type="button"
              onClick={onEdit}
              className="opacity-0 transition hover:text-[var(--ink)] group-hover:opacity-100 focus:opacity-100"
            >
              Edit
            </button>
          ) : (
            message.content && (
              <AIResponseActions
                content={message.content}
                streaming={message.status === "streaming"}
                onRegenerate={onRegenerate}
              />
            )
          )}
        </div>
      </div>
    </motion.article>
  );
});

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="ai-markdown min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          pre: ({ children }) => (
            <pre className="shell-scroll my-3 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[#0b101b] p-4 text-[12px] leading-5 text-slate-200">
              {children}
            </pre>
          ),
          code: ({ children, className }) => (
            <code
              className={cx(
                className,
                "rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[0.88em]",
              )}
            >
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="shell-scroll my-3 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[var(--border)] px-3 py-2">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AIResponseActions({
  content,
  streaming,
  onRegenerate,
}: {
  content: string;
  streaming: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
      <button
        type="button"
        aria-label="Copy response"
        onClick={() => {
          void navigator.clipboard.writeText(content);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
        className="grid size-6 place-items-center rounded-md transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {!streaming && (
        <button
          type="button"
          aria-label="Regenerate response"
          onClick={onRegenerate}
          className="grid size-6 place-items-center rounded-md transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <RefreshCw size={12} />
        </button>
      )}
    </span>
  );
}

function AITypingIndicator({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cx("flex items-center gap-3 py-3", !compact && "mb-6")}
    >
      {!compact && (
        <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-violet-500 text-white">
          <Sparkles size={14} />
        </span>
      )}
      <span className="flex items-center gap-1 rounded-xl bg-[var(--surface-2)] px-3 py-2">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            animate={{ y: [0, -3, 0], opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.14 }}
            className="size-1.5 rounded-full bg-[var(--accent)]"
          />
        ))}
      </span>
    </motion.div>
  );
}

function AIComposer({
  value,
  attachments,
  generating,
  editing,
  backendAvailable,
  onChange,
  onAttachments,
  onSend,
  onStop,
  onCancelEdit,
}: {
  value: string;
  attachments: AIConversationAttachment[];
  generating: boolean;
  editing: boolean;
  backendAvailable: boolean;
  onChange: (value: string) => void;
  onAttachments: (attachments: AIConversationAttachment[]) => void;
  onSend: () => void;
  onStop: () => void;
  onCancelEdit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valid = Boolean(value.trim()) && value.length <= MAX_CHARACTERS;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className="border-t border-[var(--border)] bg-[var(--panel)]/80 px-4 pb-4 pt-3 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl">
        {editing && (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-[11px] text-[var(--muted)]">
            <span className="flex items-center gap-2">
              <Pencil size={12} /> Editing your message
            </span>
            <button type="button" onClick={onCancelEdit} aria-label="Cancel edit">
              <X size={13} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <span
                key={`${attachment.name}-${index}`}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px]"
              >
                <File size={12} className="text-[var(--accent)]" />
                <span className="max-w-40 truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    onAttachments(attachments.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <motion.div
          layout
          className="rounded-[22px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl shadow-black/5 transition focus-within:border-[var(--accent)]/50 focus-within:shadow-[var(--accent)]/5"
        >
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            maxLength={MAX_CHARACTERS + 1}
            placeholder="Ask Chatter Intelligence anything…"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!generating) onSend();
              }
            }}
            className="max-h-[180px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-[var(--muted-2)] disabled:opacity-60"
            disabled={generating}
          />
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="flex items-center">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).map((file) => ({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    file,
                  }));
                  onAttachments([...attachments, ...files]);
                  event.target.value = "";
                }}
              />
              <motion.button
                type="button"
                aria-label="Attach files"
                title="Attach files"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.94 }}
                disabled={generating}
                onClick={() => fileRef.current?.click()}
                className="grid size-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Paperclip size={16} />
              </motion.button>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {generating ? (
                <motion.button
                  key="stop"
                  type="button"
                  aria-label="Stop generating"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  onClick={onStop}
                  className="grid size-10 place-items-center rounded-2xl bg-[var(--ink)] text-[var(--panel)]"
                >
                  <Square size={14} fill="currentColor" />
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  type="button"
                  aria-label="Send message"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  whileHover={valid ? { y: -1 } : undefined}
                  whileTap={valid ? { scale: 0.94 } : undefined}
                  disabled={!valid || generating}
                  onClick={onSend}
                  className="grid size-10 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/20 transition disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ArrowUp size={17} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-[var(--muted-2)]">
          {backendAvailable ? (
            "Chatter Intelligence can make mistakes. Check important information."
          ) : (
            <>
              <LoaderCircle size={10} /> Conversational backend connection pending
            </>
          )}
        </p>
      </div>
    </div>
  );
}
