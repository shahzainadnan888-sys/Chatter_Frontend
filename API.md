# Chatter Frontend API Integration Reference

> Source of truth: the runtime output of `app.main.app.openapi()` and the current routers, Pydantic schemas, services, ORM models, middleware, and WebSocket implementation. Generated against the development configuration on 2026-07-30. Do not treat conceptual product features as implemented unless listed here.

## Table of contents

- [Scope and backend realities](#scope-and-backend-realities)
- [Base URLs and conventions](#base-urls-and-conventions)
- [Errors and status codes](#errors-and-status-codes)
- [Authentication and account flows](#authentication-and-account-flows)
- [Onboarding mapping](#onboarding-mapping)
- [Media, messages, and feature limits](#media-messages-and-feature-limits)
- [TypeScript integration](#typescript-integration)
- [HTTP endpoint reference](#http-endpoint-reference)
- [WebSockets](#websockets)
- [Machine-auditable checklist](#machine-auditable-checklist)

## Scope and backend realities

The generated OpenAPI contains **191 HTTP operations across 160 distinct paths**. The WebSocket router adds **8 routes**, which OpenAPI does not describe.

Important current behavior and limitations:

- Signup accepts exactly `email`, `password`, and `username`. It does **not** accept `full_name`.
- Local development signup stores credentials and a six-digit OTP in Redis for 10 minutes and returns the OTP directly. The database account is created only after successful verification.
- There is no accent-color field or dedicated accent-color API. Store a desktop-only accent locally, or coordinate a backend schema change; do not put it into undocumented settings fields by assumption.
- There is no thumbnail URL contract. Media returns one storage `url` plus metadata; the frontend must not derive or claim a backend thumbnail URL.
- Discord-style **Servers** (`/api/v1/servers`, `/ws/servers/{server_id}`) are a separate module from Groups. Do not reuse Groups APIs for server sidebar/channels/roles. Permission checks are enforced server-side on every mutating endpoint.
- Status Stories are private: only the owner, accepted friends, and (when visibility is `friends_and_groups`) shared group / group-chat peers may see a status. Blocked users are excluded. Statuses expire after 24 hours and expired/archived statuses are never returned in feeds.
- Calls persist call/participant state and expose JWT-authenticated `/ws/calls` WebRTC signaling (SDP/ICE relay, ring/accept/reject/end). The backend does not proxy media; ICE servers are returned by `GET /api/v1/calls/ice-servers`.
- There are no GIF-search or GIF-provider endpoints. GIF files are accepted by the image uploader as `image/gif`. Server channels implement mention parsing (`@user`, `@everyone`, `@here`, roles) plus `GET /api/v1/servers/{server_id}/mentions/autocomplete`. Direct-message/group mention engines remain limited to content/settings.
- Message types are `text`, `image`, `video`, `document`, `voice`, `location`, `system`, `poll`, `announcement`. Users cannot send `system` or `announcement`. Media types require `media_id`; text requires content. `location` and `poll` are accepted by the enum without a dedicated payload schema in the message request.
- Most HTTP mutations do not publish WebSocket events. Status mutations do notify allowed viewers in-process via `send_to_user` (`status_created`, `status_deleted`, `status_updated`, `status_viewed`, `status_reacted`, `status_replied`). The connection manager is process-local, so multi-worker fan-out is not implemented.
- `two_factor_enabled` and mention notification settings are persisted settings, but no second-factor login flow or mention engine is implemented.
- Search `/search/users` currently searches username **and email** server-side while returning no email. Consider whether that privacy behavior is intended.

## Base URLs and conventions

- Local HTTP example: `http://localhost:8000`; API prefix: `/api/v1`.
- Local WebSocket example: `ws://localhost:8000`. Use `https://`/`wss://` in production and inject the origin through environment/config, never hard-code it.
- API discovery: `/openapi.json`, `/docs`, `/redoc`.
- JSON uses UTF-8 and snake_case. IDs are UUID strings; timestamps are ISO-8601. Send/interpret times as UTC.
- Authenticated HTTP requests use `Authorization: Bearer <access_token>`. JSON bodies use `Content-Type: application/json`; uploads use browser/Electron-generated `multipart/form-data`.
- Optional `X-Request-ID` is echoed as `X-Request-ID`; responses also include `X-Process-Time-Ms`. Generate a UUID per logical request and log it with failures.
- Default per-IP/per-path rate limit is 100 requests per 60 seconds. Health, readiness, docs, ReDoc, and OpenAPI are exempt. The limiter fails open if Redis fails and emits no `Retry-After` header.
- OpenAPI lists only declared success and framework 422 responses. Application-level 400/401/403/404/409/429/500/503 remain possible as documented here.

### Response shapes

There is no universal success envelope. Expect one of:

```json
{"success": true, "message": "..."}
```

```json
{"success": true, "data": [], "total": 0, "page": 1, "page_size": 20, "has_more": false}
```

or a bare resource/list object. Notifications use `{items,total,unread_count}`; groups/calls/search commonly return bare arrays. A 204 response has no body.

All handled errors share:

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [{"type": "missing", "loc": ["body", "field"], "msg": "Field required", "input": {}}]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

`details` and `request_id` are optional. Never display raw `details` or upstream AI errors directly to users in production; log them with the request ID and map known codes to safe copy.

## Errors and status codes

- **400 Bad Request**: app-level default for an `AppException`, though current named exception classes usually select a more specific status. Framework HTTP errors use code `http_error`.
- **401 Unauthorized**: app-level auth failures (`unauthorized`) such as missing/expired/invalid access token, bad credentials, bad/expired OTP, or invalid/revoked refresh token. Refresh once only for an expired access token; clear tokens and show login if refresh fails.
- **403 Forbidden**: app-level authorization/state failure (`forbidden`): inactive/suspended account, membership/ownership/privacy/role restriction. Do not retry; explain access loss and invalidate stale resource state.
- **404 Not Found**: app-level missing resource (`not_found`) and framework unknown route (`http_error`). Remove stale cached entries and navigate safely.
- **409 Conflict**: app-level state/uniqueness conflict (`conflict`), including duplicate username/friendship/reaction, already-joined resources, or ended calls. Re-fetch canonical state before presenting another action.
- **413 Payload Too Large**: **not emitted by current application upload code**. Oversized media and AI audio are app `ValidationError` responses with status **422**. A reverse proxy may independently emit 413 with a nonstandard body.
- **415 Unsupported Media Type**: **not emitted by current application upload code**. Unsupported declared MIME types produce app **422** with allowed types in error details. FastAPI may also produce 422 for malformed multipart input. A proxy may emit 415.
- **422 Unprocessable Entity**: framework request validation and app validation both use `validation_error`; includes schema constraints, unsupported MIME, upload size, invalid business payloads, and OTP reset state. Bind field errors from `details[].loc` where possible.
- **429 Too Many Requests**: middleware-generated `rate_limit_exceeded`; app-level and no `Retry-After`. Back off until the configured window elapses, add jitter, and avoid automatic mutation replay.
- **500 Internal Server Error**: global app handler emits `internal_error` with safe text. Treat as transient only for idempotent reads; log request ID.
- **503 Service Unavailable**: app-level dependency failures (`service_unavailable`) from AI, presence, or location backing services. Offer retry with backoff and preserve user input.

## Authentication and account flows

Access JWT lifetime defaults to 15 minutes (`expires_in` is seconds); refresh JWT lifetime defaults to 30 days. Refresh tokens are hashed in the database and rotated on every refresh. Access tokens carry `sub`, `exp`, `iat`, `type=access`, `jti`, `username`, and `role`; refresh tokens carry analogous claims and `type=refresh`.

### Secure Electron storage

Keep tokens out of React state persistence, localStorage, IndexedDB, URL fragments, logs,
crash reports, and renderer-accessible files. Store the refresh token in the OS credential
vault from the Electron main process (for example, Keychain/Credential Manager/libsecret
through a maintained keychain library). Keep the access token in main-process memory.
Expose narrow, validated IPC methods such as `apiRequest`, `signIn`, and `signOut` through
a context-isolated preload; do not expose raw vault or Node APIs. Redact `Authorization`,
refresh bodies, OTPs, and WebSocket token query strings from logs.

Current logout revokes the supplied refresh token. Although the service can blacklist an access JTI, the router does not pass it, so the existing access token remains usable until expiration. Password reset/change and admin suspension revoke database refresh tokens, but already-issued access tokens remain usable until auth re-check observes account status or expiry.

### Flow sequences

1. **Signup**: optionally check username; call signup with email/password/username; on 200 read the local-development OTP and show the verification screen.
2. **Verify**: submit email + exactly six-character OTP; on 201 atomically store both tokens and user, then bootstrap profile/settings/chats/notifications.
3. **Login**: submit email/password. Only verified database accounts can log in; successful login returns tokens + user.
4. **Refresh**: when one request receives an access-token 401, join one global refresh promise. On success atomically replace both tokens and replay eligible requests once. Never concurrently reuse a rotating refresh token.
5. **Logout**: call with bearer access token and optional refresh token, then always clear local credentials and close sockets. The request is successful even if the optional refresh token is malformed.
6. **Password reset**: request returns a local-development OTP for an existing account; confirm uses email + OTP + policy-compliant password and revokes all refresh tokens.
7. **Change password**: bearer auth + current/new password; successful change revokes all refresh tokens, so clear the current refresh token and require login (the current access token can live until expiry).

## Onboarding mapping

Use only these real APIs:

1. Identity: `GET /api/v1/auth/username/check`, then signup and email verification.
2. Display name, bio, status, phone: `PATCH /api/v1/profiles/me`. `display_name` is the nearest real field to a conceptual full name.
3. Avatar: `POST /api/v1/profiles/me/avatar` with JPEG, PNG, or WebP.
4. Theme/language/privacy/notifications/security preferences: the relevant `/api/v1/settings/*` PATCH endpoint.
5. Discover people: `/api/v1/users/search` or `/api/v1/search/users`; send friend requests with `/api/v1/users/friends/request`.
6. Create a conversation by username: `POST /api/v1/chats/`.

No backend endpoint records onboarding completion, accent color, contact import, topic selection, or device registration. Keep such progress locally unless a backend contract is added.

## Media, messages, and feature limits

Maximum upload size is currently 25 MiB for media, avatars, and AI speech audio (configuration can change). The backend trusts the multipart MIME declaration and reads the entire ordinary media upload into memory before checking size.

Exact accepted MIME declarations:

- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/heic`.
- Video: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`.
- Documents: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `application/zip`.
- Voice: `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/wav`, `audio/webm`, `audio/aac`.
- Avatar/profile: `image/jpeg`, `image/png`, `image/webp`.
- AI speech-to-text does not validate MIME, but rejects empty or oversized files and may return `available:false` when the whisper model is not configured.

Upload first, then send a message with the returned `id` as `media_id`. Sending binds an unbound media record to that chat. Direct `GET/DELETE /media/{file_id}` is uploader-only even though file search can return shared-chat media URLs. A message response includes `media_id`, not the media object; resolve metadata separately only when authorized/cached.

Delete-for-everyone is sender-only and limited to 24 hours. Delete-for-me is per-user. Read/delivered markers operate through the marker message (all eligible messages through that position), despite singular request field names.

## TypeScript integration

```ts
export type UUID = string;
export type ISODate = string;
export type MessageType =
  | "text" | "image" | "video" | "document" | "voice"
  | "location" | "system" | "poll" | "announcement";

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
  request_id?: string;
}
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
}
export interface Paginated<T> {
  success: true; data: T[]; total: number;
  page: number; page_size: number; has_more: boolean;
}
export interface WsIncoming { type: string; payload?: Record<string, unknown> }
export interface WsEvent {
  id: UUID; type: string; sender_id: UUID | null; room: string | null;
  payload: Record<string, unknown>; timestamp: ISODate;
}
```

### Startup sequence

1. Main process reads the refresh token from the OS vault; do not expose it to the renderer.
2. If present, refresh once. If absent/invalid, show logged-out routes.
3. Fetch `/auth/me` or `/users/me`, then in parallel fetch profile, settings, first chat page, and notification summary.
4. Open presence and notifications sockets only after access auth succeeds; open room sockets on demand.
5. Render cached non-sensitive UI immediately where appropriate, then revalidate. Never cache credentials or sensitive admin data in renderer persistence.

```ts
let refreshInFlight: Promise<TokenPair> | null = null;
async function refreshOnce(): Promise<TokenPair> {
  if (!refreshInFlight) {
    refreshInFlight = electronAuth.refreshFromVault()
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, replay = true): Promise<T> {
  const token = await electronAuth.getInMemoryAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Request-ID", crypto.randomUUID());
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_ORIGIN}${path}`, { ...init, headers });
  if (response.status === 401 && replay && token) {
    await refreshOnce();
    return request<T>(path, init, false);
  }
  if (!response.ok) throw await parseApiError(response);
  return response.status === 204 ? (undefined as T) : response.json();
}
```

Retries: automatically retry idempotent GET requests for network errors, 500, and 503 with capped exponential backoff + jitter. Respect the 429 window. Do not automatically retry POST/PATCH/DELETE without an idempotency contract (none exists). Preserve forms and offer an explicit retry.

Uploads: validate declared MIME and 25 MiB limit before dispatch, use `FormData.append("file", file)` (or `audio` for AI speech), support cancellation, and show determinate progress through Electron networking/XHR if needed. No resumable/chunked upload API exists.

Caching/invalidation: key paginated queries by every query argument. Invalidate chats after
chat actions and message sends; messages + chat list after message mutations; group and
associated chat lists after membership changes; notifications after read/delete; profile/user
search after profile or username edits; settings after any settings patch. Optimistic updates
are suitable for favorite/mute/read/reaction with rollback; avoid optimistic upload, group
role, admin, call-end, and auth state changes.

Loading/empty/error: use skeletons for first reads, retain stale lists while paging/revalidating, provide explicit empty copy for valid empty arrays, and keep mutation errors next to the initiating control. On 401 refresh once; 403 remove inaccessible actions; 404 evict stale detail; 409 re-fetch; 422 bind fields; 429 countdown/backoff; 500/503 preserve input and offer retry.

## HTTP endpoint reference

Each operation below is generated from the current OpenAPI operation and cross-checked with service behavior. `Authorization` is omitted only where Auth says Public. Unless stated otherwise, authenticated operations also require an active, email-verified account. The standard handled error body is the envelope shown above.

### Authentication

#### `POST /api/v1/auth/signup` — Generate local development signup OTP
- **Auth / permissions:** Public; no bearer token.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID`.
- **Path/query parameters:** none.
- **Request body:** `SignupStartRequest`: `email` (valid email), `password` (8–128 characters with uppercase, lowercase, and digit), `username` (3–30 characters; letters, numbers, `_`, `.`; normalized lowercase; reserved names and invalid periods rejected).
```json
{"email":"user@example.com","password":"StrongPass1","username":"alice"}
```
- **Success:** HTTP `200`. No database account is created yet. Signup credentials are held with the OTP in Redis for 600 seconds.
```json
{
  "success": true,
  "message": "OTP generated successfully.",
  "development": true,
  "otp": "483921",
  "expires_in": 600
}
```
- **Validation:** Existing database email or username returns 409. A new signup for the same unverified email replaces the previous Redis OTP and pending signup payload.
- **Status codes:** `200`, `409`, `422`, `429`, `500`.
- **Frontend notes:** This local-development response intentionally exposes the OTP. Navigate immediately to verification and never use this contract in production.
- **Common mistakes:** expecting a pending user row, omitting password complexity, or prefixing stored username with `@`.
- **Loading state:** Disable submit and show “Generating code…”.
- **Empty state:** Not applicable.
- **Error handling:** Preserve form input on 422; show email/username conflict on 409; retry a Redis/server failure only after user action.
- **Error example:**
```json
{
  "success": false,
  "error": {"code": "validation_error", "message": "Request validation failed"},
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/verify-email` — Verify local OTP and create account
- **Auth / permissions:** Public; no bearer token.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID`.
- **Path/query parameters:** none.
- **Request body:** `VerifyEmailRequest`: `email` (valid email) and `otp` (exactly six characters).
```json
{"email":"user@example.com","otp":"483921"}
```
- **Success:** HTTP `201`. Creates the active verified user, default profile/settings, and returns a rotated-capable JWT pair.
```json
{
  "success": true,
  "message": "Welcome to Chatter!",
  "tokens": {"access_token":"<jwt>","refresh_token":"<jwt>","token_type":"bearer","expires_in":900},
  "user": {"id":"11111111-1111-4111-8111-111111111111","email":"user@example.com","username":"alice","role":"user","status":"active","is_email_verified":true,"created_at":"2026-07-30T00:00:00Z"}
}
```
- **Validation:** OTP must match the Redis entry and be unexpired; maximum failed attempts is five. Email/username uniqueness is checked again before account creation.
- **Status codes:** `201`, `401`, `409`, `422`, `429`, `500`.
- **Frontend notes:** Store tokens only after this response succeeds, clear the OTP UI, then run authenticated bootstrap requests.
- **Common mistakes:** changing the email between signup and verification or treating the numeric-looking OTP as a number (leading zeroes matter).
- **Loading state:** Disable verification and show “Creating account…”.
- **Empty state:** If local pending state is lost or expired, return to signup.
- **Error handling:** Show invalid/expired OTP for 401, conflict guidance for 409, and preserve the entered email for retry.
- **Error example:**
```json
{
  "success": false,
  "error": {"code": "validation_error", "message": "Request validation failed"},
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/resend-otp` — Replace local signup OTP
- **Auth / permissions:** Public; no bearer token.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID`.
- **Path/query parameters:** none.
- **Request body:** `ResendOTPRequest` with the same signup `email`.
```json
{"email":"user@example.com"}
```
- **Success:** HTTP `200`. Atomically invalidates the previous code while preserving the pending signup payload in Redis.
```json
{"success":true,"message":"OTP generated successfully.","development":true,"otp":"827441","expires_in":600}
```
- **Validation:** Requires an active unexpired signup payload. The returned OTP is exactly six digits.
- **Status codes:** `200`, `422`, `429`, `500`.
- **Frontend notes:** Replace the displayed/stored development code and restart the 10-minute countdown.
- **Common mistakes:** calling after the pending signup payload expired; in that case call signup again.
- **Loading state:** Disable resend while the request is pending.
- **Empty state:** Missing pending signup redirects to signup.
- **Error handling:** On 422 explain that signup must be restarted; do not keep accepting the old code.
- **Error example:**
```json
{
  "success": false,
  "error": {"code": "validation_error", "message": "Request validation failed"},
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/login` — Login with email and password
- **Auth / permissions:** Public (no bearer token). Public; account/OTP state checks still apply.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `LoginRequest` via `application/json`. Fields/validation:
  - `email` — `Email`; required; format email.
  - `password` — `Password`; required; schema type Password.
```json
{
  "email": "user@example.com",
  "password": "<strong-password>"
}
```
- **Success:** HTTP `200` with `LoginResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `tokens` — `TokenResponse`; required; schema type TokenResponse.
  - `user` — `AuthUserResponse`; required; schema type AuthUserResponse.
```json
{
  "success": true,
  "tokens": {
    "access_token": "<token>",
    "refresh_token": "<token>",
    "expires_in": 1
  },
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "user@example.com",
    "username": "alice",
    "role": "string",
    "status": "string",
    "is_email_verified": true,
    "created_at": "2026-07-30T00:00:00Z"
  }
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/refresh` — Rotate refresh token
- **Auth / permissions:** Public (no bearer token). Public; account/OTP state checks still apply.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `RefreshTokenRequest` via `application/json`. Fields/validation:
  - `refresh_token` — `Refresh Token`; required; schema type Refresh Token.
```json
{
  "refresh_token": "<token>"
}
```
- **Success:** HTTP `200` with `LoginResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `tokens` — `TokenResponse`; required; schema type TokenResponse.
  - `user` — `AuthUserResponse`; required; schema type AuthUserResponse.
```json
{
  "success": true,
  "tokens": {
    "access_token": "<token>",
    "refresh_token": "<token>",
    "expires_in": 1
  },
  "user": {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "user@example.com",
    "username": "alice",
    "role": "string",
    "status": "string",
    "is_email_verified": true,
    "created_at": "2026-07-30T00:00:00Z"
  }
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `429`, `500`.
- **Frontend notes:** Serialize refresh calls with a mutex; replace both tokens atomically because refresh tokens rotate.
- **Common mistakes:** sending form data instead of JSON.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/logout` — Logout and revoke tokens
- **Auth / permissions:** Bearer access JWT. Active authenticated user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `LogoutRequest` via `application/json`. Fields/validation:
  - `refresh_token` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "refresh_token": "<token>"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/password-reset/request` — Generate local password-reset OTP
- **Auth / permissions:** Public; no bearer token.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID`.
- **Path/query parameters:** none.
- **Request body:** `PasswordResetRequest` with a valid account email.
```json
{"email":"user@example.com"}
```
- **Success:** HTTP `200`. Stores a new password-reset OTP in Redis for 600 seconds, replacing any previous reset code.
```json
{"success":true,"message":"OTP generated successfully.","development":true,"otp":"762115","expires_in":600}
```
- **Validation:** The account must exist; unknown email returns 422 in this local-development contract.
- **Status codes:** `200`, `422`, `429`, `500`.
- **Frontend notes:** Navigate to the reset form and keep OTP as a string.
- **Common mistakes:** assuming account-enumeration protection; local development intentionally returns the code and validates account existence.
- **Loading state:** Disable submit and show “Generating reset code…”.
- **Empty state:** Not applicable.
- **Error handling:** Bind invalid email errors and allow deliberate retry on infrastructure failures.
- **Error example:**
```json
{
  "success": false,
  "error": {"code": "validation_error", "message": "Request validation failed"},
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/password-reset/confirm` — Password Reset Confirm
- **Auth / permissions:** Public (no bearer token). Public; account/OTP state checks still apply.
- **Headers:** `Accept: application/json`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PasswordResetConfirmRequest` via `application/json`. Fields/validation:
  - `email` — `Email`; required; format email.
  - `otp` — `Otp`; required; min length 6; max length 6.
  - `new_password` — `New Password`; required; min length 8; max length 128.
```json
{
  "email": "user@example.com",
  "otp": "123456",
  "new_password": "<strong-password>"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/auth/change-password` — Change Password
- **Auth / permissions:** Bearer access JWT. Active authenticated user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChangePasswordRequest` via `application/json`. Fields/validation:
  - `current_password` — `Current Password`; required; schema type Current Password.
  - `new_password` — `New Password`; required; min length 8; max length 128.
```json
{
  "current_password": "<strong-password>",
  "new_password": "<strong-password>"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/auth/username/check` — Check username availability
- **Auth / permissions:** Public (no bearer token). No account or OTP state is required.
- **Headers:** `Accept: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `username` (query, required): `Username`; min length 3; max length 30.
- **Request body:** none.
- **Success:** HTTP `200` with an implementation-defined object (`application/json`). OpenAPI leaves this object unconstrained; the current service returns:
  - `available` — boolean; `true` when no normalized username match exists.
  - `username` — normalized lowercase username.
  - `reason` — `null`, a validation reason, or `Username is already taken`.
```json
{
  "available": true,
  "username": "alice",
  "reason": null
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `429`, `500`.
- **Frontend notes:** Debounce checks and ignore stale responses. A syntactically invalid username can still return HTTP 200 with `available:false` and a `reason`; FastAPI returns 422 only when the query length is outside 3–30.
- **Common mistakes:** treating every 200 as available, or sending the display casing without using the normalized returned `username`.
- **Loading state:** Show a small inline checking indicator without blocking unrelated form fields.
- **Empty state:** Before the minimum length is reached, do not call the endpoint; show local validation instead.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/auth/me` — Get current authenticated user
- **Auth / permissions:** Bearer access JWT. Active authenticated user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `AuthUserResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `email` — `Email`; required; format email.
  - `username` — `Username`; required; schema type Username.
  - `role` — `Role`; required; schema type Role.
  - `status` — `Status`; required; schema type Status.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "username": "alice",
  "role": "string",
  "status": "string",
  "is_email_verified": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Users

#### `GET /api/v1/users/me` — Get the current user
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `UserDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `email` — `Email`; required; format email.
  - `role` — `Role`; required; schema type Role.
  - `status` — `Status`; required; schema type Status.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "created_at": "2026-07-30T00:00:00Z",
  "email": "user@example.com",
  "role": "string",
  "status": "string",
  "is_email_verified": true,
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/users/me/username` — Update the current user's username
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `UsernameUpdateRequest` via `application/json`. Fields/validation:
  - `username` — `Username`; required; min length 3; max length 30.
```json
{
  "username": "alice"
}
```
- **Success:** HTTP `200` with `UserDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `email` — `Email`; required; format email.
  - `role` — `Role`; required; schema type Role.
  - `status` — `Status`; required; schema type Status.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "created_at": "2026-07-30T00:00:00Z",
  "email": "user@example.com",
  "role": "string",
  "status": "string",
  "is_email_verified": true,
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `409`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/users/search` — Search users
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `q` (query, required): `Q`; min length 2; max length 100.
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_UserPublicResponse_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<UserPublicResponse>`; required; schema type array<UserPublicResponse>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "username": "alice",
      "is_online": true,
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/users/block` — Block a user
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `BlockRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `201` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/users/unblock` — Unblock a user
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `BlockRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/users/blocked` — List blocked users
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_UserPublicResponse_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<UserPublicResponse>`; required; schema type array<UserPublicResponse>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "username": "alice",
      "is_online": true,
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/users/report` — Report a user
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ReportRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
  - `reason` — `Reason`; required; min length 3; max length 100.
  - `description` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "reason": "spam",
  "description": "string"
}
```
- **Success:** HTTP `201` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/users/friends/request` — Send a friend request
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `FriendRequestCreate` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `201` with `FriendRequestResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `from_user_id` — `From User Id`; required; format uuid.
  - `to_user_id` — `To User Id`; required; format uuid.
  - `status` — `Status`; required; schema type Status.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "from_user_id": "11111111-1111-4111-8111-111111111111",
  "to_user_id": "11111111-1111-4111-8111-111111111111",
  "status": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/users/friends/accept` — Accept a friend request
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `FriendRequestCreate` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `FriendRequestResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `from_user_id` — `From User Id`; required; format uuid.
  - `to_user_id` — `To User Id`; required; format uuid.
  - `status` — `Status`; required; schema type Status.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "from_user_id": "11111111-1111-4111-8111-111111111111",
  "to_user_id": "11111111-1111-4111-8111-111111111111",
  "status": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/users/friends/reject` — Reject a friend request
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `FriendRequestCreate` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `FriendRequestResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `from_user_id` — `From User Id`; required; format uuid.
  - `to_user_id` — `To User Id`; required; format uuid.
  - `status` — `Status`; required; schema type Status.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "from_user_id": "11111111-1111-4111-8111-111111111111",
  "to_user_id": "11111111-1111-4111-8111-111111111111",
  "status": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/users/friends/{friend_id}` — Remove a friend
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `friend_id` (path, required): `Friend Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/users/friends` — List friends
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_UserPublicResponse_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<UserPublicResponse>`; required; schema type array<UserPublicResponse>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "username": "alice",
      "is_online": true,
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/users/friends/requests` — List pending friend requests
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `incoming` (query, optional): `Incoming`; schema type Incoming; default `True`.
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_FriendRequestResponse_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<FriendRequestResponse>`; required; schema type array<FriendRequestResponse>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "from_user_id": "11111111-1111-4111-8111-111111111111",
      "to_user_id": "11111111-1111-4111-8111-111111111111",
      "status": "string",
      "created_at": "2026-07-30T00:00:00Z",
      "updated_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/users/{username}` — Get a user by username
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `username` (path, required): `Username`; schema type Username.
- **Request body:** none.
- **Success:** HTTP `200` with `UserPublicResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Profiles

#### `GET /api/v1/profiles/me` — Get the current user's profile
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `ProfileDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `cover_url` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `phone` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "cover_url": "string",
  "status_message": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "phone": "string"
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/profiles/me` — Update the current user's profile
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ProfileUpdateRequest` via `application/json`. Fields/validation:
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `phone` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "display_name": "string",
  "bio": "string",
  "status_message": "string",
  "phone": "string"
}
```
- **Success:** HTTP `200` with `ProfileDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `cover_url` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `phone` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "cover_url": "string",
  "status_message": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "phone": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/profiles/me/avatar` — Upload the current user's avatar
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_upload_avatar_api_v1_profiles_me_avatar_post` via `multipart/form-data`. Fields/validation:
  - `file` — `File`; required; schema type File.
```json
{
  "file": "string"
}
```
- **Success:** HTTP `200` with `ProfileDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `cover_url` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `phone` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "cover_url": "string",
  "status_message": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "phone": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/profiles/me/avatar` — Delete the current user's avatar
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `ProfileDetailResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `cover_url` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `phone` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "cover_url": "string",
  "status_message": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "phone": "string"
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/profiles/{username}` — Get a profile by username
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `username` (path, required): `Username`; schema type Username.
- **Request body:** none.
- **Success:** HTTP `200` with `ProfilePublicResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `username` — `Username`; required; schema type Username.
  - `display_name` — `string | null`; optional/nullable; schema type string | null.
  - `bio` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `cover_url` — `string | null`; optional/nullable; schema type string | null.
  - `status_message` — `string | null`; optional/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "username": "alice",
  "display_name": "string",
  "bio": "string",
  "avatar_url": "string",
  "cover_url": "string",
  "status_message": "string",
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Chats

#### `GET /api/v1/chats/` — List Chats
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
  - `archived` (query, optional): `Archived`; schema type Archived; default `False`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_ChatListItem_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<ChatListItem>`; required; schema type array<ChatListItem>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "type": "direct",
      "title": null,
      "last_message_at": null,
      "last_message_preview": null,
      "is_archived": true,
      "is_favorite": true,
      "is_muted": true,
      "muted_until": null,
      "unread_count": 1,
      "participant_count": 1,
      "updated_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/` — Create Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CreateChatRequest` via `application/json`. Fields/validation:
  - `participant_username` — `Participant Username`; required; min length 3; max length 30.
  - `title` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "participant_username": "string",
  "title": "string"
}
```
- **Success:** HTTP `201` with `ChatResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `type` — `ChatType`; required; enum: direct, group.
  - `title` — `string | null`; required/nullable; schema type string | null.
  - `last_message_at` — `string | null`; required/nullable; schema type string | null.
  - `last_message_preview` — `string | null`; required/nullable; schema type string | null.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `is_archived` — `Is Archived`; required; schema type Is Archived.
  - `is_favorite` — `Is Favorite`; required; schema type Is Favorite.
  - `is_muted` — `Is Muted`; required; schema type Is Muted.
  - `muted_until` — `string | null`; required/nullable; schema type string | null.
  - `unread_count` — `Unread Count`; required; schema type Unread Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `participants` — `array<ChatParticipantResponse>`; required; schema type array<ChatParticipantResponse>.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "type": "direct",
  "title": "string",
  "last_message_at": "2026-07-30T00:00:00Z",
  "last_message_preview": "string",
  "is_active": true,
  "is_archived": true,
  "is_favorite": true,
  "is_muted": true,
  "muted_until": "2026-07-30T00:00:00Z",
  "unread_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "participants": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "username": "alice",
      "is_online": true,
      "joined_at": "2026-07-30T00:00:00Z"
    }
  ]
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/archive` — Archive Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/unarchive` — Unarchive Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/favorite` — Favorite Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/unfavorite` — Unfavorite Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/mute` — Mute Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/chats/unmute` — Unmute Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ChatActionRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/chats/{chat_id}` — Get Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `chat_id` (path, required): `Chat Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `ChatResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `type` — `ChatType`; required; enum: direct, group.
  - `title` — `string | null`; required/nullable; schema type string | null.
  - `last_message_at` — `string | null`; required/nullable; schema type string | null.
  - `last_message_preview` — `string | null`; required/nullable; schema type string | null.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `is_archived` — `Is Archived`; required; schema type Is Archived.
  - `is_favorite` — `Is Favorite`; required; schema type Is Favorite.
  - `is_muted` — `Is Muted`; required; schema type Is Muted.
  - `muted_until` — `string | null`; required/nullable; schema type string | null.
  - `unread_count` — `Unread Count`; required; schema type Unread Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
  - `participants` — `array<ChatParticipantResponse>`; required; schema type array<ChatParticipantResponse>.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "type": "direct",
  "title": "string",
  "last_message_at": "2026-07-30T00:00:00Z",
  "last_message_preview": "string",
  "is_active": true,
  "is_archived": true,
  "is_favorite": true,
  "is_muted": true,
  "muted_until": "2026-07-30T00:00:00Z",
  "unread_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z",
  "participants": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "username": "alice",
      "is_online": true,
      "joined_at": "2026-07-30T00:00:00Z"
    }
  ]
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/chats/{chat_id}` — Leave Chat
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `chat_id` (path, required): `Chat Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Messages

#### `POST /api/v1/messages/` — Send Message
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SendMessageRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
  - `content` — `string | null`; optional/nullable; schema type string | null.
  - `type` — `MessageType`; optional; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `media_id` — `string | null`; optional/nullable; schema type string | null.
  - `reply_to_id` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "content": "Hello",
  "type": "text",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `201` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/delete-for-everyone` — Delete For Everyone
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `MessageIdRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/reply` — Reply
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ReplyRequest` via `application/json`. Fields/validation:
  - `chat_id` — `Chat Id`; required; format uuid.
  - `reply_to_id` — `Reply To Id`; required; format uuid.
  - `content` — `string | null`; optional/nullable; schema type string | null.
  - `type` — `MessageType`; optional; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `media_id` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "reply_to_id": "11111111-1111-4111-8111-111111111111",
  "content": "Hello",
  "type": "text",
  "media_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `201` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/forward` — Forward
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ForwardRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
  - `target_chat_id` — `Target Chat Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111",
  "target_chat_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `201` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/react` — React
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ReactRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
  - `emoji` — `Emoji`; required; min length 1; max length 32.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111",
  "emoji": "string"
}
```
- **Success:** HTTP `200` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/messages/react` — Remove Reaction
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ReactRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
  - `emoji` — `Emoji`; required; min length 1; max length 32.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111",
  "emoji": "string"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/pin` — Pin
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PinRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/messages/pin` — Unpin
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PinRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/read` — Mark Read
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ReadRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/messages/delivered` — Mark Delivered
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `DeliveredRequest` via `application/json`. Fields/validation:
  - `message_id` — `Message Id`; required; format uuid.
```json
{
  "message_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/messages/seen-by/{message_id}` — Seen By
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `message_id` (path, required): `Message Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `array<SeenByResponse>` (`application/json`). Response fields:
  - Array items: `SeenByResponse`.
```json
[
  {
    "user_id": "11111111-1111-4111-8111-111111111111",
    "username": "alice",
    "delivered_at": "2026-07-30T00:00:00Z",
    "read_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/messages/{chat_id}` — List Messages
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `chat_id` (path, required): `Chat Id`; format uuid.
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `50`.
- **Request body:** none.
- **Success:** HTTP `200` with `PaginatedResponse_MessageResponse_` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `data` — `array<app__messages__schemas__MessageResponse>`; required; schema type array<app__messages__schemas__MessageResponse>.
  - `total` — `Total`; required; schema type Total.
  - `page` — `Page`; required; schema type Page.
  - `page_size` — `Page Size`; required; schema type Page Size.
  - `has_more` — `Has More`; required; schema type Has More.
```json
{
  "success": true,
  "data": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "chat_id": "11111111-1111-4111-8111-111111111111",
      "sender": {
        "id": "11111111-1111-4111-8111-111111111111",
        "username": "alice"
      },
      "type": "text",
      "content": null,
      "media_id": null,
      "reply_to": null,
      "forwarded_from_id": null,
      "is_edited": true,
      "edited_at": null,
      "is_deleted": true,
      "deleted_for_everyone": true,
      "deleted_at": null,
      "is_pinned": true,
      "reactions": [
        {
          "user_id": "11111111-1111-4111-8111-111111111111",
          "emoji": "👍",
          "created_at": "2026-07-30T00:00:00Z"
        }
      ],
      "delivered_count": 1,
      "read_count": 1,
      "created_at": "2026-07-30T00:00:00Z",
      "updated_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 1,
  "has_more": true
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/messages/{message_id}` — Edit Message
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `message_id` (path, required): `Message Id`; format uuid.
- **Request body:** `EditMessageRequest` via `application/json`. Fields/validation:
  - `content` — `Content`; required; min length 1; max length 10000.
```json
{
  "content": "Hello"
}
```
- **Success:** HTTP `200` with `app__messages__schemas__MessageResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `Chat Id`; required; format uuid.
  - `sender` — `MessageSenderResponse`; required; schema type MessageSenderResponse.
  - `type` — `MessageType`; required; enum: text, image, video, document, voice, location, system, poll, announcement.
  - `content` — `string | null`; required/nullable; schema type string | null.
  - `media_id` — `string | null`; required/nullable; schema type string | null.
  - `reply_to` — `ReplyPreviewResponse | null`; required/nullable; schema type ReplyPreviewResponse | null.
  - `forwarded_from_id` — `string | null`; required/nullable; schema type string | null.
  - `is_edited` — `Is Edited`; required; schema type Is Edited.
  - `edited_at` — `string | null`; required/nullable; schema type string | null.
  - `is_deleted` — `Is Deleted`; required; schema type Is Deleted.
  - `deleted_for_everyone` — `Deleted For Everyone`; required; schema type Deleted For Everyone.
  - `deleted_at` — `string | null`; required/nullable; schema type string | null.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `reactions` — `array<MessageReactionResponse>`; required; schema type array<MessageReactionResponse>.
  - `delivered_count` — `Delivered Count`; required; schema type Delivered Count.
  - `read_count` — `Read Count`; required; schema type Read Count.
  - `created_at` — `Created At`; required; format date-time.
  - `updated_at` — `Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "sender": {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice"
  },
  "type": "text",
  "content": "Hello",
  "media_id": "11111111-1111-4111-8111-111111111111",
  "reply_to": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "type": "text",
    "content": null,
    "is_deleted": true,
    "deleted_for_everyone": true
  },
  "forwarded_from_id": "11111111-1111-4111-8111-111111111111",
  "is_edited": true,
  "edited_at": "2026-07-30T00:00:00Z",
  "is_deleted": true,
  "deleted_for_everyone": true,
  "deleted_at": "2026-07-30T00:00:00Z",
  "is_pinned": true,
  "reactions": [
    {
      "user_id": "11111111-1111-4111-8111-111111111111",
      "emoji": "string",
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "delivered_count": 1,
  "read_count": 1,
  "created_at": "2026-07-30T00:00:00Z",
  "updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/messages/{message_id}` — Delete For Me
- **Auth / permissions:** Bearer access JWT. Active user; resource operations require active chat membership/participation.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `message_id` (path, required): `Message Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Media

#### `POST /api/v1/media/upload-image` — Upload Image
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_upload_image_api_v1_media_upload_image_post` via `multipart/form-data`. Fields/validation:
  - `file` — `File`; required; schema type File.
```json
{
  "file": "string"
}
```
- **Success:** HTTP `201` with `MediaFileResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `uploader_id` — `Uploader Id`; required; format uuid.
  - `kind` — `MediaKind`; required; enum: image, video, document, voice, profile.
  - `public_id` — `Public Id`; required; schema type Public Id.
  - `url` — `Url`; required; schema type Url.
  - `resource_type` — `Resource Type`; required; schema type Resource Type.
  - `format` — `string | null`; required/nullable; schema type string | null.
  - `content_type` — `string | null`; required/nullable; schema type string | null.
  - `original_filename` — `string | null`; required/nullable; schema type string | null.
  - `bytes` — `Bytes`; required; schema type Bytes.
  - `width` — `integer | null`; required/nullable; schema type integer | null.
  - `height` — `integer | null`; required/nullable; schema type integer | null.
  - `duration` — `number | null`; required/nullable; schema type number | null.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "uploader_id": "11111111-1111-4111-8111-111111111111",
  "kind": "image",
  "public_id": "string",
  "url": "string",
  "resource_type": "string",
  "format": "string",
  "content_type": "string",
  "original_filename": "string",
  "bytes": 1,
  "width": 1,
  "height": 1,
  "duration": 1.0,
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/media/upload-video` — Upload Video
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_upload_video_api_v1_media_upload_video_post` via `multipart/form-data`. Fields/validation:
  - `file` — `File`; required; schema type File.
```json
{
  "file": "string"
}
```
- **Success:** HTTP `201` with `MediaFileResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `uploader_id` — `Uploader Id`; required; format uuid.
  - `kind` — `MediaKind`; required; enum: image, video, document, voice, profile.
  - `public_id` — `Public Id`; required; schema type Public Id.
  - `url` — `Url`; required; schema type Url.
  - `resource_type` — `Resource Type`; required; schema type Resource Type.
  - `format` — `string | null`; required/nullable; schema type string | null.
  - `content_type` — `string | null`; required/nullable; schema type string | null.
  - `original_filename` — `string | null`; required/nullable; schema type string | null.
  - `bytes` — `Bytes`; required; schema type Bytes.
  - `width` — `integer | null`; required/nullable; schema type integer | null.
  - `height` — `integer | null`; required/nullable; schema type integer | null.
  - `duration` — `number | null`; required/nullable; schema type number | null.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "uploader_id": "11111111-1111-4111-8111-111111111111",
  "kind": "image",
  "public_id": "string",
  "url": "string",
  "resource_type": "string",
  "format": "string",
  "content_type": "string",
  "original_filename": "string",
  "bytes": 1,
  "width": 1,
  "height": 1,
  "duration": 1.0,
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/media/upload-document` — Upload Document
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_upload_document_api_v1_media_upload_document_post` via `multipart/form-data`. Fields/validation:
  - `file` — `File`; required; schema type File.
```json
{
  "file": "string"
}
```
- **Success:** HTTP `201` with `MediaFileResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `uploader_id` — `Uploader Id`; required; format uuid.
  - `kind` — `MediaKind`; required; enum: image, video, document, voice, profile.
  - `public_id` — `Public Id`; required; schema type Public Id.
  - `url` — `Url`; required; schema type Url.
  - `resource_type` — `Resource Type`; required; schema type Resource Type.
  - `format` — `string | null`; required/nullable; schema type string | null.
  - `content_type` — `string | null`; required/nullable; schema type string | null.
  - `original_filename` — `string | null`; required/nullable; schema type string | null.
  - `bytes` — `Bytes`; required; schema type Bytes.
  - `width` — `integer | null`; required/nullable; schema type integer | null.
  - `height` — `integer | null`; required/nullable; schema type integer | null.
  - `duration` — `number | null`; required/nullable; schema type number | null.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "uploader_id": "11111111-1111-4111-8111-111111111111",
  "kind": "image",
  "public_id": "string",
  "url": "string",
  "resource_type": "string",
  "format": "string",
  "content_type": "string",
  "original_filename": "string",
  "bytes": 1,
  "width": 1,
  "height": 1,
  "duration": 1.0,
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/media/upload-voice` — Upload Voice
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_upload_voice_api_v1_media_upload_voice_post` via `multipart/form-data`. Fields/validation:
  - `file` — `File`; required; schema type File.
```json
{
  "file": "string"
}
```
- **Success:** HTTP `201` with `MediaFileResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `uploader_id` — `Uploader Id`; required; format uuid.
  - `kind` — `MediaKind`; required; enum: image, video, document, voice, profile.
  - `public_id` — `Public Id`; required; schema type Public Id.
  - `url` — `Url`; required; schema type Url.
  - `resource_type` — `Resource Type`; required; schema type Resource Type.
  - `format` — `string | null`; required/nullable; schema type string | null.
  - `content_type` — `string | null`; required/nullable; schema type string | null.
  - `original_filename` — `string | null`; required/nullable; schema type string | null.
  - `bytes` — `Bytes`; required; schema type Bytes.
  - `width` — `integer | null`; required/nullable; schema type integer | null.
  - `height` — `integer | null`; required/nullable; schema type integer | null.
  - `duration` — `number | null`; required/nullable; schema type number | null.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "uploader_id": "11111111-1111-4111-8111-111111111111",
  "kind": "image",
  "public_id": "string",
  "url": "string",
  "resource_type": "string",
  "format": "string",
  "content_type": "string",
  "original_filename": "string",
  "bytes": 1,
  "width": 1,
  "height": 1,
  "duration": 1.0,
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send `FormData`; do not manually set the multipart boundary. Show byte progress client-side where available.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/media/{file_id}` — Get Media
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `file_id` (path, required): `File Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `MediaFileResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `uploader_id` — `Uploader Id`; required; format uuid.
  - `kind` — `MediaKind`; required; enum: image, video, document, voice, profile.
  - `public_id` — `Public Id`; required; schema type Public Id.
  - `url` — `Url`; required; schema type Url.
  - `resource_type` — `Resource Type`; required; schema type Resource Type.
  - `format` — `string | null`; required/nullable; schema type string | null.
  - `content_type` — `string | null`; required/nullable; schema type string | null.
  - `original_filename` — `string | null`; required/nullable; schema type string | null.
  - `bytes` — `Bytes`; required; schema type Bytes.
  - `width` — `integer | null`; required/nullable; schema type integer | null.
  - `height` — `integer | null`; required/nullable; schema type integer | null.
  - `duration` — `number | null`; required/nullable; schema type number | null.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "uploader_id": "11111111-1111-4111-8111-111111111111",
  "kind": "image",
  "public_id": "string",
  "url": "string",
  "resource_type": "string",
  "format": "string",
  "content_type": "string",
  "original_filename": "string",
  "bytes": 1,
  "width": 1,
  "height": 1,
  "duration": 1.0,
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/media/{file_id}` — Delete Media
- **Auth / permissions:** Bearer access JWT. Active user; direct get/delete is uploader-only.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `file_id` (path, required): `File Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Groups

#### `POST /api/v1/groups/` — Create Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `GroupCreateRequest` via `application/json`. Fields/validation:
  - `name` — `Name`; required; min length 1; max length 100.
  - `description` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `visibility` — `GroupVisibility`; optional; enum: public, private.
  - `max_members` — `Max Members`; optional; min 2.0; max 5000.0.
```json
{
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "max_members": 500
}
```
- **Success:** HTTP `201` with `GroupResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `name` — `Name`; required; schema type Name.
  - `description` — `string | null`; required/nullable; schema type string | null.
  - `avatar_url` — `string | null`; required/nullable; schema type string | null.
  - `visibility` — `GroupVisibility`; required; enum: public, private.
  - `invite_code` — `Invite Code`; required; schema type Invite Code.
  - `owner_id` — `Owner Id`; required; format uuid.
  - `member_count` — `Member Count`; required; schema type Member Count.
  - `max_members` — `Max Members`; required; schema type Max Members.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "invite_code": "string",
  "owner_id": "11111111-1111-4111-8111-111111111111",
  "member_count": 1,
  "max_members": 1,
  "is_active": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/groups/` — List Groups
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<GroupResponse>` (`application/json`). Response fields:
  - Array items: `GroupResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "string",
    "description": "string",
    "avatar_url": "string",
    "visibility": "public",
    "invite_code": "string",
    "owner_id": "11111111-1111-4111-8111-111111111111",
    "member_count": 1,
    "max_members": 1,
    "is_active": true,
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/join` — Join Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `GroupJoinRequest` via `application/json`. Fields/validation:
  - `invite_code` — `Invite Code`; required; min length 1; max length 32.
```json
{
  "invite_code": "string"
}
```
- **Success:** HTTP `200` with `GroupResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `name` — `Name`; required; schema type Name.
  - `description` — `string | null`; required/nullable; schema type string | null.
  - `avatar_url` — `string | null`; required/nullable; schema type string | null.
  - `visibility` — `GroupVisibility`; required; enum: public, private.
  - `invite_code` — `Invite Code`; required; schema type Invite Code.
  - `owner_id` — `Owner Id`; required; format uuid.
  - `member_count` — `Member Count`; required; schema type Member Count.
  - `max_members` — `Max Members`; required; schema type Max Members.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "invite_code": "string",
  "owner_id": "11111111-1111-4111-8111-111111111111",
  "member_count": 1,
  "max_members": 1,
  "is_active": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/leave` — Leave Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `GroupActionRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/invite` — Invite Member
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `GroupInviteRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
  - `invited_user_id` — `string | null`; optional/nullable; schema type string | null.
  - `email` — `string | null`; optional/nullable; schema type string | null.
  - `expires_in_hours` — `Expires In Hours`; optional; min 1.0; max 720.0.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111",
  "invited_user_id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "expires_in_hours": 72
}
```
- **Success:** HTTP `201` with `GroupInviteResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `group_id` — `Group Id`; required; format uuid.
  - `invited_by_id` — `Invited By Id`; required; format uuid.
  - `invited_user_id` — `string | null`; required/nullable; schema type string | null.
  - `email` — `string | null`; required/nullable; schema type string | null.
  - `token` — `Token`; required; schema type Token.
  - `expires_at` — `Expires At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "invited_by_id": "11111111-1111-4111-8111-111111111111",
  "invited_user_id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "token": "<token>",
  "expires_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/remove-member` — Remove Member
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `RemoveMemberRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/groups/member-role` — Update Member Role
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `MemberRoleRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `role` — `GroupMemberRole`; required; enum: member, admin, owner.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "role": "member"
}
```
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/announcement` — Create Announcement
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `AnnouncementCreateRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
  - `title` — `Title`; required; min length 1; max length 200.
  - `body` — `Body`; required; min length 1; max length 10000.
  - `is_pinned` — `Is Pinned`; optional; schema type Is Pinned.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111",
  "title": "string",
  "body": "string",
  "is_pinned": true
}
```
- **Success:** HTTP `201` with `AnnouncementResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `group_id` — `Group Id`; required; format uuid.
  - `author_id` — `Author Id`; required; format uuid.
  - `title` — `Title`; required; schema type Title.
  - `body` — `Body`; required; schema type Body.
  - `is_pinned` — `Is Pinned`; required; schema type Is Pinned.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "author_id": "11111111-1111-4111-8111-111111111111",
  "title": "string",
  "body": "string",
  "is_pinned": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/groups/poll` — Create Poll
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PollCreateRequest` via `application/json`. Fields/validation:
  - `group_id` — `Group Id`; required; format uuid.
  - `question` — `Question`; required; min length 1; max length 500.
  - `options` — `array<string>`; required; min items 2; max items 20.
  - `is_anonymous` — `Is Anonymous`; optional; schema type Is Anonymous.
  - `allows_multiple` — `Allows Multiple`; optional; schema type Allows Multiple.
  - `closes_at` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "group_id": "11111111-1111-4111-8111-111111111111",
  "question": "string",
  "options": [
    "string"
  ],
  "is_anonymous": false,
  "allows_multiple": false,
  "closes_at": "2026-07-30T00:00:00Z"
}
```
- **Success:** HTTP `201` with `PollResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `group_id` — `Group Id`; required; format uuid.
  - `author_id` — `Author Id`; required; format uuid.
  - `question` — `Question`; required; schema type Question.
  - `is_anonymous` — `Is Anonymous`; required; schema type Is Anonymous.
  - `allows_multiple` — `Allows Multiple`; required; schema type Allows Multiple.
  - `closes_at` — `string | null`; required/nullable; schema type string | null.
  - `is_closed` — `Is Closed`; required; schema type Is Closed.
  - `options` — `array<PollOptionResponse>`; required; schema type array<PollOptionResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "author_id": "11111111-1111-4111-8111-111111111111",
  "question": "string",
  "is_anonymous": true,
  "allows_multiple": true,
  "closes_at": "2026-07-30T00:00:00Z",
  "is_closed": true,
  "options": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "text": "Example text",
      "vote_count": 1,
      "position": 1
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/groups/{group_id}` — Get Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `group_id` (path, required): `Group Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `GroupResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `name` — `Name`; required; schema type Name.
  - `description` — `string | null`; required/nullable; schema type string | null.
  - `avatar_url` — `string | null`; required/nullable; schema type string | null.
  - `visibility` — `GroupVisibility`; required; enum: public, private.
  - `invite_code` — `Invite Code`; required; schema type Invite Code.
  - `owner_id` — `Owner Id`; required; format uuid.
  - `member_count` — `Member Count`; required; schema type Member Count.
  - `max_members` — `Max Members`; required; schema type Max Members.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "invite_code": "string",
  "owner_id": "11111111-1111-4111-8111-111111111111",
  "member_count": 1,
  "max_members": 1,
  "is_active": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/groups/{group_id}` — Update Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `group_id` (path, required): `Group Id`; format uuid.
- **Request body:** `GroupUpdateRequest` via `application/json`. Fields/validation:
  - `name` — `string | null`; optional/nullable; schema type string | null.
  - `description` — `string | null`; optional/nullable; schema type string | null.
  - `avatar_url` — `string | null`; optional/nullable; schema type string | null.
  - `visibility` — `GroupVisibility | null`; optional/nullable; schema type GroupVisibility | null.
  - `max_members` — `integer | null`; optional/nullable; schema type integer | null.
```json
{
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "max_members": 2
}
```
- **Success:** HTTP `200` with `GroupResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `name` — `Name`; required; schema type Name.
  - `description` — `string | null`; required/nullable; schema type string | null.
  - `avatar_url` — `string | null`; required/nullable; schema type string | null.
  - `visibility` — `GroupVisibility`; required; enum: public, private.
  - `invite_code` — `Invite Code`; required; schema type Invite Code.
  - `owner_id` — `Owner Id`; required; format uuid.
  - `member_count` — `Member Count`; required; schema type Member Count.
  - `max_members` — `Max Members`; required; schema type Max Members.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "string",
  "description": "string",
  "avatar_url": "string",
  "visibility": "public",
  "invite_code": "string",
  "owner_id": "11111111-1111-4111-8111-111111111111",
  "member_count": 1,
  "max_members": 1,
  "is_active": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/groups/{group_id}` — Delete Group
- **Auth / permissions:** Bearer access JWT. Active user; membership required for reads/polls, owner/admin for management, owner-only for delete/role changes.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `group_id` (path, required): `Group Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `app__utils__schemas__MessageResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `message` — `Message`; required; schema type Message.
```json
{
  "success": true,
  "message": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Calls

#### `POST /api/v1/calls/start` — Start Call
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `StartCallRequest` via `application/json`. Fields/validation:
  - `chat_id` — `string | null`; optional/nullable; schema type string | null.
  - `group_id` — `string | null`; optional/nullable; schema type string | null.
  - `type` — `CallType`; optional; enum: audio, video.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio"
}
```
- **Success:** HTTP `201` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `201`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/join` — Join Call
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/end` — End Call
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/calls/history` — Call History
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<CallResponse>` (`application/json`). Response fields:
  - Array items: `CallResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "chat_id": "11111111-1111-4111-8111-111111111111",
    "group_id": "11111111-1111-4111-8111-111111111111",
    "initiator_id": "11111111-1111-4111-8111-111111111111",
    "type": "audio",
    "status": "ringing",
    "started_at": "2026-07-30T00:00:00Z",
    "ended_at": "2026-07-30T00:00:00Z",
    "duration_seconds": 1,
    "room_id": "string",
    "is_group_call": true,
    "video_enabled": true,
    "participants": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "user_id": "11111111-1111-4111-8111-111111111111",
        "joined_at": null,
        "left_at": null,
        "is_muted": false,
        "is_video_enabled": false
      }
    ],
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/mute` — Mute
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/unmute` — Unmute
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/video/start` — Start Video
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/calls/video/end` — End Video
- **Auth / permissions:** Bearer access JWT. Active user; chat/group access required; active participant for state changes; initiator-only to end.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `CallActionRequest` via `application/json`. Fields/validation:
  - `call_id` — `Call Id`; required; format uuid.
```json
{
  "call_id": "11111111-1111-4111-8111-111111111111"
}
```
- **Success:** HTTP `200` with `CallResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `group_id` — `string | null`; required/nullable; schema type string | null.
  - `initiator_id` — `Initiator Id`; required; format uuid.
  - `type` — `CallType`; required; enum: audio, video.
  - `status` — `CallStatus`; required; enum: ringing, active, ended, missed, declined.
  - `started_at` — `string | null`; required/nullable; schema type string | null.
  - `ended_at` — `string | null`; required/nullable; schema type string | null.
  - `duration_seconds` — `integer | null`; required/nullable; schema type integer | null.
  - `room_id` — `Room Id`; required; schema type Room Id.
  - `is_group_call` — `Is Group Call`; required; schema type Is Group Call.
  - `video_enabled` — `Video Enabled`; required; schema type Video Enabled.
  - `participants` — `array<CallParticipantResponse>`; required; schema type array<CallParticipantResponse>.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "group_id": "11111111-1111-4111-8111-111111111111",
  "initiator_id": "11111111-1111-4111-8111-111111111111",
  "type": "audio",
  "status": "ringing",
  "started_at": "2026-07-30T00:00:00Z",
  "ended_at": "2026-07-30T00:00:00Z",
  "duration_seconds": 1,
  "room_id": "string",
  "is_group_call": true,
  "video_enabled": true,
  "participants": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "user_id": "11111111-1111-4111-8111-111111111111",
      "joined_at": null,
      "left_at": null,
      "is_muted": true,
      "is_video_enabled": true
    }
  ],
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `409`, `429`, `500`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### AI

#### `POST /api/v1/ai/speech-to-text` — Speech To Text
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `Body_speech_to_text_api_v1_ai_speech_to_text_post` via `multipart/form-data`. Fields/validation:
  - `audio` — `Audio`; required; schema type Audio.
```json
{
  "audio": "string"
}
```
- **Success:** HTTP `200` with `SpeechToTextResponse` (`application/json`). Response fields:
  - `available` — `Available`; required; schema type Available.
  - `text` — `string | null`; optional/nullable; schema type string | null.
  - `language` — `string | null`; optional/nullable; schema type string | null.
  - `message` — `string | null`; optional/nullable; schema type string | null.
  - `source` — `Source`; optional; enum: groq, configuration.
```json
{
  "available": true,
  "text": "Example text",
  "language": "en",
  "message": "string",
  "source": "groq"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** setting `Content-Type` manually; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/ai/suggest-replies` — Suggest Replies
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SuggestRepliesRequest` via `application/json`. Fields/validation:
  - `messages` — `array<string>`; required; min items 1; max items 50.
  - `count` — `Count`; optional; min 1.0; max 8.0.
  - `tone` — `Tone`; optional; max length 50.
```json
{
  "messages": [
    "string"
  ],
  "count": 3,
  "tone": "natural"
}
```
- **Success:** HTTP `200` with `SuggestedRepliesResponse` (`application/json`). Response fields:
  - `replies` — `array<string>`; required; schema type array<string>.
```json
{
  "replies": [
    "string"
  ]
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/ai/rewrite` — Rewrite
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `RewriteRequest` via `application/json`. Fields/validation:
  - `text` — `Text`; required; min length 1; max length 20000.
  - `tone` — `Tone`; optional; max length 100.
```json
{
  "text": "Example text",
  "tone": "clear and natural"
}
```
- **Success:** HTTP `200` with `TextResult` (`application/json`). Response fields:
  - `result` — `Result`; required; schema type Result.
```json
{
  "result": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/ai/translate` — Translate
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `TranslateRequest` via `application/json`. Fields/validation:
  - `text` — `Text`; required; min length 1; max length 20000.
  - `target_language` — `Target Language`; required; min length 2; max length 50.
```json
{
  "text": "Example text",
  "target_language": "string"
}
```
- **Success:** HTTP `200` with `TextResult` (`application/json`). Response fields:
  - `result` — `Result`; required; schema type Result.
```json
{
  "result": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/ai/summarize-chat` — Summarize
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SummarizeRequest` via `application/json`. Fields/validation:
  - `messages` — `array<string>`; required; min items 1; max items 500.
  - `max_words` — `Max Words`; optional; min 25.0; max 500.0.
```json
{
  "messages": [
    "string"
  ],
  "max_words": 150
}
```
- **Success:** HTTP `200` with `TextResult` (`application/json`). Response fields:
  - `result` — `Result`; required; schema type Result.
```json
{
  "result": "string"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/ai/search` — Semantic Search
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SemanticSearchRequest` via `application/json`. Fields/validation:
  - `query` — `Query`; required; min length 1; max length 1000.
  - `texts` — `array<string>`; required; min items 1; max items 200.
  - `limit` — `Limit`; optional; min 1.0; max 50.0.
```json
{
  "query": "string",
  "texts": [
    "string"
  ],
  "limit": 10
}
```
- **Success:** HTTP `200` with `SemanticSearchResponse` (`application/json`). Response fields:
  - `matches` — `array<SemanticMatch>`; required; schema type array<SemanticMatch>.
```json
{
  "matches": [
    {
      "index": 1,
      "text": "Example text",
      "relevance": 1.0
    }
  ]
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Status

WhatsApp-style Status Stories. Statuses are never public. A viewer may see a status only when they are the owner, an accepted friend, or (if `visibility` is `friends_and_groups`) a shared group / group-chat peer. Mutual blocks hide statuses. Every status expires 24 hours after creation; expired and non-owner archived statuses are omitted from feeds and detail reads.

Wire format is snake_case. Map to frontend camelCase (`display_name` → `displayName`, `media_url` → `mediaUrl`, etc.) in the Status transport layer.

Shared `StatusResponse` shape:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "author": {
    "id": "22222222-2222-4222-8222-222222222222",
    "username": "alice",
    "display_name": "Alice",
    "avatar_url": "https://example.com/a.png"
  },
  "kind": "text",
  "media_type": "text",
  "text": "Hello",
  "media_url": null,
  "thumbnail_url": null,
  "caption": null,
  "emoji": "👋",
  "background_color": "#111827",
  "visibility": "friends_and_groups",
  "created_at": "2026-07-31T12:00:00Z",
  "expires_at": "2026-08-01T12:00:00Z",
  "viewed_at": null,
  "viewer_count": 0,
  "like_count": 0,
  "reply_count": 0,
  "liked_by_me": false,
  "is_muted": false,
  "is_own": true
}
```

`media_type` / `kind` enum: `text`, `image`, `video`, `voice`.  
`visibility` enum: `friends`, `friends_and_groups` (default).  
Feed `section` enum: `recent`, `viewed`, `muted`.

Realtime (in-process `send_to_user` to allowed viewers): `status_created`, `status_deleted`, `status_updated`, `status_viewed`, `status_reacted`, `status_replied`. Clients should still revalidate HTTP after reconnect.

#### `POST /api/v1/status` — Create Status (multipart)
- **Auth / permissions:** Bearer access JWT. Active authenticated user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: multipart/form-data`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `multipart/form-data` fields:
  - `media_type` — optional; enum: text, image, video, voice; default `text`.
  - `caption` — optional string; max 500.
  - `text` — optional string; max 2000; required for text statuses without media.
  - `emoji` — optional string; max 32.
  - `background_color` — optional string; max 32.
  - `media_id` — optional UUID of a previously uploaded media file owned by the user.
  - `visibility` — optional; enum: friends, friends_and_groups; default `friends_and_groups`.
  - `file` — optional upload for image/video/voice.
- **Success:** HTTP `201` with `StatusResponse` (`application/json`).
- **Status codes:** OpenAPI declares `201`, `422`. Runtime also `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Prefer this for drafts that still have a local `File`. Do not set `Content-Type` manually.
- **Common mistakes:** sending JSON to this route; omitting `text` on a text status; uploading a file with `media_type=text` without expecting the server to coerce to image when a file is present.

#### `POST /api/v1/status/json` — Create Status (JSON)
- **Auth / permissions:** Bearer access JWT. Active authenticated user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Request body:** `StatusCreateRequest`:
```json
{
  "media_type": "image",
  "kind": "image",
  "caption": "Sunset",
  "text": null,
  "emoji": null,
  "background_color": null,
  "media_id": "33333333-3333-4333-8333-333333333333",
  "media_url": null,
  "thumbnail_url": null,
  "visibility": "friends_and_groups"
}
```
- **Success:** HTTP `201` with `StatusResponse`.
- **Status codes:** `201`, `422` (+ `401`, `403`, `429`, `500`, `503`).
- **Frontend notes:** Upload via `/api/v1/media/upload-image|video|voice` first, then pass `media_id`.

#### `GET /api/v1/status/me` — My Status
- **Auth / permissions:** Bearer access JWT.
- **Success:** HTTP `200` with `StatusListResponse`:
```json
{
  "success": true,
  "data": [ /* StatusResponse[] of the current user's non-expired, non-archived statuses */ ]
}
```
- **Status codes:** `200`, `422` (+ `401`, `429`, `500`).

#### `GET /api/v1/status/feed` — Status Feed
- **Auth / permissions:** Bearer access JWT.
- **Success:** HTTP `200` with `StatusFeedResponse`:
```json
{
  "success": true,
  "data": [
    {
      "author": {
        "id": "22222222-2222-4222-8222-222222222222",
        "username": "bob",
        "display_name": "Bob",
        "avatar_url": null
      },
      "statuses": [ /* StatusResponse[] */ ],
      "section": "recent",
      "unseen_count": 2,
      "latest_at": "2026-07-31T12:00:00Z"
    }
  ]
}
```
- **Notes:** Groups only include friends / shared-group peers the viewer may see. Blocked and public-only users never appear. `section` is `muted` if the author is muted, else `viewed` when all items were viewed, else `recent`.
- **Status codes:** `200`, `422` (+ `401`, `429`, `500`).

#### `GET /api/v1/status/{status_id}` — Get Status
- **Auth / permissions:** Bearer access JWT. Must be owner, friend, or allowed shared-group peer; otherwise `403`. Expired → `404`.
- **Path parameters:** `status_id` (UUID).
- **Success:** HTTP `200` with `StatusResponse`.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `DELETE /api/v1/status/{status_id}` — Delete Status
- **Auth / permissions:** Bearer access JWT. Owner only (`403` otherwise).
- **Success:** HTTP `200` with `StatusDeleteResponse` `{ "success": true, "message": "Status deleted" }`.
- **Side effects:** emits `status_deleted` to allowed viewers.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `POST /api/v1/status/{status_id}/archive` — Archive Status
- **Auth / permissions:** Bearer access JWT. Owner only.
- **Success:** HTTP `200` with `StatusResponse` (archived; hidden from others’ feeds).
- **Side effects:** emits `status_updated` with `{ "archived": true }`.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `POST /api/v1/status/view` — Mark Viewed
- **Auth / permissions:** Bearer access JWT. Viewer must be allowed to view the status. Owner self-views are no-ops.
- **Request body:**
```json
{ "status_id": "11111111-1111-4111-8111-111111111111" }
```
- **Success:** HTTP `200` `{ "success": true }`.
- **Side effects:** emits `status_viewed`.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `POST /api/v1/status/react` — React
- **Auth / permissions:** Bearer access JWT. Allowed viewer; cannot react to own status (`422`).
- **Request body:**
```json
{
  "status_id": "11111111-1111-4111-8111-111111111111",
  "emoji": "❤️"
}
```
- **Success:** HTTP `200` with updated `StatusResponse` (`liked_by_me` / `like_count` reflect reactions).
- **Side effects:** emits `status_reacted`.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `POST /api/v1/status/unreact` — Remove Reaction
- **Auth / permissions:** Bearer access JWT. Allowed viewer.
- **Request body:** `{ "status_id": "<uuid>" }`.
- **Success:** HTTP `200` with updated `StatusResponse`.
- **Side effects:** emits `status_reacted` with `{ "removed": true }`.

#### `POST /api/v1/status/reply` — Reply
- **Auth / permissions:** Bearer access JWT. Allowed viewer.
- **Request body:**
```json
{
  "status_id": "11111111-1111-4111-8111-111111111111",
  "message": "Nice!"
}
```
- **Success:** HTTP `200` with `StatusReplyResponse`:
```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "author": {
    "id": "22222222-2222-4222-8222-222222222222",
    "username": "alice",
    "display_name": "Alice",
    "avatar_url": null
  },
  "text": "Nice!",
  "created_at": "2026-07-31T12:05:00Z"
}
```
- **Side effects:** marks viewed for non-owners; emits `status_replied`.
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `GET /api/v1/status/viewers/{status_id}` — Status Viewers
- **Auth / permissions:** Bearer access JWT. **Owner only** (`403` otherwise).
- **Success:** HTTP `200` with `array<StatusViewerResponse>`:
```json
[
  {
    "user": {
      "id": "22222222-2222-4222-8222-222222222222",
      "username": "bob",
      "display_name": "Bob",
      "avatar_url": null
    },
    "viewed_at": "2026-07-31T12:01:00Z",
    "liked": true,
    "replied": false
  }
]
```
- **Status codes:** `200`, `422` (+ `401`, `403`, `404`, `429`, `500`).

#### `POST /api/v1/status/mute/{author_id}` — Mute Author
- **Auth / permissions:** Bearer access JWT. Cannot mute self.
- **Success:** HTTP `200` `{ "success": true }`. Muted authors appear under feed `section: "muted"`.

#### `POST /api/v1/status/unmute/{author_id}` — Unmute Author
- **Auth / permissions:** Bearer access JWT.
- **Success:** HTTP `200` `{ "success": true }`.


### Servers

Discord-style community servers. Completely separate from Groups (`/api/v1/groups`). Module root: `app/servers/`. All routes require Bearer access JWT unless noted. Membership + role permissions are enforced on every endpoint; never trust the frontend.

#### Concepts

- **Server**: name, description, icon, banner, owner, invite code, verification level, default notifications, members, roles, categories, channels, emojis.
- **Channel types**: `text`, `voice`, `video`, `announcement`, `stage`, `read_only`.
- **Roles**: `@everyone` (default), `Admin`, `Moderator`, plus custom roles. Permissions are JSON string lists; `administrator` grants all. Owner always has all permissions.
- **Invites**: permanent (server `invite_code` or invite rows), expiring (`expires_in_hours`), limited-use (`max_uses`). Track creator + uses.
- **Mentions** in message content: `@username`, `@everyone`, `@here`, role name / `@role:<uuid>`. Autocomplete via HTTP.
- **Uploads**: use existing `/api/v1/media/*` then pass `media_id` on messages.
- **Voice/video state**: Redis-backed participant list (mute/deafen/camera/screen). WebRTC media is client-side; signaling via `/ws/servers/{server_id}` events prefixed `webrtc_`.
- **Realtime**: HTTP mutations emit in-process WebSocket events to rooms `server:<id>` and optionally `server_channel:<id>`.

#### Permissions

Keys (from `GET /api/v1/servers/permissions`):

`administrator`, `manage_server`, `manage_roles`, `manage_channels`, `manage_categories`, `manage_invites`, `manage_emojis`, `manage_voice`, `manage_stage`, `kick_members`, `ban_members`, `mute_members`, `timeout_members`, `delete_messages`, `pin_messages`, `mention_everyone`, `upload_files`, `send_messages`, `read_message_history`, `connect_voice`, `speak`, `video`, `view_channels`, `create_invite`, `change_nickname`, `manage_nicknames`.

Missing permission → `403` with message `Missing permission: <key>`.

#### Shared response shapes

`ServerResponse`:
```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "name": "Chatter HQ",
  "description": "Welcome",
  "icon_url": null,
  "banner_url": null,
  "owner_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "invite_code": "AbCdEfGhIj",
  "verification_level": "none",
  "default_notifications": "all",
  "is_public": false,
  "member_count": 1,
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-01T00:00:00Z"
}
```

`ServerSidebarResponse`: `{ server, categories[], channels[], roles[], online_count, my_permissions[] }`.

`ChannelResponse` includes `unread_count`. Channel `type` enum as above.

`MessageResponse`:
```json
{
  "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "channel_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "author": {"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","username":"alice","display_name":"Alice","avatar_url":null,"is_online":false},
  "content": "hello @bob",
  "media_id": null,
  "media_url": null,
  "reply_to_id": null,
  "is_edited": false,
  "edited_at": null,
  "is_pinned": false,
  "mentions": {"users":["..."],"roles":[],"everyone":false,"here":false},
  "reactions": [{"emoji":"🔥","count":1,"me":true}],
  "created_at": "2026-08-01T00:00:00Z"
}
```

`SuccessResponse`: `{ "success": true, "message": "ok" }`.

Errors use the standard envelope (`unauthorized`, `forbidden`, `not_found`, `validation_error`, `conflict`, …).

#### `POST /api/v1/servers` — Create Server
- **Auth:** Bearer. Creates server + `@everyone`/`Admin`/`Moderator` roles + Text Channels / Voice Channels categories + `#general`, `#announcements`, voice `General` + permanent invite matching `invite_code`. Creator becomes Admin member.
- **Body:** `{ "name": "Chatter HQ", "description": optional, "icon_url": optional, "banner_url": optional }` (`name` 2–100).
- **Success:** `201` `ServerSidebarResponse`. Emits `server_created`.

#### `GET /api/v1/servers` — List My Servers
- **Success:** `200` `ServerListItem[]` — `{ server, unread_count, is_owner }`.

#### `POST /api/v1/servers/join` — Join Via Invite
- **Body:** `{ "code": "AbCdEfGhIj" }`.
- **Success:** `200` `ServerSidebarResponse`. Emits `member_joined`. Banned users → `403`.

#### `GET /api/v1/servers/invites/{code}` — Preview Invite
- **Auth:** Bearer. Returns `{ code, server, member_count }`.

#### `GET /api/v1/servers/permissions` — Permission Catalog
- **Success:** `200` `[{ "key": "manage_server", "name": "MANAGE_SERVER" }, ...]`.

#### `GET /api/v1/servers/{server_id}` — Get Server
- **Permission:** member.

#### `GET /api/v1/servers/{server_id}/sidebar` — Sidebar
- **Permission:** member. Categories, channels (with unread), roles, `my_permissions`, `online_count` (presence enrichment optional; clients may combine `/ws/presence`).

#### `PATCH /api/v1/servers/{server_id}` — Update Settings
- **Permission:** `manage_server`.
- **Body (any subset):** `name`, `description`, `icon_url`, `banner_url`, `verification_level` (`none|low|medium|high`), `default_notifications` (`all|mentions|nothing`).
- Emits `server_updated`.

#### `DELETE /api/v1/servers/{server_id}` — Delete Server
- **Permission:** owner only. Emits `server_deleted`. Cascades DB children.

#### `POST /api/v1/servers/{server_id}/leave` — Leave
- Owner cannot leave (`403`). Emits `member_left`.

#### Categories
- `GET /{server_id}/categories` — member
- `POST /{server_id}/categories` — `manage_categories`; body `{ "name", "position?" }`; emits `category_created`
- `PATCH /{server_id}/categories/{category_id}` — `manage_categories`; emits `category_updated`
- `DELETE /{server_id}/categories/{category_id}` — `manage_categories`; emits `category_deleted`

#### Channels
- `GET|POST /{server_id}/channels` — list (member) / create (`manage_channels`)
- Create body:
```json
{
  "name": "gaming",
  "type": "text",
  "category_id": null,
  "topic": null,
  "position": 0,
  "is_nsfw": false,
  "slowmode_seconds": 0,
  "bitrate": 64000,
  "user_limit": 0
}
```
  Names are normalized to lowercase-hyphen. Emits `channel_created` / `channel_updated` / `channel_deleted`.
- `GET|PATCH|DELETE /{server_id}/channels/{channel_id}`
- `POST /{server_id}/channels/{channel_id}/read?message_id=` — mark read / clear unread; emits `unread_updated`
- `POST|DELETE /{server_id}/channels/{channel_id}/typing` — emits `typing_started` / `typing_stopped`

#### Messages
- `GET /{server_id}/channels/{channel_id}/messages?before=&limit=50` — infinite scroll (`before` = older-than message id). Needs `read_message_history` + `view_channels`.
- `POST .../messages` — `{ "content"?, "media_id"?, "reply_to_id"? }`. Needs `send_messages`. Media needs `upload_files`. `@everyone`/`@here` needs `mention_everyone`. Announcement channels require staff. Read-only channels reject non-admins. Emits `message_created` (+ `mention_created` / notifications).
- `PATCH .../messages/{message_id}` — author only; emits `message_updated`
- `DELETE .../messages/{message_id}` — author or `delete_messages`; soft-delete; emits `message_deleted`
- `POST|DELETE .../messages/{message_id}/pin` — `pin_messages`
- `POST|DELETE .../messages/{message_id}/reactions` — body `{ "emoji": "🔥" }`; emits `reaction_added` / `reaction_removed`

#### Voice / Video / Stage
- `GET .../voice` — participants
- `POST .../voice/join` — needs `connect_voice`; optional body `{ muted, deafened, camera_enabled, screen_sharing }`; emits `voice_state_updated`
- `POST .../voice/leave`
- `PATCH .../voice/state` — mute/unmute/deafen/undeafen/camera/screen flags
- Full channel → `409 conflict`. Use `/ws/servers/{server_id}` for `webrtc_*` signaling; media not proxied (reuse `GET /api/v1/calls/ice-servers`).

#### Roles
- `GET|POST /{server_id}/roles` — list / create (`manage_roles`)
- Create body: `{ "name", "color"?, "permissions": ["kick_members"], "position"?, "is_mentionable"?, "hoist"? }`
- `PATCH|DELETE /{server_id}/roles/{role_id}` — cannot delete `@everyone`. Emits `role_updated` with `action` `created|updated|deleted`.

#### Members
- `GET /{server_id}/members`
- `PATCH /{server_id}/members/{user_id}` — `{ "nickname"?, "role_ids"? }` (`change_nickname` / `manage_nicknames` / `manage_roles`)
- `POST .../kick|ban|unban|mute|timeout` — body `{ "reason"?, "duration_minutes"? }` with matching permissions. Kick/ban emit `member_left`.

#### Invites
- `GET|POST /{server_id}/invites` — list needs `manage_invites`; create needs `create_invite`
- Create body: `{ "invite_type": "permanent|expiring|limited_use", "max_uses"?, "expires_in_hours"?, "channel_id"? }`
- `DELETE /{server_id}/invites/{invite_id}` — revoke (`manage_invites`)

#### Emojis
- `GET /{server_id}/emojis` — member
- `POST /{server_id}/emojis` — `manage_emojis`; `{ "name", "image_url" }` (upload image via media first)
- `DELETE /{server_id}/emojis/{emoji_id}` — `manage_emojis`

#### Search & mentions
- `POST /{server_id}/search` — `{ "q": "hello", "limit": 20 }` → `{ messages, members, channels, files }`
- `GET /{server_id}/mentions/autocomplete?q=&limit=20` → `MentionSuggestion[]` with `type` `user|role|everyone|here`

#### Notifications generated
Uses shared `/api/v1/notifications` table/types: `mention` for user/role/@everyone/@here; `system` for member join (to owner), role assigned, announcement posts, pinned messages. Also pushes `notification_created` on `/ws/notifications`.

### Search

#### `GET /api/v1/search/users` — Users
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `q` (query, required): `Q`; min length 1; max length 200.
  - `limit` (query, optional): `Limit`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<UserSearchResult>` (`application/json`). Response fields:
  - Array items: `UserSearchResult`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "username": "alice",
    "display_name": "string",
    "avatar_url": "string"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/search/groups` — Groups
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `q` (query, required): `Q`; min length 1; max length 200.
  - `limit` (query, optional): `Limit`; min 1; max 100; default `20`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<GroupSearchResult>` (`application/json`). Response fields:
  - Array items: `GroupSearchResult`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "string",
    "description": "string",
    "avatar_url": "string",
    "member_count": 1,
    "visibility": "string"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/search/messages` — Messages
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `q` (query, required): `Q`; min length 1; max length 200.
  - `limit` (query, optional): `Limit`; min 1; max 100; default `50`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<MessageSearchResult>` (`application/json`). Response fields:
  - Array items: `MessageSearchResult`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "chat_id": "11111111-1111-4111-8111-111111111111",
    "sender_id": "11111111-1111-4111-8111-111111111111",
    "content": "Hello",
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/search/files` — Files
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `q` (query, required): `Q`; min length 1; max length 200.
  - `limit` (query, optional): `Limit`; min 1; max 100; default `50`.
- **Request body:** none.
- **Success:** HTTP `200` with `array<FileSearchResult>` (`application/json`). Response fields:
  - Array items: `FileSearchResult`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "chat_id": "11111111-1111-4111-8111-111111111111",
    "uploader_id": "11111111-1111-4111-8111-111111111111",
    "filename": "string",
    "url": "string",
    "content_type": "string",
    "bytes": 1,
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Notifications

#### `GET /api/v1/notifications/` — List Notifications
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
  - `unread_only` (query, optional): `Unread Only`; schema type Unread Only; default `False`.
- **Request body:** none.
- **Success:** HTTP `200` with `NotificationListResponse` (`application/json`). Response fields:
  - `items` — `array<NotificationResponse>`; required; schema type array<NotificationResponse>.
  - `total` — `Total`; required; schema type Total.
  - `unread_count` — `Unread Count`; required; schema type Unread Count.
```json
{
  "items": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "actor_id": null,
      "type": "message",
      "title": "string",
      "body": null,
      "data": null,
      "is_read": true,
      "read_at": null,
      "created_at": "2026-07-30T00:00:00Z"
    }
  ],
  "total": 1,
  "unread_count": 1
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/notifications/read` — Mark Read
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `MarkReadRequest` via `application/json`. Fields/validation:
  - `notification_ids` — `array<string>`; required; min items 1; max items 100.
```json
{
  "notification_ids": [
    "11111111-1111-4111-8111-111111111111"
  ]
}
```
- **Success:** HTTP `200` with `MutationCountResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `updated` — `Updated`; required; schema type Updated.
```json
{
  "success": true,
  "updated": 1
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/notifications/read-all` — Mark All Read
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `MutationCountResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `updated` — `Updated`; required; schema type Updated.
```json
{
  "success": true,
  "updated": 1
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/notifications/{notification_id}` — Delete Notification
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `notification_id` (path, required): `Notification Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `204` with no body. Response fields:
  - `none` (schema type none).
- **Status codes:** OpenAPI declares `204`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** failing to URL-encode or validate UUID path values; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Presence

#### `POST /api/v1/presence/online` — Online
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PresenceUpdateRequest` via `application/json`. Fields/validation:
  - `ttl_seconds` — `Ttl Seconds`; optional; min 30.0; max 600.0.
```json
{
  "ttl_seconds": 90
}
```
- **Success:** HTTP `200` with `PresenceResponse` (`application/json`). Response fields:
  - `user_id` — `User Id`; required; format uuid.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `hidden` — `Hidden`; optional; schema type Hidden.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "hidden": false
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/presence/offline` — Offline
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `PresenceResponse` (`application/json`). Response fields:
  - `user_id` — `User Id`; required; format uuid.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `hidden` — `Hidden`; optional; schema type Hidden.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "hidden": false
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/presence/status/{user_id}` — Status
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `user_id` (path, required): `User Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `PresenceResponse` (`application/json`). Response fields:
  - `user_id` — `User Id`; required; format uuid.
  - `is_online` — `Is Online`; required; schema type Is Online.
  - `last_seen_at` — `string | null`; optional/nullable; schema type string | null.
  - `hidden` — `Hidden`; optional; schema type Hidden.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "is_online": true,
  "last_seen_at": "2026-07-30T00:00:00Z",
  "hidden": false
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Location

#### `POST /api/v1/location/share-live` — Share
- **Auth / permissions:** Bearer access JWT. Active user; shared-chat membership controls sharing/viewing another user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ShareLiveLocationRequest` via `application/json`. Fields/validation:
  - `chat_id` — `string | null`; optional/nullable; schema type string | null.
  - `latitude` — `Latitude`; required; min -90.0; max 90.0.
  - `longitude` — `Longitude`; required; min -180.0; max 180.0.
  - `accuracy` — `number | null`; optional/nullable; schema type number | null.
  - `heading` — `number | null`; optional/nullable; schema type number | null.
  - `speed` — `number | null`; optional/nullable; schema type number | null.
  - `duration_minutes` — `Duration Minutes`; optional; min 1.0.
```json
{
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "latitude": 1.0,
  "longitude": 1.0,
  "accuracy": 1.0,
  "heading": 1.0,
  "speed": 1.0,
  "duration_minutes": 60
}
```
- **Success:** HTTP `200` with `LiveLocationResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `latitude` — `Latitude`; required; schema type Latitude.
  - `longitude` — `Longitude`; required; schema type Longitude.
  - `accuracy` — `number | null`; required/nullable; schema type number | null.
  - `heading` — `number | null`; required/nullable; schema type number | null.
  - `speed` — `number | null`; required/nullable; schema type number | null.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `started_at` — `Started At`; required; format date-time.
  - `expires_at` — `Expires At`; required; format date-time.
  - `last_updated_at` — `Last Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "latitude": 1.0,
  "longitude": 1.0,
  "accuracy": 1.0,
  "heading": 1.0,
  "speed": 1.0,
  "is_active": true,
  "started_at": "2026-07-30T00:00:00Z",
  "expires_at": "2026-07-30T00:00:00Z",
  "last_updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `POST /api/v1/location/stop-sharing` — Stop
- **Auth / permissions:** Bearer access JWT. Active user; shared-chat membership controls sharing/viewing another user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `MutationCountResponse` (`application/json`). Response fields:
  - `success` — `Success`; optional; schema type Success.
  - `updated` — `Updated`; required; schema type Updated.
```json
{
  "success": true,
  "updated": 1
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`, `503`.
- **Frontend notes:** Disable duplicate submission while pending. Prefer response-driven cache replacement over assuming local state.
- **Common mistakes:** retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/location/{user_id}` — Get Location
- **Auth / permissions:** Bearer access JWT. Active user; shared-chat membership controls sharing/viewing another user.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `user_id` (path, required): `User Id`; format uuid.
- **Request body:** none.
- **Success:** HTTP `200` with `LiveLocationResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `user_id` — `User Id`; required; format uuid.
  - `chat_id` — `string | null`; required/nullable; schema type string | null.
  - `latitude` — `Latitude`; required; schema type Latitude.
  - `longitude` — `Longitude`; required; schema type Longitude.
  - `accuracy` — `number | null`; required/nullable; schema type number | null.
  - `heading` — `number | null`; required/nullable; schema type number | null.
  - `speed` — `number | null`; required/nullable; schema type number | null.
  - `is_active` — `Is Active`; required; schema type Is Active.
  - `started_at` — `Started At`; required; format date-time.
  - `expires_at` — `Expires At`; required; format date-time.
  - `last_updated_at` — `Last Updated At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "user_id": "11111111-1111-4111-8111-111111111111",
  "chat_id": "11111111-1111-4111-8111-111111111111",
  "latitude": 1.0,
  "longitude": 1.0,
  "accuracy": 1.0,
  "heading": 1.0,
  "speed": 1.0,
  "is_active": true,
  "started_at": "2026-07-30T00:00:00Z",
  "expires_at": "2026-07-30T00:00:00Z",
  "last_updated_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** failing to URL-encode or validate UUID path values.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Settings

#### `GET /api/v1/settings/` — Get Settings
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/settings/` — Update Settings
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SettingsUpdate` via `application/json`. Fields/validation:
  - `two_factor_enabled` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `login_alerts` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `notifications_enabled` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `message_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `group_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `call_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `mention_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `notification_sound` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_last_seen` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_online_status` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_read_receipts` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_profile_photo` — `string | null`; optional/nullable; schema type string | null.
  - `who_can_message` — `string | null`; optional/nullable; schema type string | null.
  - `who_can_add_to_groups` — `string | null`; optional/nullable; schema type string | null.
  - `theme` — `string | null`; optional/nullable; schema type string | null.
  - `language` — `string | null`; optional/nullable; schema type string | null.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "everyone",
  "who_can_message": "everyone",
  "who_can_add_to_groups": "everyone",
  "theme": "light",
  "language": "en",
  "extra": {}
}
```
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/settings/privacy` — Update Privacy
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `PrivacySettingsUpdate` via `application/json`. Fields/validation:
  - `show_last_seen` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_online_status` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_read_receipts` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `show_profile_photo` — `string | null`; optional/nullable; schema type string | null.
  - `who_can_message` — `string | null`; optional/nullable; schema type string | null.
  - `who_can_add_to_groups` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "everyone",
  "who_can_message": "everyone",
  "who_can_add_to_groups": "everyone"
}
```
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/settings/theme` — Update Theme
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `ThemeSettingsUpdate` via `application/json`. Fields/validation:
  - `theme` — `string | null`; optional/nullable; schema type string | null.
  - `language` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "theme": "light",
  "language": "en"
}
```
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/settings/notifications` — Update Notifications
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `NotificationSettingsUpdate` via `application/json`. Fields/validation:
  - `notifications_enabled` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `message_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `group_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `call_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `mention_notifications` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `notification_sound` — `boolean | null`; optional/nullable; schema type boolean | null.
```json
{
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true
}
```
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/settings/security` — Update Security
- **Auth / permissions:** Bearer access JWT. Active authenticated user; resource ownership, privacy, block, or membership rules may further restrict access.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `SecuritySettingsUpdate` via `application/json`. Fields/validation:
  - `two_factor_enabled` — `boolean | null`; optional/nullable; schema type boolean | null.
  - `login_alerts` — `boolean | null`; optional/nullable; schema type boolean | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true
}
```
- **Success:** HTTP `200` with `SettingsResponse` (`application/json`). Response fields:
  - `two_factor_enabled` — `Two Factor Enabled`; required; schema type Two Factor Enabled.
  - `login_alerts` — `Login Alerts`; required; schema type Login Alerts.
  - `notifications_enabled` — `Notifications Enabled`; required; schema type Notifications Enabled.
  - `message_notifications` — `Message Notifications`; required; schema type Message Notifications.
  - `group_notifications` — `Group Notifications`; required; schema type Group Notifications.
  - `call_notifications` — `Call Notifications`; required; schema type Call Notifications.
  - `mention_notifications` — `Mention Notifications`; required; schema type Mention Notifications.
  - `notification_sound` — `Notification Sound`; required; schema type Notification Sound.
  - `show_last_seen` — `Show Last Seen`; required; schema type Show Last Seen.
  - `show_online_status` — `Show Online Status`; required; schema type Show Online Status.
  - `show_read_receipts` — `Show Read Receipts`; required; schema type Show Read Receipts.
  - `show_profile_photo` — `Show Profile Photo`; required; schema type Show Profile Photo.
  - `who_can_message` — `Who Can Message`; required; schema type Who Can Message.
  - `who_can_add_to_groups` — `Who Can Add To Groups`; required; schema type Who Can Add To Groups.
  - `theme` — `Theme`; required; schema type Theme.
  - `language` — `Language`; required; schema type Language.
  - `extra` — `object | null`; optional/nullable; schema type object | null.
```json
{
  "two_factor_enabled": true,
  "login_alerts": true,
  "notifications_enabled": true,
  "message_notifications": true,
  "group_notifications": true,
  "call_notifications": true,
  "mention_notifications": true,
  "notification_sound": true,
  "show_last_seen": true,
  "show_online_status": true,
  "show_read_receipts": true,
  "show_profile_photo": "string",
  "who_can_message": "string",
  "who_can_add_to_groups": "string",
  "theme": "string",
  "language": "en",
  "extra": {}
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Admin

#### `GET /api/v1/admin/dashboard` — Dashboard
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `DashboardResponse` (`application/json`). Response fields:
  - `users` — `Users`; required; schema type Users.
  - `active_users` — `Active Users`; required; schema type Active Users.
  - `suspended_users` — `Suspended Users`; required; schema type Suspended Users.
  - `groups` — `Groups`; required; schema type Groups.
  - `messages` — `Messages`; required; schema type Messages.
  - `open_reports` — `Open Reports`; required; schema type Open Reports.
```json
{
  "users": 1,
  "active_users": 1,
  "suspended_users": 1,
  "groups": 1,
  "messages": 1,
  "open_reports": 1
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/admin/users` — Users
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
  - `q` (query, optional): `string | null`; schema type string | null.
- **Request body:** none.
- **Success:** HTTP `200` with `array<AdminUserResponse>` (`application/json`). Response fields:
  - Array items: `AdminUserResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "email": "user@example.com",
    "username": "alice",
    "role": "user",
    "status": "pending",
    "is_email_verified": true,
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/admin/reports` — Reports
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
  - `status` (query, optional): `string | null`; schema type string | null.
- **Request body:** none.
- **Success:** HTTP `200` with `array<ReportResponse>` (`application/json`). Response fields:
  - Array items: `ReportResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "reporter_id": "11111111-1111-4111-8111-111111111111",
    "reported_user_id": "11111111-1111-4111-8111-111111111111",
    "reported_message_id": "11111111-1111-4111-8111-111111111111",
    "reported_group_id": "11111111-1111-4111-8111-111111111111",
    "reason": "spam",
    "description": "string",
    "status": "string",
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/admin/groups` — Groups
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `20`.
  - `q` (query, optional): `string | null`; schema type string | null.
- **Request body:** none.
- **Success:** HTTP `200` with `array<AdminGroupResponse>` (`application/json`). Response fields:
  - Array items: `AdminGroupResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "string",
    "owner_id": "11111111-1111-4111-8111-111111111111",
    "member_count": 1,
    "is_active": true,
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/admin/suspend-user` — Suspend
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `UserActionRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
  - `reason` — `string | null`; optional/nullable; schema type string | null.
  - `suspended_until` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "reason": "spam",
  "suspended_until": "2026-07-30T00:00:00Z"
}
```
- **Success:** HTTP `200` with `AdminUserResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `email` — `Email`; required; schema type Email.
  - `username` — `Username`; required; schema type Username.
  - `role` — `UserRole`; required; enum: user, moderator, admin, superadmin.
  - `status` — `UserStatus`; required; enum: pending, active, suspended, deleted.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "username": "alice",
  "role": "user",
  "status": "pending",
  "is_email_verified": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/admin/unsuspend-user` — Unsuspend
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `UserActionRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
  - `reason` — `string | null`; optional/nullable; schema type string | null.
  - `suspended_until` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "reason": "spam",
  "suspended_until": "2026-07-30T00:00:00Z"
}
```
- **Success:** HTTP `200` with `AdminUserResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `email` — `Email`; required; schema type Email.
  - `username` — `Username`; required; schema type Username.
  - `role` — `UserRole`; required; enum: user, moderator, admin, superadmin.
  - `status` — `UserStatus`; required; enum: pending, active, suspended, deleted.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "username": "alice",
  "role": "user",
  "status": "pending",
  "is_email_verified": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `DELETE /api/v1/admin/delete-user` — Delete User
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `UserActionRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
  - `reason` — `string | null`; optional/nullable; schema type string | null.
  - `suspended_until` — `string | null`; optional/nullable; schema type string | null.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "reason": "spam",
  "suspended_until": "2026-07-30T00:00:00Z"
}
```
- **Success:** HTTP `200` with `AdminUserResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `email` — `Email`; required; schema type Email.
  - `username` — `Username`; required; schema type Username.
  - `role` — `UserRole`; required; enum: user, moderator, admin, superadmin.
  - `status` — `UserStatus`; required; enum: pending, active, suspended, deleted.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "username": "alice",
  "role": "user",
  "status": "pending",
  "is_email_verified": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Confirm destructive intent where appropriate, then invalidate affected detail and list caches.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/admin/audit-logs` — Audit Logs
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:**
  - `page` (query, optional): `Page`; min 1; default `1`.
  - `page_size` (query, optional): `Page Size`; min 1; max 100; default `50`.
  - `action` (query, optional): `string | null`; schema type string | null.
- **Request body:** none.
- **Success:** HTTP `200` with `array<AuditLogResponse>` (`application/json`). Response fields:
  - Array items: `AuditLogResponse`.
```json
[
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "actor_id": "11111111-1111-4111-8111-111111111111",
    "action": "string",
    "target_type": "string",
    "target_id": "string",
    "ip_address": "string",
    "details": {},
    "message": "string",
    "created_at": "2026-07-30T00:00:00Z"
  }
]
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** Treat an empty array (or `data/items: []`) as a successful empty state, not an error.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /api/v1/admin/analytics` — Analytics
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with `AnalyticsResponse` (`application/json`). Response fields:
  - `users` — `Users`; required; schema type Users.
  - `active_users` — `Active Users`; required; schema type Active Users.
  - `suspended_users` — `Suspended Users`; required; schema type Suspended Users.
  - `groups` — `Groups`; required; schema type Groups.
  - `messages` — `Messages`; required; schema type Messages.
  - `open_reports` — `Open Reports`; required; schema type Open Reports.
  - `new_users_30d` — `New Users 30D`; required; schema type New Users 30D.
  - `messages_24h` — `Messages 24H`; required; schema type Messages 24H.
  - `active_groups` — `Active Groups`; required; schema type Active Groups.
```json
{
  "users": 1,
  "active_users": 1,
  "suspended_users": 1,
  "groups": 1,
  "messages": 1,
  "open_reports": 1,
  "new_users_30d": 1,
  "messages_24h": 1,
  "active_groups": 1
}
```
- **Status codes:** OpenAPI declares `200`. Runtime paths for this operation can also return `401`, `403`, `429`, `500`.
- **Frontend notes:** Cache by the complete path plus query parameters; render stale data during background revalidation when safe.
- **Common mistakes:** assuming every success response uses a common `data` envelope.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "unauthorized",
    "message": "Authentication required"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `PATCH /api/v1/admin/user-role` — User Role
- **Auth / permissions:** Bearer access JWT. Active `admin` or `superadmin`; role changes additionally require `superadmin` and cannot assign `superadmin`.
- **Headers:** `Accept: application/json`, `Authorization: Bearer <access_token>`, `Content-Type: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** `UserRoleRequest` via `application/json`. Fields/validation:
  - `user_id` — `User Id`; required; format uuid.
  - `role` — `UserRole`; required; enum: user, moderator, admin, superadmin.
```json
{
  "user_id": "11111111-1111-4111-8111-111111111111",
  "role": "user"
}
```
- **Success:** HTTP `200` with `AdminUserResponse` (`application/json`). Response fields:
  - `id` — `Id`; required; format uuid.
  - `email` — `Email`; required; schema type Email.
  - `username` — `Username`; required; schema type Username.
  - `role` — `UserRole`; required; enum: user, moderator, admin, superadmin.
  - `status` — `UserStatus`; required; enum: pending, active, suspended, deleted.
  - `is_email_verified` — `Is Email Verified`; required; schema type Is Email Verified.
  - `created_at` — `Created At`; required; format date-time.
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "user@example.com",
  "username": "alice",
  "role": "user",
  "status": "pending",
  "is_email_verified": true,
  "created_at": "2026-07-30T00:00:00Z"
}
```
- **Status codes:** OpenAPI declares `200`, `422`. Runtime paths for this operation can also return `401`, `403`, `404`, `429`, `500`.
- **Frontend notes:** Send only changed fields. Merge the returned canonical object into cache, then invalidate dependent lists.
- **Common mistakes:** sending form data instead of JSON; retrying a mutation blindly after an ambiguous network failure.
- **Loading state:** Use a skeleton for reads; use an inline pending/disabled control for mutations.
- **Empty state:** No special empty state; preserve the prior stable UI.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "loc": [
          "body",
          "field"
        ],
        "msg": "Field required",
        "type": "missing"
      }
    ]
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

### Health

#### `GET /health` — Liveness probe
- **Auth / permissions:** Public (no bearer token). No dependency health check or rate limit applies.
- **Headers:** `Accept: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with an implementation-defined object (`application/json`). OpenAPI leaves this object unconstrained; the current handler returns:
  - `status` — literal `ok`.
  - `service` — configured application name.
```json
{
  "status": "ok",
  "service": "Chatter"
}
```
- **Status codes:** OpenAPI declares `200`; an unexpected application failure is handled as `500`. This path is exempt from the application rate limiter, so it does not produce the middleware's 429 response.
- **Frontend notes:** Use for process liveness only. A 200 does not prove that PostgreSQL or Redis is usable; use `/ready` for dependency readiness.
- **Common mistakes:** using this endpoint as a database/Redis readiness check or expecting a common success envelope.
- **Loading state:** Infrastructure probes should use a short timeout; product UI normally should not render this request.
- **Empty state:** Not applicable; a successful response always contains `status` and `service`.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

#### `GET /ready` — Readiness probe
- **Auth / permissions:** Public (no bearer token). A successful response requires both PostgreSQL and Redis checks to pass; no application rate limit applies.
- **Headers:** `Accept: application/json`, optional `X-Request-ID: <uuid>`.
- **Path/query parameters:** none.
- **Request body:** none.
- **Success:** HTTP `200` with an implementation-defined object (`application/json`). OpenAPI leaves this object unconstrained; the current handler returns:
  - `status` — literal `ready`.
  - `database` — literal `ok`.
  - `redis` — literal `ok`.
```json
{
  "status": "ready",
  "database": "ok",
  "redis": "ok"
}
```
- **Status codes:** OpenAPI declares `200`. A failed database connection/query or Redis ping currently reaches the global handler as `500`, not 503. This path is exempt from the application rate limiter.
- **Frontend notes:** Use for dependency readiness. The handler performs `SELECT 1` and a Redis `PING` on every request.
- **Common mistakes:** expecting a partial-success body or 503 when one dependency fails; the current implementation returns the standard 500 error envelope.
- **Loading state:** Infrastructure probes should use a short timeout; product UI normally should not render this request.
- **Empty state:** Not applicable; a successful response always contains all three fields.
- **Error handling:** Parse the standard error envelope; key UI behavior by HTTP status and `error.code`, log `request_id`, preserve recoverable input, and never show raw upstream details. Do not blindly replay mutations.
- **Error example:**

```json
{
  "success": false,
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred"
  },
  "request_id": "d9b1a7bc-42d8-4caf-bbe8-2b51218bcf20"
}
```

## WebSockets

All eight sockets authenticate with the **access token in the exact `token` query parameter**: `?token=<url-encoded-access-jwt>`. Browsers cannot set an Authorization header in the WebSocket constructor. Query URLs can leak through logs; use `wss`, redact them, and never use refresh tokens. Missing/invalid/expired/revoked token closes with **4401**; an inactive account or failed membership closes with **4403**. Invalid UUID/required room parameters close with **4400**.

General client payload (all room sockets except presence use this validator):

```json
{"type":"message.typing","payload":{"active":true}}
```

`type` is any non-empty string up to 64 characters; `payload` is an object. There is no event-specific validation or allowlist. A `ping` receives a direct `pong`; any other event is wrapped and broadcast to every connection in the same in-process room, including the sender:

```json
{
  "id":"11111111-1111-4111-8111-111111111111",
  "type":"message.typing",
  "sender_id":"11111111-1111-4111-8111-111111111111",
  "room":"typing:22222222-2222-4222-8222-222222222222",
  "payload":{"active":true},
  "timestamp":"2026-07-30T00:00:00Z"
}
```

Malformed JSON/schema on ordinary room sockets yields an `error` event and keeps the socket open. On presence, malformed input exits the receive loop and disconnects without an error event. Normal WebSocket/network closure commonly appears as 1000/1001/1006 at the client; those are protocol/runtime behavior, not custom application codes.

### `/ws/chat/{chat_id}`

- URL: `wss://<origin>/ws/chat/<chat-uuid>?token=<access-jwt>`.
- Membership: active `ChatParticipant` (`left_at IS NULL`) required; otherwise 4403.
- Room: `chat:<chat_id>`. Client/server payloads use the general schemas above. `ping` → `pong`.
- Frontend: open while viewing/using the chat. The backend does not generate message events after HTTP sends; agree on client event types if using this relay and always reconcile via HTTP.

### `/ws/group/{group_id}`

- URL: `wss://<origin>/ws/group/<group-uuid>?token=<access-jwt>`.
- Membership: `GroupMember` required; otherwise 4403.
- Room: `group:<group_id>`. General payload and ping/pong behavior apply.
- Frontend: do not infer database group updates from arbitrary payloads; re-fetch group/chat state.

### `/ws/typing`

- URL: `wss://<origin>/ws/typing?token=<access-jwt>&chat_id=<chat-uuid>`.
- Parameters/membership: valid `chat_id` query parameter and active chat membership required; invalid/missing is 4400, nonmember is 4403.
- Room: `typing:<chat_id>`. Send ephemeral types/payloads; the server does not enforce a typing-specific type or expiry.

### `/ws/recording`

- URL: `wss://<origin>/ws/recording?token=<access-jwt>&chat_id=<chat-uuid>`.
- Parameters/membership: same as typing. Room: `recording:<chat_id>`.
- Frontend: send start/stop/heartbeat semantics explicitly; the server does not clear stale recording state or define event names.

### `/ws/notifications`

- URL: `wss://<origin>/ws/notifications?token=<access-jwt>`.
- Room: `notifications:<current_user_id>`; no additional membership parameter.
- General client relay and ping/pong apply. Current notification HTTP services do not publish events to this room, so poll/revalidate HTTP as the source of truth.

### `/ws/calls`

- URL (chat): `wss://<origin>/ws/calls?token=<access-jwt>&room_id=<room>&chat_id=<uuid>`.
- URL (group): `wss://<origin>/ws/calls?token=<access-jwt>&room_id=<room>&group_id=<uuid>`.
- `room_id` and at least one of `chat_id`/`group_id` are required; invalid/missing values close 4400. If both IDs are supplied, chat authorization is used. Membership failure closes 4403. `room_id` is truncated to 128 characters in the room key.
- Room: `call:<room_id>`. General arbitrary relay payload applies.
- Critical limitation: media is never proxied. Use `GET /api/v1/calls/ice-servers` for STUN/TURN. Prefer the typed signaling event names (`CALL_INVITE`, `SDP_OFFER`, `ICE_CANDIDATE`, etc.) documented by the calls module; legacy chat/group `room_id` query params are no longer required for one-to-one signaling.

### `/ws/presence`

- URL: `wss://<origin>/ws/presence?token=<access-jwt>`; room is global `presence`.
- On connect, Redis TTL is set to `ws_heartbeat_interval * 3` (default 90 seconds), DB `is_online=true`, and `presence.online` is broadcast.
- Client may send `{"type":"ping","payload":{}}` or `{"type":"heartbeat","payload":{}}`; either refreshes TTL and receives `pong`. Other valid events are silently ignored. Send heartbeat every default 30 seconds.
- On the final connection for a user closing, DB/Redis are updated and `presence.offline` broadcasts `user_id` and `last_seen_at`. Process crashes/network partitions rely on Redis TTL; DB and broadcast may remain stale.

### Reconnect and heartbeat guidance

- Refresh an expired access token before reconnecting; never reconnect-loop on 4401/4403/4400.
- For transient closures, use exponential backoff with full jitter (for example 0.5s, 1s, 2s, 4s, capped near 30s), reset after a stable connection, pause when offline/asleep, and reconnect when the app resumes.
- Send application `ping` about every 30 seconds on open sockets; require a timely `pong` and recreate a half-open socket. Presence must heartbeat before its TTL expires.
- Re-subscribe by reconstructing every desired socket because there is no resume cursor or replay. Re-fetch HTTP state after reconnect to cover missed events.
- De-duplicate server events by `id`, but do not rely on delivery ordering or durability. There are no acknowledgements or backpressure protocol.

## Machine-auditable checklist

The checklist below contains each OpenAPI method/path exactly once plus every WebSocket path.

### HTTP operations
- [ ] `POST /api/v1/auth/signup`
- [ ] `POST /api/v1/auth/verify-email`
- [ ] `POST /api/v1/auth/resend-otp`
- [ ] `POST /api/v1/auth/login`
- [ ] `POST /api/v1/auth/refresh`
- [ ] `POST /api/v1/auth/logout`
- [ ] `POST /api/v1/auth/password-reset/request`
- [ ] `POST /api/v1/auth/password-reset/confirm`
- [ ] `POST /api/v1/auth/change-password`
- [ ] `GET /api/v1/auth/username/check`
- [ ] `GET /api/v1/auth/me`
- [ ] `GET /api/v1/users/me`
- [ ] `PATCH /api/v1/users/me/username`
- [ ] `GET /api/v1/users/search`
- [ ] `POST /api/v1/users/block`
- [ ] `DELETE /api/v1/users/unblock`
- [ ] `GET /api/v1/users/blocked`
- [ ] `POST /api/v1/users/report`
- [ ] `POST /api/v1/users/friends/request`
- [ ] `POST /api/v1/users/friends/accept`
- [ ] `POST /api/v1/users/friends/reject`
- [ ] `DELETE /api/v1/users/friends/{friend_id}`
- [ ] `GET /api/v1/users/friends`
- [ ] `GET /api/v1/users/friends/requests`
- [ ] `GET /api/v1/users/{username}`
- [ ] `GET /api/v1/profiles/me`
- [ ] `PATCH /api/v1/profiles/me`
- [ ] `POST /api/v1/profiles/me/avatar`
- [ ] `DELETE /api/v1/profiles/me/avatar`
- [ ] `GET /api/v1/profiles/{username}`
- [ ] `GET /api/v1/chats/`
- [ ] `POST /api/v1/chats/`
- [ ] `POST /api/v1/chats/archive`
- [ ] `POST /api/v1/chats/unarchive`
- [ ] `POST /api/v1/chats/favorite`
- [ ] `POST /api/v1/chats/unfavorite`
- [ ] `POST /api/v1/chats/mute`
- [ ] `POST /api/v1/chats/unmute`
- [ ] `GET /api/v1/chats/{chat_id}`
- [ ] `DELETE /api/v1/chats/{chat_id}`
- [ ] `POST /api/v1/messages/`
- [ ] `POST /api/v1/messages/delete-for-everyone`
- [ ] `POST /api/v1/messages/reply`
- [ ] `POST /api/v1/messages/forward`
- [ ] `POST /api/v1/messages/react`
- [ ] `DELETE /api/v1/messages/react`
- [ ] `POST /api/v1/messages/pin`
- [ ] `DELETE /api/v1/messages/pin`
- [ ] `POST /api/v1/messages/read`
- [ ] `POST /api/v1/messages/delivered`
- [ ] `GET /api/v1/messages/seen-by/{message_id}`
- [ ] `GET /api/v1/messages/{chat_id}`
- [ ] `PATCH /api/v1/messages/{message_id}`
- [ ] `DELETE /api/v1/messages/{message_id}`
- [ ] `POST /api/v1/media/upload-image`
- [ ] `POST /api/v1/media/upload-video`
- [ ] `POST /api/v1/media/upload-document`
- [ ] `POST /api/v1/media/upload-voice`
- [ ] `GET /api/v1/media/{file_id}`
- [ ] `DELETE /api/v1/media/{file_id}`
- [ ] `POST /api/v1/groups/`
- [ ] `GET /api/v1/groups/`
- [ ] `POST /api/v1/groups/join`
- [ ] `POST /api/v1/groups/leave`
- [ ] `POST /api/v1/groups/invite`
- [ ] `POST /api/v1/groups/remove-member`
- [ ] `PATCH /api/v1/groups/member-role`
- [ ] `POST /api/v1/groups/announcement`
- [ ] `POST /api/v1/groups/poll`
- [ ] `GET /api/v1/groups/{group_id}`
- [ ] `PATCH /api/v1/groups/{group_id}`
- [ ] `DELETE /api/v1/groups/{group_id}`
- [ ] `POST /api/v1/calls/start`
- [ ] `POST /api/v1/calls/join`
- [ ] `POST /api/v1/calls/end`
- [ ] `GET /api/v1/calls/history`
- [ ] `POST /api/v1/calls/mute`
- [ ] `POST /api/v1/calls/unmute`
- [ ] `POST /api/v1/calls/video/start`
- [ ] `POST /api/v1/calls/video/end`
- [ ] `POST /api/v1/ai/speech-to-text`
- [ ] `POST /api/v1/ai/suggest-replies`
- [ ] `POST /api/v1/ai/rewrite`
- [ ] `POST /api/v1/ai/translate`
- [ ] `POST /api/v1/ai/summarize-chat`
- [ ] `POST /api/v1/ai/search`
- [ ] `POST /api/v1/status`
- [ ] `POST /api/v1/status/json`
- [ ] `GET /api/v1/status/me`
- [ ] `GET /api/v1/status/feed`
- [ ] `GET /api/v1/status/{status_id}`
- [ ] `DELETE /api/v1/status/{status_id}`
- [ ] `POST /api/v1/status/{status_id}/archive`
- [ ] `POST /api/v1/status/view`
- [ ] `POST /api/v1/status/react`
- [ ] `POST /api/v1/status/unreact`
- [ ] `POST /api/v1/status/reply`
- [ ] `GET /api/v1/status/viewers/{status_id}`
- [ ] `POST /api/v1/status/mute/{author_id}`
- [ ] `POST /api/v1/status/unmute/{author_id}`
- [ ] `GET /api/v1/servers`
- [ ] `POST /api/v1/servers`
- [ ] `GET /api/v1/servers/invites/{code}`
- [ ] `POST /api/v1/servers/join`
- [ ] `GET /api/v1/servers/permissions`
- [ ] `GET /api/v1/servers/{server_id}`
- [ ] `PATCH /api/v1/servers/{server_id}`
- [ ] `DELETE /api/v1/servers/{server_id}`
- [ ] `GET /api/v1/servers/{server_id}/categories`
- [ ] `POST /api/v1/servers/{server_id}/categories`
- [ ] `PATCH /api/v1/servers/{server_id}/categories/{category_id}`
- [ ] `DELETE /api/v1/servers/{server_id}/categories/{category_id}`
- [ ] `GET /api/v1/servers/{server_id}/channels`
- [ ] `POST /api/v1/servers/{server_id}/channels`
- [ ] `GET /api/v1/servers/{server_id}/channels/{channel_id}`
- [ ] `PATCH /api/v1/servers/{server_id}/channels/{channel_id}`
- [ ] `DELETE /api/v1/servers/{server_id}/channels/{channel_id}`
- [ ] `GET /api/v1/servers/{server_id}/channels/{channel_id}/messages`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/messages`
- [ ] `PATCH /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}`
- [ ] `DELETE /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}/pin`
- [ ] `DELETE /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}/pin`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}/reactions`
- [ ] `DELETE /api/v1/servers/{server_id}/channels/{channel_id}/messages/{message_id}/reactions`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/read`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/typing`
- [ ] `DELETE /api/v1/servers/{server_id}/channels/{channel_id}/typing`
- [ ] `GET /api/v1/servers/{server_id}/channels/{channel_id}/voice`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/voice/join`
- [ ] `POST /api/v1/servers/{server_id}/channels/{channel_id}/voice/leave`
- [ ] `PATCH /api/v1/servers/{server_id}/channels/{channel_id}/voice/state`
- [ ] `GET /api/v1/servers/{server_id}/emojis`
- [ ] `POST /api/v1/servers/{server_id}/emojis`
- [ ] `DELETE /api/v1/servers/{server_id}/emojis/{emoji_id}`
- [ ] `GET /api/v1/servers/{server_id}/invites`
- [ ] `POST /api/v1/servers/{server_id}/invites`
- [ ] `DELETE /api/v1/servers/{server_id}/invites/{invite_id}`
- [ ] `POST /api/v1/servers/{server_id}/leave`
- [ ] `GET /api/v1/servers/{server_id}/members`
- [ ] `PATCH /api/v1/servers/{server_id}/members/{user_id}`
- [ ] `POST /api/v1/servers/{server_id}/members/{user_id}/ban`
- [ ] `POST /api/v1/servers/{server_id}/members/{user_id}/kick`
- [ ] `POST /api/v1/servers/{server_id}/members/{user_id}/mute`
- [ ] `POST /api/v1/servers/{server_id}/members/{user_id}/timeout`
- [ ] `POST /api/v1/servers/{server_id}/members/{user_id}/unban`
- [ ] `GET /api/v1/servers/{server_id}/mentions/autocomplete`
- [ ] `GET /api/v1/servers/{server_id}/roles`
- [ ] `POST /api/v1/servers/{server_id}/roles`
- [ ] `PATCH /api/v1/servers/{server_id}/roles/{role_id}`
- [ ] `DELETE /api/v1/servers/{server_id}/roles/{role_id}`
- [ ] `POST /api/v1/servers/{server_id}/search`
- [ ] `GET /api/v1/servers/{server_id}/sidebar`
- [ ] `GET /api/v1/search/users`
- [ ] `GET /api/v1/search/groups`
- [ ] `GET /api/v1/search/messages`
- [ ] `GET /api/v1/search/files`
- [ ] `GET /api/v1/notifications/`
- [ ] `PATCH /api/v1/notifications/read`
- [ ] `PATCH /api/v1/notifications/read-all`
- [ ] `DELETE /api/v1/notifications/{notification_id}`
- [ ] `POST /api/v1/presence/online`
- [ ] `POST /api/v1/presence/offline`
- [ ] `GET /api/v1/presence/status/{user_id}`
- [ ] `POST /api/v1/location/share-live`
- [ ] `POST /api/v1/location/stop-sharing`
- [ ] `GET /api/v1/location/{user_id}`
- [ ] `GET /api/v1/settings/`
- [ ] `PATCH /api/v1/settings/`
- [ ] `PATCH /api/v1/settings/privacy`
- [ ] `PATCH /api/v1/settings/theme`
- [ ] `PATCH /api/v1/settings/notifications`
- [ ] `PATCH /api/v1/settings/security`
- [ ] `GET /api/v1/admin/dashboard`
- [ ] `GET /api/v1/admin/users`
- [ ] `GET /api/v1/admin/reports`
- [ ] `GET /api/v1/admin/groups`
- [ ] `PATCH /api/v1/admin/suspend-user`
- [ ] `PATCH /api/v1/admin/unsuspend-user`
- [ ] `DELETE /api/v1/admin/delete-user`
- [ ] `GET /api/v1/admin/audit-logs`
- [ ] `GET /api/v1/admin/analytics`
- [ ] `PATCH /api/v1/admin/user-role`
- [ ] `GET /health`
- [ ] `GET /ready`

### WebSocket routes
- [ ] `WS /ws/chat/{chat_id}`
- [ ] `WS /ws/group/{group_id}`
- [ ] `WS /ws/servers/{server_id}`
- [ ] `WS /ws/typing`
- [ ] `WS /ws/recording`
- [ ] `WS /ws/notifications`
- [ ] `WS /ws/calls`
- [ ] `WS /ws/presence`

**Exact counts:** 191 HTTP operations; 160 distinct HTTP paths; 8 WebSocket routes; 199 total operations/routes.