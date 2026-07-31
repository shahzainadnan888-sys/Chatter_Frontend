export type StatusDayBucket = "today" | "yesterday" | "older";

export function formatStatusRemaining(
  expiresAt: string,
  now = Date.now(),
): string {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  if (remainingMs <= 0) return "Expired";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}m left`;
  }
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    return `${hours}h left`;
  }
  return `${Math.ceil(hours / 24)}d left`;
}

export function getStatusDayBucket(
  iso: string,
  now = new Date(),
): StatusDayBucket {
  const date = new Date(iso);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  if (date >= startToday) return "today";
  if (date >= startYesterday) return "yesterday";
  return "older";
}

export function statusDayBucketLabel(bucket: StatusDayBucket): string {
  switch (bucket) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    default:
      return "Older";
  }
}
