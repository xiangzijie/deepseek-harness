# Bug 平台自动修复控制台（产品化）设计

日期：2026-09-15

状态：待实现（开发前规格；本文件批准前不写业务代码、不建独立仓）

范围：在[值班机 CLI 闭环（M0）](./2026-09-09-bug-platform-autofix-design.md)之上，做成**独立可视化项目**（M1）：可配置产品仓与 GitLab 目标分支，基于 Bug 平台数据调用 deepseek-harness 改代码并开 MR；修单使用全局 skill 与个人 skill。M3 再补 MR review 与按 GitLab 现场 clone。

M0 的编排、选单、映射、Git 隔离、followup 以一期规格为准：开 MR 后平台保持 `处理中` 并附 MR 链接，人工合入；控制台不得改成自动标 `现场验证`。本文件规定 M1 的控制台、配置与 skill，以及 M3–M5 的后续形态。产品里程碑与一期规格 §9 为同一张表。

## 产品里程碑

| 里程碑 | 状态 | 内容 | 规格 |
|--------|------|------|------|
| **M0 值班机 CLI** | 已落地（`feature/bug-platform-autofix`，未合 `master`） | 领单 → 映射 → headless → MR；串行轮询；预检与视觉；进度与回滚。路径硬编码。 | [一期规格](./2026-09-09-bug-platform-autofix-design.md) |
| **M1 控制台第一交付** | 待实现 | `operator.yaml`、三页 UI、全局 skill git、个人上传、强制注入 brief。本机 clone。 | 本文 §1–6、§8–9 |
| **M2 跑批增强** | 待实现 | 有限并发（每个 `localRoot` 同时最多 1 单）、stats / importance 选单 | 一期规格 §9 |
| **M3 质量与远程仓** | 待实现 | MR 只读 review；工作区 `mode: clone` | 本文 §7.1–7.2 |
| **M4 在线多人** | 待实现 | 账号、`operatorId`、内网部署 | 本文 §7.3 |
| **M5 运行时收口** | 待实现 | 控制台进程内调用 autofix 库；业务控制台不做进 `dsh web` / bundle | 本文 §7.4 |
| **M6 经验库** | 待实现 | 按菜单沉淀「这类单通常怎么改」；与 skill 分工 | [经验库规格](./2026-09-23-bug-platform-autofix-lessons-design.md) |

**默认不做：** 自动转派、从描述推断菜单、默认自动合 MR、改 `dkh-home`、截图视觉回归门禁。高确信度自动合见一期 §3.11。

## 1. 目标与非目标

### 1.1 目标

- 用 deepseek-harness 的 headless 改代码能力，不改 `agent-loop`，不把业务控制台做进 harness 仓库。
- 以自研 Bug 平台为任务源（登录、列表、详情、跟进、附件），不以控制台取代工单系统。
- 对**已配置**的本地产品工作区改代码：每个工作区绑定一个 GitLab 项目、一条产品基线分支；修复分支为 `bugfix/<ticketId>`；向该基线开 MR，默认不合入。
- 提供可视化页面：配置工作区 / GitLab / 映射路径、触发或观察跑批、管理 skill。
- 修单期间模型可使用三层 skill：全局（管理员配置）、仓内（产品仓 `.agents/skills` 或 `.dsh/skills`）、个人（操作者上传）。强制全局 skill 由编排注入 brief，不依赖模型自行调用 `skill` 工具。
- 修单成功回写保持 `处理中` + MR 链接，不合入。

### 1.2 非目标（M1 不做）

- 把控制台或 skill 后台做进 Bug 工单平台。
- 把控制台做进 `deepseek-harness` 的 `dsh web` / bundle。
- 服务端按 GitLab URL 现场 clone、在线多租户、账号体系 / SSO。
- 默认自动合入 MR；高确信度自动合仍见一期 §3.11。
- 自动转派后端、从描述推断菜单、完整 capability seam + 可安装 dsh bundle。
- M6 经验库（按菜单沉淀「常改哪」）；与 skill（「怎么修」）分开，见[一期规格 §9.1](./2026-09-09-bug-platform-autofix-design.md)。
- 上传可执行 `scripts/`、以 skill 为名在修单机跑第三方代码。
- 多进程抢同一 `localRoot` 或同一 `state.json`。

## 2. 仓库与进程切分

三个代码库，职责不交叉：

| 仓库 | 职责 |
|------|------|
| **控制台独立仓**（新建） | Web UI + 本机 API：读写配置、skill 元数据、触发/观察跑批、展示进度 |
| **deepseek-harness**（现有 worktree / 日后合入的 autofix 包） | Bug 平台 HTTP 客户端、编排、`run-once` CLI、headless 改代码 |
| **全局 skill git 仓**（新建，可私有） | 全局 `SKILL.md` 与 `manifest.yaml` 的权威存储 |

运行时三个进程（第一交付在同一值班机上）：

```text
浏览器  →  控制台 API（本机，如 127.0.0.1）
                ↓ 读写 operator.yaml / 调 CLI / pull skill 仓
           run-once.ts（现有入口，改为读同一份 operator.yaml）
                ↓ cwd = 映射到的 localRoot
           dsh --profile headless  （harnessRoot 可配置）
```

控制台**不**在进程内跑模型。第一交付用子进程调用现有 CLI（与今日值班方式相同）。日后可将 CLI 换成对 `@deepseek-ai/dsh-bug-platform-*` 的进程内调用，不改变配置文件与 UI 契约。

Git 权威在 GitLab：本地目录是检出。第一交付要求每个工作区已 clone，且 `origin` 指向配置的 GitLab 项目。控制台不替操作者执行第一次 `git clone`（可在 UI 上显示「目录不存在 / 非 git / remote 不匹配」诊断）。

## 3. 配置权威（operator.yaml）

所有部署可变项进入控制台仓根目录的 `operator.yaml`（或 `config/operator.yaml`）。密钥仍只来自环境变量 / `.env`，禁止写入 yaml 与 git。

控制台与 CLI **读同一文件**。CLI 在找不到该文件时失败，不再使用写死的 `D:\CODE\COMPANY\dkh-bugFix-project`、GitLab host/项目 id、产品分支名作为隐式默认（试点值可作为 `operator.example.yaml` 示例，不是代码常量）。

### 3.1 文件内容

```yaml
harnessRoot: 'D:/CODE/COMPANY/deepseek-harness/.worktrees/bug-platform-autofix'
bugPlatform:
  baseUrl: 'http://10.20.183.62:8080'
  projectId: 47
gitlab:
  host: 'http://gitlab.info.dbappsecurity.com.cn'
  tokenEnv: GITLAB_TOKEN
mappingFile: 'D:/CODE/COMPANY/dkh-bugFix-project/menu-mapping.json'
stateFile: 'D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/state.json'
progressFile: 'D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/progress.json'
assetsDir: 'D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix'
workspaces:
  - id: custom
    localRoot: 'D:/CODE/COMPANY/dkh-bugFix-project/dkh-custom'
    gitlabProjectId: 8325
    productBranch: 'dkh-custom-jinan'
    mappingRepo: custom
  - id: ailpha
    localRoot: 'D:/CODE/COMPANY/dkh-bugFix-project/dkh-ailpha'
    gitlabProjectId: 8325
    productBranch: 'dkh-ailpha-jinan'
    mappingRepo: ailpha
  - id: home
    localRoot: 'D:/CODE/COMPANY/dkh-bugFix-project/dkh-home'
    gitlabProjectId: 8325
    productBranch: 'dkh-home-jinan'
    mappingRepo: home
    autofix: false
skills:
  globalRepo: 'git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-skills.git'
  globalLocal: 'D:/CODE/COMPANY/dkh-bugFix-project/autofix-skills'
  personalRoot: 'D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/personal-skills'
  forceMaxCount: 3
  forceMaxChars: 8000
run:
  maxTickets: 1
  lintEnabled: false
  buildEnabled: false
```

字段语义：

- `workspaces[].id`：稳定主键，UI 与日志使用。
- `mappingRepo`：必须与 `menu-mapping.json` 里的 `repo` 取值一致（`custom` / `ailpha` / `home`）。
- `gitlabProjectId` + `gitlab.host`：push/MR 的目标项目；开跑前校验 `localRoot` 的 `origin` 与该项目一致（按 remote URL 或配置的 path）。
- `productBranch`：该工作区唯一允许的产品基线；MR `target_branch` 必须等于它。
- `autofix: false`：映射命中该仓则跳过（home 默认如此，与一期一致）。
- `skills.globalLocal`：全局 skill 仓的本地 clone；编排把它交给 dsh（`customSkillDirs` 或等价），使所有已配置工作区都能看到同一套全局 skill。`globalRepo` 示例为与产品仓同一 GitLab 上的独立项目 `jgts/autofix-skills`（部署时创建；路径可改，不得与产品仓混用同一 repo）。
- `skills.personalRoot/<operatorId>/`：个人 skill 根。第一交付 `operatorId` 固定为配置项 `run.operatorId`（默认 `local`），不做登录系统。

环境变量（与一期一致，控制台启动时加载 harness 或控制台根 `.env`）：`BUG_PLATFORM_USERNAME`、`BUG_PLATFORM_PASSWORD`、`DEEPSEEK_API_KEY`、可选 `BUG_PLATFORM_BASE_URL`、`GITLAB_TOKEN`、`DEEPSEEK_BASE_URL`、`BUG_PLATFORM_VISION_MODEL`。

### 3.2 工作区硬约束（继承一期，配置化后仍有效）

- 一单只进入映射决议的那一个 `localRoot`。
- 禁止在错误目录检出另一条 `productBranch`。
- 开跑前：`HEAD` 为该仓 `productBranch` 或本单 `bugfix/<id>`；工作区干净。
- 同一 `localRoot` 同时只允许一个跑批进程；控制台在已有跑批时拒绝再启动，并指向 `progressFile`。

## 4. Skill

### 4.1 三层与优先级

dsh `skill-filesystem` 已按项目根 / 用户根扫描。控制台必须保证 headless 进程能看到：

| 层 | 来源 | 可见范围 |
|----|------|----------|
| 仓内 | `<localRoot>/.agents/skills` 与 `<localRoot>/.dsh/skills` | 仅该工作区（cwd 为该 git 根时自动发现） |
| 全局 | `skills.globalLocal/skills/` | 所有 autofix 工作区（经 `customSkillDirs` 注入） |
| 个人 | `skills.personalRoot/<operatorId>/` | 仅当前操作者这次跑批 |

同名 skill（kebab-case `name`）：**个人覆盖仓内，仓内覆盖全局**。覆盖只影响可选目录与 `skill` 工具加载；**强制列表仍全部注入 brief**。

仓内 skill 继续由各产品仓自己版本管理，控制台只读展示「发现到哪些」，第一交付不在 UI 里编辑仓内文件。

### 4.2 全局 skill git 仓布局

```text
autofix-skills/
  manifest.yaml
  skills/
    fix-frontend-ticket/
      SKILL.md
    gitlab-mr-hygiene/
      SKILL.md
```

只允许单层目录包 `skills/<name>/SKILL.md` 或平铺 `skills/<name>.md`，与 dsh 发现规则一致。`SKILL.md` 必须含 kebab-case `name` 与 `description`；禁止 `disable-model-invocation: true` 出现在强制项上。

`manifest.yaml`：

```yaml
skills:
  - name: fix-frontend-ticket
    enabled: true
    force: true
    workspaceIds: []          # 空 = 全部 autofix:true 的工作区
  - name: gitlab-mr-hygiene
    enabled: true
    force: false
    workspaceIds: [custom]
```

- `enabled: false`：不进入模型目录、不注入 brief。
- `force: true`：对该 skill 生效的工作区，编排在调 headless **之前**把当前 `SKILL.md` 正文写入 brief（标明「强制 skill」）。超过 `forceMaxCount` 或合计超过 `forceMaxChars` 则开跑失败，不领单。
- `workspaceIds`：空表示所有 `autofix: true` 的工作区；非空则仅列出的 `workspaces[].id`。
- 强制变更（`force` 从 false→true，或强制正文变更）**必须经过该 skill 仓的 MR 合入** 后，值班机 `git pull`（或控制台「同步全局 skill」）才对跑批生效。控制台「保存草稿」只写本地 clone 的未推送改动，不得把未合入的强制正文用于生产跑批。可选 skill 的启用/范围可在控制台改 `manifest.yaml` 并 commit；是否要求 MR 由 skill 仓保护分支策略决定，规格要求：**强制项与保护分支绑定，控制台不能绕过 hook 直写 `main`。**

上传：控制台只接受 Markdown 正文（及 frontmatter）。拒绝 zip 内的 `scripts/`、二进制、HTML。个人上传同样只收 Markdown，写入 `personalRoot/<operatorId>/<name>/SKILL.md`，不进全局 git 仓。

### 4.3 注入与发现

跑每一单时：

1. 解析映射得到 `workspace id`。
2. 从已 pull 的 `manifest.yaml` 收集该工作区 `enabled` 的全局 skill；`force` 的正文拼进 brief。
3. 启动 headless 时设置 cwd=`localRoot`，并把 `globalLocal/skills` 与 `personalRoot/<operatorId>` 配进 skill 提供方的自定义根（具体配置键以实现时 dsh `skill-filesystem` 的 `customSkillDirs` 为准）。
4. 仓内根由 cwd 的 git 根自动扫描。
5. brief 可点名强制 skill 的 `name`，降低漏执行；可选 skill 仍靠目录 + `description` 匹配。

模型可见的强制正文是 brief 的一部分。日后若修单路径带上 session 日志，brief 必须能从日志重建（一期已记录该缺口：`run-once` 在 session 路径之外拉起 headless）。

## 5. 可视化页面（第一交付）

本机打开控制台（默认 `127.0.0.1`，不监听 `0.0.0.0`）。三个页面，不含用户注册。

### 5.1 工作区与 GitLab

- 编辑 `workspaces`、`mappingFile`、`gitlab.host`、各 `gitlabProjectId` / `productBranch`、`harnessRoot`。
- 对每个工作区显示健康检查：目录存在、是 git、HEAD 允许、`status` 干净、`origin` 匹配、绑定分支可检出。
- 保存即写 `operator.yaml`。不在此页存 Token。

### 5.2 跑批与进度

- 动作：`--max N`、`--ticket(s)`、`--continuous`（与现 CLI 同语义）。
- 只读 `progress.json`：队列、当前单、心跳、完成摘要。
- 已有跑批时禁用启动；提供停止（SIGINT 到 CLI 进程）。
- 不在 UI 里改 Bug 平台账号。

### 5.3 Skill

- **全局**：列表来自 `manifest.yaml` + 各 `SKILL.md`；创建/编辑正文；设置 `enabled` / `force` / `workspaceIds`；「同步」= 在 `globalLocal` 执行 fetch/pull（失败则禁止用旧强制正文开跑，直到同步成功或操作者确认沿用已合入 revision）。
- **个人**：当前 `operatorId` 下的列表；上传/删除仅影响个人根；个人 skill 不可标 `force`（强制只来自全局 manifest）。
- **仓内**：按工作区只读列出发现到的 name/description，链到磁盘路径。

## 6. 端到端（第一交付）

```text
操作者在控制台保存 operator.yaml、同步全局 skill
  → 触发跑批（或 CLI 直接读同一 yaml）
  → 与一期相同：登录 Bug 平台 → 选单 → 映射到 workspace
  → 校验该 workspace 健康约束
  → 注入强制 skill 正文 → 下载附件/预检（一期已有则保持）
  → dsh headless 在 localRoot 改代码（可见全局+仓内+个人 skill）
  → commit / push origin bugfix/<id> / ensure MR 到 productBranch
  → 平台 followup 保持处理中 + MR 链接
  → 人工在 GitLab 审阅合入
```

Git 鉴权与一期相同：push 用本机 SSH（或已配置的 credential helper）；开 MR 用 `GITLAB_TOKEN` 调 GitLab API v4。无 Token 则 `awaiting_push`，禁止当成功验收。

## 7. 后续分期（M3–M5；M1 不实现）

### 7.1 MR review

开 MR 之后（或合入前）可再跑一次只读 agent：输入 diff + 工单摘要 + 强制 skill，输出写到该 MR 的 note。不改产品代码、不合入。与修单 agent 分两次进程，避免同一 brief 里又修又审。

### 7.2 按 GitLab 现场 clone

工作区增加模式 `local | clone`。`clone`：服务端按 `gitlabProjectId` + `productBranch` fetch 到隔离目录再修。需要磁盘配额、并发锁、凭据注入 git。第一交付只实现 `local`。配置字段预留 `mode: local`，缺省即 local。

### 7.3 多操作者与在线服务

登录后 `operatorId` 来自账号；个人 skill 按用户隔离；控制台可部署到内网，跑批仍建议每产品线一个守护进程。不把 skill 元数据迁到 Bug 平台。

### 7.4 进程内编排

控制台 API 直接调用 autofix 库，不再 spawn CLI。以 `operator.yaml` 与 UI 契约不变为前提。

## 8. 安全

- 密钥只在 env；UI 只显示「已配置 / 缺失」，永不回显。
- 控制台默认仅本机回环；若内网开放，须另开认证，本规格第一交付不做。
- 全局 skill 仓与产品仓、harness 仓分离；写权限小于修单 GitLab Token。
- 强制 skill 是提示注入面：只允许已审 Markdown；条数与字符上限见 §3.1。
- 个人 skill 不进入其他 `operatorId` 的跑批。

## 9. 验收（第一交付）

1. 去掉代码里的试点绝对路径后，仅凭 `operator.yaml` + env 能在值班机跑通一期同等修单（领单 → 正确 `localRoot` → MR 到配置的 `productBranch`）。
2. 控制台三个页面可编辑工作区、启动/观察跑批、管理全局/个人 skill；保存后 CLI 不经 UI 也能读到同一配置。
3. 全局强制 skill 出现在 headless 的 brief 中；个人与仓内 skill 出现在该次进程的 skill 目录中；同名时个人覆盖仓内覆盖全局。
4. 未合入的强制草稿不能用于生产跑批。
5. 上传拒绝 `scripts/` 与非 Markdown。
6. 第二工作区进程与 dirty 工作区被拒绝，并有可读原因。
7. 凭证不进 git、不进页面明文、不进跑批日志。

## 10. 曾考虑的替代方案

- **控制台做进 harness / `dsh plugin add`。** 否决：这是业务操作台，不是 harness 通用能力；会绑进 dsh 的发版与文档门禁。通用 skill 提供方日后再以插件形式贡献给 dsh 可以另议。
- **独立仓直接依赖未发布的 `@deepseek-ai/dsh-bug-platform-*`。** 推迟：包仍是仓内私有 + 源码拉起；第一交付用 CLI 子进程。
- **Skill 权威存数据库或 Bug 平台。** 否决：正文需要 diff/MR；工单系统不该解释模型指令。
- **第一交付即服务端 clone。** 否决：与「配置化 + 可视化 + skill」解耦；先把已 clone 目录配起来。
- **强制只靠模型自己调用 `skill`。** 否决：目录匹配会漏；强制必须编排注入。

## 11. 实现顺序（批准规格后才开工）

1. 将现有 CLI 改为只读 `operator.yaml`（behavior 不变，去掉硬编码）。
2. 新建全局 skill 仓模板 + 值班机 clone；CLI 注入 `customSkillDirs` 与强制 brief。
3. 新建控制台仓：本机 API + 三个页面，spawn 现有 CLI。
4. （后续独立计划）review agent、clone 模式、进程内编排。
