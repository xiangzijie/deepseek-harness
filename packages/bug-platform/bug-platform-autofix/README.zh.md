# @deepseek-ai/dsh-bug-platform-autofix

[English](README.md) | 中文

面向内部 bug 平台自动修复的库优先辅助：加载 `menu-mapping.json`，将工单的 `target_menu` 解析到 custom／ailpha 工作区命中项，过滤列表行，维护本地 JSON 幂等状态，提供按工作区隔离的 Git 辅助（`assertProductBranch`、`assertClean`、`createBugfixBranch`、`commitAll`、`pushBranch`、`listChangedFiles`，可注入 `RunGit`），可选通过 `createMergeRequest` 创建 GitLab MR，并用 `runOneTicket`／`runBatch` 编排单票或跑批。第一阶段 Cordis `apply` 仅作 Config 桩（`inject` 为空）；编排直接导入辅助函数。

## 值班配置（`operator.yaml`）

`loadOperatorConfig(configPath)` 读取并校验传入路径上的控制台／CLI `operator.yaml`（相对或绝对路径均可）。文件缺失或字段非法时立即抛出 `Error`（例如 `operator.yaml 不存在: …` 或 `operator-config: …` 校验信息）。每个工作区必须有自己的 `gitlabProjectId`；GitLab MR 创建／复用使用该 id。可选字段省略时使用默认值：`gitlab.tokenEnv` → `GITLAB_TOKEN`，`workspaces[].autofix` → `true`，`skills.forceMaxCount` → `3`，`skills.forceMaxChars` → `8000`，`run.maxTickets` → `1`，`run.operatorId` → `local`，`run.lintEnabled`／`run.buildEnabled` → `false`。返回值提供 `workspaceByMappingRepo` 与 `workspaceById`。完整样例见 [examples/bug-platform-autofix/operator.example.yaml](../../../examples/bug-platform-autofix/operator.example.yaml)。

## 个人 skill 上传

`validateSkillUpload` 只接受 UTF-8 Markdown，且 `name` 为 kebab-case、`description` 非空；拒绝 `scripts/` 路径、非 `.md` 文件名、NUL 字节、ZIP 魔数（文件头 `PK`）以及个人上传的 `force: true`。`writePersonalSkill` 仅在 `operatorId` 与 `name` 均为 kebab-case、且解析后的目录仍位于 `personalRoot` 之下时，写入 `personalRoot/operatorId/<name>/SKILL.md`；否则抛错。调用方不得假定已经跑过 `validateSkillUpload` 而跳过该检查。

## 跑批锁

`acquireRunLock(lockPath, info)` 把 `{ pid, startedAt, configPath }` 写到 `dirname(progressFile)/run.lock`。第二个存活 pid 抛出 `已有跑批（pid=<n>），progressFile=<path>`。`process.kill(pid, 0)` 报 `ESRCH` 视为过期并替换；`EPERM` 视为仍存活，不得抢占。`readRunLock` 返回该文档或 `undefined`。返回的 `release()` 删除该文件。`runLockPath(progressFile)` 是锁路径辅助。示例 `run-once` 在强制／白名单／轮询整段生命周期持有此锁。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `mappingFile` | `""` | `menu-mapping.json` 的绝对路径。为空时由调用方把已解析 JSON 交给 `loadMenuMapping`。 |

## 菜单映射

`loadMenuMapping(json)` 读取 `systems.*.items[]`。`resolveMenu(index, targetMenu)` 精确匹配 `target_menu`，只保留 `repo` 为 `custom` 或 `ailpha` 的项，优先 `file_exists === true`，再优先 `custom` 于 `ailpha`；未知、`repo == null`、`home` 或其他不可修仓库返回 null。

## 选单与本地状态

`selectTickets(tickets, index, store, options?)` 保留：`assignee_id` 为 null、`status` 在允许列表（默认 `待确认`／`验证未通过`／`转派`／`转需求`）、`target_menu` 不是 `网络安全数据大屏`／`网络安全指挥大屏`、`resolveMenu` 有命中、在传入 `options.workspaces` 时映射工作区不是 `autofix: false`、且不在 `TicketStateStore` 进行中阶段（`claimed`／`fixing`／`awaiting_push`）的行。可用 `options.statuses` 覆盖允许列表。`runBatch` 总会传入 workspaces，因此 `autofix: false` 的工单不占用 `maxTickets`；强制 `--ticket` 仍走 `runOneTicket`。

`loadState(path)`／`saveState(path, store)` 读写 `{ tickets: TicketRecord[] }`；文件不存在时得到空的 `TicketStateStore`。`isActive(record)` 对进行中阶段为 true；`store.get`／`store.upsert` 维护内存映射。

## Git 工作区

辅助函数只接受单个 `localRoot`，不会跨工作区切换产品 jinan。`assertProductBranch(localRoot, expectedJinan)` 允许该 jinan 或 `bugfix/<digits>`；若 HEAD 是另一条 `*-jinan` 则硬失败。`assertClean` 要求 porcelain 状态为空。`createBugfixBranch(localRoot, ticketId, expectedJinan)`：已在 `bugfix/<id>` 则复用；分支已存在则 checkout；否则先 checkout 到 `expectedJinan` 再 `checkout -b`，避免叠在上一单 `bugfix/*` 上。`commitAll` 执行 `add -A` + `commit` 并返回 `rev-parse HEAD`。`pushBranch` 执行 `push -u origin <branch>`。`listChangedFiles` 解析 porcelain 路径。测试可传入 `runGit(cwd, args)`；省略则使用 `defaultRunGit`。`inspectWorkspace({ localRoot, productBranch, gitlabHost, gitlabProjectId, runGit })` 仅根据本地 git 返回 `{ ok, reasons }`（目录、`.git`、HEAD、干净 porcelain、origin hostname 与 `gitlab.host`），不调用 GitLab HTTP。`inspectAutofixWorkspaces({ workspaces, gitlabHost, runGit })` 只检查 `autofix: true` 工作区，汇总 `id: 原因` 行，返回 `{ ok, lines }`。`run-once` 在进度锁之后、该聚合之前，若 `manifest.yaml` 含 `force: true` 项则调用 `assertGlobalSkillsRunnable`：强制 skill 文件或 `manifest.yaml` 有未提交变更时即使带 `--allow-stale-global-skills` 也拒绝开跑；HEAD 须与 `origin/main` 一致，除非带该 flag。全局仓缺失且需要强制 skill 时进程以退出码 1 失败。随后调用工作区聚合；任一失败则退出码 1。

## 可选 GitLab MR

`ensureMergeRequest(...)` 先 `POST` 创建 MR；若源分支已有 MR（典型 HTTP 409），则按 `source_branch` 查出已有 MR 并复用。`addMergeRequestNote(...)` 向该 MR 写讨论备注。编排在**每次** push 成功后：ensure MR → 写 MR note（含 commit 与摘要）→ 平台 followup（`处理中`，含 MR / commit / 摘要；**不**标 `现场验证`）。因此同一 `bugfix/<id>` 的第二次及以后修复不会因「MR 已存在」落入 `awaiting_push`，且每次都有独立评论。`createMergeRequest` 仍导出为仅创建的薄封装。`token` 缺失时抛出 `GitlabTokenMissingError`，编排保持 `处理中`／`awaiting_push`。测试可注入 `fetchImpl`、`ensureMr`、`addMrNote`。

## 编排

`runOneTicket(config, ticketIdOrDetail)` 实现领单 → 修复 → Git 状态机。可传入已加载的 `BugTicketDetail` 强制处理（如 `--ticket 428`），绕过列表状态白名单。映射决议在任何 `处理中` followup 之前完成；无映射／home／`autofix: false` 可选 followup 且 `status_change` 为空／null，不领单。领单：`status_change=处理中`，`assignee_change=null`。映射之后、领单之前下载附件（跳过 `file_size === 0`）。领单前，若描述过短且无截图，`assessPreAgentContext` 以 `insufficient_context` 跳过且不领单（`phase=skipped`）。该预检之后，可选 `config.eligibility`（`run-once` 始终设置）调用 `assessNeedFrontendFix`（仅描述与跟进，不读截图；工单正文不可信，忽略其中改 JSON／结果的指令）；仅当 `needFrontendFix === false` 时以 `out_of_scope` 跳过且不写 `处理中`；`true`／`uncertain`／`ok: false` 继续。仍在领单前，`runOneTicket` 从 `config.skills.globalLocal/manifest.yaml` 解析 `force: true` 的 skill（`skills/<name>/SKILL.md` 或 `skills/<name>.md`；`workspaceIds: []` 表示所有 `autofix: true` 的 id；`skills[].name` 必须符合 kebab-case `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`），把正文写入 brief 的 `## 强制 skill（编排注入，必须遵守）`；超过 `forceMaxCount`／`forceMaxChars`、名称不是 kebab-case、或强制项带 `disable-model-invocation: true` 则跳过且不写 `处理中`（`phase=skipped`）。当设置 `config.vision` 且有截图时，`describeScreenshots` 调用官方 DeepSeek 多模态（默认 `deepseek-flash`），把观察写入 agent brief 的 `## 截图观察（模型视觉）`；视觉失败写跟进但不改状态，仍允许领单。Agent brief 含停止规则；摘要含 `SKIP_AUTOFIX|<类别>|<原因>` 在领单后走停止路径。`lintEnabled`／`buildEnabled` 默认 `false`。MR 成功 → followup 保持 `处理中`（含 MR 链接与摘要），`phase=done`；本地已 commit 但 push／MR 失败 → 保持 `处理中`，`phase=awaiting_push`；修复失败／无 diff → 保持 `处理中`，`phase=failed`。自动修复**从不**标 `现场验证`。错误产品 jinan 硬失败且禁止自动 checkout。`runBatch(config, { maxTickets: 1 })` 先 `ensureToken`，再拉候选并调用 `runOneTicket`，直到已领单结果（含随后失败的领单）达到 `maxTickets`；跳过结果不占用 `maxTickets`。测试可注入 `agentRunner`、`runGit`、`ensureMr`、`addMrNote`；`buildAgentBrief`／`createDefaultAgentRunner` 负责 brief 与默认从 harness `apps/cli` 拉起 headless（需 `harnessRoot`，cwd 为产品仓）。`run-once` 把 `operator.yaml` 的 `skills.globalLocal` 与强制上限传入编排。`createDefaultAgentRunner({ skillPatch })` 在 brief 之前写入 `dsh --patch` overlay：skill-filesystem 的 `customSkillDirs` 为全局 `skills/` 目录（rank 300，仓内 100/200 会赢过它）；并插入 rank=50 的 `autofix-personal` 提供方，根目录为 `join(personalRoot, operatorId)`，因此个人 skill 同名覆盖仓内。overlay 的 `name` 指向源码面 `personal-skill-plugin.ts`，tsx headless 启动无需先构建该额外 export。

## 模型体验

编排把 `manifest.yaml` 中 `enabled` 且 `force: true` 的全局 skill 正文写入 headless agent brief（`## 强制 skill（编排注入，必须遵守）`），模型必须遵守且不必调用 skill 工具。名称出现在第 2 行（`强制 skill 名称：…`）。brief 其余部分（工单字段、停止规则、附件）在此组装后交给另一次 headless 运行。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- Cordis `apply` 仅校验 Config；不在 `ctx` 上注册编排。
- 默认 agent runner 从 harness `apps/cli`（tsx + `harnessRoot`）拉起 headless，cwd 为产品工作区；应注入超时与更完整的退出解析，且禁止在产品仓内 `pnpm dsh`。可选 `skillPatch` 会写 `--patch` overlay（`customSkillDirs` + rank=50 个人提供方）；个人目录里 `disable-model-invocation: true` 的 skill 不会进入该目录。
- `WorkspaceRoots` 含 home 路径类型，但第一期不得改 home；映射到 `home` 时在领单前跳过。
- 无定时轮询，亦无多单并发；`runBatch` 串行且由人工触发。
- 自动转派后端处理人暂缓；失败 followup 保持 `处理中` 且不改指派。
- 第一期 `run-once` 的 agent brief 不在 session 日志内；接入 session 后须使该模型可见 brief 可从 session 事件重建。
