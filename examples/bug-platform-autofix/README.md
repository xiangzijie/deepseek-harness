# bug-platform-autofix 手动跑批 / 守护轮询

第一期示例：直接调用 `@deepseek-ai/dsh-bug-platform-http` 与 `@deepseek-ai/dsh-bug-platform-autofix` 库，**不需要** `cordis.yml`。

工作区路径、GitLab host、映射 / 状态 / 进度 / 附件路径只来自 `operator.yaml`。密钥只来自环境变量 / `.env`。

## operator.yaml

把 [`operator.example.yaml`](./operator.example.yaml) 复制到控制台仓或值班目录的 `operator.yaml`（不要提交含本机路径的副本进 git），然后用 `--config <path>` 指向它。未传 `--config` 时读取环境变量 `BUG_PLATFORM_OPERATOR_FILE`；两者都缺则失败。

`run-once` 要求 yaml 里同时有 `mappingRepo` 为 `custom`、`ailpha`、`home` 的三条工作区。未传 `--max` 时使用 yaml 的 `run.maxTickets`。

## 操作约定

- 始终用 `--config <path>`（或环境变量 `BUG_PLATFORM_OPERATOR_FILE`）指向控制台仓／值班目录的 `operator.yaml`；两者都缺则失败。
- 同一 `progressFile` 同时只允许一个 `run-once`：互斥文件是 `dirname(progressFile)/run.lock`。第二个存活进程以 `已有跑批（pid=<n>），progressFile=<path>` 失败。
- `--allow-stale-global-skills` 只允许全局 skill 仓 HEAD 落后 `origin/main` 仍开跑；强制 skill 文件或 `manifest.yaml` 有未提交变更时仍拒绝。
- 禁止在产品仓（`dkh-custom` / `dkh-ailpha` / `dkh-home`）内执行 `pnpm dsh`。headless 必须从 yaml `harnessRoot` 启动 harness `apps/cli`，cwd 才是映射到的产品工作区。

全局 skill 仓模板见 [`skill-repo-template/`](./skill-repo-template/README.md)：在 GitLab 建独立项目 `jgts/autofix-skills`，值班机 clone 到 yaml `skills.globalLocal`；保护 `main`，强制变更走 MR。

经验库模板见 [`lesson-repo-template/`](./lesson-repo-template/README.md)：在 GitLab 建独立项目 `jgts/autofix-lessons`（不要与 skill 仓混放文件），值班机 clone 到 yaml `lessons.local`；`lessons.repo` 指向该远程，`lessons.injectMax` 缺省 `3`。`main` 允许 Maintainer 直推。查询只走 `index.yaml`；`pending/` 是待确认草稿，`accepted/` 是已入库正文。跑批开始时对 `lessons.local` 执行 `git pull --ff-only`；pull 失败则本轮不注入、不起草，修单继续。机制见 [经验库规格](../../docs/superpowers/specs/2026-09-23-bug-platform-autofix-lessons-design.md)。

## 环境变量

脚本启动时会**优先**加载 harness 根目录的 `.env`（覆盖同名进程环境变量）；文件缺失时再退回 ambient env。

可复制模板：

```powershell
Copy-Item .env.example .env
# 编辑 .env，填入 BUG_PLATFORM_USERNAME / BUG_PLATFORM_PASSWORD / DEEPSEEK_API_KEY 等
```

| 变量 | 必填 | 说明 |
|------|------|------|
| `BUG_PLATFORM_USERNAME` | 是 | Bug 平台登录用户名 |
| `BUG_PLATFORM_PASSWORD` | 是 | Bug 平台登录密码 |
| `DEEPSEEK_API_KEY` | 是 | headless agent、领单前资格判断与修单成功后经验去重调模型（`reset-to-pending` 不需要） |
| `BUG_PLATFORM_OPERATOR_FILE` | 否 | `operator.yaml` 路径；`--config` 优先于本变量 |
| `BUG_PLATFORM_BASE_URL` | 否 | 覆盖 yaml `bugPlatform.baseUrl` |
| `GITLAB_TOKEN` | 否 | GitLab `PRIVATE-TOKEN`（或 yaml `gitlab.tokenEnv` 所指变量）；无 Token 时仍可本地 commit，但不会开 MR |
| `BUG_PLATFORM_ELIGIBILITY_MODEL` | 否 | 领单前「是否改前端」文本判断所用模型；默认 `deepseek-chat` |
| `BUG_PLATFORM_LESSON_MODEL` | 否 | 修单成功后经验去重所用文本模型；默认 `deepseek-chat` |

映射、状态、进度、附件路径只认 yaml 的 `mappingFile` / `stateFile` / `progressFile` / `assetsDir`，不提供同名 env 覆盖。

领单前文本资格判断：同一 `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_BASE_URL`、`BUG_PLATFORM_ELIGIBILITY_MODEL`）根据描述与跟进判断 `need_frontend_fix`；仅当模型返回 `false` 时跳过领单；`uncertain`、HTTP 失败或解析失败仍领单；强制单号同样走该判断；白名单下被跳过的单不占用 `maxTickets`，后续候选补位。

视觉预跑（有截图时）：使用同一 `DEEPSEEK_API_KEY`；可选 `DEEPSEEK_BASE_URL`、`BUG_PLATFORM_VISION_MODEL`（默认 `deepseek-flash`）。观察结果写入 agent brief 的「截图观察（模型视觉）」节。

### 进度可见性

跑批会在终端打印队列、`[i/n] 开始/结束 #id`，并每隔 30s 心跳「仍在处理 #id」；同时写入 yaml `progressFile`（`current` / `pending` / `completed`，以及展示用 `pid`）。同一 `progressFile` 同时只允许一个 `run-once` 进程：互斥文件是 `dirname(progressFile)/run.lock`，第二个存活进程以 `已有跑批（pid=<n>），progressFile=<path>` 失败退出。另开终端可 `Get-Content` 该进度路径。

### Windows：从用户环境读取 `GITLAB_TOKEN`

若 Token 写在「用户」环境变量里且未写入 `.env`，当前 PowerShell 可能尚未继承，可先同步到进程：

```powershell
$env:GITLAB_TOKEN = [System.Environment]::GetEnvironmentVariable('GITLAB_TOKEN', 'User')
```

有 `.env` 时优先以文件为准；勿把含密钥的 `.env` 提交进 git。

## 怎么跑

前置：本 worktree 需要先有一次 `pnpm run build`（或至少 `pnpm run build:lib`）。headless 的 typert-loader 从各包 `exports["./typert"]` 加载 **已构建的** `lib/typert.host.js`。

在 **deepseek-harness 仓库根**（本 worktree 根）执行。Agent 会从 yaml `harnessRoot` 启动 `apps/cli`（`dsh --profile headless`），并把 **cwd 设为映射到的产品工作区**；禁止在产品仓内执行 `pnpm dsh`。

Windows 上若 `pnpm run` 因 lefthook postinstall 锁失败：删掉仓库 `.git/dsh-lefthook-install.lock` 后重试，或用下面的 `node` 入口（仍需先 build）：

```sh
# 首次 / 缺 lib 时
pnpm run build:lib

# 强制单号（绕过状态白名单）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --ticket 428

# 一条命令强制多个指定单（逗号分隔，串行执行）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --tickets 428,430,441

# 跑批：一次最多 N 单（默认状态：待确认,验证未通过,转派,转需求；未指派；有映射）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --max 1

# 可选：覆盖列表 status 过滤
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --max 3 --status 待确认,验证未通过,转派,转需求
```

本脚本按平台列表**实际取回**的候选串行修复；`--continuous` 表示本批跑完立刻再拉下一批（空批短退避）。不要手写死单号除非排障用 `--tickets`。

白名单默认：状态 `待确认/验证未通过/转派/转需求`，菜单有映射且非排除大屏，本地非进行中/`skipped`；**未指派或指派给当前登录用户**均可入选（避免误领回滚后仍挂在自己名下却捞不到）。

### 自动流水（守护）

**推荐：连续批处理**（批内串行修完立刻拉下一批，不按固定时钟）：

```powershell
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --max 20 --continuous
```

空批（没有候选）时等待 60 秒再试，避免空转打满 API。

**可选：定时轮询**（每 N 秒跑一批，与 `--continuous` 互斥）：

```powershell
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --max 1 --poll-interval 300
```

**Windows 任务计划（推荐运维）**

1. 新建「基本任务」→ 触发器按需（如每 10 分钟，或开机后重复）。
2. 操作：启动程序
   - 程序：`node`（或 `node.exe` 全路径）
   - 参数：`--import tsx/esm examples/bug-platform-autofix/src/run-once.ts --config <path> --max 1`
   - 起始于：本 worktree 根目录（含 `examples/` 的路径）。
3. 在任务「常规」勾选「不管用户是否登录都要运行」时，请在任务里配置环境变量，或改用包装 `.ps1` 先 `$env:…=` 再调用 `node`。
4. 守护模式也可用任务「开机启动一次」+ `--poll-interval`；不要同时开多个守护进程抢同一 `state.json`／产品工作区。

`--ticket` / `--tickets` 走强制路径（绕过列表**状态**白名单），仍会排除 `网络安全数据大屏`／`网络安全指挥大屏`、home、无映射；**不能**与 `--max` / `--status` / `--poll-interval` 同用；`--ticket` 与 `--tickets` 也互斥。本地 `state.json` 中仍处于进行中 phase 的单会跳过。`--max` 只影响白名单跑批；省略时用 yaml `run.maxTickets`。`--allow-stale-global-skills` 允许 HEAD 落后 `origin/main` 仍开跑；强制 skill 文件或 `manifest.yaml` 有未提交变更时仍拒绝。

### 运维：误领单改回「待确认」

不跑 agent。对指定单（或本地 `state.json` 中 `phase=failed` 的单）写跟进：`status_change=待确认`，并删除对应本地 state 记录，便于白名单重新领单。`statePath` 来自同一份 `operator.yaml` 的 `stateFile`。

```powershell
# 自动挑选 state.json 里 phase=failed 的单
node --import tsx/esm examples/bug-platform-autofix/src/reset-to-pending.ts --config <path>

# 指定单号 + 可选自定义说明（默认：因工作区未就绪误领，已改回待确认，可重新自动修复）
node --import tsx/esm examples/bug-platform-autofix/src/reset-to-pending.ts --config <path> --tickets 428,430,441
node --import tsx/esm examples/bug-platform-autofix/src/reset-to-pending.ts --config <path> --tickets 428 --note "自定义说明"
```

需要 `BUG_PLATFORM_USERNAME` / `BUG_PLATFORM_PASSWORD`（可选 `BUG_PLATFORM_BASE_URL` 覆盖 yaml）。

## 安全

- 凭证只来自环境变量；README / 代码 / 日志不得出现明文密码或 Token。
- 勿把 `.env`、含密钥的脚本、`operator.yaml` 本机副本或 state 里的敏感内容提交进 git。
