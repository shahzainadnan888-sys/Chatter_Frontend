import type { ServerPermissionKey } from "@/src/types/servers";

export function hasServerPermission(
  permissions: string[] | null | undefined,
  key: ServerPermissionKey,
): boolean {
  if (!permissions?.length) return false;
  if (permissions.includes("administrator")) return true;
  return permissions.includes(key);
}

export function canManageChannels(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "manage_channels");
}

export function canManageServer(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "manage_server");
}

export function canSendMessages(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "send_messages");
}

export function canConnectVoice(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "connect_voice");
}

export function canCreateInvite(permissions: string[] | undefined) {
  return (
    hasServerPermission(permissions, "create_invite") ||
    hasServerPermission(permissions, "manage_invites")
  );
}

export function canManageRoles(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "manage_roles");
}

export function canKick(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "kick_members");
}

export function canDeleteMessages(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "delete_messages");
}

export function canPinMessages(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "pin_messages");
}

export function canUploadFiles(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "upload_files");
}

export function canMentionEveryone(permissions: string[] | undefined) {
  return hasServerPermission(permissions, "mention_everyone");
}

export function serverInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "S";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}
