"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  Bell,
  Camera,
  Check,
  ChevronRight,
  CircleUserRound,
  Download,
  Eye,
  FileImage,
  Globe2,
  HardDrive,
  Info,
  KeyRound,
  Languages,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Save,
  Shield,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserRound,
  Users,
  Volume2,
} from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, cx } from "@/src/components/ui";
import { Avatar, PanelHeader, SoftBadge } from "@/src/features/shell/shell-ui";
import { forceSignOut } from "@/src/lib/session";
import { formatJoinDate, friendlyError } from "@/src/lib/shell-utils";
import {
  getLocalPreferences,
  setLocalPreferences,
} from "@/src/lib/api-client";
import {
  queryBrowserPermission,
  requestDevicePermission,
  requestNotificationPermission,
} from "@/src/lib/permissions";
import { mediaApi } from "@/src/services/messaging-api";
import {
  profileApi,
  prompt4SettingsApi,
} from "@/src/services/prompt4-api";
import { friendsApi, groupsApi, usersApi } from "@/src/services/shell-api";
import {
  useAuthStore,
  useSettingsStore,
  useThemeStore,
  useUserStore,
} from "@/src/stores/app-stores";
import {
  useFeatureSettingsStore,
  usePermissionStore,
  useProfileEditorStore,
} from "@/src/stores/feature-stores";
import type {
  LocalPreferences,
  Settings,
  ThemePreference,
} from "@/src/types/api";

const SECTIONS = [
  { id: "general", label: "General & language", icon: Globe2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "privacy", label: "Privacy", icon: LockKeyhole },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "media", label: "Devices & media", icon: HardDrive },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "about", label: "Advanced", icon: Info },
] as const;

const ACCENTS: Array<{
  id: LocalPreferences["accent"];
  label: string;
  color: string;
}> = [
  { id: "purple", label: "Purple", color: "#7656c9" },
  { id: "blue", label: "Blue", color: "#3b6fc4" },
  { id: "emerald", label: "Green", color: "#258568" },
  { id: "orange", label: "Orange", color: "#c56b2d" },
  { id: "red", label: "Red", color: "#c34848" },
  { id: "pink", label: "Pink", color: "#c44e87" },
  { id: "teal", label: "Teal", color: "#16858a" },
];

export function SettingsPage() {
  const active = useFeatureSettingsStore((state) => state.activeSection);
  const setActive = useFeatureSettingsStore((state) => state.setActiveSection);
  const setServer = useFeatureSettingsStore((state) => state.setServer);
  const setLocal = useFeatureSettingsStore((state) => state.setLocal);
  const settingsStore = useSettingsStore((state) => state.setSettings);
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: prompt4SettingsApi.get,
  });
  const local = useQuery({
    queryKey: ["local-preferences"],
    queryFn: getLocalPreferences,
  });

  useEffect(() => {
    if (settings.data) {
      setServer(settings.data);
      settingsStore(settings.data);
    }
  }, [settings.data, setServer, settingsStore]);

  useEffect(() => {
    if (local.data) setLocal(local.data);
  }, [local.data, setLocal]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Settings"
        description="Manage your Chatter desktop experience."
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_1fr]">
        <nav className="flex min-h-0 gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--panel)]/80 p-3 backdrop-blur-xl lg:block lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActive(section.id)}
                className={cx(
                  "flex w-auto shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition lg:mb-1 lg:w-full lg:gap-3",
                  active === section.id
                    ? "bg-[var(--accent)] font-semibold text-white shadow-lg shadow-black/10"
                    : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                )}
              >
                <Icon size={16} />
                {section.label}
                <ChevronRight
                  size={13}
                  className="ml-auto hidden opacity-50 lg:block"
                />
              </button>
            );
          })}
        </nav>
        <div className="min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,var(--accent-soft),transparent_34%)] p-4 sm:p-6">
          {settings.isLoading || local.isLoading ? (
            <SettingsSkeleton />
          ) : settings.isError ? (
            <ErrorCard error={settings.error} retry={() => void settings.refetch()} />
          ) : settings.data && local.data ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
              >
                <SettingsSection
                  section={active}
                  settings={settings.data}
                  local={local.data}
                />
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  section,
  settings,
  local,
}: {
  section: (typeof SECTIONS)[number]["id"];
  settings: Settings;
  local: LocalPreferences;
}) {
  if (section === "appearance") {
    return <AppearanceSettings settings={settings} local={local} />;
  }
  if (section === "privacy") return <PrivacySettings settings={settings} />;
  if (section === "notifications") {
    return <NotificationSettings settings={settings} local={local} />;
  }
  if (section === "security") return <SecuritySettings settings={settings} />;
  if (section === "media") return <MediaSettings settings={settings} />;
  if (section === "accessibility") return <AccessibilitySettings local={local} />;
  if (section === "about") return <AboutSettings />;
  return <GeneralSettings settings={settings} />;
}

function GeneralSettings({ settings }: { settings: Settings }) {
  const mutate = useSettingsMutation();
  return (
    <SettingsGroup title="General" description="Language and desktop behavior.">
      <SelectRow
        icon={Languages}
        title="Language"
        description="Choose the language used by Chatter."
        value={settings.language}
        onChange={(language) => mutate.mutate({ language })}
        options={[
          ["en", "English"],
          ["es", "Español"],
          ["fr", "Français"],
          ["de", "Deutsch"],
        ]}
      />
      <ToggleRow
        icon={Download}
        title="Launch behavior"
        description="Keep Chatter ready in the background."
        checked={Boolean(settings.extra?.launch_in_background)}
        onChange={(value) =>
          mutate.mutate({
            extra: { ...settings.extra, launch_in_background: value },
          })
        }
      />
    </SettingsGroup>
  );
}

function AppearanceSettings({
  settings,
  local,
}: {
  settings: Settings;
  local: LocalPreferences;
}) {
  const queryClient = useQueryClient();
  const setTheme = useThemeStore((state) => state.setTheme);
  const setAccent = useThemeStore((state) => state.setAccent);
  const [previewTheme, setPreviewTheme] = useState<ThemePreference>(
    (settings.theme as ThemePreference) || "system",
  );
  const [previewAccent, setPreviewAccent] = useState(local.accent);
  const wallpaperRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      const updated = await prompt4SettingsApi.theme({ theme: previewTheme });
      // Accent is desktop-local only per API.md — do not write into settings.extra.
      await setLocalPreferences({ accent: previewAccent });
      return updated;
    },
    onSuccess: async () => {
      setTheme(previewTheme);
      setAccent(previewAccent);
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["local-preferences"] });
      toast.success("Appearance updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const wallpaper = useMutation({
    mutationFn: async (file: File) => {
      const media = await mediaApi.uploadImage(file);
      await setLocalPreferences({ wallpaper_url: media.url });
      return media.url;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["local-preferences"] });
      toast.success("Wallpaper uploaded");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <SettingsGroup
      title="Appearance"
      description="Preview themes and accents before applying."
      action={
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          <Save size={15} /> Apply
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-3 p-4">
        {(["light", "dark", "system"] as ThemePreference[]).map((theme) => {
          const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
          return (
            <button
              key={theme}
              type="button"
              onClick={() => {
                setPreviewTheme(theme);
                setTheme(theme);
              }}
              className={cx(
                "rounded-2xl border p-4 text-left transition",
                previewTheme === theme
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
              )}
            >
              <Icon size={18} />
              <span className="mt-3 block text-sm font-semibold capitalize">{theme}</span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-[var(--border)] p-4">
        <p className="text-sm font-semibold">Accent color</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {ACCENTS.map((accent) => (
            <button
              key={accent.id}
              type="button"
              aria-label={accent.label}
              onClick={() => {
                setPreviewAccent(accent.id);
                setAccent(accent.id);
              }}
              className={cx(
                "grid size-10 place-items-center rounded-full border-2 transition",
                previewAccent === accent.id
                  ? "border-[var(--ink)]"
                  : "border-transparent",
              )}
            >
              <span
                className="grid size-7 place-items-center rounded-full text-white"
                style={{ backgroundColor: accent.color }}
              >
                {previewAccent === accent.id && <Check size={14} />}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-[var(--border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Custom wallpaper</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Upload an image to Cloudinary through Chatter’s media API.
            </p>
          </div>
          <Button variant="secondary" onClick={() => wallpaperRef.current?.click()}>
            <Upload size={15} /> Upload
          </Button>
        </div>
        {(local.wallpaper_url) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={String(local.wallpaper_url)}
            alt="Wallpaper preview"
            className="mt-4 h-32 w-full rounded-2xl object-cover"
          />
        )}
        <input
          ref={wallpaperRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) wallpaper.mutate(file);
          }}
        />
      </div>
    </SettingsGroup>
  );
}

function PrivacySettings({ settings }: { settings: Settings }) {
  const mutate = useSpecialSettingsMutation("privacy");
  return (
    <SettingsGroup title="Privacy" description="Control who can see and contact you.">
      <ToggleRow
        icon={Eye}
        title="Read receipts"
        description="Let people know when you have read messages."
        checked={settings.show_read_receipts}
        onChange={(show_read_receipts) => mutate.mutate({ show_read_receipts })}
      />
      <ToggleRow
        icon={CircleUserRound}
        title="Online status"
        description="Show when you are online."
        checked={settings.show_online_status}
        onChange={(show_online_status) => mutate.mutate({ show_online_status })}
      />
      <ToggleRow
        icon={Globe2}
        title="Last seen"
        description="Show when you last used Chatter."
        checked={settings.show_last_seen}
        onChange={(show_last_seen) => mutate.mutate({ show_last_seen })}
      />
      <SelectRow
        icon={Users}
        title="Who can message me"
        description="Limit new conversations."
        value={settings.who_can_message}
        onChange={(who_can_message) => mutate.mutate({ who_can_message })}
        options={[
          ["everyone", "Everyone"],
          ["friends", "Friends"],
          ["nobody", "Nobody"],
        ]}
      />
      <SelectRow
        icon={Users}
        title="Who can add me"
        description="Limit group invitations."
        value={settings.who_can_add_to_groups}
        onChange={(who_can_add_to_groups) =>
          mutate.mutate({ who_can_add_to_groups })
        }
        options={[
          ["everyone", "Everyone"],
          ["friends", "Friends"],
          ["nobody", "Nobody"],
        ]}
      />
      <BlockedUsers />
    </SettingsGroup>
  );
}

function NotificationSettings({
  settings,
  local,
}: {
  settings: Settings;
  local: LocalPreferences;
}) {
  const mutate = useSpecialSettingsMutation("notifications");
  const queryClient = useQueryClient();
  const notificationPermission = usePermissionStore(
    (state) => state.states.notifications,
  );
  const setPermissionState = usePermissionStore((state) => state.setState);
  useEffect(() => {
    void queryBrowserPermission("notifications").then((state) =>
      setPermissionState("notifications", state),
    );
  }, [setPermissionState]);

  async function desktop(value: boolean) {
    if (value) {
      const result = await requestNotificationPermission();
      setPermissionState(
        "notifications",
        result === "default" ? "prompt" : result,
      );
      if (result !== "granted") {
        toast.error("Desktop notifications are blocked.", {
          description:
            "Use the site controls beside the address bar to allow notifications.",
        });
        return;
      }
    }
    mutate.mutate({ notifications_enabled: value });
  }
  return (
    <SettingsGroup
      title="Notifications"
      description="Choose which events can interrupt you."
    >
      <ToggleRow icon={Bell} title="Desktop notifications" description="Show native desktop alerts." checked={settings.notifications_enabled && notificationPermission === "granted"} onChange={(value) => void desktop(value)} />
      <ToggleRow icon={UserRound} title="Friend requests" description="Notify when someone sends a request." checked={local.friend_request_notifications} onChange={(value) => void setLocalPreferences({ friend_request_notifications: value }).then(() => queryClient.invalidateQueries({ queryKey: ["local-preferences"] }))} />
      <ToggleRow icon={Bell} title="Messages" description="New direct messages." checked={settings.message_notifications} onChange={(message_notifications) => mutate.mutate({ message_notifications })} />
      <ToggleRow icon={CircleUserRound} title="Mentions" description="Mentions and replies." checked={settings.mention_notifications} onChange={(mention_notifications) => mutate.mutate({ mention_notifications })} />
      <ToggleRow icon={Smartphone} title="Calls" description="Incoming and missed calls." checked={settings.call_notifications} onChange={(call_notifications) => mutate.mutate({ call_notifications })} />
      <ToggleRow icon={Users} title="Groups" description="Group updates and invites." checked={settings.group_notifications} onChange={(group_notifications) => mutate.mutate({ group_notifications })} />
      <ToggleRow icon={Volume2} title="Sound effects" description="Play notification sounds." checked={settings.notification_sound} onChange={(notification_sound) => mutate.mutate({ notification_sound })} />
      <SelectRow
        icon={Bell}
        title="Popup duration"
        description="How long desktop banners remain."
        value={String(local.popup_duration || 5)}
        onChange={(value) => void setLocalPreferences({ popup_duration: Number(value) })}
        options={[
          ["3", "3 seconds"],
          ["5", "5 seconds"],
          ["8", "8 seconds"],
        ]}
      />
    </SettingsGroup>
  );
}

function SecuritySettings({ settings }: { settings: Settings }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutate = useSpecialSettingsMutation("security");
  const password = useForm<{ current: string; next: string; confirm: string }>();
  const change = useMutation({
    mutationFn: async (values: { current: string; next: string; confirm: string }) => {
      if (values.next !== values.confirm) throw new Error("Passwords do not match.");
      return profileApi.changePassword(values.current, values.next);
    },
    onSuccess: async () => {
      password.reset();
      toast.success("Password changed. Please sign in again.");
      await forceSignOut(queryClient);
      navigate("/login", { replace: true });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return (
    <div className="space-y-4">
      <SettingsGroup title="Security" description="Protect your account and sign-ins.">
        <ToggleRow icon={Shield} title="Login alerts" description="Alert you about new sign-ins." checked={settings.login_alerts} onChange={(login_alerts) => mutate.mutate({ login_alerts })} />
        <ToggleRow icon={KeyRound} title="Two-factor authentication" description="Backend preference placeholder; enrollment is not exposed by the API." checked={settings.two_factor_enabled} onChange={(two_factor_enabled) => mutate.mutate({ two_factor_enabled })} />
      </SettingsGroup>
      <SettingsGroup title="Change password" description="Use at least eight characters with upper, lower, and a digit. All sessions will be signed out.">
        <form className="space-y-3 p-4" onSubmit={password.handleSubmit((values) => change.mutate(values))}>
          <Field type="password" placeholder="Current password" {...password.register("current", { required: true })} />
          <Field type="password" placeholder="New password" {...password.register("next", { required: true, minLength: 8 })} />
          <Field type="password" placeholder="Confirm password" {...password.register("confirm", { required: true })} />
          <Button type="submit" disabled={change.isPending}>Change password</Button>
        </form>
      </SettingsGroup>
      <SettingsGroup title="Active devices" description="Session inventory is not exposed by API.md.">
        <div className="flex items-center gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-2)]"><Monitor size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">This device</span>
            <span className="block text-xs text-[var(--muted)]">Current encrypted Electron session</span>
          </span>
          <SoftBadge>Active</SoftBadge>
        </div>
        <p className="border-t border-[var(--border)] p-4 text-xs leading-5 text-[var(--muted)]">
          Changing your password revokes backend refresh tokens. A dedicated session list/logout-other-devices endpoint is not documented.
        </p>
      </SettingsGroup>
    </div>
  );
}

function MediaSettings({ settings }: { settings: Settings }) {
  const mutate = useSettingsMutation();
  const permissionStates = usePermissionStore((state) => state.states);
  const setPermissionState = usePermissionStore((state) => state.setState);
  const setPermissionPending = usePermissionStore((state) => state.setPending);

  useEffect(() => {
    void Promise.all([
      queryBrowserPermission("microphone"),
      queryBrowserPermission("camera"),
    ]).then(([microphone, camera]) => {
      setPermissionState("microphone", microphone);
      setPermissionState("camera", camera);
    });
  }, [setPermissionState]);

  async function requestAccess(name: "microphone" | "camera") {
    if (permissionStates[name] === "granted") {
      toast.info(`${name === "camera" ? "Camera" : "Microphone"} access is enabled.`, {
        description:
          "Use the site controls beside the address bar if you want to revoke access.",
      });
      return;
    }
    setPermissionPending(name);
    try {
      await requestDevicePermission(name);
      setPermissionState(name, "granted");
      toast.success(`${name === "camera" ? "Camera" : "Microphone"} access enabled.`);
    } catch {
      setPermissionState(name, "denied");
      toast.error(`${name === "camera" ? "Camera" : "Microphone"} access was blocked.`, {
        description:
          "Use the site controls beside the address bar to allow access, then try again.",
      });
    } finally {
      setPermissionPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsGroup
        title="Call permissions"
        description="Allow browser access for voice messages and calls."
      >
        <ToggleRow
          icon={Volume2}
          title="Microphone access"
          description="Required for voice messages and all calls."
          checked={permissionStates.microphone === "granted"}
          onChange={() => void requestAccess("microphone")}
        />
        <ToggleRow
          icon={Camera}
          title="Camera access"
          description="Required when you start or join a video call."
          checked={permissionStates.camera === "granted"}
          onChange={() => void requestAccess("camera")}
        />
      </SettingsGroup>
      <SettingsGroup title="Media" description="Control downloads and previews.">
        <ToggleRow icon={FileImage} title="Image previews" description="Show image previews in conversations." checked={settings.extra?.image_previews !== false} onChange={(value) => mutate.mutate({ extra: { ...settings.extra, image_previews: value } })} />
        <ToggleRow icon={Download} title="Automatic downloads" description="Download media while on trusted networks." checked={Boolean(settings.extra?.automatic_downloads)} onChange={(value) => mutate.mutate({ extra: { ...settings.extra, automatic_downloads: value } })} />
        <ToggleRow icon={Volume2} title="Autoplay voice messages" description="Continue to the next voice message." checked={Boolean(settings.extra?.autoplay_voice)} onChange={(value) => mutate.mutate({ extra: { ...settings.extra, autoplay_voice: value } })} />
        <div className="p-4 text-xs text-[var(--muted)]">
          Upload limit: 25 MiB per file, as defined by the backend.
        </div>
      </SettingsGroup>
    </div>
  );
}

function AccessibilitySettings({ local }: { local: LocalPreferences }) {
  const queryClient = useQueryClient();
  const update = async (patch: Partial<LocalPreferences>) => {
    await setLocalPreferences(patch);
    await queryClient.invalidateQueries({ queryKey: ["local-preferences"] });
  };
  return (
    <SettingsGroup title="Accessibility" description="Make Chatter comfortable to use.">
      <ToggleRow icon={Accessibility} title="Reduce motion" description="Minimize animated transitions." checked={Boolean(local.reduce_motion)} onChange={(reduce_motion) => void update({ reduce_motion })} />
      <ToggleRow icon={Eye} title="High contrast" description="Increase interface contrast." checked={Boolean(local.high_contrast)} onChange={(high_contrast) => void update({ high_contrast })} />
      <SelectRow
        icon={CircleUserRound}
        title="Text size"
        description="Scale interface text."
        value={String(local.font_scale || 1)}
        onChange={(value) => void update({ font_scale: Number(value) })}
        options={[
          ["0.9", "Compact"],
          ["1", "Default"],
          ["1.1", "Large"],
          ["1.2", "Extra large"],
        ]}
      />
    </SettingsGroup>
  );
}

function AboutSettings() {
  return (
    <SettingsGroup title="About Chatter" description="A focused desktop communication platform.">
      <div className="p-5">
        <div className="grid size-12 place-items-center rounded-2xl bg-[var(--accent)] text-xl font-bold text-white">C</div>
        <h3 className="mt-4 text-lg font-semibold">Chatter Desktop</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">Version 0.1.0</p>
        <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--muted)]">
          Built with React, Electron, and the Chatter API. Calls, messaging, privacy, media, and AI work through documented backend contracts.
        </p>
      </div>
    </SettingsGroup>
  );
}

export function ProfileManagementPage() {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((state) => state.user);
  const setAuthSession = useAuthStore((state) => state.setSession);
  const profile = useQuery({ queryKey: ["profiles-me"], queryFn: profileApi.me });
  const me = useQuery({ queryKey: ["users-me"], queryFn: usersApi.me });
  const friends = useQuery({ queryKey: ["friends", "profile-count"], queryFn: () => friendsApi.list(1, 1) });
  const groups = useQuery({ queryKey: ["groups", "profile-count"], queryFn: () => groupsApi.list(1, 100) });
  const localPrefs = useQuery({
    queryKey: ["local-preferences"],
    queryFn: getLocalPreferences,
  });
  const form = useForm<{
    display_name: string;
    username: string;
    bio: string;
    status_message: string;
    phone: string;
  }>();
  const previewDisplayName = useWatch({
    control: form.control,
    name: "display_name",
  });
  const previewUsername = useWatch({
    control: form.control,
    name: "username",
  });
  const previewBio = useWatch({ control: form.control, name: "bio" });
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const previewAvatar = useProfileEditorStore((state) => state.previewAvatar);
  const previewCover = useProfileEditorStore((state) => state.previewCover);
  const setPreviewAvatar = useProfileEditorStore((state) => state.setPreviewAvatar);
  const setPreviewCover = useProfileEditorStore((state) => state.setPreviewCover);
  const setUserProfile = useUserStore((state) => state.setProfile);

  useEffect(() => {
    if (!profile.data) return;
    form.reset({
      display_name: profile.data.display_name || "",
      username: profile.data.username,
      bio: profile.data.bio || "",
      status_message: profile.data.status_message || "",
      phone: profile.data.phone || "",
    });
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: async (values: {
      display_name: string;
      username: string;
      bio: string;
      status_message: string;
      phone: string;
    }) => {
      const updated = await profileApi.update({
        display_name: values.display_name || null,
        bio: values.bio || null,
        status_message: values.status_message || null,
        phone: values.phone || null,
      });
      if (values.username !== profile.data?.username) {
        const user = await profileApi.updateUsername(values.username);
        setUserProfile(user);
        setAuthSession(user);
      }
      return updated;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles-me"] });
      await queryClient.invalidateQueries({ queryKey: ["users-me"] });
      toast.success("Profile updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const avatar = useMutation({
    mutationFn: async (file: File) => {
      const cropped = await cropImage(file, 1);
      return profileApi.uploadAvatar(cropped);
    },
    onSuccess: async () => {
      setPreviewAvatar(null);
      await queryClient.invalidateQueries({ queryKey: ["profiles-me"] });
      await queryClient.invalidateQueries({ queryKey: ["users-me"] });
      toast.success("Avatar updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const removeAvatar = useMutation({
    mutationFn: profileApi.removeAvatar,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles-me"] });
      await queryClient.invalidateQueries({ queryKey: ["users-me"] });
      toast.success("Avatar removed");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const cover = useMutation({
    mutationFn: async (file: File) => {
      const cropped = await cropImage(file, 3);
      const media = await mediaApi.uploadImage(cropped);
      // No profile cover write API — keep as a desktop-local preference only.
      await setLocalPreferences({ profile_cover_url: media.url });
      return media.url;
    },
    onSuccess: async () => {
      setPreviewCover(null);
      await queryClient.invalidateQueries({ queryKey: ["local-preferences"] });
      toast.success("Banner uploaded (saved locally)");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const removeCover = useMutation({
    mutationFn: async () => setLocalPreferences({ profile_cover_url: null }),
    onSuccess: async () => {
      setPreviewCover(null);
      await queryClient.invalidateQueries({ queryKey: ["local-preferences"] });
      toast.success("Banner removed");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const coverUrl =
    previewCover ||
    profile.data?.cover_url ||
    localPrefs.data?.profile_cover_url ||
    undefined;
  const avatarUrl = previewAvatar || profile.data?.avatar_url;

  if (profile.isLoading) return <SettingsSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Your profile"
        description="Edit how you appear across Chatter."
        actions={
          <Button
            disabled={save.isPending}
            onClick={form.handleSubmit((values) => save.mutate(values))}
          >
            <Save size={15} /> Save
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,var(--accent-soft),transparent_34%)] xl:grid-cols-[1fr_340px]">
        <form className="space-y-4 p-4 sm:p-6" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <SettingsGroup title="Profile media" description="Images are cropped locally before upload.">
            <div className="relative h-44 overflow-hidden bg-[radial-gradient(circle_at_75%_25%,var(--accent),transparent_18%),linear-gradient(135deg,var(--surface-2),var(--panel))]">
              {coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="size-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-xl bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur"
              >
                <Camera size={14} /> Banner
              </button>
              {coverUrl && (
                <button
                  type="button"
                  onClick={() => removeCover.mutate()}
                  className="absolute right-3 top-14 inline-flex items-center gap-2 rounded-xl bg-black/55 px-3 py-2 text-xs font-medium text-white backdrop-blur"
                >
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 p-4">
              <Avatar
                name={profile.data?.display_name || authUser?.username}
                src={avatarUrl}
                size="xl"
              />
              <Button type="button" variant="secondary" onClick={() => avatarRef.current?.click()}>
                <Upload size={14} /> Upload avatar
              </Button>
              {profile.data?.avatar_url && (
                <Button type="button" variant="ghost" onClick={() => removeAvatar.mutate()}>
                  <Trash2 size={14} /> Remove
                </Button>
              )}
            </div>
          </SettingsGroup>

          <SettingsGroup title="Profile details" description="Your public identity and status.">
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <LabeledField label="Display name" registration={form.register("display_name")} />
              <LabeledField label="Username" prefix="@" registration={form.register("username", { required: true, minLength: 3 })} />
              <LabeledField label="Status" registration={form.register("status_message")} />
              <LabeledField label="Phone" registration={form.register("phone")} />
              <label className="md:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">Bio / About</span>
                <textarea {...form.register("bio")} rows={4} className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-3 text-sm outline-none focus:border-[var(--accent)]" />
              </label>
            </div>
          </SettingsGroup>
          <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPreviewAvatar(URL.createObjectURL(file));
            avatar.mutate(file);
          }} />
          <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setPreviewCover(URL.createObjectURL(file));
            cover.mutate(file);
          }} />
        </form>

        <aside className="border-t border-[var(--border)] bg-[var(--surface-2)]/25 p-5 xl:border-l xl:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Profile preview
          </p>
          <div className="mt-4 overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_65px_-42px_rgba(0,0,0,0.75)]">
            <div className="h-32 bg-[radial-gradient(circle_at_75%_25%,var(--accent),transparent_18%),linear-gradient(135deg,var(--surface-2),var(--panel))]">
              {coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="px-5 pb-5">
              <div className="-mt-8">
                <Avatar name={previewDisplayName} src={avatarUrl} size="xl" online />
              </div>
              <h2 className="mt-3 text-xl font-semibold">
                {previewDisplayName || profile.data?.username}
              </h2>
              <p className="text-sm text-[var(--muted)]">@{previewUsername}</p>
              <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                {previewBio || "No bio yet."}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Stat label="Friends" value={friends.data?.total} />
                <Stat label="Groups" value={groups.data?.length} />
                <Stat label="Media" value="—" />
              </div>
              <p className="mt-4 text-xs text-[var(--muted)]">
                Joined {formatJoinDate(me.data?.created_at)}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function useSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: prompt4SettingsApi.update,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Setting updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
}

function useSpecialSettingsMutation(kind: "privacy" | "notifications" | "security") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (kind === "privacy") return prompt4SettingsApi.privacy(body);
      if (kind === "notifications") return prompt4SettingsApi.notifications(body);
      return prompt4SettingsApi.security(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Setting updated");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
}

function SettingsGroup({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/80 shadow-[0_22px_60px_-45px_rgba(0,0,0,0.75)] backdrop-blur-xl">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="group flex items-center gap-3 border-b border-[var(--border)] p-4 transition hover:bg-[var(--surface-2)]/45 last:border-0">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-[var(--muted)]">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 rounded-full transition", checked ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]")}
      >
        <span className={cx("absolute top-1 size-4 rounded-full bg-white shadow transition", checked ? "left-6" : "left-1")} />
      </button>
    </div>
  );
}

function SelectRow({
  icon: Icon,
  title,
  description,
  value,
  onChange,
  options,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="group flex items-center gap-3 border-b border-[var(--border)] p-4 transition hover:bg-[var(--surface-2)]/45 last:border-0">
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-[var(--muted)]">{description}</span>
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]">
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </div>
  );
}

function BlockedUsers() {
  const queryClient = useQueryClient();
  const blocked = useQuery({
    queryKey: ["blocked-users"],
    queryFn: () => friendsApi.blocked(1, 50),
  });
  const unblock = useMutation({
    mutationFn: friendsApi.unblock,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["blocked-users"] });
      toast.success("User unblocked");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]"><UserRound size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Blocked users</span>
          <span className="block text-xs text-[var(--muted)]">
            {blocked.data?.total || 0} blocked
          </span>
        </span>
        {blocked.isFetching && <SoftBadge>Loading</SoftBadge>}
      </div>
      <div className="mt-3 space-y-2">
        {(blocked.data?.data ?? []).map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2"
          >
            <Avatar name={user.display_name || user.username} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">
              @{user.username}
            </span>
            <button
              type="button"
              onClick={() => unblock.mutate(user.id)}
              className="text-xs font-medium text-[var(--accent)]"
            >
              Unblock
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return <div className="space-y-3 animate-pulse"><div className="h-20 rounded-3xl bg-[var(--surface-2)]" /><div className="h-64 rounded-3xl bg-[var(--surface-2)]" /></div>;
}

function ErrorCard({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><p>{friendlyError(error)}</p><Button className="mt-4" onClick={retry}>Retry</Button></div>;
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--accent)]" />;
}

function LabeledField({
  label,
  prefix,
  registration,
}: {
  label: string;
  prefix?: string;
  registration: ReturnType<ReturnType<typeof useForm>["register"]>;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <span className="relative block">
        {prefix && <span className="absolute left-3 top-2.5 text-sm text-[var(--muted)]">{prefix}</span>}
        <input {...registration} className={cx("w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--accent)]", prefix && "pl-7")} />
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value?: number | string }) {
  return <div className="rounded-xl bg-[var(--surface-2)] p-3"><p className="text-lg font-semibold">{value ?? "—"}</p><p className="text-[11px] text-[var(--muted)]">{label}</p></div>;
}

async function cropImage(file: File, ratio: number): Promise<File> {
  const image = await createImageBitmap(file);
  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > ratio) {
    sw = image.height * ratio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / ratio;
    sy = (image.height - sh) / 2;
  }
  const width = ratio === 1 ? 512 : 1500;
  const height = Math.round(width / ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image crop failed.")), "image/jpeg", 0.9),
  );
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}
