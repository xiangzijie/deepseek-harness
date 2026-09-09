# Bug 骞冲彴鑷姩淇锛堢涓€鏈燂級Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鎵嬪姩璺戞壒鏃讹紝浠庢湭鎸囨淳鐨勮嚜鐮?bug 鍗曚腑棰?1 鍗曪紝鎸?`menu-mapping.json` 瀹氫綅鍒?custom/ailpha 宸ヤ綔鍖猴紝鐢?dsh headless 鏀逛唬鐮侊紝灏介噺 push/寮€ MR 骞跺洖鍐欏钩鍙般€?
**Architecture:** 鏂板缓 `packages/bug-platform/` 涓ょ粍鍖咃細`bug-platform-http`锛坙ogin/list/get/followup/download + 401 鍒锋柊锛変笌 `bug-platform-autofix`锛堟槧灏勩€佸箓绛夈€佺姸鎬佹満銆丟it銆佺紪鎺掞級銆備笉鎷嗗畬鏁?capability 涓変欢濂楋紱涓嶆敼 `agent-loop`銆傞€氳繃 example/`cordis` patch 缁勫悎锛屽瘑閽ヤ粎 env/`dsh-credentials`銆?
**Tech Stack:** TypeScript ESM銆丆ordis 鎻掍欢銆乂itest銆乣fetch`銆佹湰鏈?`git` + 鍙€?GitLab REST API锛坄PRIVATE-TOKEN`锛夈€乣pnpm dsh --profile headless`銆?
**Spec:** [`docs/superpowers/specs/2026-09-09-bug-platform-autofix-design.md`](../specs/2026-09-09-bug-platform-autofix-design.md)

---

## File structure (new)

```
packages/bug-platform/
  bug-platform-http/
    package.json
    tsconfig.json
    README.md
    src/index.ts          # Cordis plugin: name/inject/Config/apply 鈫?ctx.bugPlatform
    src/client.ts         # BugPlatformClient (login, list, get, followup, download)
    src/types.ts          # ticket / followup / list types
    src/invariant.ts
    tests/client.spec.ts
  bug-platform-autofix/
    package.json
    tsconfig.json
    README.md
    src/index.ts          # plugin: register runBatch / CLI hook
    src/menu-mapping.ts   # load menu-mapping.json + resolve(target_menu)
    src/ticket-state.ts   # local idempotency JSON
    src/select.ts         # filter candidates
    src/git-workspace.ts  # branch assert, bugfix/*, commit, push
    src/gitlab-mr.ts      # optional create MR
    src/orchestrator.ts   # runOneTicket / runBatch (搂3 flow)
    src/agent-brief.ts    # build prompt text + paths
    src/invariant.ts
    tests/menu-mapping.spec.ts
    tests/select.spec.ts
    tests/orchestrator.spec.ts
examples/bug-platform-autofix/
  cordis.yml              # or patch that mounts the two plugins + headless
  README.md               # how to run one ticket
.agents/notes/proposed/feature/2026-09-09-bug-platform-autofix.md
```

Also register the new group/packages per [`docs/cookbook/adding-a-package.md`](../../cookbook/adding-a-package.md): `packages/README.md`, `tsconfig.host.json` references, package invariants.

---

### Task 1: Scaffold `bug-platform-http` package

**Files:**
- Create: `packages/bug-platform/bug-platform-http/package.json`
- Create: `packages/bug-platform/bug-platform-http/tsconfig.json`
- Create: `packages/bug-platform/bug-platform-http/src/index.ts` (stub)
- Create: `packages/bug-platform/bug-platform-http/src/invariant.ts`
- Create: `packages/bug-platform/bug-platform-http/README.md`
- Modify: `packages/README.md` (add `bug-platform` group row)
- Modify: `tsconfig.host.json` (add project reference)
- Modify: `tsconfig.base.json` only if new group glob required (cookbook 搂2)

- [ ] **Step 1: Copy scaffold from `packages/web/web-fetch-http`**

Name: `@deepseek-ai/dsh-bug-platform-http`. Peers: `@deepseek-ai/cordis`. Deps: `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-credentials` (dev+peer mirror per constraints). Match root `version`, `private: true`, `type: module`, exports/files gates.

- [ ] **Step 2: Stub plugin**

```ts
// packages/bug-platform/bug-platform-http/src/index.ts
export const name = 'bug-platform-http'
export const inject = ['credentials'] // or empty + launchEnvironment fallback like web-search-deepseek
export interface Config {
  baseUrl: string
  usernameEnv: string
  passwordEnv: string
}
export const Config = /* z.object with defaults:
  baseUrl: 'http://10.20.183.62:8080'
  usernameEnv: 'BUG_PLATFORM_USERNAME'
  passwordEnv: 'BUG_PLATFORM_PASSWORD'
*/
export function apply(ctx: Context, config: Config) {
  // Task 2 wires client onto ctx
}
```

- [ ] **Step 3: Empty invariant with justified reason or minimal check**

Follow `packages/AGENTS.md` invariant rules.

- [ ] **Step 4: `pnpm install` and ensure package resolves**

Run: `pnpm install`
Expected: workspace links `@deepseek-ai/dsh-bug-platform-http`

- [ ] **Step 5: Commit**

```bash
git add packages/bug-platform packages/README.md tsconfig.host.json tsconfig.base.json
git commit -m "feat(bug-platform): 鑴氭墜鏋?bug-platform-http 鍖?
```

---

### Task 2: HTTP client 鈥?login, list, get, token refresh

**Files:**
- Create: `packages/bug-platform/bug-platform-http/src/types.ts`
- Create: `packages/bug-platform/bug-platform-http/src/client.ts`
- Modify: `packages/bug-platform/bug-platform-http/src/index.ts`
- Test: `packages/bug-platform/bug-platform-http/tests/client.spec.ts`

- [ ] **Step 1: Write failing tests with mocked `fetch`**

```ts
// tests/client.spec.ts 鈥?behaviors:
// 1) login posts /api/auth/login and stores token
// 2) listTickets GETs /api/bug-tickets with query; returns data.list
// 3) getTicket GETs /api/bug-tickets/:id; returns data
// 4) on 401, re-login once and retries the failed call
// Never assert real network.
```

- [ ] **Step 2: Run tests 鈥?expect FAIL**

```sh
pnpm exec vitest run packages/bug-platform/bug-platform-http/tests/client.spec.ts
```

- [ ] **Step 3: Implement `BugPlatformClient`**

Public methods (names fixed for later tasks):

```ts
export class BugPlatformClient {
  constructor(private readonly opts: {
    baseUrl: string
    username: string
    password: string
    fetchImpl?: typeof fetch
  }) {}
  async ensureToken(): Promise<string>
  async listTickets(query: {
    projectId: number
    status: string // '寰呯‘璁?楠岃瘉鏈€氳繃'
    page?: number
    pageSize?: number
  }): Promise<BugTicketSummary[]>
  async getTicket(id: number): Promise<BugTicketDetail>
  async createFollowup(id: number, body: FollowupBody): Promise<void>
  async downloadToFile(urlPath: string, destPath: string): Promise<void>
}
```

Rules from spec 搂3.1: one login per batch session; 401 鈫?login 鈫?single retry; never log token/password.

- [ ] **Step 4: Wire `ctx.bugPlatform` in `apply`**

Use declaration merging for `Context` if exposing a service object; or export a plain factory from the plugin without full Service class (phase 1: attach `{ client }` via `ctx.set` / small service class 鈥?prefer a tiny `class BugPlatformService` default-export only if matching service-package pattern; function plugin exposing methods on a frozen object registered with `ctx.effect` is OK if documented).

Simplest phase-1: **no Cordis service** 鈥?export `createBugPlatformClientFromConfig` used by autofix package. Keep plugin `apply` optional for future. Prefer **autofix depends on http package as library** to avoid inventing a seam prematurely.

Decision locked for phase 1: **`bug-platform-http` is primarily a library** (`export { BugPlatformClient, ... }`). A Cordis `apply` that only validates Config is optional; the autofix runner constructs the client from env. Do not invent a full `ctx.bugPlatform` seam in this plan.

- [ ] **Step 5: Tests PASS + commit**

```bash
pnpm exec vitest run packages/bug-platform/bug-platform-http/tests/client.spec.ts
git add packages/bug-platform/bug-platform-http
git commit -m "feat(bug-platform-http): 瀹炵幇 login/list/get 涓?401 鍒锋柊"
```

---

### Task 3: Followup + download

**Files:**
- Modify: `packages/bug-platform/bug-platform-http/src/client.ts`
- Modify: `packages/bug-platform/bug-platform-http/tests/client.spec.ts`

- [ ] **Step 1: Tests for `createFollowup` and `downloadToFile`**

- POST `/api/bug-tickets/:id/followups` with JSON body
- Download: join `baseUrl` + relative `url`, Bearer header, write bytes; skip caller-side for `file_size===0`

- [ ] **Step 2: Implement + PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bug-platform-http): followup 涓庨檮浠朵笅杞?
```

---

### Task 4: Menu mapping loader

**Files:**
- Create: `packages/bug-platform/bug-platform-autofix/` scaffold (same cookbook steps as Task 1)
- Create: `packages/bug-platform/bug-platform-autofix/src/menu-mapping.ts`
- Test: `packages/bug-platform/bug-platform-autofix/tests/menu-mapping.spec.ts`
- Fixture: `packages/bug-platform/bug-platform-autofix/tests/fixtures/menu-mapping-sample.json` (minimal 2鈥? items; do not import full production JSON into unit tests)

- [ ] **Step 1: Failing tests**

```ts
// resolveMenu('鏀拺鍗曚綅') 鈫?repo custom, filePath ..., branch dkh-custom-jinan
// resolveMenu('unknown') 鈫?null
// when custom+ailpha both match same target_menu 鈫?custom wins
// repo null 鈫?null (unmapped)
```

- [ ] **Step 2: Implement loader**

```ts
export type ResolvedMenu = {
  targetMenu: string
  repo: 'custom' | 'ailpha'
  branch: string
  routeHint: string | null
  filePath: string | null
  menuPath: string
}

export function loadMenuMapping(json: unknown): MenuMappingIndex
export function resolveMenu(index: MenuMappingIndex, targetMenu: string): ResolvedMenu | null
```

Parse `systems.*.items[]` per spec 搂4.2.

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(bug-platform-autofix): 鍔犺浇 menu-mapping 骞惰В鏋?target_menu"
```

---

### Task 5: Select + local ticket state (idempotency)

**Files:**
- Create: `packages/bug-platform/bug-platform-autofix/src/select.ts`
- Create: `packages/bug-platform/bug-platform-autofix/src/ticket-state.ts`
- Test: `packages/bug-platform/bug-platform-autofix/tests/select.spec.ts`
- Test: `packages/bug-platform/bug-platform-autofix/tests/ticket-state.spec.ts`

- [ ] **Step 1: Tests**

Select keeps: `assignee_id==null`, status in `寰呯‘璁楠岃瘉鏈€氳繃`, `target_menu !== '缃戠粶瀹夊叏鏁版嵁澶у睆'`, mapping resolves, not in active local state.

State file shape:

```ts
type TicketPhase = 'claimed' | 'fixing' | 'awaiting_push' | 'done' | 'failed'
type TicketRecord = {
  ticketId: number
  phase: TicketPhase
  repo: 'custom' | 'ailpha'
  branch: string // bugfix/<id>
  mrUrl?: string
  updatedAt: string
}
```

Path default: `D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/state.json` (Config).

- [ ] **Step 2: Implement + PASS + commit**

```bash
git commit -m "feat(bug-platform-autofix): 閫夊崟杩囨护涓庢湰鍦板箓绛夌姸鎬?
```

---

### Task 6: Git workspace helpers (no cross-product checkout)

**Files:**
- Create: `packages/bug-platform/bug-platform-autofix/src/git-workspace.ts`
- Test: `packages/bug-platform/bug-platform-autofix/tests/git-workspace.spec.ts` (mock `simple-git` or inject `runGit(args): Promise<string>`)

- [ ] **Step 1: API**

```ts
export type WorkspaceRoots = {
  custom: string // D:\...\dkh-custom
  ailpha: string
  home: string // unused for edits
}

export async function assertProductBranch(localRoot: string, expectedJinan: string): Promise<void>
export async function assertClean(localRoot: string): Promise<void>
export async function createBugfixBranch(localRoot: string, ticketId: number): Promise<string> // returns bugfix/<id>
export async function commitAll(localRoot: string, message: string): Promise<string> // returns sha
export async function pushBranch(localRoot: string, branch: string): Promise<void>
export function listChangedFiles(localRoot: string): Promise<string[]>
```

Hard fail if current branch is another product jinan (e.g. ailpha dir on `dkh-custom-jinan`).

- [ ] **Step 2: Tests with fake `runGit`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(bug-platform-autofix): Git 宸ヤ綔鍖轰笌 bugfix 鍒嗘敮杈呭姪"
```

---

### Task 7: Optional GitLab MR

**Files:**
- Create: `packages/bug-platform/bug-platform-autofix/src/gitlab-mr.ts`
- Test: `packages/bug-platform/bug-platform-autofix/tests/gitlab-mr.spec.ts`

- [ ] **Step 1: Implement**

```ts
export async function createMergeRequest(opts: {
  host: string // http://gitlab.info.dbappsecurity.com.cn
  projectId: number // 8325
  token: string // from GITLAB_TOKEN user env
  sourceBranch: string
  targetBranch: string // product jinan
  title: string
  description: string
}): Promise<{ webUrl: string }>
```

POST `/api/v4/projects/:id/merge_requests`. If `token` missing 鈫?return null / throw typed `GitlabTokenMissingError` for orchestrator fallback.

- [ ] **Step 2: Tests with mocked fetch + commit**

```bash
git commit -m "feat(bug-platform-autofix): 鍙€?GitLab 鍒涘缓 MR"
```

---

### Task 8: Orchestrator `runOneTicket` (spec 搂3)

**Files:**
- Create: `packages/bug-platform/bug-platform-autofix/src/agent-brief.ts`
- Create: `packages/bug-platform/bug-platform-autofix/src/orchestrator.ts`
- Create: `packages/bug-platform/bug-platform-autofix/src/run-agent.ts` (spawn headless)
- Test: `packages/bug-platform/bug-platform-autofix/tests/orchestrator.spec.ts`

- [ ] **Step 1: Unit-test orchestrator with fakes**

Fake client, mapping, git, agent runner, gitlab. Assert order:

1. resolve mapping **before** followup `澶勭悊涓璥
2. skip writes optional followup without status when unmapped
3. on success path with MR 鈫?followup `鐜板満楠岃瘉` + mr url
4. on git failure after local commit 鈫?stay `澶勭悊涓璥 + awaiting_push text
5. never checkout wrong product branch

- [ ] **Step 2: Implement `runOneTicket` / `runBatch({ maxTickets: 1 })`**

`lintEnabled`/`buildEnabled` default `false` 鈥?skip lint.

Agent runner phase-1:

```ts
// run-agent.ts
// spawn: pnpm dsh --profile headless "<brief>"
// cwd: localRoot of target workspace
// env: inherit + DEEPSEEK_API_KEY
// timeout: config
```

Brief must include: ticket id, description, followups, `filePath`, `routeHint`, routes file path, screenshots dir, instruction to only edit this module.

- [ ] **Step 3: PASS + commit**

```bash
git commit -m "feat(bug-platform-autofix): 缂栨帓 runOneTicket 鐘舵€佹満"
```

---

### Task 9: Example runner + env docs

**Files:**
- Create: `examples/bug-platform-autofix/README.md`
- Create: `examples/bug-platform-autofix/run-once.mjs` or `src/run-once.ts` launched via `pnpm exec tsx`
- Modify: root `package.json` script optional: `"bugfix:once": "tsx examples/bug-platform-autofix/run-once.ts"`

- [ ] **Step 1: `run-once.ts` loads config from env**

Required env:

- `BUG_PLATFORM_USERNAME` / `BUG_PLATFORM_PASSWORD`
- `DEEPSEEK_API_KEY` (for headless)
- optional `GITLAB_TOKEN` (User env OK)

Config paths default to the three local roots + `menu-mapping.json`.

CLI flag: `--ticket 428` to force one id (bypass list status whitelist) for pilot.

- [ ] **Step 2: README 鈥?涓枃鎿嶄綔璇存槑**锛堝嚟璇佸嬁鍏ュ簱锛?
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(examples): bug 骞冲彴鎵嬪姩璺戞壒鍏ュ彛"
```

---

### Task 10: Agent Note + package READMEs + doc pointer

**Files:**
- Create: `.agents/notes/proposed/feature/2026-09-09-bug-platform-autofix.md`
- Update: both package READMEs (Model Experience short form / Known Limitations)
- Modify: spec 搂10 if needed

- [ ] **Step 1: Write Agent Note** (decision: hybrid 2-pkg, library http, lint off, same GitLab project three worktrees)

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: bug 骞冲彴鑷姩淇 Agent Note 涓?README"
```

---

### Task 11: Manual smoke (pilot ticket 428)

**Not automated CI.** Operator machine only.

- [ ] **Step 1: Confirm env**

```powershell
$env:GITLAB_TOKEN = [System.Environment]::GetEnvironmentVariable('GITLAB_TOKEN','User')
# BUG_PLATFORM_* and DEEPSEEK_API_KEY set
```

- [ ] **Step 2: Run**

```sh
pnpm exec tsx examples/bug-platform-autofix/run-once.ts --ticket 428
```

Expected:

- `--ticket` bypasses status whitelist (`428` is 转派, not in 待确认/验证未通过)
- mapping resolves to custom `src/views/assetVerification/index.vue`
- followup to 处理中 (assignee unchanged)
- branch `bugfix/428` under `dkh-custom`
- agent uses latest followup: `/api/company/listPageV2` needs `application/json`
- MR or `awaiting_push` followup

- [ ] **Step 3: Record outcome in Agent Note or example README troubleshooting**


---

## Spec coverage checklist

| Spec area | Task |
|-----------|------|
| 搂3.1 auth session | 2 |
| 搂3.2 select + idempotency | 5 |
| 搂3.3 detail + followups text | 8 (brief) |
| 搂3.4 mapping before claim | 4, 8 |
| 搂3.5 claim 澶勭悊涓?no assignee | 8 |
| 搂3.6 downloads | 3, 8 |
| 搂3.7 git workspace isolation | 6, 8 |
| 搂3.8 agent | 8, 9 |
| 搂3.9 lint off by default | 8 |
| 搂3.10 git/MR/fallback | 6, 7, 8 |
| 搂4.2 menu-mapping.json | 4 |
| 搂2.2 three worktrees same remote | 6, 9 config |
| Credentials env-only | 2, 9 |

---

## Out of scope (do not implement in this plan)

- Polling scheduler / concurrency
- Auto-assign / auto-reassign backend
- Editing `dkh-home`
- Enabling lint/build by default
- Full capability seam + bundle productization
- Snapshot/e2e against real bug platform in CI锛堟棤鍐呯綉锛?
