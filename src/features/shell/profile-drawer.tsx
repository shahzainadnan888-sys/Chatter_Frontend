"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  Flag,
  MessageSquarePlus,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/src/components/ui";
import { Avatar, SoftBadge } from "@/src/features/shell/shell-ui";
import { friendlyError, formatJoinDate } from "@/src/lib/shell-utils";
import { chatsApi, friendsApi, usersApi } from "@/src/services/shell-api";
import { useAuthStore } from "@/src/stores/app-stores";
import {
  useChatStore,
  useNavigationStore,
  useProfileStore,
} from "@/src/stores/shell-stores";

export function ProfileDrawer() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const { open, username, profile, user, closeProfile, setProfileData } =
    useProfileStore();
  const selectChat = useNavigationStore((state) => state.selectChat);
  const setPage = useNavigationStore((state) => state.setPage);
  const cacheDetail = useChatStore((state) => state.cacheDetail);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDescription, setReportDescription] = useState("");

  const detail = useQuery({
    queryKey: ["profile-drawer", username],
    enabled: open && Boolean(username),
    queryFn: async () => {
      if (!username) throw new Error("Missing username");
      const [nextUser, nextProfile] = await Promise.all([
        usersApi.byUsername(username),
        usersApi.profile(username),
      ]);
      return { user: nextUser, profile: nextProfile };
    },
  });

  const friends = useQuery({
    queryKey: ["friends-all"],
    enabled: open,
    queryFn: () => friendsApi.list(1, 100),
  });
  const outgoing = useQuery({
    queryKey: ["friend-requests-out"],
    enabled: open,
    queryFn: () => friendsApi.requests(false, 1, 100),
  });
  const incoming = useQuery({
    queryKey: ["friend-requests-in"],
    enabled: open,
    queryFn: () => friendsApi.requests(true, 1, 100),
  });

  useEffect(() => {
    if (detail.data) setProfileData(detail.data.profile, detail.data.user);
  }, [detail.data, setProfileData]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeProfile();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeProfile, open]);

  const isSelf = currentUser?.username === username;
  const isFriend = Boolean(
    user && friends.data?.data.some((friend) => friend.id === user.id),
  );
  const outgoingRequest = user
    ? outgoing.data?.data.find((request) => request.to_user_id === user.id)
    : undefined;
  const incomingRequest = user
    ? incoming.data?.data.find((request) => request.from_user_id === user.id)
    : undefined;

  const invalidateSocial = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["friends"] }),
      queryClient.invalidateQueries({ queryKey: ["friends-all"] }),
      queryClient.invalidateQueries({ queryKey: ["friend-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["friend-requests-in"] }),
      queryClient.invalidateQueries({ queryKey: ["friend-requests-out"] }),
      queryClient.invalidateQueries({ queryKey: ["blocked"] }),
    ]);
  };

  const sendRequest = useMutation({
    mutationFn: () => friendsApi.send(user!.id),
    onSuccess: async () => {
      toast.success("Friend request sent");
      await invalidateSocial();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const acceptRequest = useMutation({
    mutationFn: () => friendsApi.accept(user!.id),
    onSuccess: async () => {
      toast.success("Friend request accepted");
      await invalidateSocial();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const rejectRequest = useMutation({
    mutationFn: () => friendsApi.reject(user!.id),
    onSuccess: async () => {
      toast.success("Request updated");
      await invalidateSocial();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const removeFriend = useMutation({
    mutationFn: () => friendsApi.remove(user!.id),
    onSuccess: async () => {
      toast.success("Friend removed");
      await invalidateSocial();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const blockUser = useMutation({
    mutationFn: () => friendsApi.block(user!.id),
    onSuccess: async () => {
      toast.success("User blocked");
      await invalidateSocial();
      closeProfile();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const reportUser = useMutation({
    mutationFn: () =>
      friendsApi.report({
        user_id: user!.id,
        reason: reportReason,
        description: reportDescription || null,
      }),
    onSuccess: () => {
      toast.success("Report submitted");
      setReportOpen(false);
      setReportDescription("");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const startChat = useMutation({
    mutationFn: () =>
      chatsApi.create({ participant_username: username! }),
    onSuccess: async (chat) => {
      cacheDetail(chat);
      selectChat(chat.id);
      setPage("chats");
      closeProfile();
      await queryClient.invalidateQueries({ queryKey: ["chats"] });
      toast.success("Conversation ready");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close profile"
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeProfile}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="User profile"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] shadow-[-24px_0_60px_rgba(0,0,0,0.12)] backdrop-blur-xl"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 28, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="relative h-36 overflow-hidden bg-[var(--surface-2)]">
              {profile?.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.cover_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_55%),linear-gradient(180deg,var(--surface-2),var(--panel))]" />
              )}
              <button
                type="button"
                onClick={closeProfile}
                className="absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)]/90 text-[var(--muted)] shadow-sm transition hover:text-[var(--ink)]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 pb-6">
              <div className="-mt-10 flex items-end justify-between gap-3">
                <Avatar
                  name={profile?.display_name || username}
                  src={profile?.avatar_url || user?.avatar_url}
                  online={user?.is_online}
                  size="xl"
                />
                {user?.is_online ? (
                  <SoftBadge tone="success">Online</SoftBadge>
                ) : (
                  <SoftBadge>Offline</SoftBadge>
                )}
              </div>

              {detail.isLoading ? (
                <div className="mt-5 space-y-3 animate-pulse">
                  <div className="h-6 w-40 rounded bg-[var(--surface-2)]" />
                  <div className="h-4 w-28 rounded bg-[var(--surface-2)]" />
                  <div className="h-16 w-full rounded-2xl bg-[var(--surface-2)]" />
                </div>
              ) : detail.isError ? (
                <p className="mt-5 text-sm text-red-600">
                  {friendlyError(detail.error)}
                </p>
              ) : (
                <>
                  <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
                    {profile?.display_name || `@${username}`}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">@{username}</p>
                  {profile?.status_message && (
                    <p className="mt-3 rounded-2xl bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]">
                      {profile.status_message}
                    </p>
                  )}
                  <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                    {profile?.bio || "No bio yet."}
                  </p>
                  <p className="mt-4 text-xs text-[var(--muted)]">
                    Joined {formatJoinDate(profile?.created_at || user?.created_at)}
                  </p>
                </>
              )}

              {!isSelf && user && (
                <div className="mt-6 grid gap-2">
                  <Button
                    className="w-full"
                    loading={startChat.isPending}
                    onClick={() => startChat.mutate()}
                  >
                    <MessageSquarePlus size={16} /> Message
                  </Button>
                  {incomingRequest ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        loading={acceptRequest.isPending}
                        onClick={() => acceptRequest.mutate()}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        loading={rejectRequest.isPending}
                        onClick={() => rejectRequest.mutate()}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : outgoingRequest ? (
                    <Button
                      variant="secondary"
                      loading={rejectRequest.isPending}
                      onClick={() => rejectRequest.mutate()}
                    >
                      Cancel request
                    </Button>
                  ) : isFriend ? (
                    <Button
                      variant="secondary"
                      loading={removeFriend.isPending}
                      onClick={() => removeFriend.mutate()}
                    >
                      <UserMinus size={16} /> Remove friend
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      loading={sendRequest.isPending}
                      onClick={() => sendRequest.mutate()}
                    >
                      <UserPlus size={16} /> Send friend request
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="ghost"
                      loading={blockUser.isPending}
                      onClick={() => blockUser.mutate()}
                    >
                      <Ban size={15} /> Block
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setReportOpen((value) => !value)}
                    >
                      <Flag size={15} /> Report
                    </Button>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {reportOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4"
                  >
                    <label className="block text-xs font-medium">Reason</label>
                    <select
                      className="mt-2 h-10 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none"
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value)}
                    >
                      <option value="spam">Spam</option>
                      <option value="harassment">Harassment</option>
                      <option value="impersonation">Impersonation</option>
                      <option value="other">Other</option>
                    </select>
                    <label className="mt-3 block text-xs font-medium">
                      Details
                    </label>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none"
                      value={reportDescription}
                      onChange={(event) =>
                        setReportDescription(event.target.value)
                      }
                      placeholder="Optional context"
                    />
                    <Button
                      className="mt-3 w-full"
                      loading={reportUser.isPending}
                      onClick={() => reportUser.mutate()}
                    >
                      Submit report
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-8 space-y-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Shared groups
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Shared group details will appear here when available from
                    membership data.
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Mutual friends
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Mutual friends aren&apos;t exposed by a dedicated endpoint
                    yet.
                  </p>
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
