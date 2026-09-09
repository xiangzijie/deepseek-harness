# @deepseek-ai/dsh-bug-platform-http

English | [中文](README.zh.md)

HTTP client library (and optional Cordis plugin entry) for the internal bug-platform API used by autofix orchestration. Phase 1 is **library-first**: callers construct the client from Config/env; `apply` only validates Config and does not invent a `ctx.bugPlatform` seam.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://10.20.183.62:8080` | Bug-platform API origin. |
| `usernameEnv` | `BUG_PLATFORM_USERNAME` | Credential-ref env name for the login username. |
| `passwordEnv` | `BUG_PLATFORM_PASSWORD` | Credential-ref env name for the login password. |

Empty strings after defaulting throw at plugin `apply` time.

## Model Experience

None, as this package is a deployment-local HTTP library that never contributes tokens to a model request.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- **HTTP client not implemented yet** — login, list/get tickets, follow-up, attachment download, and 401 re-login retry land in follow-up tasks; this package currently exports Config validation and the Cordis plugin stub only.
