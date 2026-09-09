# Agent Note: 自研 bug 平台自动修复（第一期）

Status: proposed

[English](2026-09-09-bug-platform-autofix.md) | 中文

## 问题

自研 bug 平台上有一批可在本地产品工作区修复的未指派前端工单，目标仓为 `jgts/bigdata-web-frontend`。操作员需要一条手动跑批路径：领单、按菜单映射到正确工作区、拉起 headless agent、尝试 Git push 与 GitLab MR，并向平台写回 followup。deepseek-harness 必须承载该路径，且不改 `agent-loop`、不在试点落地前发明完整 capability seam，也不把错误的产品 jinan 检出到同一 remote 的另一个工作区。

## 提案

在 `packages/bug-platform/` 下交付**混合双包、库优先**布局：

- `@deepseek-ai/dsh-bug-platform-http` 负责登录、列表／详情、followup 与鉴权下载。调用方用已解析凭据构造 `BugPlatformClient`；Cordis `apply` 只校验 Config，不注册 `ctx.bugPlatform`。
- `@deepseek-ai/dsh-bug-platform-autofix` 负责菜单映射、选单、本地幂等状态、按工作区隔离的 Git 辅助、可选 GitLab MR，以及 `runOneTicket`／`runBatch` 编排。Cordis `apply` 仍为 Config 桩；示例 `run-once` 直接导入辅助函数。

完整的 Service Definition／Provider／Consumer seam 与可安装 bundle 推迟到试点跑通之后。

### 工作区与映射

三个本地根目录（`dkh-custom`、`dkh-ailpha`、`dkh-home`）共用同一 GitLab 项目，各自绑定一条产品 jinan。映射只决议一个 `localRoot`；修改／lint／commit／push／MR 均只在该目录进行。辅助函数禁止跨目录把另一条产品 `*-jinan` checkout 进错误根目录；错误 HEAD 硬失败，不做自动纠正。

权威映射文件为 `menu-mapping.json`（`systems.*.items[]`）。`resolveMenu` 精确匹配 `target_menu`，只保留 `custom`／`ailpha`，优先 `file_exists`，再**优先 custom 于 ailpha**；未知、`repo == null` 或 **home** 返回 null。

### 门禁、GitLab 与试点单

`lintEnabled` 与 `buildEnabled` **默认关闭**；只要有本地 diff 即可进入 Git 路径，不必先跑 lint／build。

`GITLAB_TOKEN` 可选。无 token 或 push／MR 失败时，平台保持 `处理中`，本地记 `phase=awaiting_push`，**不得**标 `现场验证`。

试点单 **428**（状态 `转派`）不在默认列表白名单（`待确认`／`验证未通过`）。操作员用 `--ticket 428`（把预加载详情传入 `runOneTicket`）强制领单，从而绕过列表状态过滤；映射仍须成功。

### 模型可见 brief 与 session 日志

若日后在带 session 的 agent 内运行自动修复，agent brief 属于模型可见输入，必须能从 session 日志重建（模型可见 ⟺ 已记录）。第一期 `run-once` 在该路径之外拉起 headless，故 brief **尚未**写入 session 日志；在接入 session 前接受这一限制。

## 备选方案

**第一期就做完整 capability seam。** 否决：Definition／Provider／Consumer 与产品 bundle 会推迟试点，却不改变示例已需要的 HTTP 与编排约定。

**HTTP 与编排做单包。** 否决：HTTP 客户端可不依赖映射／Git 复用；拆包让库优先的 HTTP 面独立于自动修复状态机。

**在同一工作区内随意 checkout 任意 jinan。** 否决：三根目录共享同一 remote，检出另一产品 jinan 会污染错误本地树。一单只映射一个根目录与一条绑定 jinan。

**在 `menu-mapping.json` 旁另维护简表 YAML。** 否决：导出 JSON 已含 `repo`、路由与 `file_exists`；第二份表会漂移。

**无 GitLab token 则整次跑批失败。** 否决：远程不可用时，本地 commit 加 `awaiting_push` 仍能交付修复；无 MR 却标 `现场验证` 会对平台撒谎。

**失败时自动转派后端处理人。** 第一期否决；保持 `处理中` 并写明原因，不改指派。

## 验收标准

- 两包均以库优先插件交付，`inject` 为空且无自有 `ctx` 键；示例 profile 组合手动 `run-once` 跑批。
- 映射优先 custom 于 ailpha，在任何 `处理中` 领单前跳过 home 与无映射菜单，并拒绝跨工作区产品 jinan checkout。
- lint／build 默认关闭；可选 GitLab MR 失败时回落 `awaiting_push` 且不标 `现场验证`。
- `--ticket 428` 可在 `转派` 状态下强制试点单。
- 两包 README 写明暂缓的轮询、并发、home 修改与自动转派；本笔记记录第一期 brief 的 session 日志缺口。

## 风险

无轮询与并发锁时，重叠的手动跑批可能争用同一未指派单；本地幂等只保护遵守状态文件的单一进程。

默认跳过 lint／build 可能推送损坏 diff；目标仓支持按路径 lint 后再由操作员开启。

第一期 brief 不在 session 日志内，意味着 transcript 回放与 SDK snapshot 尚不能钉住模型可见的自动修复上下文；接入 session 前须补 session 事件，才能声称符合 harness「模型可见 ⟺ 已记录」。
