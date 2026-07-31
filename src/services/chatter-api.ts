import {
  apiRequest,
  logoutSession,
  restoreSession,
  uploadAvatar,
} from "@/src/lib/api-client";
import type {
  AuthUser,
  LoginRequest,
  MessageResponse,
  NotificationSettingsUpdate,
  OtpGenerationResponse,
  PasswordResetConfirmRequest,
  PrivacySettingsUpdate,
  ProfileDetail,
  RendererLoginResponse,
  Settings,
  SignupRequest,
  ThemePreference,
  UserDetail,
  UsernameAvailability,
} from "@/src/types/api";

export const authApi = {
  signup: (body: SignupRequest) =>
    apiRequest<RendererLoginResponse>({
      path: "/api/v1/auth/signup",
      method: "POST",
      body,
      remember: true,
    }),
  login: (body: LoginRequest) =>
    apiRequest<RendererLoginResponse>({
      path: "/api/v1/auth/login",
      method: "POST",
      body,
      remember: true,
    }),
  checkUsername: (username: string) =>
    apiRequest<UsernameAvailability>({
      path: `/api/v1/auth/username/check?username=${encodeURIComponent(username)}`,
    }),
  requestPasswordReset: (email: string) =>
    apiRequest<OtpGenerationResponse>({
      path: "/api/v1/auth/password-reset/request",
      method: "POST",
      body: { email },
    }),
  confirmPasswordReset: (body: PasswordResetConfirmRequest) =>
    apiRequest<MessageResponse>({
      path: "/api/v1/auth/password-reset/confirm",
      method: "POST",
      body,
    }),
  me: () => apiRequest<AuthUser>({ path: "/api/v1/auth/me" }),
  restoreSession,
  logout: logoutSession,
};

export const userApi = {
  me: () => apiRequest<UserDetail>({ path: "/api/v1/users/me" }),
  updateProfile: (body: { display_name?: string | null }) =>
    apiRequest<ProfileDetail>({
      path: "/api/v1/profiles/me",
      method: "PATCH",
      body,
    }),
  uploadAvatar,
};

export const settingsApi = {
  get: () => apiRequest<Settings>({ path: "/api/v1/settings/" }),
  updateTheme: (theme: ThemePreference) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/theme",
      method: "PATCH",
      body: { theme },
    }),
  updateNotifications: (body: NotificationSettingsUpdate) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/notifications",
      method: "PATCH",
      body,
    }),
  updatePrivacy: (body: PrivacySettingsUpdate) =>
    apiRequest<Settings>({
      path: "/api/v1/settings/privacy",
      method: "PATCH",
      body,
    }),
};
