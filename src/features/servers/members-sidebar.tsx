"use client";

import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { Input, cx } from "@/src/components/ui";
import { Avatar } from "@/src/features/shell/shell-ui";
import { resolveApiAssetUrl } from "@/src/lib/api-client";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import type { ServerMember, ServerRole, ServerSidebar } from "@/src/types/servers";

type MemberRow =
  | { kind: "header"; id: string; label: string }
  | { kind: "member"; id: string; member: ServerMember; color: string | null };

function memberLabel(member: ServerMember) {
  return member.nickname || member.user.display_name || member.user.username;
}

function roleName(roles: ServerRole[], roleId: string) {
  return roles.find((role) => role.id === roleId)?.name ?? null;
}

function highestRole(member: ServerMember, roles: ServerRole[]) {
  const ranked = roles
    .filter((role) => member.role_ids.includes(role.id))
    .sort((a, b) => b.position - a.position);
  return ranked[0] ?? null;
}

function presenceBucket(member: ServerMember) {
  if (member.status === "timeout" || member.status === "muted") return "idle";
  if (member.user.is_online) return "online";
  return "offline";
}

export function MembersSidebar({ sidebar }: { sidebar: ServerSidebar }) {
  const [q, setQ] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const members = useQuery({
    queryKey: SERVER_QUERY_KEYS.members(sidebar.server.id),
    queryFn: () => serversApi.listMembers(sidebar.server.id),
  });

  const rows = useMemo(() => {
    const list = (members.data ?? []).filter((member) => {
      if (member.status === "banned" || member.status === "left") return false;
      const label = memberLabel(member).toLowerCase();
      return !q.trim() || label.includes(q.trim().toLowerCase());
    });

    const ownerId = sidebar.server.owner_id;
    const roles = [...sidebar.roles].sort((a, b) => b.position - a.position);

    const buckets: Record<string, ServerMember[]> = {
      Owner: [],
      Admins: [],
      Moderators: [],
      Online: [],
      Idle: [],
      Offline: [],
    };

    for (const member of list) {
      const role = highestRole(member, roles);
      const name = role?.name?.toLowerCase() ?? "";
      if (member.user.id === ownerId) {
        buckets.Owner!.push(member);
      } else if (name.includes("admin") || member.permissions.includes("administrator")) {
        buckets.Admins!.push(member);
      } else if (name.includes("mod")) {
        buckets.Moderators!.push(member);
      } else {
        const presence = presenceBucket(member);
        if (presence === "online") buckets.Online!.push(member);
        else if (presence === "idle") buckets.Idle!.push(member);
        else buckets.Offline!.push(member);
      }
    }

    const next: MemberRow[] = [];
    for (const [label, group] of Object.entries(buckets)) {
      if (!group.length) continue;
      next.push({ kind: "header", id: `h-${label}`, label: `${label} — ${group.length}` });
      for (const member of group) {
        next.push({
          kind: "member",
          id: member.id,
          member,
          color: highestRole(member, roles)?.color ?? null,
        });
      }
    }
    return next;
  }, [members.data, q, sidebar.roles, sidebar.server.owner_id]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? 28 : 44),
    overscan: 16,
  });

  return (
    <aside className="flex h-full w-full flex-col bg-[color-mix(in_srgb,var(--surface)_40%,transparent)]">
      <div className="border-b border-[var(--border)] p-3">
        <Input
          label="Members"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search members"
        />
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {sidebar.online_count} online · {sidebar.server.member_count} members
        </p>
      </div>
      <div ref={parentRef} className="shell-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {members.isLoading && (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="h-9 animate-pulse rounded-lg bg-[var(--surface)]"
              />
            ))}
          </div>
        )}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const item = rows[row.index]!;
            return (
              <div
                key={item.id}
                ref={virtualizer.measureElement}
                data-index={row.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {item.kind === "header" ? (
                  <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                    {item.label}
                  </p>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface)]">
                    <div className="relative">
                      <Avatar
                        name={memberLabel(item.member)}
                        src={
                          item.member.user.avatar_url
                            ? resolveApiAssetUrl(item.member.user.avatar_url)
                            : null
                        }
                        size="sm"
                      />
                      <span
                        className={cx(
                          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--panel)]",
                          item.member.user.is_online
                            ? "bg-emerald-500"
                            : "bg-[var(--muted-2)]",
                        )}
                      />
                    </div>
                    <div className="min-w-0">
                      <p
                        className="truncate text-[13px] font-medium"
                        style={{ color: item.color || "var(--ink)" }}
                      >
                        {memberLabel(item.member)}
                      </p>
                      <p className="truncate text-[10px] text-[var(--muted)]">
                        {item.member.role_ids
                          .map((id) => roleName(sidebar.roles, id))
                          .filter(Boolean)
                          .slice(0, 2)
                          .join(" · ") || "Member"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
