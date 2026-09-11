# Agent Note: 自研 bug 平台自动修复（第一期）

Status: implemented

[English](2026-09-09-bug-platform-autofix.md) | 中文

## 问题

自研 bug 平台上有一批可在本地产品工作区修复的未指派前端工单，目标仓为 `jgts/bigdata-web-frontend`。操作员需要一条手动跑批路径：领单、按菜单映射到正确工作区、拉起 headless agent、尝试 Git push 与 GitLab MR，并向平台写回 followup。deepseek-harness 必须承载该路径，且不改 `agent-loop`、不在试点落地前发明完整 capability seam，也不把错误的产品 jinan 检出到同一 remote 的另一个工作区。

## 决策

在 `packages/bug-platform/` 下交付**混合双包、库优先**布局：

- `@deepseek-ai/dsh-bug-platform-http` 负责登录、列表／详情、followup 与鉴权下载。调用方用已解析凭据构造 `BugPlatformClient`；Cordis `apply` 只校验 Config，不注册 `ctx.bugPlatform`。
- `@deepseek-ai/dsh-bug-platform-autofix` 负责菜单映射、选单、本地幂等状态、按工作区隔离的 Git 辅助、GitLab ensure MR 与 note，以及 `runOneTicket`／`runBatch` 编排。Cordis `apply` 仍为 Config 桩；`examples/bug-platform-autofix/run-once` 直接导入辅助函数。

完整的 Service Definition／Provider／Consumer seam 与可安装 bundle 仍推迟。一期合入策略为**自动修 + 人工合**；高确信度自动合为后续例外且须审计判定依据（设计 §3.11）。经验沉淀仍属三期（设计 §9.2）。

### 工作区与映射

三个本地根目录（`dkh-custom`、`dkh-ailpha`、`dkh-home`）共用同一 GitLab 项目，各自绑定一条产品 jinan。映射只决议一个 `localRoot`；修改／lint／commit／push／MR 均只在该目录进行。辅助函数禁止跨目录把另一条产品 `*-jinan` checkout 进错误根目录；错误 HEAD 硬失败，不做自动纠正。`createBugfixBranch` 在 `checkout -b` 前先 checkout 绑定 jinan，避免新单叠在上一单 `bugfix/*` 上。

权威映射文件为 `menu-mapping.json`（`systems.*.items[]`）。`resolveMenu` 精确匹配 `target_menu`，只保留 `custom`／`ailpha`，优先 `file_exists`，再**优先 custom 于 ailpha**；未知、`repo == null` 或 **home** 返回 null。提报须选末端菜单；描述不参与菜单决议（设计 §4.3）。默认列表状态含 `待确认`／`验证未通过`／`转派`／`转需求`；排除 `网络安全数据大屏` 与 `网络安全指挥大屏`。

### 门禁、GitLab 与再次修单

`lintEnabled` 与 `buildEnabled` **默认关闭**。`GITLAB_TOKEN` 可选。无 token 或 push／ensure MR 失败时，平台保持 `处理中`，本地记 `phase=awaiting_push`。push 成功时平台状态仍为 **`处理中`**（跟进含 MR 链接），**不得**标 `现场验证`；由人工审阅合入。

每次 push 成功后，编排 **ensure** MR（创建或冲突时复用）、写 MR note，并写平台 followup（`处理中`，含 MR／commit／摘要）。同一 `bugfix/<id>` 的再次修复因此仍更新平台处理记录与 MR 讨论，不会仅因「MR 已存在」失败。强制 `--ticket`／`--tickets` 可重跑 `done`／`awaiting_push`／`failed`；仅本地 `claimed`／`fixing` 会拦住。

默认 agent runner 在 `harnessRoot` 下经 tsx 拉起 harness `apps/cli`，cwd 为产品工作区——禁止在产品仓内 `pnpm dsh`。

### 上下文不足／非前端时停止

描述过短且无截图时，领单后预检直接停止并回写 `insufficient_context`，不拉 agent、不建 `bugfix` 分支。Agent 若判定上下文不足或无法确定为前端问题，须在摘要中写 `SKIP_AUTOFIX|<类别>|<原因>`；编排解析后写平台跟进（类别＋原因），状态保持 `处理中`，`phase=failed`，不开 MR。brief 另含判断准则：独立判断、勿迎合叙述；区分事实／预测／观点；按本仓代码 → 截图 → 具体跟进 → 笼统描述取证。矛盾诉求、过大改动、环境配置、已修复、安全敏感等仍用现有三类停止，不新增类别。

### 模型可见 brief 与 session 日志

若日后在带 session 的 agent 内运行自动修复，agent brief 属于模型可见输入，必须能从 session 日志重建（模型可见 ⟺ 已记录）。第一期 `run-once` 在该路径之外拉起 headless，故 brief **尚未**写入 session 日志；在接入 session 前仍接受这一限制。

## 曾考虑的替代方案

**第一期就做完整 capability seam。** 否决：Definition／Provider／Consumer 与产品 bundle 会推迟试点，却不改变示例已需要的 HTTP 与编排约定。

**HTTP 与编排做单包。** 否决：HTTP 客户端可不依赖映射／Git 复用；拆包让库优先的 HTTP 面独立于自动修复状态机。

**在同一工作区内随意 checkout 任意 jinan。** 否决：三根目录共享同一 remote，检出另一产品 jinan 会污染错误本地树。一单只映射一个根目录与一条绑定 jinan。

**在 `menu-mapping.json` 旁另维护简表 YAML。** 否决：导出 JSON 已含 `repo`、路由与 `file_exists`；第二份表会漂移。

**无 GitLab token 则整次跑批失败。** 否决：远程不可用时，本地 commit 加 `awaiting_push` 仍能交付修复；无 MR 却标 `现场验证` 会对平台撒谎。

**失败时自动转派后端处理人。** 第一期否决；保持 `处理中` 并写明原因，不改指派。

**默认自动合入 MR。** 否决；默认人工合。后续高确信度自动合必须记录判定依据（设计 §3.11）。

## 后果

一期交付可手动触发的库优先路径，已能开出真实 GitLab MR 并回写平台 followup；代价是轮询、并发、完整 seam、session 记录的 brief 与经验沉淀仍推迟。无共享锁时重叠手动跑批仍可能争用同一未指派单（本地状态文件只保护遵守它的单进程）。默认跳过 lint／build 可能推送损坏 diff，需操作员开启按路径 lint。再次修单会更新平台与 MR 记录，但错误产品合入仍须人审后再进 jinan。
