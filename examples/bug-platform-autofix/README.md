# bug-platform-autofix 手动跑批 / 守护轮询

第一期示例：直接调用 `@deepseek-ai/dsh-bug-platform-http` 与 `@deepseek-ai/dsh-bug-platform-autofix` 库，**不需要** `cordis.yml`。

## 环境变量

在仓库根目录的 shell 中设置（**勿写入仓库、勿提交密钥**）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BUG_PLATFORM_USERNAME` | 是 | Bug 平台登录用户名 |
| `BUG_PLATFORM_PASSWORD` | 是 | Bug 平台登录密码 |
| `DEEPSEEK_API_KEY` | 是 | headless agent 调模型 |
| `BUG_PLATFORM_BASE_URL` | 否 | 默认 `http://10.20.183.62:8080` |
| `GITLAB_TOKEN` | 否 | GitLab `PRIVATE-TOKEN`；无 Token 时仍可本地 commit，但不会开 MR |

可选覆盖路径：`BUG_PLATFORM_MAPPING_FILE`、`BUG_PLATFORM_STATE_FILE`、`BUG_PLATFORM_ASSETS_DIR`。

### Windows：从用户环境读取 `GITLAB_TOKEN`

若 Token 写在「用户」环境变量里，当前 PowerShell 可能尚未继承，可先同步到进程：

```powershell
$env:GITLAB_TOKEN = [System.Environment]::GetEnvironmentVariable('GITLAB_TOKEN', 'User')
$env:BUG_PLATFORM_USERNAME = '…'
$env:BUG_PLATFORM_PASSWORD = '…'
$env:DEEPSEEK_API_KEY = '…'
```

本脚本只读 `process.env`，不会去读注册表；请确保启动前环境变量已进入进程。

## 默认路径（本机）

| 用途 | 默认 |
|------|------|
| 菜单映射 | `D:/CODE/COMPANY/dkh-bugFix-project/menu-mapping.json` |
| custom / ailpha / home | `D:/CODE/COMPANY/dkh-bugFix-project/dkh-{custom,ailpha,home}` |
| 幂等状态 | `D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/state.json` |
| 截图附件 | `D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/<ticketId>/` |

GitLab：`http://gitlab.info.dbappsecurity.com.cn`，项目 id `8325`。

## 怎么跑

前置：本 worktree 需要先有一次 `pnpm run build`（或至少 `pnpm run build:lib`）。headless 的 typert-loader 从各包 `exports["./typert"]` 加载 **已构建的** `lib/typert.host.js`。

在 **deepseek-harness 仓库根**（本 worktree 根）执行。Agent 会从本 harness 启动 `apps/cli`（`dsh --profile headless`），并把 **cwd 设为映射到的产品工作区**；不要在 `dkh-custom` / `dkh-ailpha` 里找 `dsh`。

Windows 上若 `pnpm run` 因 lefthook postinstall 锁失败：删掉仓库 `.git/dsh-lefthook-install.lock` 后重试，或用下面的 `node` 入口（仍需先 build）：

```sh
# 首次 / 缺 lib 时
pnpm run build:lib

# 强制单号（绕过状态白名单）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --ticket 428

# 一条命令强制多个指定单（逗号分隔，串行执行）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --tickets 428,430,441

# 跑批：一次最多 N 单（默认状态：待确认,验证未通过,转派,转需求；未指派；有映射）
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 1

# 可选：覆盖列表 status 过滤
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 3 --status 待确认,验证未通过,转派,转需求
```

### 自动流水（守护）

**推荐：连续批处理**（批内串行修完立刻拉下一批，不按固定时钟）：

```powershell
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 20 --continuous
```

空批（没有候选）时等待 60 秒再试，避免空转打满 API。

**可选：定时轮询**（每 N 秒跑一批，与 `--continuous` 互斥）：

```powershell
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 1 --poll-interval 300
```

**Windows 任务计划（推荐运维）**

1. 新建「基本任务」→ 触发器按需（如每 10 分钟，或开机后重复）。
2. 操作：启动程序
   - 程序：`node`（或 `node.exe` 全路径）
   - 参数：`--import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 1`
   - 起始于：本 worktree 根目录（含 `examples/` 的路径）。
3. 在任务「常规」勾选「不管用户是否登录都要运行」时，请在任务里配置环境变量，或改用包装 `.ps1` 先 `$env:…=` 再调用 `node`。
4. 守护模式也可用任务「开机启动一次」+ `--poll-interval`；不要同时开多个守护进程抢同一 `state.json`／产品工作区。

`--ticket` / `--tickets` 走强制路径（绕过列表**状态**白名单），仍会排除 `网络安全数据大屏`／`网络安全指挥大屏`、home、无映射；**不能**与 `--max` / `--status` / `--poll-interval` 同用；`--ticket` 与 `--tickets` 也互斥。本地 `state.json` 中仍处于进行中 phase 的单会跳过。`--max` 只影响白名单跑批。

## 安全

- 凭证只来自环境变量；README / 代码 / 日志不得出现明文密码或 Token。
- 勿把 `.env`、含密钥的脚本或 state 里的敏感内容提交进 git。
