"use client";

import { AIConversation } from "@/src/features/ai/ai-conversation";

export function AiAssistantPage() {
  return (
    <div className="h-full min-h-0 overflow-hidden bg-[var(--panel)]">
      <AIConversation />
    </div>
  );
}
