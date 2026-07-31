export type AIImagePhase = "idle" | "loading" | "success" | "error" | "timeout";

export interface AIImagePayload {
  phase: AIImagePhase;
  prompt: string;
  imageUrl?: string | null;
  error?: string | null;
}

export const IMAGE_GENERATION_TIMEOUT_MS = 60_000;
export const IMAGE_ASSET_LOAD_TIMEOUT_MS = 20_000;

export function resolveImagePhase(input: {
  status: string;
  imageUrl?: string | null;
  error?: string | null;
}): AIImagePhase {
  if (input.status === "timeout") return "timeout";
  if (input.status === "error") return "error";
  if (input.status === "generating" || input.status === "loading") return "loading";
  if (input.imageUrl) return "success";
  if (input.status === "complete" && !input.imageUrl) return "error";
  if (input.status === "stopped") return "error";
  return "idle";
}
