"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { Toaster } from "sonner";
import {
  ForgotPasswordPage,
  LoginPage,
  SignupPage,
  WelcomePage,
} from "@/src/features/auth/auth-pages";
import { useHydrated } from "@/src/app/use-hydrated";
import { OnboardingWizard } from "@/src/features/onboarding/onboarding-wizard";
import { DesktopShell } from "@/src/features/shell/desktop-shell";
import { ApiError, getLocalPreferences } from "@/src/lib/api-client";
import { authApi } from "@/src/services/chatter-api";
import { useAuthStore } from "@/src/stores/app-stores";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  if (status === "booting") return null;
  if (status !== "authenticated") return <Navigate to="/login" replace />;
  return children;
}

function AnonymousOnlyRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  if (status === "booting") return null;
  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function SessionBootstrap({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const setSession = useAuthStore((state) => state.setSession);
  const finishBoot = useAuthStore((state) => state.finishBoot);

  useEffect(() => {
    let active = true;
    authApi
      .restoreSession()
      .then((user) => {
        if (active && user) setSession(user);
      })
      .catch(() => {
        // Invalid sessions become signed out.
      })
      .finally(() => {
        if (active) finishBoot();
      });
    return () => {
      active = false;
    };
  }, [finishBoot, setSession]);

  if (status === "booting") return null;
  return children;
}

function OnboardingCompleteRoute({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const completion = useQuery({
    queryKey: ["onboarding-completion", user?.id],
    enabled: Boolean(user),
    queryFn: getLocalPreferences,
  });
  if (completion.isLoading) return null;
  if (
    !user ||
    !completion.data?.completed_onboarding_user_ids.includes(user.id)
  ) {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function AppRoutes() {
  const status = useAuthStore((state) => state.status);
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={status === "authenticated" ? "/dashboard" : "/login"}
            replace
          />
        }
      />
      <Route
        path="/login"
        element={
          <AnonymousOnlyRoute>
            <LoginPage />
          </AnonymousOnlyRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <AnonymousOnlyRoute>
            <SignupPage />
          </AnonymousOnlyRoute>
        }
      />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route
        path="/welcome"
        element={
          <ProtectedRoute>
            <WelcomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingWizard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <OnboardingCompleteRoute>
              <DesktopShell />
            </OnboardingCompleteRoute>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function ChatterApp() {
  const hydrated = useHydrated();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiError) {
                if (error.status >= 400 && error.status < 500) {
                  return error.status === 429 && failureCount < 2;
                }
                return failureCount < 2;
              }
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
          },
          mutations: { retry: false },
        },
      }),
  );

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <SessionBootstrap>
          <AppRoutes />
        </SessionBootstrap>
      </HashRouter>
      <Toaster
        position="top-right"
        richColors
        toastOptions={{ className: "font-sans" }}
      />
    </QueryClientProvider>
  );
}
