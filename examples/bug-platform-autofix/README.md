# bug-platform-autofix 手动跑批

第一期示例：直接调用 `@deepseek-ai/dsh-bug-platform-http` 与 `@deepseek-ai/dsh-bug-platform-autofix` 库，**不需要** `cordis.yml`。

## 环境变量

在仓库根目录的 shell 中设置（**勿写入仓库、勿提交密钥**）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `BUG_PLATFORM_USERNAME` | 是 | Bug 平台登录用户名 |
| `BUG_PLATFORM_PASSWORD` | 是 | Bug 平台登录密码 |
| `DEEPSEEK_API_KEY` | 是 | headless agent 调模型 |
| `BUG_PLATFORM_BASE_URL` | 否 | 默认 `http://10.20.183.62:8080` |
| `GITLAB_TOKEN` | 否 | GitLab `PRIVATE-TOKEN`；无 Token 时仍可本地 commit，但不会开 MR / 不会标「现场验证」 |

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

在 **deepseek-harness 仓库根**（本 worktree 根）执行：

```sh
# 试点单 428（状态为「转派」，不在默认选单白名单，必须强制）
pnpm run bugfix:once -- --ticket 428

# 等价
node --import tsx/esm examples/bug-platform-autofix/run-once.ts --ticket 428

# 不传 --ticket：按平台列表过滤未指派 + 白名单状态，默认最多 1 单
pnpm run bugfix:once
```

`--ticket <id>` 会 `GET` 详情后直接走 `runOneTicket`，绕过列表状态白名单。若本地 `state.json` 里该单仍处于进行中 phase，会跳过以避免重复领单。

## 安全

- 凭证只来自环境变量；README / 代码 / 日志不得出现明文密码或 Token。
- 勿把 `.env`、含密钥的脚本或 state 里的敏感内容提交进 git。
