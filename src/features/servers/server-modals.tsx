"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "@/src/components/ui";
import { ApiError, resolveApiAssetUrl } from "@/src/lib/api-client";
import { serverInitials } from "@/src/lib/server-permissions";
import { mediaApi } from "@/src/services/messaging-api";
import { SERVER_QUERY_KEYS, serversApi } from "@/src/services/servers-api";
import { useServerStore } from "@/src/stores/server-stores";
import { useNavigationStore } from "@/src/stores/shell-stores";

export function ServerModals() {
  const createOpen = useServerStore((state) => state.createOpen);
  const joinOpen = useServerStore((state) => state.joinOpen);
  const closeCreate = useServerStore((state) => state.closeCreate);
  const closeJoin = useServerStore((state) => state.closeJoin);

  return (
    <>
      <AnimatePresence>
        {createOpen && <CreateServerModal onClose={closeCreate} />}
      </AnimatePresence>
      <AnimatePresence>
        {joinOpen && <JoinServerModal onClose={closeJoin} />}
      </AnimatePresence>
    </>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="w-full max-w-md overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

function CreateServerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const selectServer = useServerStore((state) => state.selectServer);
  const applySidebarDefaults = useServerStore(
    (state) => state.applySidebarDefaults,
  );
  const setPage = useNavigationStore((state) => state.setPage);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!iconFile) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(iconFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [iconFile]);

  const create = useMutation({
    mutationFn: async () => {
      let icon_url: string | undefined;
      if (iconFile) {
        const media = await mediaApi.uploadImage(iconFile);
        icon_url = media.url;
      }
      return serversApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        icon_url,
      });
    },
    onSuccess: async (sidebar) => {
      await queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      queryClient.setQueryData(
        SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
        sidebar,
      );
      selectServer(sidebar.server.id);
      applySidebarDefaults(sidebar);
      setPage("servers");
      onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.message : "Could not create server.",
      );
    },
  });

  const valid = name.trim().length >= 2 && name.trim().length <= 100;

  return (
    <ModalShell title="Create a Server" onClose={onClose}>
      <div className="space-y-4">
        <label className="mx-auto flex size-20 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--muted)] hover:border-[var(--accent)]">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            "Icon"
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => setIconFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <Input
          label="Server name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My community"
          maxLength={100}
          autoFocus
        />
        <label className="block">
          <span className="mb-2 block text-[13px] font-medium">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this server about?"
            rows={3}
            className="field w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]"
          />
        </label>
        <p className="text-xs text-[var(--muted)]">
          A permanent invite is created automatically for your server.
        </p>

        {error && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "Create"
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

function JoinServerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const selectServer = useServerStore((state) => state.selectServer);
  const applySidebarDefaults = useServerStore(
    (state) => state.applySidebarDefaults,
  );
  const setPage = useNavigationStore((state) => state.setPage);
  const [code, setCode] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(code.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [code]);

  const preview = useQuery({
    queryKey: SERVER_QUERY_KEYS.invitePreview(debounced),
    queryFn: () => serversApi.previewInvite(debounced),
    enabled: debounced.length >= 4,
    retry: false,
  });

  const join = useMutation({
    mutationFn: () => serversApi.join(code.trim()),
    onSuccess: async (sidebar) => {
      await queryClient.invalidateQueries({ queryKey: SERVER_QUERY_KEYS.list });
      queryClient.setQueryData(
        SERVER_QUERY_KEYS.sidebar(sidebar.server.id),
        sidebar,
      );
      selectServer(sidebar.server.id);
      applySidebarDefaults(sidebar);
      setPage("servers");
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError("You already joined this server.");
          return;
        }
        if (err.status === 404) {
          setError("Invalid invite code.");
          return;
        }
        if (err.status === 410) {
          setError("This invite has expired.");
          return;
        }
        setError(err.message);
        return;
      }
      setError("Could not join server.");
    },
  });

  const server = preview.data?.server;
  const icon = server?.icon_url ? resolveApiAssetUrl(server.icon_url) : null;

  return (
    <ModalShell title="Join a Server" onClose={onClose}>
      <div className="space-y-4">
        <Input
          label="Invite code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setError(null);
          }}
          placeholder="Paste invite code"
          autoFocus
        />

        {preview.isFetching && (
          <p className="text-sm text-[var(--muted)]">Looking up invite…</p>
        )}

        {preview.isError && debounced && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {preview.error instanceof ApiError && preview.error.status === 410
              ? "This invite has expired."
              : "Invalid invite code."}
          </p>
        )}

        {server && (
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="grid size-12 place-items-center overflow-hidden rounded-2xl bg-[var(--surface-2)] text-sm font-bold">
              {icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" className="size-full object-cover" />
              ) : (
                serverInitials(server.name)
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--ink)]">
                {server.name}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {preview.data?.member_count ?? server.member_count} members
                {server.description ? ` · ${server.description}` : ""}
              </p>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={code.trim().length < 4 || join.isPending}
            onClick={() => {
              setError(null);
              join.mutate();
            }}
          >
            {join.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "Join Server"
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
