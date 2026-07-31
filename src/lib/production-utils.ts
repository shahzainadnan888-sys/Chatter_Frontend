/** Escape user text before any HTML injection path. React text nodes are already safe. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function cycleTheme(
  current: "light" | "dark" | "system",
): "light" | "dark" | "system" {
  if (current === "light") return "dark";
  if (current === "dark") return "system";
  return "light";
}
