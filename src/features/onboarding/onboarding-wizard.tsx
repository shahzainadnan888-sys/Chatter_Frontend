"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  Laptop,
  LockKeyhole,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Brand,
  Button,
  InlineError,
  cx,
} from "@/src/components/ui";
import {
  getLocalPreferences,
  setLocalPreferences,
} from "@/src/lib/api-client";
import {
  queryBrowserPermission,
  requestNotificationPermission,
  type ChatterPermissionState,
} from "@/src/lib/permissions";
import { settingsApi, userApi } from "@/src/services/chatter-api";
import {
  useAuthStore,
  useSettingsStore,
  useThemeStore,
  useUserStore,
} from "@/src/stores/app-stores";
import type {
  AudiencePreference,
  LocalPreferences,
  NotificationSettingsUpdate,
  PrivacySettingsUpdate,
  ThemePreference,
} from "@/src/types/api";

const steps = [
  { title: "Your photo", icon: ImagePlus },
  { title: "Theme", icon: Moon },
  { title: "Accent", icon: Palette },
  { title: "Notifications", icon: Bell },
  { title: "Privacy", icon: LockKeyhole },
  { title: "Finish", icon: Sparkles },
];

function Switch({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]">
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] transition group-hover:text-[var(--ink)]">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-[var(--border-strong)] transition peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--panel)] after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        "relative flex min-h-32 flex-col items-start rounded-2xl border p-4 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
        selected
          ? "border-emerald-400/70 bg-emerald-400/[0.08] shadow-[0_0_30px_-18px_rgba(52,211,153,0.7)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
      )}
    >
      <span className={selected ? "text-emerald-500" : "text-[var(--muted)]"}>{icon}</span>
      <span className="mt-5 text-sm font-semibold text-[var(--ink)]">{title}</span>
      {description && (
        <span className="mt-1 text-xs text-[var(--muted)]">{description}</span>
      )}
      {selected && (
        <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-950">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function AudienceSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: AudiencePreference) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
      <span>
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        <span className="mt-0.5 block text-xs text-[var(--muted)]">
          Control who can see this information
        </span>
      </span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as AudiencePreference)
        }
        className="rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] px-3 py-2 text-xs font-medium text-[var(--ink)] outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10"
      >
        <option value="everyone">Everyone</option>
        <option value="friends">Friends</option>
        <option value="nobody">Nobody</option>
      </select>
    </label>
  );
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const authUser = useAuthStore((state) => state.user);
  const setProfile = useUserStore((state) => state.setProfile);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const accent = useThemeStore((state) => state.accent);
  const setAccent = useThemeStore((state) => state.setAccent);
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [localPreferences, setLocalPreferencesState] =
    useState<LocalPreferences | null>(null);
  const [notifications, setNotifications] =
    useState<NotificationSettingsUpdate>({});
  const [notificationPermission, setNotificationPermission] =
    useState<ChatterPermissionState>("prompt");
  const [privacy, setPrivacy] = useState<PrivacySettingsUpdate>({});
  const [finishing, setFinishing] = useState(false);

  const bootstrap = useQuery({
    queryKey: ["onboarding-bootstrap", authUser?.id],
    enabled: Boolean(authUser),
    queryFn: async () => {
      const [profile, settings, local] = await Promise.all([
        userApi.me(),
        settingsApi.get(),
        getLocalPreferences(),
      ]);
      return { profile, settings, local };
    },
    retry: 1,
  });

  useEffect(() => {
    if (!bootstrap.data || !authUser) return;
    const { profile, settings, local } = bootstrap.data;
    const timer = window.setTimeout(() => {
      setProfile(profile);
      setSettings(settings);
      setLocalPreferencesState(local);
      setTheme(
        (["light", "dark", "system"].includes(settings.theme)
          ? settings.theme
          : "system") as ThemePreference,
      );
      setAccent(local.accent);
      setNotifications({
        notifications_enabled: settings.notifications_enabled,
        message_notifications: settings.message_notifications,
        group_notifications: settings.group_notifications,
        call_notifications: settings.call_notifications,
        mention_notifications: settings.mention_notifications,
        notification_sound: settings.notification_sound,
      });
      setPrivacy({
        show_last_seen: settings.show_last_seen,
        show_online_status: settings.show_online_status,
        show_read_receipts: settings.show_read_receipts,
        show_profile_photo: settings.show_profile_photo,
        who_can_message: settings.who_can_message,
        who_can_add_to_groups: settings.who_can_add_to_groups,
      });
      if (local.completed_onboarding_user_ids.includes(authUser.id)) {
        navigate("/dashboard", { replace: true });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    authUser,
    bootstrap.data,
    navigate,
    setAccent,
    setProfile,
    setSettings,
    setTheme,
  ]);

  useEffect(
    () => () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  useEffect(() => {
    void queryBrowserPermission("notifications").then(
      setNotificationPermission,
    );
  }, []);

  const saveTheme = useMutation({
    mutationFn: () => settingsApi.updateTheme(theme),
    onSuccess: setSettings,
  });
  const saveNotifications = useMutation({
    mutationFn: () => settingsApi.updateNotifications(notifications),
    onSuccess: setSettings,
  });
  const savePrivacy = useMutation({
    mutationFn: () => settingsApi.updatePrivacy(privacy),
    onSuccess: setSettings,
  });
  const upload = useMutation({ mutationFn: userApi.uploadAvatar });

  const pending =
    saveTheme.isPending ||
    saveNotifications.isPending ||
    savePrivacy.isPending ||
    upload.isPending ||
    finishing;

  function selectAvatar(file?: File) {
    setFormError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFormError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setFormError("Your image must be 25 MB or smaller.");
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function next() {
    setFormError("");
    try {
      if (step === 0 && avatar) await upload.mutateAsync(avatar);
      if (step === 1) await saveTheme.mutateAsync();
      if (step === 2) {
        const local = await setLocalPreferences({ accent });
        setLocalPreferencesState(local);
      }
      if (step === 3) {
        await saveNotifications.mutateAsync();
        if (localPreferences) {
          const local = await setLocalPreferences({
            friend_request_notifications:
              localPreferences.friend_request_notifications,
          });
          setLocalPreferencesState(local);
        }
      }
      if (step === 4) {
        await savePrivacy.mutateAsync();
        if (localPreferences) {
          const local = await setLocalPreferences({
            who_can_send_friend_requests:
              localPreferences.who_can_send_friend_requests,
          });
          setLocalPreferencesState(local);
        }
      }
      if (step < steps.length - 1) setStep((value) => value + 1);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn't save this step. Please try again.",
      );
    }
  }

  async function toggleDesktopNotifications(value: boolean) {
    if (value) {
      const result = await requestNotificationPermission();
      const nextPermission =
        result === "default" ? "prompt" : result;
      setNotificationPermission(nextPermission);
      if (result !== "granted") {
        toast.error(
          result === "denied"
            ? "Notifications are blocked."
            : "Notifications were not enabled.",
          {
          description:
              result === "denied"
                ? "Use the site controls beside the address bar to allow notifications."
                : "Please allow notifications when your browser asks.",
          },
        );
        setNotifications((state) => ({
          ...state,
          notifications_enabled: false,
        }));
        return;
      }
    }
    setNotifications((state) => ({
      ...state,
      notifications_enabled: value,
    }));
  }

  async function finish() {
    if (!authUser || !localPreferences) return;
    setFinishing(true);
    setFormError("");
    try {
      const ids = Array.from(
        new Set([
          ...localPreferences.completed_onboarding_user_ids,
          authUser.id,
        ]),
      );
      await setLocalPreferences({ completed_onboarding_user_ids: ids });
      toast.success("Your Chatter space is ready.");
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn't finish setup. Please try again.",
      );
      setFinishing(false);
    }
  }

  const content = (() => {
    if (!localPreferences) return null;
    if (step === 0) {
      return (
        <div className="flex flex-col items-center py-5">
          <div className="relative">
            <div className="grid size-36 place-items-center overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[var(--surface-2)] shadow-[0_20px_50px_-25px_rgba(0,0,0,0.35)]">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview}
                  alt="Selected profile preview"
                  className="size-full object-cover"
                />
              ) : (
                <ImagePlus size={36} className="text-[var(--muted)]" />
              )}
            </div>
            {avatarPreview && (
              <button
                onClick={() => {
                  URL.revokeObjectURL(avatarPreview);
                  setAvatar(null);
                  setAvatarPreview("");
                }}
                aria-label="Remove selected photo"
                className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] shadow-lg"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <label className="mt-6 inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)] transition hover:border-emerald-400/40 hover:bg-[var(--surface-2)] focus-within:ring-2 focus-within:ring-emerald-400">
            <Upload size={16} />
            Upload a photo
            <input
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => selectAvatar(event.target.files?.[0])}
            />
          </label>
          <p className="mt-3 text-xs text-[var(--muted)]">
            JPEG, PNG, or WebP · Up to 25 MB
          </p>
        </div>
      );
    }
    if (step === 1) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <ChoiceCard
            title="Light"
            description="Bright and clear"
            icon={<Sun size={22} />}
            selected={theme === "light"}
            onClick={() => setTheme("light")}
          />
          <ChoiceCard
            title="Dark"
            description="Easy on the eyes"
            icon={<Moon size={22} />}
            selected={theme === "dark"}
            onClick={() => setTheme("dark")}
          />
          <ChoiceCard
            title="System"
            description="Match your device"
            icon={<Laptop size={22} />}
            selected={theme === "system"}
            onClick={() => setTheme("system")}
          />
        </div>
      );
    }
    if (step === 2) {
      const accents: Array<{
        name: LocalPreferences["accent"];
        color: string;
        label: string;
      }> = [
        { name: "purple", color: "linear-gradient(145deg,#a855f7,#6d28d9)", label: "Violet" },
        { name: "blue", color: "linear-gradient(145deg,#60a5fa,#2563eb)", label: "Indigo" },
        { name: "emerald", color: "linear-gradient(145deg,#34d399,#059669)", label: "Emerald" },
        { name: "teal", color: "linear-gradient(145deg,#2dd4bf,#0891b2)", label: "Teal" },
        { name: "orange", color: "linear-gradient(145deg,#fbbf24,#f97316)", label: "Amber" },
        { name: "pink", color: "linear-gradient(145deg,#f472b6,#db2777)", label: "Pink" },
        { name: "red", color: "linear-gradient(145deg,#fb7185,#dc2626)", label: "Red" },
        { name: "rose", color: "linear-gradient(145deg,#fb7185,#e11d48)", label: "Rose" },
      ];
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {accents.map((item) => (
            <button
              type="button"
              key={item.name}
              onClick={() => setAccent(item.name)}
              aria-pressed={accent === item.name}
              className={cx(
                "relative flex min-h-32 flex-col items-center justify-center rounded-2xl border p-4 text-xs font-medium text-[var(--ink)] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                accent === item.name
                  ? "border-emerald-400/70 bg-emerald-400/[0.07] shadow-[0_0_30px_-18px_rgba(52,211,153,0.75)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
              )}
            >
              <span
                className="mb-3 grid size-12 place-items-center rounded-full text-white shadow-[0_10px_25px_-10px_rgba(0,0,0,0.8)]"
                style={{ background: item.color }}
              >
                {accent === item.name && <Check size={18} />}
              </span>
              {item.label}
              <span
                className={cx(
                  "mt-3 grid size-4 place-items-center rounded-full border",
                  accent === item.name
                    ? "border-emerald-400 bg-emerald-500 text-white"
                    : "border-[var(--border-strong)]",
                )}
              >
                {accent === item.name && <Check size={10} strokeWidth={3} />}
              </span>
            </button>
          ))}
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="grid gap-2.5">
          <Switch
            label="Desktop notifications"
            description={
              notificationPermission === "denied"
                ? "Blocked in browser settings — use the icon beside the address bar"
                : notificationPermission === "granted"
                  ? "Browser permission granted"
                  : "Click to show the browser permission popup"
            }
            checked={
              Boolean(notifications.notifications_enabled) &&
              notificationPermission === "granted"
            }
            onChange={(value) => void toggleDesktopNotifications(value)}
            icon={<Bell size={17} />}
          />
          <Switch
            label="Message sounds"
            description="Play a subtle sound for new messages"
            checked={Boolean(notifications.notification_sound)}
            onChange={(value) =>
              setNotifications((state) => ({
                ...state,
                notification_sound: value,
              }))
            }
            icon={<Volume2 size={17} />}
          />
          <Switch
            label="Friend requests"
            description="Notify you when someone wants to connect"
            checked={localPreferences.friend_request_notifications}
            onChange={(value) =>
              setLocalPreferencesState((state) =>
                state
                  ? { ...state, friend_request_notifications: value }
                  : state,
              )
            }
          />
          <Switch
            label="Call notifications"
            description="Alert you about incoming calls"
            checked={Boolean(notifications.call_notifications)}
            onChange={(value) =>
              setNotifications((state) => ({
                ...state,
                call_notifications: value,
              }))
            }
          />
          <Switch
            label="Mention notifications"
            description="Notify you when someone mentions you"
            checked={Boolean(notifications.mention_notifications)}
            onChange={(value) =>
              setNotifications((state) => ({
                ...state,
                mention_notifications: value,
              }))
            }
          />
        </div>
      );
    }
    if (step === 4) {
      return (
        <div className="grid gap-2.5">
          <Switch
            label="Last seen"
            description="Let others see when you were last active"
            checked={Boolean(privacy.show_last_seen)}
            onChange={(value) =>
              setPrivacy((state) => ({ ...state, show_last_seen: value }))
            }
            icon={<Eye size={17} />}
          />
          <Switch
            label="Read receipts"
            description="Let others know when you've read their messages"
            checked={Boolean(privacy.show_read_receipts)}
            onChange={(value) =>
              setPrivacy((state) => ({ ...state, show_read_receipts: value }))
            }
          />
          <AudienceSelect
            label="Profile visibility"
            value={privacy.show_profile_photo ?? "everyone"}
            onChange={(value) =>
              setPrivacy((state) => ({
                ...state,
                show_profile_photo: value,
              }))
            }
          />
          <AudienceSelect
            label="Friend requests"
            value={localPreferences.who_can_send_friend_requests}
            onChange={(value) =>
              setLocalPreferencesState((state) =>
                state
                  ? { ...state, who_can_send_friend_requests: value }
                  : state,
              )
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 15 }}
          className="grid size-16 place-items-center rounded-2xl bg-emerald-500 text-white shadow-xl shadow-emerald-950/50"
        >
          <Check size={31} strokeWidth={2.7} />
        </motion.div>
        <h3 className="mt-6 text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
          You&apos;re all set.
        </h3>
        <p className="mt-3 max-w-sm text-sm leading-6 text-[var(--muted)]">
          Your profile, appearance, notifications, and privacy preferences are
          ready.
        </p>
      </div>
    );
  })();

  if (bootstrap.isLoading || (bootstrap.data && !localPreferences)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--canvas)] text-[var(--ink)]">
        <div className="flex flex-col items-center gap-4">
          <Brand compact />
          <span className="size-5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <span className="text-xs text-[var(--muted)]">Preparing your space…</span>
        </div>
      </main>
    );
  }
  if (bootstrap.isError || !localPreferences) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--canvas)] p-6 text-[var(--ink)]">
        <div className="max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto text-[var(--muted)]" size={34} />
          <h1 className="mt-4 text-xl font-semibold">Setup couldn&apos;t load</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            We couldn&apos;t securely load your profile and settings.
          </p>
          <Button
            className="onboarding-primary-button mt-5"
            onClick={() => void bootstrap.refetch()}
          >
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const ActiveIcon = steps[step].icon;
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--canvas)] p-0 text-[var(--ink)] transition-colors duration-300 sm:p-4 lg:p-5">
      <div className="pointer-events-none absolute -left-40 top-1/3 size-[30rem] rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -top-40 size-[34rem] rounded-full bg-purple-600/15 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative mx-auto flex min-h-screen max-w-[1500px] flex-col overflow-hidden border border-[var(--border)] bg-[var(--panel)]/95 shadow-[0_30px_100px_-45px_rgba(0,0,0,0.55)] transition-colors duration-300 sm:min-h-[calc(100vh-2rem)] sm:rounded-[24px]"
      >
        <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-[var(--border)] px-5 sm:px-7">
          <Brand />
          <div className="flex items-center gap-4">
            <span className="hidden text-xs font-medium text-[var(--muted)] sm:block">
              Step {step + 1} of {steps.length}
            </span>
            <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((item, index) => (
                <span
                  key={item.title}
                  className={cx(
                    "h-1.5 rounded-full transition-all duration-300",
                    index <= step
                      ? "w-5 bg-emerald-400"
                      : "w-3 bg-[var(--border-strong)]",
                  )}
                />
              ))}
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[226px_1fr]">
          <aside className="hidden flex-col justify-between border-r border-[var(--border)] bg-[var(--canvas)]/35 p-5 lg:flex">
            <nav aria-label="Onboarding progress">
              <ol className="relative space-y-1 before:absolute before:bottom-5 before:left-[15px] before:top-5 before:w-px before:bg-[var(--border)]">
                {steps.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.title}
                      className={cx(
                        "relative z-10 flex items-center gap-3 rounded-xl border px-2.5 py-2.5 text-sm transition duration-200",
                        index === step
                          ? "border-emerald-400/30 bg-emerald-400/[0.09] font-medium text-emerald-700 dark:text-emerald-100"
                          : index < step
                            ? "border-transparent text-[var(--ink)]"
                            : "border-transparent text-[var(--muted)]",
                      )}
                      aria-current={index === step ? "step" : undefined}
                    >
                      <span
                        className={cx(
                          "grid size-8 shrink-0 place-items-center rounded-full border",
                          index < step
                            ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-600 dark:text-emerald-300"
                            : index === step
                              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-500"
                              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
                        )}
                      >
                        {index < step ? <Check size={14} /> : <Icon size={14} />}
                      </span>
                      {item.title}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <Sparkles size={18} className="text-purple-400" />
              <p className="mt-5 text-xs font-semibold text-[var(--ink)]">
                Personalize your experience
              </p>
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                Every choice can be changed later from your settings.
              </p>
              <div className="relative -mx-4 -mb-4 mt-5 h-16 overflow-hidden">
                <div className="absolute -bottom-10 -left-5 h-20 w-44 rotate-6 rounded-[50%] bg-purple-600/55 blur-sm" />
                <div className="absolute -bottom-10 left-12 h-20 w-44 -rotate-6 rounded-[50%] bg-blue-600/50 blur-sm" />
                <div className="absolute -bottom-12 right-0 h-20 w-40 rotate-12 rounded-[50%] bg-emerald-500/50 blur-sm" />
              </div>
            </div>
          </aside>

          <section className="relative min-w-0 overflow-hidden">
            <div className="pointer-events-none absolute -right-32 -top-48 size-[34rem] rounded-full bg-[radial-gradient(circle,rgba(109,40,217,0.32),rgba(79,70,229,0.12)_38%,transparent_68%)] blur-xl" />

            <nav
              aria-label="Onboarding progress"
              className="border-b border-[var(--border)] px-4 py-3 lg:hidden"
            >
              <ol className="flex gap-2 overflow-x-auto">
                {steps.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.title}
                      className={cx(
                        "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs",
                        index === step
                          ? "bg-emerald-400/10 text-emerald-200"
                          : "text-[var(--muted)]",
                      )}
                    >
                      {index < step ? <Check size={13} /> : <Icon size={13} />}
                      {item.title}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
              <div className="mb-7">
                <div className="mb-4 grid size-11 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-600 shadow-[0_0_25px_-14px_rgba(52,211,153,0.8)] dark:text-emerald-300">
                  <ActiveIcon size={19} />
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-[34px]">
                  {
                    [
                      "Add a profile picture",
                      "Choose your theme",
                      "Pick an accent color",
                      "Stay in the loop",
                      "Set your boundaries",
                      "Ready when you are",
                    ][step]
                  }
                </h1>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {
                    [
                      "Help friends recognize you. You can always change this later.",
                      "Choose what feels best. Chatter will remember it everywhere.",
                      "A small touch of color to make Chatter feel like yours.",
                      "Choose which moments deserve your attention.",
                      "You decide what others can see and how they can reach you.",
                      "Everything is configured. Your conversations are waiting.",
                    ][step]
                  }
                </p>
              </div>

              <div className="min-h-[350px] rounded-[22px] border border-[var(--border)] bg-[var(--surface)]/75 p-5 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-7">
                <InlineError message={formError} />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -18 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className={formError ? "mt-5" : ""}
                  >
                    {content}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-5">
                <Button
                  variant="secondary"
                  className="border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]"
                  disabled={step === 0 || pending}
                  onClick={() => {
                    setFormError("");
                    setStep((value) => Math.max(0, value - 1));
                  }}
                >
                  <ChevronLeft size={16} /> Back
                </Button>
                {step === steps.length - 1 ? (
                  <Button
                    className="onboarding-primary-button"
                    loading={finishing}
                    onClick={finish}
                  >
                    Enter Chatter <Sparkles size={16} />
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    {step === 0 && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setAvatar(null);
                          setAvatarPreview("");
                          void next();
                        }}
                        className="h-11 px-3 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--ink)] disabled:opacity-50"
                      >
                        Skip
                      </button>
                    )}
                    <Button
                      className="onboarding-primary-button min-w-28"
                      loading={pending}
                      onClick={next}
                    >
                      Continue <ChevronRight size={16} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </motion.div>
    </main>
  );
}
