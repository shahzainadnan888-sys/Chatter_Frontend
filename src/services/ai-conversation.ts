export type AIConversationRole = "user" | "assistant";

export interface AIConversationInput {
  role: AIConversationRole;
  content: string;
}

export interface AIConversationAttachment {
  name: string;
  type: string;
  size: number;
  file: File;
}

export interface AIConversationRequest {
  conversationId: string;
  messages: AIConversationInput[];
  attachments: AIConversationAttachment[];
}

export interface AIConversationStreamOptions {
  signal: AbortSignal;
  onToken: (token: string) => void;
}

export interface AIConversationService {
  readonly available: boolean;
  stream(
    request: AIConversationRequest,
    options: AIConversationStreamOptions,
  ): Promise<void>;
}

const DEV_AI_PROXY_URL = "http://127.0.0.1:4317/v1/chat";

async function streamFromDevelopmentProxy(
  request: AIConversationRequest,
  options: AIConversationStreamOptions,
) {
  const response = await fetch(DEV_AI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: request.messages }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message ||
        "Chatter Intelligence could not connect to the local AI service.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emitted = false;

  function consumeLines(flush = false) {
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          emitted = true;
          options.onToken(token);
        }
      } catch {
        // Ignore one malformed provider event while allowing the stream to continue.
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    consumeLines();
  }
  buffer += decoder.decode();
  consumeLines(true);
  if (!emitted && !options.signal.aborted) {
    throw new Error("Groq returned an empty response.");
  }
}

export const aiConversationService: AIConversationService = {
  get available() {
    return (
      typeof window !== "undefined" &&
      (typeof window.chatter?.streamAIConversation === "function" ||
        process.env.NODE_ENV === "development")
    );
  },
  async stream(request, options) {
    if (request.attachments.length) {
      throw new Error("File attachments are not supported by Groq chat yet.");
    }

    const bridge = window.chatter;
    if (!bridge?.streamAIConversation) {
      if (process.env.NODE_ENV === "development") {
        await streamFromDevelopmentProxy(request, options);
        return;
      }
      throw new Error(
        "Chatter Intelligence is available in the configured desktop app.",
      );
    }

    const requestId = crypto.randomUUID();
    const cancel = () => bridge.cancelAIConversation(requestId);
    options.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await bridge.streamAIConversation(
        {
          requestId,
          conversationId: request.conversationId,
          messages: request.messages,
        },
        options.onToken,
      );
      if (!result.ok) {
        throw new Error(
          result.error?.message ||
            "Chatter Intelligence could not complete that response.",
        );
      }
    } finally {
      options.signal.removeEventListener("abort", cancel);
    }
  },
};
