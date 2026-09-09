# @deepseek-ai/dsh-bug-platform-http

[English](README.md) | 中文

面向内部 bug 平台 API 的 HTTP 客户端库（及可选的 Cordis 插件入口），供自动修复编排使用。第一阶段以**库优先**：调用方用已解析的用户名／密码／`baseUrl`（及可选 `fetchImpl`）构造 `BugPlatformClient`；`apply` 只校验 Config，不发明 `ctx.bugPlatform` seam。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | `http://10.20.183.62:8080` | bug 平台 API 源点。 |
| `usernameEnv` | `BUG_PLATFORM_USERNAME` | 登录用户名的凭据引用环境变量名。 |
| `passwordEnv` | `BUG_PLATFORM_PASSWORD` | 登录密码的凭据引用环境变量名。 |

默认填充后若为空字符串，插件 `apply` 时抛错。Cordis 插件 `inject` 为空；在插件外解析凭据后再传入 `BugPlatformClient`。

## 客户端

`BugPlatformClient` 支持 `ensureToken`（登录并缓存）、`listTickets` 与 `getTicket`。鉴权请求携带 `Authorization: Bearer <token>`。收到 HTTP 401 时重新登录一次并仅重试失败的那次请求。令牌与密码永不写入日志。跟进写入与附件下载将在后续变更落地。

## 模型体验

无，因为本包是部署本地的 HTTP 库，从不向模型请求贡献 token。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- **跟进与下载** — 尚未导出 `createFollowup`／`downloadToFile`。
- Cordis `apply` 仅校验 Config；不在 `ctx` 上构造或注册客户端。
