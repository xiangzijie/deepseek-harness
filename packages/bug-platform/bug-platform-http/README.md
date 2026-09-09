# @deepseek-ai/dsh-bug-platform-http

English | [中文](README.zh.md)

HTTP client library (and optional Cordis plugin entry) for the internal bug-platform API used by autofix orchestration. Phase 1 is **library-first**: callers construct `BugPlatformClient` from resolved username/password/`baseUrl` (and optional `fetchImpl`); `apply` only validates Config and does not invent a `ctx.bugPlatform` seam.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://10.20.183.62:8080` | Bug-platform API origin. |
| `usernameEnv` | `BUG_PLATFORM_USERNAME` | Credential-ref env name for the login username. |
| `passwordEnv` | `BUG_PLATFORM_PASSWORD` | Credential-ref env name for the login password. |

Empty strings after defaulting throw at plugin `apply` time. The Cordis plugin inject list is empty; resolve credentials outside the plugin and pass them into `BugPlatformClient`.

## Client

`BugPlatformClient` supports `ensureToken` (login + cache), `listTickets`, `getTicket`, `createFollowup`, and `downloadToFile`. Authenticated calls send `Authorization: Bearer <token>`. On HTTP 401 the client re-logins once and retries the failed request once. Tokens and passwords are never logged. Callers skip `file_size === 0` before `downloadToFile`.

## Model Experience

None, as this package is a deployment-local HTTP library that never contributes tokens to a model request.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not construct or register the client on `ctx`.
- No scheduled list polling; each run is caller-driven.
- No client-side concurrency or cross-process claim lock; overlapping callers can race the same ticket.
- Home-menu tickets and automatic backend reassignment are out of scope here; orchestration consumers own those policies (phase 1 skips home and does not auto-reassign).
