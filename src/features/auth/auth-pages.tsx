"use client";

import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  LockKeyhole,
  MessageCircleMore,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Zap,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AuthShell,
  Brand,
  Button,
  FormHeader,
  InlineError,
  Input,
  PasswordInput,
  cx,
} from "@/src/components/ui";
import { ApiError } from "@/src/lib/api-client";
import { authApi, userApi } from "@/src/services/chatter-api";
import { useAuthStore } from "@/src/stores/app-stores";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9_.]+$/;

const passwordRules = [
  { label: "8+ characters", test: (value: string) => value.length >= 8 },
  { label: "Uppercase", test: (value: string) => /[A-Z]/.test(value) },
  { label: "Lowercase", test: (value: string) => /[a-z]/.test(value) },
  { label: "Number", test: (value: string) => /\d/.test(value) },
];

const premiumAuthFieldClass =
  "h-12 rounded-[14px] border-[#dedee6] bg-[#fcfcfd] px-4 text-[15px] text-[#111827] shadow-[0_1px_2px_rgba(24,24,27,0.03)] transition duration-200 placeholder:text-[#9ca3af] hover:border-[#c9c9d3] focus:border-[#7c3aed] focus:ring-[#7c3aed]/10";

function passwordIsStrong(value: string) {
  return passwordRules.every((rule) => rule.test(value));
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (error.status >= 500) {
      return "Chatter is temporarily unavailable. Your input is safe—please try again.";
    }
    return error.message;
  }
  return "We couldn't complete that request. Check your connection and try again.";
}

function PasswordRules({ password }: { password: string }) {
  return (
    <div
      className="rounded-[14px] border border-[#ebe7f5] bg-[linear-gradient(145deg,#faf9ff,#f7f5ff)] p-3.5"
      aria-live="polite"
    >
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6b7280]">
        Password requirements
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {passwordRules.map((rule) => {
          const passed = rule.test(password);
          return (
            <motion.span
              key={rule.label}
              animate={{ color: passed ? "#059669" : "#6b7280" }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2 text-[11px] font-medium"
            >
              <motion.span
                animate={{
                  scale: passed ? [0.82, 1.12, 1] : 1,
                  backgroundColor: passed ? "#d1fae5" : "#e5e7eb",
                }}
                transition={{ duration: 0.25 }}
                className="grid size-4 shrink-0 place-items-center rounded-full"
                aria-hidden="true"
              >
                {passed ? (
                  <Check size={10} strokeWidth={3} />
                ) : (
                  <Circle size={7} fill="currentColor" />
                )}
              </motion.span>
              {rule.label}
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}

type LoginFields = {
  email: string;
  password: string;
};

const loginHighlights = [
  {
    icon: MessageCircleMore,
    title: "Conversations that stay in sync",
    description: "Move naturally between messages, media, and calls.",
  },
  {
    icon: Zap,
    title: "Fast by default",
    description: "Realtime updates keep every conversation feeling immediate.",
  },
  {
    icon: LockKeyhole,
    title: "Private and protected",
    description: "Secure sessions and thoughtful privacy controls are built in.",
  },
];

function LoginExperience({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="grid min-h-screen bg-[#fafafc] font-sans text-[#18181b] [color-scheme:light] lg:grid-cols-[minmax(0,1.08fr)_minmax(480px,0.92fr)]"
    >
      <section className="order-1 flex min-h-[100svh] items-center justify-center px-5 py-16 sm:px-10 lg:order-2 lg:px-14">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[470px]"
        >
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <div className="rounded-[20px] border border-[#e8e8ee] bg-white p-6 shadow-[0_24px_70px_-30px_rgba(40,28,75,0.28)] sm:p-9">
            {children}
          </div>
          <p className="mt-6 text-center text-xs leading-5 text-[#71717a]">
            Protected by secure session authorization.
          </p>
        </motion.div>
      </section>

      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative order-2 isolate overflow-hidden bg-[linear-gradient(145deg,#4c1d95_0%,#6d28d9_47%,#4338ca_100%)] px-6 py-14 text-white sm:px-12 lg:order-1 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 lg:py-12"
        aria-label="About Chatter"
      >
        <div
          className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-fuchsia-400/25 blur-3xl"
          aria-hidden="true"
        />
        <motion.div
          className="pointer-events-none absolute -bottom-36 -right-24 size-[28rem] rounded-full bg-blue-400/20 blur-3xl"
          animate={{ x: [0, 18, 0], y: [0, -14, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />

        <div className="relative z-10 hidden lg:block">
          <Brand tone="light" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-xl lg:mx-0">
          <div className="mb-9 hidden lg:block" aria-hidden="true">
            <div className="relative h-44 max-w-md">
              <motion.div
                animate={{ y: [0, -7, 0] }}
                transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute left-0 top-8 w-[78%] rounded-2xl border border-white/15 bg-white/12 p-4 shadow-2xl backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-white/15">
                    <MessageCircleMore size={19} />
                  </span>
                  <span className="space-y-2">
                    <span className="block h-2 w-28 rounded-full bg-white/80" />
                    <span className="block h-2 w-48 rounded-full bg-white/30" />
                  </span>
                </div>
              </motion.div>
              <motion.div
                animate={{ y: [0, 8, 0] }}
                transition={{
                  duration: 5.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.4,
                }}
                className="absolute bottom-0 right-0 w-[65%] rounded-2xl border border-white/15 bg-indigo-950/25 p-4 shadow-2xl backdrop-blur-xl"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-full bg-emerald-300/20 text-emerald-100">
                    <UsersRound size={17} />
                  </span>
                  <span className="space-y-2">
                    <span className="block h-2 w-24 rounded-full bg-white/75" />
                    <span className="block h-2 w-36 rounded-full bg-white/25" />
                  </span>
                </div>
              </motion.div>
            </div>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide backdrop-blur">
            <Sparkles size={14} aria-hidden="true" />
            Your conversations, beautifully connected
          </span>
          <h1 className="mt-6 max-w-lg text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl">
            Communication that feels effortless.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-indigo-100/85 sm:text-base">
            A focused place for meaningful messages, shared moments, and the
            people who matter most.
          </p>

          <ul className="mt-9 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {loginHighlights.map(({ icon: Icon, title, description }, index) => (
              <motion.li
                key={title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.22 + index * 0.08 }}
                className="flex gap-3"
              >
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-indigo-100/70">
                    {description}
                  </span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 mt-12 hidden text-xs text-indigo-100/60 lg:block">
          Private by design. Built for real conversations.
        </p>
      </motion.aside>
    </motion.main>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [formError, setFormError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFields>({
    defaultValues: { email: "", password: "" },
  });
  const login = useMutation({
    mutationFn: (values: LoginFields) =>
      authApi.login({
        email: values.email.trim(),
        password: values.password,
      }),
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      const result = await login.mutateAsync(values);
      setSession(result.user);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <LoginExperience>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c3aed]">
          Welcome back
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#18181b] sm:text-[34px]">
          Sign in to Chatter
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#71717a]">
          New here?{" "}
          <Link
            className="font-semibold text-[#7c3aed] underline-offset-4 transition hover:text-[#6d28d9] hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]"
            to="/signup"
          >
            Create an account
          </Link>
        </p>
      </header>
      <form className="space-y-5" onSubmit={onSubmit} noValidate>
        <InlineError message={formError} />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className={premiumAuthFieldClass}
          error={errors.email?.message}
          {...register("email", {
            required: "Enter your email address.",
            pattern: { value: emailPattern, message: "Enter a valid email address." },
          })}
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          className={cx(premiumAuthFieldClass, "pr-11")}
          error={errors.password?.message}
          hint={
            <Link
              className="rounded font-medium text-[#7c3aed] underline-offset-4 transition hover:text-[#6d28d9] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]"
              to="/forgot-password"
            >
              Forgot password?
            </Link>
          }
          {...register("password", { required: "Enter your password." })}
        />
        <Button
          className="login-primary-button mt-1 h-12 w-full rounded-[14px] text-[15px] shadow-[0_12px_30px_-12px_rgba(124,58,237,0.75)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-12px_rgba(124,58,237,0.72)] active:translate-y-0 active:scale-[0.985]"
          loading={login.isPending}
          type="submit"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-7 flex items-center justify-center gap-2 text-xs text-[#71717a]">
        <LockKeyhole size={13} aria-hidden="true" />
        Your session stays securely signed in on this device.
      </div>
    </LoginExperience>
  );
}

const signupHighlights = [
  { icon: MessageCircleMore, label: "Private conversations" },
  { icon: ShieldCheck, label: "Protected sessions" },
  { icon: Zap, label: "Lightning-fast messaging" },
  { icon: MonitorSmartphone, label: "Cross-device continuity" },
];

function SignupExperience({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="grid min-h-screen bg-[#fafafc] font-sans text-[#111827] [color-scheme:light] lg:grid-cols-[minmax(0,0.95fr)_minmax(560px,1.05fr)]"
    >
      <section className="order-1 flex min-h-[100svh] items-center justify-center px-4 py-10 sm:px-8 lg:order-2 lg:px-10 xl:px-14">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.52, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[590px]"
        >
          <div className="mb-7 lg:hidden">
            <Brand />
          </div>
          <div className="rounded-[20px] border border-[#e5e7eb] bg-white p-5 shadow-[0_26px_75px_-34px_rgba(55,33,105,0.3)] sm:p-8 xl:p-9">
            {children}
          </div>
        </motion.div>
      </section>

      <motion.aside
        initial={{ opacity: 0, x: -18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
        className="relative order-2 isolate overflow-hidden bg-[linear-gradient(145deg,#581c87_0%,#7c3aed_50%,#4338ca_100%)] px-6 py-14 text-white sm:px-12 lg:order-1 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-12 lg:py-11 xl:px-14"
        aria-label="Why join Chatter"
      >
        <motion.div
          className="pointer-events-none absolute -left-28 -top-24 size-96 rounded-full bg-fuchsia-400/25 blur-3xl"
          animate={{ x: [0, 14, 0], y: [0, 10, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />
        <motion.div
          className="pointer-events-none absolute -bottom-32 -right-28 size-[30rem] rounded-full bg-blue-400/20 blur-3xl"
          animate={{ x: [0, -16, 0], y: [0, -12, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />

        <div className="relative z-10 hidden lg:block">
          <Brand tone="light" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-xl lg:mx-0">
          <div className="relative mb-10 hidden h-52 max-w-md lg:block" aria-hidden="true">
            <motion.div
              animate={{ y: [0, -8, 0], rotate: [-1, 0.5, -1] }}
              transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-8 top-0 w-72 rounded-[22px] border border-white/20 bg-white/12 p-4 shadow-2xl backdrop-blur-xl"
            >
              <div className="mb-4 flex items-center gap-2">
                <span className="size-2 rounded-full bg-rose-300/80" />
                <span className="size-2 rounded-full bg-amber-200/80" />
                <span className="size-2 rounded-full bg-emerald-300/80" />
              </div>
              <div className="space-y-3">
                <span className="ml-auto block h-8 w-3/5 rounded-2xl rounded-br-md bg-white/20" />
                <span className="block h-10 w-4/5 rounded-2xl rounded-bl-md bg-indigo-950/25" />
                <span className="ml-auto block h-7 w-2/5 rounded-2xl rounded-br-md bg-white/20" />
              </div>
            </motion.div>
            <motion.div
              animate={{ y: [0, 9, 0] }}
              transition={{
                duration: 4.8,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.35,
              }}
              className="absolute bottom-0 right-0 flex items-center gap-3 rounded-2xl border border-white/15 bg-indigo-950/25 px-4 py-3 shadow-xl backdrop-blur-xl"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-emerald-300/20 text-emerald-100">
                <ShieldCheck size={17} />
              </span>
              <span>
                <span className="block text-xs font-semibold">Ready to connect</span>
                <span className="mt-1 block h-1.5 w-28 rounded-full bg-white/20" />
              </span>
            </motion.div>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide backdrop-blur">
            <Sparkles size={14} aria-hidden="true" />
            Create your space
          </span>
          <h1 className="mt-6 max-w-lg text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl">
            Better conversations begin here.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-7 text-purple-100/85 sm:text-base">
            Join a thoughtful communication space designed to keep your people,
            messages, and shared moments close.
          </p>

          <ul className="mt-9 grid gap-3 sm:grid-cols-2">
            {signupHighlights.map(({ icon: Icon, label }, index) => (
              <motion.li
                key={label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 + index * 0.07 }}
                className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-3.5 py-3 text-sm font-medium shadow-sm backdrop-blur"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/12">
                  <Icon size={15} aria-hidden="true" />
                </span>
                {label}
              </motion.li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 mt-12 hidden text-xs text-purple-100/60 lg:block">
          Thoughtful communication, without the noise.
        </p>
      </motion.aside>
    </motion.main>
  );
}

type SignupFields = {
  fullName: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [formError, setFormError] = useState("");
  const [availability, setAvailability] = useState<{
    state: "idle" | "checking" | "available" | "taken" | "error";
    message?: string;
    normalized?: string;
  }>({ state: "idle" });
  const checkSequence = useRef(0);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<SignupFields>({
    mode: "onChange",
    defaultValues: {
      fullName: "",
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
  const username = useWatch({ control, name: "username" });
  const password = useWatch({ control, name: "password" });
  const signup = useMutation({ mutationFn: authApi.signup });

  useEffect(() => {
    const clean = username.trim().replace(/^@/, "");
    const sequence = ++checkSequence.current;
    if (clean.length < 3 || !usernamePattern.test(clean)) {
      return;
    }
    const timeout = window.setTimeout(async () => {
      setAvailability({ state: "checking" });
      try {
        const result = await authApi.checkUsername(clean);
        if (sequence !== checkSequence.current) return;
        setAvailability({
          state: result.available ? "available" : "taken",
          message: result.reason ?? undefined,
          normalized: result.username,
        });
      } catch {
        if (sequence === checkSequence.current) {
          setAvailability({
            state: "error",
            message: "Availability check failed. Try again.",
          });
        }
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [username]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    if (availability.state !== "available") {
      setFormError("Choose an available username before continuing.");
      return;
    }
    const email = values.email.trim();
    const fullName = values.fullName.trim();
    try {
      const result = await signup.mutateAsync({
        email,
        password: values.password,
        username: availability.normalized ?? values.username.replace(/^@/, ""),
      });
      setSession(result.user);
      if (fullName) {
        try {
          await userApi.updateProfile({ display_name: fullName });
        } catch (profileError) {
          toast.error("Your account was created, but your display name could not be saved.", {
            description: errorMessage(profileError),
          });
        }
      }
      navigate("/welcome", { replace: true });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 409) {
        setFormError(
          apiError.message ||
            "That email or username is already registered. Sign in or choose another.",
        );
        return;
      }
      setFormError(errorMessage(error));
    }
  });

  return (
    <SignupExperience>
      <header className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7c3aed]">
          Join Chatter
        </p>
        <h1 className="mt-2.5 text-3xl font-semibold tracking-[-0.04em] text-[#111827] sm:text-[34px]">
          Create your account
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#6b7280]">
          Already have an account?{" "}
          <Link
            className="rounded font-semibold text-[#7c3aed] underline-offset-4 transition hover:text-[#6d28d9] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed]"
            to="/login"
          >
            Sign in
          </Link>
        </p>
      </header>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <InlineError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            autoComplete="name"
            placeholder="Alex Morgan"
            className={premiumAuthFieldClass}
            error={errors.fullName?.message}
            {...register("fullName", {
              required: "Enter your full name.",
              minLength: { value: 2, message: "Use at least 2 characters." },
            })}
          />
          <Input
            label="Username"
            autoComplete="username"
            placeholder="alex_dev"
            leading="@"
            className={premiumAuthFieldClass}
            error={errors.username?.message}
            hint={
              <span
                className={cx(
                  "flex items-center gap-1 text-[11px] font-normal",
                  availability.state === "available" && "text-emerald-600",
                  availability.state === "taken" && "text-red-600",
                  availability.state === "error" && "text-amber-600",
                )}
                aria-live="polite"
              >
                {availability.state === "checking" && "Checking…"}
                {availability.state === "available" && (
                  <>
                    <Check size={12} /> Available
                  </>
                )}
                {availability.state === "taken" && (
                  <>
                    <X size={12} /> Already taken
                  </>
                )}
                {availability.state === "error" && (
                  <>
                    <RefreshCw size={12} /> Check connection
                  </>
                )}
              </span>
            }
            {...register("username", {
              required: "Choose a username.",
              minLength: { value: 3, message: "Use at least 3 characters." },
              maxLength: { value: 30, message: "Use 30 characters or fewer." },
              validate: (value) =>
                usernamePattern.test(value.replace(/^@/, "")) ||
                "Use only letters, numbers, underscores, and periods.",
              onChange: (event) => {
                setAvailability({ state: "idle" });
                const value = event.target.value.replace(/^@/, "");
                setValue("username", value, { shouldValidate: true });
              },
            })}
          />
        </div>
        {(availability.state === "taken" ||
          availability.state === "error") &&
          availability.message && (
          <p
            className={cx(
              "-mt-2 text-xs",
              availability.state === "error"
                ? "text-amber-600"
                : "text-red-600",
            )}
            role="status"
          >
            {availability.message}
          </p>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className={premiumAuthFieldClass}
          error={errors.email?.message}
          {...register("email", {
            required: "Enter your email address.",
            pattern: { value: emailPattern, message: "Enter a valid email address." },
          })}
        />
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          placeholder="Create a strong password"
          className={cx(premiumAuthFieldClass, "pr-11")}
          error={errors.password?.message}
          {...register("password", {
            required: "Create a password.",
            validate: (value) =>
              passwordIsStrong(value) || "Your password doesn't meet every requirement.",
          })}
        />
        <PasswordRules password={password} />
        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          placeholder="Repeat your password"
          className={cx(premiumAuthFieldClass, "pr-11")}
          error={errors.confirmPassword?.message}
          {...register("confirmPassword", {
            required: "Confirm your password.",
            validate: (value) => value === password || "Passwords do not match.",
          })}
        />
        <Button
          className="login-primary-button mt-1 h-12 w-full rounded-[14px] text-[15px] shadow-[0_12px_30px_-12px_rgba(124,58,237,0.72)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-12px_rgba(124,58,237,0.7)] active:translate-y-0 active:scale-[0.985]"
          loading={signup.isPending}
          type="submit"
        >
          {signup.isPending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-[11px] leading-5 text-[#6b7280]">
          By creating an account, you agree to Chatter&apos;s Terms and Privacy
          Policy.
        </p>
      </form>
    </SignupExperience>
  );
}

function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  function update(index: number, nextValue: string) {
    const digit = nextValue.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    onChange(next.join(""));
    if (digit && index < 5) refs.current[index + 1]?.focus();
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) refs.current[index + 1]?.focus();
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  }

  return (
    <div
      className="grid grid-cols-6 gap-2 sm:gap-2.5"
      onPaste={paste}
      role="group"
      aria-label="Six digit verification code"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digit}
          onChange={(event) => update(index, event.target.value)}
          onKeyDown={(event) => keyDown(index, event)}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Digit ${index + 1}`}
          className="aspect-square min-w-0 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-center text-xl font-semibold outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)] disabled:opacity-50"
        />
      ))}
    </div>
  );
}

function useCountdown(initial = 60) {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [seconds]);
  return { seconds, reset: () => setSeconds(initial) };
}

export function WelcomePage() {
  const navigate = useNavigate();
  useEffect(() => {
    const timer = window.setTimeout(() => navigate("/onboarding", { replace: true }), 2600);
    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-6 text-center text-[var(--ink)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-w-md flex-col items-center"
      >
        <motion.div
          initial={{ scale: 0, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 190, damping: 16 }}
          className="brand-mark grid size-16 place-items-center rounded-2xl text-white shadow-lg"
        >
          <Check size={32} strokeWidth={2.5} />
        </motion.div>
        <h1 className="mt-7 text-4xl font-semibold tracking-[-0.045em]">
          Welcome to Chatter
        </h1>
        <p className="mt-3 text-[15px] leading-7 text-[var(--muted)]">
          Your account is ready. Let&apos;s make Chatter feel like yours.
        </p>
        <div className="mt-8 h-1 w-32 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <motion.div
            className="brand-button h-full"
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: 2.3, ease: "linear" }}
          />
        </div>
      </motion.div>
    </main>
  );
}

type ResetStep = "email" | "otp" | "password" | "success";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [developmentOtp, setDevelopmentOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const { seconds, reset } = useCountdown();
  const requestReset = useMutation({
    mutationFn: () => authApi.requestPasswordReset(email.trim()),
  });
  const confirmReset = useMutation({
    mutationFn: () =>
      authApi.confirmPasswordReset({
        email: email.trim(),
        otp,
        new_password: newPassword,
      }),
  });

  async function sendCode() {
    if (!emailPattern.test(email.trim())) {
      setFormError("Enter a valid email address.");
      return;
    }
    setFormError("");
    try {
      const result = await requestReset.mutateAsync();
      if (result.otp) {
        setDevelopmentOtp(result.otp);
        setOtp(result.otp);
      }
      reset();
      setStep("otp");
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function resetPassword() {
    if (!passwordIsStrong(newPassword)) {
      setFormError("Your password doesn't meet every requirement.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setFormError("");
    try {
      await confirmReset.mutateAsync();
      setStep("success");
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  const copy = {
    email: {
      title: "Reset your password",
      description: "Enter your email and we’ll generate a secure verification code.",
    },
    otp: {
      title: "Enter your reset code",
      description: `Use the 6-digit development code for ${email.trim()}.`,
    },
    password: {
      title: "Create a new password",
      description: "Choose something strong and different from your previous password.",
    },
    success: {
      title: "Password updated",
      description: "Your password has been reset securely. You can now sign in.",
    },
  }[step];

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="A secure way back into your conversations."
      description="We’ll verify it’s really you before making any changes to your account."
    >
      {step !== "success" && (
        <button
          onClick={() => {
            if (step === "email") navigate("/login");
            else setStep(step === "password" ? "otp" : "email");
            setFormError("");
          }}
          className="mb-6 flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <ArrowLeft size={15} /> Back
        </button>
      )}
      <FormHeader title={copy.title} description={copy.description} />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
          className="space-y-5"
        >
          <InlineError message={formError} />
          {step === "email" && (
            <>
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void sendCode()}
              />
              <Button
                className="w-full"
                loading={requestReset.isPending}
                onClick={sendCode}
              >
                {requestReset.isPending
                  ? "Generating reset code…"
                  : "Generate verification code"}
              </Button>
            </>
          )}
          {step === "otp" && (
            <>
              {developmentOtp && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--muted)]">
                  Development code:{" "}
                  <button
                    type="button"
                    className="font-semibold tracking-[0.18em] text-[var(--ink)]"
                    onClick={() => setOtp(developmentOtp)}
                  >
                    {developmentOtp}
                  </button>
                </div>
              )}
              <OtpInput value={otp} onChange={setOtp} />
              <Button
                className="w-full"
                disabled={otp.length !== 6}
                onClick={() => {
                  setFormError("");
                  setStep("password");
                }}
              >
                Continue
              </Button>
              <div className="text-center text-sm text-[var(--muted)]">
                {seconds > 0 ? (
                  <>Resend available in 0:{seconds.toString().padStart(2, "0")}</>
                ) : (
                  <button
                    className="text-link"
                    onClick={async () => {
                      try {
                        const result = await requestReset.mutateAsync();
                        if (result.otp) {
                          setDevelopmentOtp(result.otp);
                          setOtp(result.otp);
                        }
                        reset();
                        toast.success("A new development reset code is ready.");
                      } catch (error) {
                        setFormError(errorMessage(error));
                      }
                    }}
                  >
                    Resend code
                  </button>
                )}
              </div>
            </>
          )}
          {step === "password" && (
            <>
              <PasswordInput
                label="New password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <PasswordRules password={newPassword} />
              <PasswordInput
                label="Confirm new password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <Button
                className="w-full"
                loading={confirmReset.isPending}
                onClick={resetPassword}
              >
                Reset password
              </Button>
            </>
          )}
          {step === "success" && (
            <div className="text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >
                <CheckCircle2 size={31} />
              </motion.div>
              <Button className="mt-7 w-full" onClick={() => navigate("/login")}>
                Return to sign in
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}
