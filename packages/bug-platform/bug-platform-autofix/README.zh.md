# @deepseek-ai/dsh-bug-platform-autofix

[English](README.md) | 中文

面向内部 bug 平台自动修复的库优先辅助：加载 `menu-mapping.json`，将工单的 `target_menu` 解析到 custom／ailpha 工作区命中项，过滤列表行，维护本地 JSON 幂等状态，提供按工作区隔离的 Git 辅助（`assertProductBranch`、`assertClean`、`createBugfixBranch`、`commitAll`、`pushBranch`、`listChangedFiles`，可注入 `RunGit`），可选通过 `createMergeRequest` 创建 GitLab MR，并用 `runOneTicket`／`runBatch` 编排单票或跑批。第一阶段 Cordis `apply` 仅作 Config 桩（`inject` 为空）；编排直接导入辅助函数。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `mappingFile` | `""` | `menu-mapping.json` 的绝对路径。为空时由调用方把已解析 JSON 交给 `loadMenuMapping`。 |

## 菜单映射

`loadMenuMapping(json)` 读取 `systems.*.items[]`。`resolveMenu(index, targetMenu)` 精确匹配 `target_menu`，只保留 `repo` 为 `custom` 或 `ailpha` 的项，优先 `file_exists === true`，再优先 `custom` 于 `ailpha`；未知、`repo == null`、`home` 或其他不可修仓库返回 null。

## 选单与本地状态

`selectTickets(tickets, index, store, options?)` 保留：`assignee_id` 为 null、`status` 在允许列表（默认 `待确认`／`验证未通过`）、`target_menu` 不是 `网络安全数据大屏`、`resolveMenu` 有命中、且不在 `TicketStateStore` 进行中阶段（`claimed`／`fixing`／`awaiting_push`）的行。可用 `options.statuses` 覆盖允许列表。

`loadState(path)`／`saveState(path, store)` 读写 `{ tickets: TicketRecord[] }`；文件不存在时得到空的 `TicketStateStore`。`isActive(record)` 对进行中阶段为 true；`store.get`／`store.upsert` 维护内存映射。

## Git 工作区

辅助函数只接受单个 `localRoot`，不会跨工作区切换产品 jinan。`assertProductBranch(localRoot, expectedJinan)` 允许该 jinan 或 `bugfix/<digits>`；若 HEAD 是另一条 `*-jinan` 则硬失败。`assertClean` 要求 porcelain 状态为空。`createBugfixBranch`：已在 `bugfix/<id>` 则复用；分支已存在则 checkout；否则从当前 HEAD `checkout -b`。`commitAll` 执行 `add -A` + `commit` 并返回 `rev-parse HEAD`。`pushBranch` 执行 `push -u origin <branch>`。`listChangedFiles` 解析 porcelain 路径。测试可传入 `runGit(cwd, args)`；省略则使用 `defaultRunGit`。

## 可选 GitLab MR

`createMergeRequest({ host, projectId, token, sourceBranch, targetBranch, title, description, fetchImpl? })` 以 `PRIVATE-TOKEN` 请求头 POST `/api/v4/projects/:id/merge_requests`，返回 `{ webUrl }`（来自响应 `web_url`）。`token` 缺失、为 null 或空字符串时抛出 `GitlabTokenMissingError`，编排可保持 `处理中`／`awaiting_push`，不得标 `现场验证`。测试可注入 `fetchImpl`。

## 编排

`runOneTicket(config, ticketIdOrDetail)` 实现领单 → 修复 → Git 状态机。可传入已加载的 `BugTicketDetail` 强制领单（如 `--ticket 428`），绕过列表状态白名单。映射决议在任何 `处理中` followup 之前完成；无映射／home 可选 followup 且 `status_change` 为空／null，不领单。领单：`status_change=处理中`，`assignee_change=null`。领单后再下附件（跳过 `file_size === 0`）。`lintEnabled`／`buildEnabled` 默认 `false`。MR 成功 → followup `现场验证`，`phase=done`；本地已 commit 但 push／MR 失败 → 保持 `处理中`，`phase=awaiting_push`；修复失败／无 diff → 保持 `处理中`，`phase=failed`。错误产品 jinan 硬失败且禁止自动 checkout。`runBatch(config, { maxTickets: 1 })` 先 `ensureToken`，再拉候选并调用 `runOneTicket` 至多 `maxTickets` 次。测试可注入 `agentRunner`、`runGit`、`createMr`；`buildAgentBrief`／`createDefaultAgentRunner` 负责 brief 与默认 `pnpm dsh --profile headless` 拉起。

## 模型体验

无，因为本包是部署本地的映射库，从不向模型请求贡献 token。Agent brief 字符串供另一次 headless 运行使用。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- Cordis `apply` 仅校验 Config；不在 `ctx` 上注册编排。
- 默认 agent runner 是薄封装的 `pnpm dsh` spawn；生产应注入超时与更完整的退出解析。
- `WorkspaceRoots` 含 home 路径类型，但第一期不得改 home。
