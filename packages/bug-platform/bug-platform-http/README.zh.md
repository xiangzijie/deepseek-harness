# @deepseek-ai/dsh-bug-platform-http

[English](README.md) | 中文

面向内部 bug 平台 API 的 HTTP 客户端库（及可选的 Cordis 插件入口），供自动修复编排使用。第一阶段以**库优先**：调用方从 Config／环境变量构造客户端；`apply` 只校验 Config，不发明 `ctx.bugPlatform` seam。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | `http://10.20.183.62:8080` | bug 平台 API 源点。 |
| `usernameEnv` | `BUG_PLATFORM_USERNAME` | 登录用户名的凭据引用环境变量名。 |
| `passwordEnv` | `BUG_PLATFORM_PASSWORD` | 登录密码的凭据引用环境变量名。 |

默认填充后若为空字符串，插件 `apply` 时抛错。

## 模型体验

无，因为本包是部署本地的 HTTP 库，从不向模型请求贡献 token。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- **HTTP 客户端尚未实现** — 登录、列举／获取工单、跟进、附件下载以及 401 重新登录重试将在后续任务中落地；当前包仅导出 Config 校验与 Cordis 插件桩。
