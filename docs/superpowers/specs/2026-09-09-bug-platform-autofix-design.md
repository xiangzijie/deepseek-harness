# 自研 Bug 平台自动修复（第一期）设计

日期：2026-09-09

状态：已实现／试点中（方案 3：混合接入 deepseek-harness）

范围：尽快跑通「手动跑批 → 领未指派单 → 本地改代码 → 尽量自动 Git → 回写平台」

## 1. 目标与非目标

### 1.1 目标

- 从自研 bug 平台拉取符合条件的工单，在本地微服务前端仓中自动尝试修复。
- 修复产物优先自动 push 并开 MR；若远程 GitLab 不可用，则保留本地 commit，由人工推送。
- 通过平台 followup 接口回写进度与结果。
- 以 deepseek-harness 插件方式接入（瘦 capability + 编排命令），不修改 `agent-loop`。

### 1.2 非目标（第一期不做）

- 定时轮询、多并发 worktree。
- **默认自动合入 MR**（合入策略见 §3.11：一期只开 MR，人工合；高确信度自动合留待后续且须审计记录）。
- 自动转派后端处理人。
- 修改 `dkh-home`（左侧菜单 / home 包默认不在范围内）。
- 截图视觉回归门禁（截图仅作模型输入）。
- 完整三件套文档化与产品化打包（完整 Seam + Bundle 留待后续加强）。

## 2. 外部系统

### 2.1 Bug 平台

- Base URL：`http://10.20.183.62:8080`（可配置）
- 鉴权：`POST /api/auth/login` → `data.token`；请求头 `Authorization: Bearer <token>`
- 凭证：仅环境变量（如 `BUG_PLATFORM_BASE_URL`、`BUG_PLATFORM_USERNAME`、`BUG_PLATFORM_PASSWORD`）；禁止写入仓库与日志
- 401 时重新 login 后重试当前请求

| 能力 | 方法 | 路径 |
|------|------|------|
| 登录 | POST | `/api/auth/login` |
| 统计（可选） | GET | `/api/bug-tickets/stats?project_id=47` |
| 列表 | GET | `/api/bug-tickets` |
| 详情 | GET | `/api/bug-tickets/:id` |
| 跟进/改状态 | POST | `/api/bug-tickets/:id/followups` |
| 截图/附件 | GET | `/api/uploads/...`（相对 `url`，需 Bearer） |

列表查询第一期固定语义：

- `project_id=47`
- `status=待确认,验证未通过,转派,转需求`（实现时可分页）
- 不按 `version_id` 过滤
- 客户端再过滤：`assignee_id == null`；`target_menu` 不是 `网络安全数据大屏`／`网络安全指挥大屏`

Followup 写回字段（已验证）：`content`、`attachments`、`status_change`、`issue_type_change`、`assignee_change`、`plan_solve_date_change`。

可选状态（前端角色可见，以平台为准）：待确认、处理中、转派、不是问题、已处理、未复现、转需求、现场验证等。

### 2.2 本地工作区（同一远程，三分支三目录）

远程为**同一个** GitLab 项目：`jgts/bigdata-web-frontend`
（`http://gitlab.info.dbappsecurity.com.cn/jgts/bigdata-web-frontend`）

本地用**三个独立工作目录**分别检出三条产品分支（已切换到位，名称固定）：

| 本地路径 | 唯一允许的产品分支 | 远程树链接 | 路由入口 | 第一期角色 |
|----------|-------------------|------------|----------|------------|
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-custom` | `dkh-custom-jinan` | `.../tree/dkh-custom-jinan` | `src/routes.js` | 新模块；**优先修改** |
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-ailpha` | `dkh-ailpha-jinan` | `.../tree/dkh-ailpha-jinan` | `src/commonRoutes.js` | 老旧页面；仅当 custom 无该模块 |
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-home` | `dkh-home-jinan` | `.../tree/dkh-home-jinan` | （第一期不改） | **默认不改**；映射误指向则跳过 |

因 remote 相同，在某一目录里 `git checkout` 到另一条 jinan 分支，就会把「别的产品线代码」检进错误工作区。故硬约束：

- **一单一目录**：映射决议的 `repo`（custom|ailpha|home）决定唯一 `localRoot`；修改 / lint / commit / push / MR 只允许在该目录。
- **禁止跨目录改代码**：custom 的单不得写入 `dkh-ailpha` 或 `dkh-home` 目录（反之亦然）。
- **禁止在错误目录切换产品分支**：例如禁止在 `dkh-ailpha` 中 `checkout dkh-custom-jinan`（或任意其它产品 jinan）来改 custom 代码。开跑前校验 `HEAD` 为本目录绑定的 jinan，或本单在**本目录**从该 jinan 拉出的 `bugfix/<ticket_id>`。
- 三条产品分支名第一期**固定不改配**。

### 2.3 GitLab

- 项目 path：`jgts/bigdata-web-frontend`（三工作区共用同一 remote）
- MR：在对应工作区内 push `bugfix/<id>`，目标分支为**该工作区绑定的 jinan**（custom 单 → `dkh-custom-jinan`，ailpha 单 → `dkh-ailpha-jinan`）；不得把 custom 修复 MR 打到 ailpha 分支
- 策略：优先自动 push + 开 MR；失败则本地 commit，平台保持 `处理中` 并注明待人工推送
- 凭证：`GITLAB_TOKEN` 等，仅 env；无 Token 时不得假装修单已闭环成功

## 3. 端到端流程

总览（实现必须遵守下列子步骤的顺序与失败语义）：

```text
人工触发跑批（默认最多 1 单，可配置）
  → 3.1 会话登录（整批一次，401 再刷新）
  → 可选 stats（仅日志）
  → 分页拉列表 → 过滤 → 对候选单循环直到成功领满或列表耗尽：
       3.2 幂等检查 → 跳过
       3.3 GET 详情 → 组装文本上下文
       3.4 映射决议（通过前不得标「处理中」）
            失败 → 可选 followup 说明（不改状态）→ 下一单
       3.5 标处理中（不改指派）→ 落盘 phase=claimed
       3.6 下载截图/附件
       3.7 准备工作区与 bugfix/<id>
       3.8 调用 dsh agent
       3.9 门禁（lint/build 均默认关闭；开启后 lint 仅针对变更文件）
       3.10 Git 尝试与回写
```

### 3.1 会话与鉴权

- 跑批进程启动时 `login` **一次**，将 `token` 保存在进程内存（或短生命周期会话对象）中。
- 同一跑批内所有 list/get/followup/download 复用该 token；**禁止**每个 HTTP 请求都 login。
- 收到 401（或可解析的过期）：再 `login` 一次，更新内存 token，**仅重试失败的那一次请求**；连续刷新失败则中止跑批并报告。
- 用户名密码与 token 只来自环境变量 / credentials；日志与 session 摘要中不得出现明文密钥。

### 3.2 选单与幂等

- `GET /api/bug-tickets`：`project_id=47`，`status=待确认,验证未通过,转派,转需求`，按页拉取直至满足「本批已修/已尝试上限」或无更多页。
- 客户端过滤：保留 `assignee_id == null` 且 `target_menu` 不是 `网络安全数据大屏`／`网络安全指挥大屏`。
- 读取本地状态文件：若该 `ticket_id` 的 `phase` 为进行中（如 `claimed` / `fixing` / `awaiting_push`）或已成功闭环且策略禁止重开，则跳过。
- 默认每批只处理 1 单；配置 `maxTickets` 时可连续尝试多个候选，但第一期仍建议串行（并发=1）。

### 3.3 详情与文本上下文

- `GET /api/bug-tickets/:id`。
- 取出并规范化：`id`、`target_menu`、`description`、`issue_type`、`importance`、`followups`。
- `followups` 按 `created_at` 升序排列，注入时标明「以最新跟进为准」。
- 此时只记录截图/附件的远程 `url` 列表，**先不下载**（等映射通过并领单后再下，避免无映射单浪费 IO）。

### 3.4 映射决议（领单前）

输入：`target_menu` + `menu-mapping.json`（§4.2）+ 强制规则。输出：`{ repo, branch, localRoot, routesFile, routeHint?, filePath? }` 或跳过原因。

- 按 §4.2 无法解析为可修 custom/ailpha → 跳过；可选 `followup`：`content` 说明「无菜单映射」，`status_change` 为空（保持原状态）。
- 映射指向 `home` → 跳过；可选 followup「home 不在自动修复范围」，不改状态。
- 映射在 custom 与 ailpha 皆命中（或实现层检测到双仓模块）→ **强制选 custom**。
- 通过后才进入 3.5；**禁止**先标「处理中」再发现无映射。

### 3.5 领单（写处理中）

- `POST .../followups`：`status_change=处理中`，`assignee_change=null`（或不传，语义为不改指派），`content` 标明自动修复开始。
- 本地状态写入：`phase=claimed`，记录 `repo`、`branch`、时间戳。
- 若 followup 失败：不创建分支、不调 agent；记错误并处理下一候选（或中止，可配置）。

### 3.6 下载附件

- 下载主单 `screenshots[]` 与各 `followups[].attachments[]`。
- 跳过 `file_size === 0` 或下载失败的项，并在 Agent brief 中注明缺失。
- 保存到跑批工作目录（如 `.dsh-bugfix/<ticket_id>/assets/`）；施加张数/总大小上限配置。
- 相对路径用 `baseUrl` 拼接；请求带同一 Bearer。

### 3.7 工作区与分支

- 目标仅为映射得到的那一个 `localRoot`；**不得**切换到其它两个本地目录去改本单。
- 开跑前断言：当前分支为本目录绑定的 jinan，或已是本单的 `bugfix/<ticket_id>`。若当前在其它产品 jinan（例如在 ailpha 目录上却是 `dkh-custom-jinan`）→ **中止并回写**，禁止自动 checkout「纠正」。
- `git status` 干净；dirty 则失败并说明。
- 仅在本目录内，从**该目录绑定的产品 jinan** 创建 `bugfix/<ticket_id>`（若当前停在其它 `bugfix/*` 上，须先 checkout 回 jinan 再 `checkout -b`，禁止叠前序单提交）；MR 目标为**同一产品 jinan**（同一 GitLab 项目内的对应分支）。
- 不得在本目录检出另一条产品 jinan 来改文件。
- 状态：`phase=fixing`。

### 3.8 调用 Agent

- 启动 dsh headless（或等价编排）：工作目录=目标仓；注入 §4.1 brief（含本地截图路径、`routesFile`、`filePath`/`routeHint`）。
- 优先在映射路径与路由指向的模块内修改。
- **停止／跳过（非「猜改」）**：上下文不足，或无法确定为前端问题（更像接口／数据／权限／配置／纯后端）时，禁止改码。Agent 摘要须含一行 `SKIP_AUTOFIX|<类别>|<原因>`（类别：`insufficient_context`｜`not_frontend`｜`out_of_scope`）；编排解析后写平台跟进（含类别与原因），状态保持 `处理中`，本地 `phase=failed`。
- **预检**：领单并下载附件后、创建 `bugfix/*`／调 agent 前，若描述过短（阈值见实现）且无可用截图，直接停止并回写 `insufficient_context`，不拉 agent。
- **判断准则（brief，不新增类别）**：独立判断、勿一味迎合工单叙述；区分事实／预测／观点；信息源优先级为本仓代码与映射 → 截图／附件 → 带具体路径或接口的最新跟进 → 较早跟进 → 笼统描述。证据冲突、需求型诉求、过大改动面、仅能线上复现、环境配置、已修复／过时、安全敏感等，归入上述三类停止，禁止猜改。

### 3.9 门禁

- **第一期默认不执行门禁**：`lint` 与全量 `build` 均 **默认关闭**；Agent 改完有 diff 即可进入 Git 尝试路径（仍要求存在变更，无 diff 则失败回写）。
- 预留配置：`lintEnabled`（默认 `false`）、`buildEnabled`（默认 `false`）。
- 当将来打开 `lintEnabled` 时：
  - **禁止**依赖三仓现有 `pnpm run lint`：custom / ailpha / home 的脚本均为 `eslint --ext .js,.vue src --fix`，路径写死为 `src`；`pnpm run lint -- <file>` 语法上可接受，但**仍会 lint 整个 `src`**，达不到「只 lint 变更文件」。
  - 正确做法：在目标 `localRoot` 内直接调用本地 `eslint`（或 `pnpm exec eslint`），显式传入本单变更文件列表，例如 `pnpm exec eslint --ext .js,.vue --fix -- <changed files...>`；禁止无文件参数的全仓 lint。
  - 无变更文件则失败；lint 失败则不进入 Git 成功路径，followup 保持 `处理中` 并写明文件与摘要。
- `buildEnabled=true` 时才跑全仓 build（成本高，第一期不启用）。

### 3.10 Git 与结果回写

- **尝试**：在**同一目标目录**内 commit → push `bugfix/<id>` → 向**该目录绑定的 jinan** **ensure** MR（同一 `bigdata-web-frontend` 项目内；custom 单目标 `dkh-custom-jinan`，不得打到 `dkh-ailpha-jinan`）：首次创建；若源分支已有 MR（冲突）则复用已有 MR，不因二次修单失败。
- **每次 push 成功**：向该 MR 追加 discussion note（含 commit 与摘要）；平台 followup `status_change=处理中`，content 含 MR URL、commit、摘要（首次与再次提交均写独立跟进；**不**改为「现场验证」）；`phase=done`，记录 `mrUrl`。
- **无 Token / push 或 ensure MR 失败**：确保本地 commit 存在；followup 保持 `处理中`（或 `status_change=处理中`），写分支名、commit、待人工推送；`phase=awaiting_push`。**禁止**标「现场验证」。
- **修失败 / 偏后端 / `SKIP_AUTOFIX` 停止**：followup 保持 `处理中` + 原因（停止类跟进含类别）；不开假 MR；`phase=failed`。
- 本批若 `maxTickets>1`，回到列表循环处理下一候选；第一期默认处理完 1 单成功或 1 单失败尝试后结束亦可配置。
- **强制 `--tickets`**：可重跑 `done`／`awaiting_push`／`failed`；仅跳过本地仍为 `claimed`／`fixing` 的单。

### 3.11 合入策略（产品约定）

默认模式：**自动修 + 人工合**。开 MR 并回写 `处理中`（跟进含 MR 链接）后，由人审 diff／合入 jinan；编排**不得**默认调用 GitLab merge，也**不得**把平台状态改为「现场验证」。

例外（后续分期可实现，一期不启用）：仅当修复后判定为**百分之百无问题**时，才允许自动合入该 MR。启用时必须同时满足：

- 有显式、可配置的「允许自动合」判定（白名单菜单／问题类型、门禁通过、变更面上限等）；不确定则一律人工合。
- 自动合入前后在 bug 平台 followup（及可选 MR note）写明：**自动合入**、判定依据、所用规则／门禁结果、操作者（机器人账号）、时间、MR／commit。本地状态可记 `mergedBy=auto` 与依据摘要，便于审计与回滚。
- 自动合失败则保持 MR 打开并 followup 说明，回退为人工合；不得静默跳过记录。

## 4. 上下文与映射

### 4.1 注入 Agent 的字段

- `id`、`project_id`、`target_menu`、`target_platform`、`issue_type`、`importance`
- `description`（全文）
- `followups[]`：按 `created_at` 排序；含 `content`、`status_change`、`creator_name`、`created_at`；**以最新跟进为准**
- 本地截图路径列表
- 映射得到的 `repo`、`branch`、`routeHint`、`filePath`（作为优先打开的页面文件）
- 明确指示：先读映射 `filePath`，再按需读目标仓路由入口（custom：`src/routes.js`；ailpha：`src/commonRoutes.js`）

### 4.2 菜单映射表（已落实）

- **权威文件**：`D:\CODE\COMPANY\dkh-bugFix-project\menu-mapping.json`（Config 键如 `mappingFile` 指向此路径；可配置覆盖）。
- **结构**：读取 `systems.*.items[]`；不必再维护单独的简表 YAML。
- **每项关键字段**：`target_menu`、`menu_path`、`menu_code`、`repo`、`branch`、`routeHint`、`filePath`、`file_exists`。
- **解析规则**：
  - 按 bug 的 `target_menu` 精确匹配 `items[].target_menu`。
  - 可修：`repo` 为 `custom` 或 `ailpha`，且建议 `file_exists === true`；`repo == null` 或无法定位 → 视为无映射，跳过。
  - 多条命中：优先 `custom`，再 `ailpha`；仍冲突时用 `menu_path` / `menu_code` 消歧。
  - 指向 home 或非 custom/ailpha → 跳过。
  - `target_menu` 为 `网络安全数据大屏` 或 `网络安全指挥大屏` 仍由选单过滤排除（映射中即使存在也不领）。
- **已验证样例**：
  - bug `387`（`支撑单位`）→ `repo=custom`，`filePath=src/views/networkSecurityIndustry/index.vue`
  - **试点单** bug `428`（`资产核查`）→ `repo=custom`，`routeHint=/assets/assetVerification`，`filePath=src/views/assetVerification/index.vue`；最新跟进：`/api/company/listPageV2` 需 `application/json`。状态可为 `转派`（已在默认选单白名单）。
- **可选**：Config 增加 `menuAllowlist`（仅跑指定 `target_menu`）；缺省则凡可解析且可修的菜单均可尝试。

## 5. 状态机与回写

| 事件 | `status_change` | `assignee_change` | `content` 要点 |
|------|-----------------|-------------------|----------------|
| 领单开始 | `处理中` | `null`（不改指派） | 自动修复开始 |
| MR 成功 | `处理中` | `null` | MR 链接 + 摘要；请人工审阅合入（不改为现场验证） |
| 本地已修好但 Git 失败 | `处理中`（或 `status_change` 为空且当前已是处理中） | `null` | 分支名、commit、待人工推送；禁止标现场验证 |
| 修失败 / `SKIP_AUTOFIX` 停止 / 像后端问题 | 保持处理中 | `null` | 类别＋原因（或失败原因）；第一期不转派 |
| 无映射 / home 范围外 | 不标处理中；可选 followup 且 `status_change` 为空 | — | 跳过原因；保持原状态 |

第一期不自动转派后端（即使内容像数据/接口问题）。

## 6. 幂等、安全与工作区

- 本地状态文件记录 `ticket_id → { branch, repo, phase, mrUrl? }`；进行中则跳过
- 领单后仍未指派，故**不能**依赖指派互斥，必须依赖本地幂等
- 目标仓 dirty 且无法隔离 → 拒绝开跑并说明
- 禁止日志输出 token/密码；对话中曾出现的真实口令须作废轮换
- 截图过大时截断数量/尺寸（配置上限），避免撑爆模型上下文

## 7. deepseek-harness 落点（方案 3）

| 单元 | 职责 |
|------|------|
| Bug 平台 HTTP provider | login、list、get、followup、download、可选 stats |
| 编排命令 / 小 runner | 选单、幂等、映射、状态机、调起 agent、Git 尝试 |
| Git 适配 | 每仓独立；try MR → fallback 本地 |
| 配置 | baseUrl、project_id、仓路径、分支、`mappingFile`（默认 `menu-mapping.json` 路径）、可选 `menuAllowlist`、`lintEnabled`/`buildEnabled`（默认 false） |
| 组合 | example 或 profile patch；密钥走 credentials/env |

原则：新行为挂扩展点与插件；不改 agent-loop；模型可见输入进 session 日志（遵循仓库「model-visible ⟺ logged」）。

## 8. 验收标准（第一期）

1. 手动触发后，能领到符合过滤条件的未指派单，并写 `处理中`。
2. 无映射的单被跳过且有跟进说明。
3. 有映射的试点单：只在正确本地目录（优先 custom）产生 `bugfix/<id>` 与本地 commit；不出现在错误目录切换产品 jinan 改代码。
4. GitLab 可用时开出 MR 并回写 `处理中`（跟进含 MR）；不可用时保持 `处理中` 且说明待推送。全程不标「现场验证」。
5. 凭证仅来自环境变量；仓库中无密钥。

## 9. 后续分期

### 9.1 二期（运维与产品化）

目标：在一期手动闭环之上，把跑批变成可持续的自动流水，并把接入方式产品化。

- **定时轮询与有限并发（部分已落地）**：示例支持 `--continuous`（每批 `--max N` 串行修完立刻拉下一批；空批短退避）与 `--poll-interval <秒>`（定时跑批，二者互斥）。有限跨仓并发仍未做。
- stats / importance 优先级选单
- 自动转派后端账号
- 完整 capability seam + bundle 产品化
- home 若确需改，再显式纳入映射与范围
- 视觉或预览环境验收（可选）
- **高确信度自动合 MR**（默认仍人工合；仅 §3.11 例外路径）：自动合时必须在平台处理记录中留下判定依据与审计字段
- （可选、非主路径）极简本地 `lessons` 追加：成功修单后按 `target_menu` 记一条短笔记，下次 brief 注入 ≤N 条——仅当业务急需提前试用时启用；正位仍见 §9.2

### 9.2 三期（经验沉淀）

目标：沉淀「某菜单常改哪、某类接口怎么修」等跨单经验，提升修复命中率。不自建 DSH 一等 memory capability；优先本地结构化经验库（建议落在 `dkh-bugFix-project` 或产品仓 `.agents/`），必要时再接第三方 MCP memory。

**流程（已约定）**

1. AI 修单成功（已开／复用 MR、回写 `处理中` 且跟进含 MR）后，系统根据 diff 与摘要**自动起草**一条短经验（症状、菜单、改法、关键路径、反例），状态为「待确认」。草稿默认挂在修单成功，**不依赖**人工是否已合入 MR。
2. **通用型闸门**（规则与／或模型）：跨页共用组件／枚举／请求约定、同类菜单或问题类型可复用者进入待确认队列；一次性文案、纯后端／数据、单页特例 → 不入库（可丢弃或标「不入库」）。
3. **人工**只处理待确认队列（抽查，非每单必做）：通过／改一句后入库，或拒绝。日常仍以人工合 MR 为主；合入本身不等于经验入库。发现误导性已入库条目时作废／删除。
4. 下次领单：按 `target_menu`／问题类型检索已入库经验 ≤N 条，注入 Agent brief。
5. 与 `menu-mapping.json` 分工：映射管「落到哪仓哪文件」；经验管「这类单通常怎么改」。审计字段含来源 ticket、MR、时间。

一期／二期默认**不实现**；二期仅在业务急需时可启用 §9.1 极简 `lessons` 旁路，正位仍以本节为准。

## 10. 待用户补充（不阻塞骨架）

- [x] 菜单映射：已采用 `D:\CODE\COMPANY\dkh-bugFix-project\menu-mapping.json`（见 §4.2）
- [x] GitLab Token / 项目 / 分支：已验证可用（user=`zijie.xiang`，项目 `jgts/bigdata-web-frontend` id=8325；`dkh-custom-jinan` / `dkh-ailpha-jinan` / `dkh-home-jinan` 均可读）
- [x] 三仓本地 `HEAD`：已确认分别在 `dkh-custom-jinan` / `dkh-ailpha-jinan` / `dkh-home-jinan`（工作区 clean）
- [x] 抽查各仓 lint 脚本（2026-09-10）：三仓均为 `eslint --ext .js,.vue src --fix`；`pnpm run lint -- <file>` **不能**只 lint 单文件。启用 `lintEnabled` 时须直接 `eslint`/`pnpm exec eslint` 传变更文件（见 §3.9）；第一期默认仍关闭
