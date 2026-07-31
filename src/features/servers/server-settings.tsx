"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, cx } from "@/src/components/ui";
import {
  canCreateInvite,
  canManageRoles,
  canManageServer,
  hasServerPermission,
} from "@/src/lib/server-permissions";
import { friendlyError } from "@/src/lib/shell-utils";
import { mediaApi } from "@/src/services/messaging-api";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useServerStore } from "@/src/stores/server-stores";
import { useNavigationStore } from "@/src/stores/shell-stores";
import type {
  ServerInviteType,
  ServerSettingsTab,
  ServerSidebar,
} from "@/src/types/servers";

const TABS: Array<{ id: ServerSettingsTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
  { id: "permissions", label: "Permissions" },
  { id: "channels", label: "Channels" },
  { id: "members", label: "Members" },
  { id: "invites", label: "Invites" },
  { id: "integrations", label: "Integrations" },
  { id: "audit", label: "Audit Logs" },
  { id: "moderation", label: "Moderation" },
  { id: "danger", label: "Danger Zone" },
];

export function ServerSettingsModal({ sidebar }: { sidebar: ServerSidebar }) {
  const open = useServerStore((state) => state.settingsOpen);
  const tab = useServerStore((state) => state.settingsTab);
  const setTab = useServerStore((state) => state.setSettingsTab);
  const close = useServerStore((state) => state.closeSettings);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, open]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[85] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Server settings"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className="flex h-[min(720px,90dvh)] w-full max-w-4xl overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <nav className="w-48 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="mb-2 truncate px-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              {sidebar.server.name}
            </p>
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cx(
                  "mb-0.5 w-full rounded-lg px-2.5 py-2 text-left text-[13px]",
                  tab === item.id
                    ? "bg-[var(--surface-2)] font-semibold text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--ink)]",
                  item.id === "danger" && "text-red-500",
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h2 className="text-base font-semibold">
                {TABS.find((item) => item.id === tab)?.label}
              </h2>
              <button
                type="button"
                aria-label="Close settings"
                onClick={close}
                className="grid size-8 place-items-center rounded-full hover:bg-[var(--surface)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="shell-scroll min-h-0 flex-1 overflow-y-auto p-5">
              {tab === "overview" && <OverviewTab sidebar={sidebar} />}
              {tab === "roles" && <RolesTab sidebar={sidebar} />}
              {tab === "permissions" && <PermissionsTab />}
              {tab === "channels" && <ChannelsTab sidebar={sidebar} />}
              {tab === "members" && <MembersTab sidebar={sidebar} />}
              {tab === "invites" && <InvitesTab sidebar={sidebar} />}
              {tab === "integrations" && (
                <EmptyNote text="Custom emoji management is available via the emoji endpoints. Bot integrations are not exposed yet." />
              )}
              {tab === "audit" && (
                <EmptyNote text="Audit log endpoints are not available in the current API." />
              )}
              {tab === "moderation" && <ModerationTab sidebar={sidebar} />}
              {tab === "danger" && <DangerTab sidebar={sidebar} />}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-[var(--muted)]">{text}</p>;
}

function OverviewTab({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(sidebar.server.name);
  const [description, setDescription] = useState(
    sidebar.server.description ?? "",
  );
  const canEdit = canManageServer(sidebar.my_permissions);

  const save = useMutation({
    mutationFn: async () => {
      return serversApi.update(sidebar.server.id, {
        name: name.trim(),
        description: description.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      await queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      toast.success("Server updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const uploadIcon = useMutation({
    mutationFn: async (file: File) => {
      const media = await mediaApi.uploadImage(file);
      return serversApi.update(sidebar.server.id, { icon_url: media.url });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      toast.success("Icon updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="max-w-lg space-y-4">
      <Input
        label="Server name"
        value={name}
        disabled={!canEdit}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="block">
        <span className="mb-2 block text-[13px] font-medium">Description</span>
        <textarea
          value={description}
          disabled={!canEdit}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          className="field w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none disabled:opacity-50"
        />
      </label>
      {canEdit && (
        <label className="block text-sm">
          <span className="mb-2 block font-medium">Server icon</span>
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadIcon.mutate(file);
            }}
          />
        </label>
      )}
      <p className="text-xs text-[var(--muted)]">
        Invite code: <code>{sidebar.server.invite_code}</code>
      </p>
      {canEdit && (
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="animate-spin" size={16} /> : "Save changes"}
        </Button>
      )}
    </div>
  );
}

function RolesTab({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const canEdit = canManageRoles(sidebar.my_permissions);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () =>
      serversApi.createRole(sidebar.server.id, {
        name: name.trim(),
        permissions: [],
      }),
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      toast.success("Role created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const remove = useMutation({
    mutationFn: (roleId: string) =>
      serversApi.deleteRole(sidebar.server.id, roleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
      });
      toast.success("Role deleted");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="space-y-4">
      {sidebar.roles
        .slice()
        .sort((a, b) => b.position - a.position)
        .map((role) => (
          <div
            key={role.id}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-3 rounded-full"
                style={{ background: role.color || "var(--muted)" }}
              />
              <div>
                <p className="text-sm font-semibold">{role.name}</p>
                <p className="text-[11px] text-[var(--muted)]">
                  {role.permissions.length} permissions
                </p>
              </div>
            </div>
            {canEdit && !role.is_default && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Delete role ${role.name}?`)) {
                    remove.mutate(role.id);
                  }
                }}
              >
                Delete
              </Button>
            )}
          </div>
        ))}
      {canEdit && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="New role"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </Button>
        </div>
      )}
    </div>
  );
}

function PermissionsTab() {
  const catalog = useQuery({
    queryKey: SERVER_QUERY_KEYS.permissions,
    queryFn: () => serversApi.permissions(),
  });
  return (
    <div className="space-y-2">
      {(catalog.data ?? []).map((item) => (
        <div
          key={item.key}
          className="rounded-xl border border-[var(--border)] px-3 py-2"
        >
          <p className="text-sm font-semibold text-[var(--ink)]">{item.name}</p>
          <p className="text-xs text-[var(--muted)]">{item.key}</p>
        </div>
      ))}
    </div>
  );
}

function ChannelsTab({ sidebar }: { sidebar: ServerSidebar }) {
  return (
    <div className="space-y-2">
      {sidebar.channels
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((channel) => (
          <div
            key={channel.id}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
          >
            <span>
              #{channel.name}{" "}
              <span className="text-[var(--muted)]">({channel.type})</span>
            </span>
            <span className="text-xs text-[var(--muted)]">
              pos {channel.position}
            </span>
          </div>
        ))}
    </div>
  );
}

function MembersTab({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: SERVER_QUERY_KEYS.members(sidebar.server.id),
    queryFn: () => serversApi.listMembers(sidebar.server.id),
  });
  const canKick = hasServerPermission(sidebar.my_permissions, "kick_members");
  const canBan = hasServerPermission(sidebar.my_permissions, "ban_members");

  const kick = useMutation({
    mutationFn: (userId: string) =>
      serversApi.kickMember(sidebar.server.id, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.members(sidebar.server.id),
      });
      toast.success("Member kicked");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const ban = useMutation({
    mutationFn: (userId: string) =>
      serversApi.banMember(sidebar.server.id, userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.members(sidebar.server.id),
      });
      toast.success("Member banned");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="space-y-2">
      {(members.data ?? []).map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2"
        >
          <div>
            <p className="text-sm font-semibold">
              {member.nickname ||
                member.user.display_name ||
                member.user.username}
            </p>
            <p className="text-xs text-[var(--muted)]">@{member.user.username}</p>
          </div>
          <div className="flex gap-1">
            {canKick && member.user.id !== sidebar.server.owner_id && (
              <Button
                variant="ghost"
                onClick={() => kick.mutate(member.user.id)}
              >
                Kick
              </Button>
            )}
            {canBan && member.user.id !== sidebar.server.owner_id && (
              <Button
                variant="ghost"
                onClick={() => ban.mutate(member.user.id)}
              >
                Ban
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function InvitesTab({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const canList = hasServerPermission(sidebar.my_permissions, "manage_invites");
  const canCreate = canCreateInvite(sidebar.my_permissions);
  const [inviteType, setInviteType] = useState<ServerInviteType>("permanent");

  const invites = useQuery({
    queryKey: SERVER_QUERY_KEYS.invites(sidebar.server.id),
    queryFn: () => serversApi.listInvites(sidebar.server.id),
    enabled: canList,
  });

  const create = useMutation({
    mutationFn: () =>
      serversApi.createInvite(sidebar.server.id, { invite_type: inviteType }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.invites(sidebar.server.id),
      });
      toast.success("Invite created");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      serversApi.revokeInvite(sidebar.server.id, inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SERVER_QUERY_KEYS.invites(sidebar.server.id),
      });
      toast.success("Invite revoked");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (!canList && !canCreate) {
    return <EmptyNote text="You don’t have permission to manage invites." />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Default invite: <code>{sidebar.server.invite_code}</code>
      </p>
      {canCreate && (
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium">Invite type</span>
            <select
              value={inviteType}
              onChange={(event) =>
                setInviteType(event.target.value as ServerInviteType)
              }
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <option value="permanent">Permanent</option>
              <option value="expiring">Expiring</option>
              <option value="limited_use">Limited use</option>
            </select>
          </label>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Create invite
          </Button>
        </div>
      )}
      {(invites.data ?? []).map((invite) => (
        <div
          key={invite.id}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
        >
          <div>
            <p className="font-semibold">{invite.code}</p>
            <p className="text-xs text-[var(--muted)]">
              {invite.invite_type} · {invite.uses}
              {invite.max_uses ? `/${invite.max_uses}` : ""} uses
            </p>
          </div>
          {canList && (
            <Button variant="ghost" onClick={() => revoke.mutate(invite.id)}>
              Revoke
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function ModerationTab({ sidebar }: { sidebar: ServerSidebar }) {
  return (
    <EmptyNote
      text={`Use Members to kick or ban. Mute and timeout require mute_members / timeout_members. Your permissions: ${sidebar.my_permissions.join(", ") || "none"}.`}
    />
  );
}

function DangerTab({ sidebar }: { sidebar: ServerSidebar }) {
  const queryClient = useQueryClient();
  const selectServer = useServerStore((state) => state.selectServer);
  const closeSettings = useServerStore((state) => state.closeSettings);
  const setPage = useNavigationStore((state) => state.setPage);
  const isOwner = sidebar.server.owner_id; // compared via leave/delete UX below

  const leave = useMutation({
    mutationFn: () => serversApi.leave(sidebar.server.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      selectServer(null);
      closeSettings();
      setPage("home");
      toast.success("Left server");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const remove = useMutation({
    mutationFn: () => serversApi.remove(sidebar.server.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      selectServer(null);
      closeSettings();
      setPage("home");
      toast.success("Server deleted");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  void isOwner;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
        <h3 className="font-semibold text-red-600">Leave server</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Owners cannot leave. Transfer ownership is not available in the API.
        </p>
        <Button
          className="mt-3"
          variant="ghost"
          disabled={leave.isPending}
          onClick={() => leave.mutate()}
        >
          Leave server
        </Button>
      </div>
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
        <h3 className="font-semibold text-red-600">Delete server</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Permanently deletes the server. Owner only.
        </p>
        <Button
          className="mt-3"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Delete this server permanently? This cannot be undone.",
              )
            ) {
              remove.mutate();
            }
          }}
        >
          Delete server
        </Button>
      </div>
    </div>
  );
}
