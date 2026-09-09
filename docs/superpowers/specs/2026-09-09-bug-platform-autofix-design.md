# 自研 Bug 平台自动修复（第一期）设计

日期：2026-09-09

状态：待实现（方案 3：混合接入 deepseek-harness）

范围：尽快跑通「手动跑批 → 领未指派单 → 本地改代码 → 尽量自动 Git → 回写平台」

## 1. 目标与非目标

### 1.1 目标

- 从自研 bug 平台拉取符合条件的工单，在本地微服务前端仓中自动尝试修复。
- 修复产物优先自动 push 并开 MR；若远程 GitLab 不可用，则保留本地 commit，由人工推送。
- 通过平台 followup 接口回写进度与结果。
- 以 deepseek-harness 插件方式接入（瘦 capability + 编排命令），不修改 `agent-loop`。

### 1.2 非目标（第一期不做）

- 定时轮询、多并发 worktree。
- 自动合入 MR。
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
- `status=待确认,验证未通过`（实现时可分页）
- 不按 `version_id` 过滤
- 客户端再过滤：`assignee_id == null`；`target_menu !== "网络安全数据大屏"`

Followup 写回字段（已验证）：`content`、`attachments`、`status_change`、`issue_type_change`、`assignee_change`、`plan_solve_date_change`。

可选状态（前端角色可见，以平台为准）：待确认、处理中、转派、不是问题、已处理、未复现、转需求、现场验证等。

### 2.2 代码仓（本地）

| 本地路径 | 分支 | 第一期角色 |
|----------|------|------------|
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-custom` | `dkh-custom-jinan` | 新模块；**优先修改** |
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-ailpha` | `dkh-ailpha-jinan` | 老旧页面；仅当 custom 无该模块 |
| `D:\CODE\COMPANY\dkh-bugFix-project\dkh-home` | `dkh-home-jinan` | **默认不改**；映射误指向则跳过 |

路由入口参考（custom）：`src/routes.js`。各仓路径均可配置。

### 2.3 GitLab

- 远程示例：`http://gitlab.info.dbappsecurity.com.cn/jgts/bigdata-web-frontend`（custom；ailpha/home 各自远程可配置）
- 策略：优先自动 push + 开 MR（目标分支为对应 jinan 分支）；失败则本地 commit，平台保持 `处理中` 并注明待人工推送
- 凭证：`GITLAB_TOKEN` 等，仅 env；无 Token 时不得报「现场验证」成功

## 3. 端到端流程

```text
人工触发「修 1 单」（可配置上限，默认 1）
  → login
  → 可选 GET stats（仅日志参考）
  → GET 列表（project_id + status 白名单）→ 过滤未指派、排除大屏
  → 本地幂等：已有进行中 ticket 则跳过
  → GET 详情
  → 组装上下文：id、target_menu、description、followups（时间序，最新优先）、截图清单
  → 查菜单映射表
       无映射 → followup 说明并跳过
       指向 home → followup「home 不在范围」并跳过
       custom 与 ailpha 皆有 → 选 custom
  → POST followup：status_change=处理中（不改 assignee）
  → 下载主单 screenshots + followups[].attachments（跳过 file_size=0）
  → 在目标仓从 jinan 基线建 bugfix/<id>（工作区必须干净或使用独立 worktree）
  → 启动 dsh headless：注入上下文 + 映射路径 + routes 线索
  → Agent 改代码 → 跑配置的 lint/build
  → 尝试 push + MR
       成功 → followup：现场验证 + MR 链接
       Git 失败 → 保持处理中 + 本地分支/commit + 待人工推送
       修失败或判定偏后端 → 保持处理中 + 原因（不开假成功）
```

## 4. 上下文与映射

### 4.1 注入 Agent 的字段

- `id`、`project_id`、`target_menu`、`target_platform`、`issue_type`、`importance`
- `description`（全文）
- `followups[]`：按 `created_at` 排序；含 `content`、`status_change`、`creator_name`、`created_at`；**以最新跟进为准**
- 本地截图路径列表
- 映射得到的 `repo`、`branch`、`pathPrefix`（若有）
- 明确指示：先读目标仓路由/菜单配置（如 custom 的 `src/routes.js`）

### 4.2 菜单映射表（用户后续补充）

配置文件（YAML 或 JSON），建议字段：

```yaml
# target_menu -> 定位信息
- target_menu: 支撑单位
  repo: custom          # custom | ailpha（第一期不用 home）
  branch: dkh-custom-jinan
  pathPrefix: src/...   # 可选
  routeHint: ...        # 可选
```

规则：

- 无条目 → 跳过并回写「无菜单映射」
- 同模块在 custom 与 ailpha 都存在 → **只改 custom**（映射应优先写 custom；实现层亦强制该优先级）
- 指向 home → 跳过
- 映射可先只覆盖试点菜单（5～15 个），不阻塞骨架开发

## 5. 状态机与回写

| 事件 | `status_change` | `assignee_change` | `content` 要点 |
|------|-----------------|-------------------|----------------|
| 领单开始 | `处理中` | `null`（不改指派） | 自动修复开始 |
| MR 成功 | `现场验证` | `null` | MR 链接 + 摘要 |
| 本地已修好但 Git 失败 | `处理中`（或 `status_change` 为空且当前已是处理中） | `null` | 分支名、commit、待人工推送；禁止标现场验证 |
| 修失败 / 像后端问题 | 保持处理中 | `null` | 失败原因；第一期不转派 |
| 无映射 / home 范围外 | 不领单或领单前跳过；若已交互则只写说明 | — | 原因 |

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
| 配置 | baseUrl、project_id、仓路径、分支、lint/build 命令、映射文件路径 |
| 组合 | example 或 profile patch；密钥走 credentials/env |

原则：新行为挂扩展点与插件；不改 agent-loop；模型可见输入进 session 日志（遵循仓库「model-visible ⟺ logged」）。

## 8. 验收标准（第一期）

1. 手动触发后，能领到符合过滤条件的未指派单，并写 `处理中`。
2. 无映射的单被跳过且有跟进说明。
3. 有映射的试点单：能在正确仓（优先 custom）产生 `bugfix/<id>` 与本地 commit。
4. GitLab 可用时开出 MR 并回写 `现场验证`；不可用时保持 `处理中` 且说明待推送。
5. 凭证仅来自环境变量；仓库中无密钥。

## 9. 后续（二期意向）

- 定时轮询与有限并发
- stats / importance 优先级
- 自动转派后端账号
- 完整 capability seam + bundle 产品化
- home 若确需改，再显式纳入映射与范围
- 视觉或预览环境验收（可选）

## 10. 待用户补充（不阻塞骨架）

- [ ] 试点 `target_menu` 映射表
- [ ] 各仓 `package.json` 中的 lint/build 命令（实现时读取并做成配置）
- [ ] 各仓 GitLab 项目 path 与 Token 权限验证
- [ ] 确认 custom 分支正式名为 `dkh-custom-jinan`（若与口头 `dkh-customn` 不同以仓库为准）
