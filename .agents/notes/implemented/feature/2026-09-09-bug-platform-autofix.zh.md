# Agent Note: 自研 bug 平台自动修复（第一期）

Status: implemented

[English](2026-09-09-bug-platform-autofix.md) | 中文

## 问题

自研 bug 平台上有一批可在本地产品工作区修复的未指派前端工单，目标仓为 `jgts/bigdata-web-frontend`。操作员需要一条手动跑批路径：领单、按菜单映射到正确工作区、拉起 headless agent、尝试 Git push 与 GitLab MR，并向平台写回 followup。deepseek-harness 必须承载该路径，且不改 `agent-loop`、不在试点落地前发明完整 capability seam，也不把错误的产品 jinan 检出到另一个工作区。

## 决策

在 `packages/bug-platform/` 下交付**混合双包、库优先**布局：

- `@deepseek-ai/dsh-bug-platform-http` 负责登录、列表／详情、followup 与鉴权下载。调用方用已解析凭据构造 `BugPlatformClient`；Cordis `apply` 只校验 Config，不注册 `ctx.bugPlatform`。
- `@deepseek-ai/dsh-bug-platform-autofix` 负责菜单映射、选单、本地幂等状态、按工作区隔离的 Git 辅助、`inspectWorkspace`／`inspectAutofixWorkspaces` 健康检查、GitLab ensure MR 与 note，以及 `runOneTicket`／`runBatch` 编排。Cordis `apply` 仍为 Config 桩；`examples/bug-platform-autofix/run-once` 直接导入辅助函数。

完整的 Service Definition／Provider／Consumer seam 与可安装 bundle 仍推迟。一期合入策略为**自动修 + 人工合**；高确信度自动合仍推迟且须记录判定依据。经验沉淀仍推迟。

### 工作区与映射

每个本地根目录（`dkh-custom`、`dkh-ailpha`、`dkh-home`）各自绑定一条产品 jinan 与自己的 `gitlabProjectId`。映射只决议一个 `localRoot`；修改／lint／commit／push／MR 均只在该目录进行。`ensureMergeRequest` 使用该工作区的 `gitlabProjectId`。辅助函数禁止跨目录把另一条产品 `*-jinan` checkout 进错误根目录；错误 HEAD 硬失败，不做自动纠正。`createBugfixBranch` 在 `checkout -b` 前先 checkout 绑定 jinan，避免新单叠在上一单 `bugfix/*` 上。工作区 `autofix: false` 在 `selectTickets` 时被排除，白名单跑批不会占用 `maxTickets`。强制 `--ticket` 仍走 `runOneTicket`，映射后跳过并写跟进（`status_change` 空），不领 `处理中`。

权威映射文件为 `menu-mapping.json`（`systems.*.items[]`）。`resolveMenu` 精确匹配 `target_menu`，只保留 `custom`／`ailpha`，优先 `file_exists`，再**优先 custom 于 ailpha**；未知、`repo == null` 或 **home** 返回 null。提报须选末端菜单；描述不参与菜单决议。默认列表状态含 `待确认`／`验证未通过`／`转派`／`转需求`；排除 `网络安全数据大屏` 与 `网络安全指挥大屏`。

### 门禁、GitLab 与再次修单

`lintEnabled` 与 `buildEnabled` **默认关闭**。`GITLAB_TOKEN` 可选。无 token 或 push／ensure MR 失败时，平台保持 `处理中`，本地记 `phase=awaiting_push`。push 成功时平台状态仍为 **`处理中`**（跟进含 MR 链接），**不得**标 `现场验证`；由人工审阅合入。

`run-once` 在构造编排配置之后、开跑任何工单之前调用 `inspectAutofixWorkspaces`。该辅助对每个 `autofix: true` 工作区走 `inspectWorkspace`。检查项为：目录存在、`.git` 存在、HEAD 为绑定 jinan 或 `bugfix/<digits>`、porcelain 干净、origin hostname 与 `gitlab.host` 一致。该检查不调用 GitLab HTTP API 查询项目 path。任一失败则进程退出码 1，并向 stderr 打印 `id: 原因`。

每次 push 成功后，编排 **ensure** MR（创建或冲突时复用）、写 MR note，并写平台 followup（`处理中`，含 MR／commit／摘要）。同一 `bugfix/<id>` 的再次修复因此仍更新平台处理记录与 MR 讨论，不会仅因「MR 已存在」失败。强制 `--ticket`／`--tickets` 可重跑 `done`／`awaiting_push`／`failed`；仅本地 `claimed`／`fixing` 会拦住。

默认 agent runner 在 `harnessRoot` 下经 tsx 拉起 harness `apps/cli`，cwd 为产品工作区——禁止在产品仓内 `pnpm dsh`。示例支持 `--poll-interval <秒>` 串行守护轮询；亦可用 Windows 任务计划周期性拉起 `--max 1`。运维入口 `reset-to-pending.ts` 可将单批量改回「待确认」（`--tickets`，或不写则取本地 `phase=failed`），写跟进并清本地 state，不跑 agent。跑批进度：终端打印队列与 `[i/n]`，并写 `progress.json`（可选展示 `pid`）。`run-once` 在强制／白名单／轮询整段生命周期持有 `dirname(progressFile)/run.lock`：存活 holder pid 以 `已有跑批（pid=<n>），progressFile=<path>` 失败；`ESRCH` 视为过期并替换；`EPERM` 视为仍存活，不得抢占。

### 上下文不足／非前端时停止

映射决议后，编排先下载附件并运行 `assessPreAgentContext`，**再**领单。上下文过薄时写平台跟进（`status_change` 空），本地 `phase=skipped`，不改为 `处理中`。有截图时，DeepSeek 视觉预跑（默认 `deepseek-flash`）把观察写入 agent brief；视觉失败只记录，不阻断领单。Agent 在领单后若无法定位前端改动或无法确认是前端问题，须发出 `SKIP_AUTOFIX|<类别>|<原因>`；编排写平台跟进（类别＋原因），状态保持 `处理中`，`phase=failed`，不开 MR。brief 另含判断准则：独立判断、勿迎合叙述；区分事实／预测／观点；按本仓代码 → 截图观察 → 截图路径 → 具体跟进 → 笼统描述取证。矛盾诉求、过大改动、环境配置、已修复、安全敏感等仍用现有三类停止，不新增类别。

### 模型可见 brief 与 session 日志

若日后在带 session 的 agent 内运行自动修复，agent brief 属于模型可见输入，必须能从 session 日志重建（模型可见 ⟺ 已记录）。第一期 `run-once` 在该路径之外拉起 headless，故 brief **尚未**写入 session 日志；在接入 session 前仍接受这一限制。

## 曾考虑的替代方案

**第一期就做完整 capability seam。** 否决：Definition／Provider／Consumer 与产品 bundle 会推迟试点，却不改变示例已需要的 HTTP 与编排约定。

**HTTP 与编排做单包。** 否决：HTTP 客户端可不依赖映射／Git 复用；拆包让库优先的 HTTP 面独立于自动修复状态机。

**在同一工作区内随意 checkout 任意 jinan。** 否决：每个根目录只绑定一条产品 jinan，检出另一产品 jinan 会污染错误本地树。一单只映射一个根目录与一条绑定 jinan。

**三个工作区共用一个写死的 GitLab 项目 id。** 否决：同一 `gitlab.host` 上各工作区可指向不同 GitLab 项目；MR 创建／复用使用 `workspaces[].gitlabProjectId`。

**在 `menu-mapping.json` 旁另维护简表 YAML。** 否决：导出 JSON 已含 `repo`、路由与 `file_exists`；第二份表会漂移。

**无 GitLab token 则整次跑批失败。** 否决：远程不可用时，本地 commit 加 `awaiting_push` 仍能交付修复；无 MR 却标 `现场验证` 会对平台撒谎。

**失败时自动转派后端处理人。** 第一期否决；保持 `处理中` 并写明原因，不改指派。

**默认自动合入 MR。** 否决；默认人工合。后续高确信度自动合必须记录判定依据。

## 后果

一期交付可手动触发的库优先路径，已能开出真实 GitLab MR 并回写平台 followup；代价是轮询、并发、完整 seam、session 记录的 brief 与经验沉淀仍推迟。共享同一 `progressFile` 的两个 `run-once` 进程不能重叠：第二个存活 pid 在领单前失败。默认跳过 lint／build 可能推送损坏 diff，需操作员开启按路径 lint。再次修单会更新平台与 MR 记录，但错误产品合入仍须人审后再进 jinan。
