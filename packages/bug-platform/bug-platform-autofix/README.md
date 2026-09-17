# @deepseek-ai/dsh-bug-platform-autofix

English | [中文](README.zh.md)

Library-first helpers for internal bug-platform autofix: load `menu-mapping.json`, resolve a ticket `target_menu` to a custom/ailpha worktree hit, filter list rows, keep a local JSON idempotency store, run per-worktree Git helpers (`assertProductBranch`, `assertClean`, `createBugfixBranch`, `commitAll`, `pushBranch`, `listChangedFiles`) with an injectable `RunGit`, optionally open a GitLab MR via `createMergeRequest`, and orchestrate one ticket or a batch with `runOneTicket` / `runBatch`. Phase 1 keeps Cordis `apply` as a Config stub (empty inject); orchestration imports helpers directly.

## Operator configuration (`operator.yaml`)

`loadOperatorConfig(configPath)` reads and validates the console/CLI `operator.yaml` at the path you pass (relative or absolute). Missing files and invalid shapes fail loud with an `Error` (for example `operator.yaml 不存在: …` or `operator-config: …` validation messages). Each workspace requires its own `gitlabProjectId`; GitLab MR create/reuse uses that id. Omitted optional fields receive defaults: `gitlab.tokenEnv` → `GITLAB_TOKEN`, `workspaces[].autofix` → `true`, `skills.forceMaxCount` → `3`, `skills.forceMaxChars` → `8000`, `run.maxTickets` → `1`, `run.operatorId` → `local`, `run.lintEnabled` / `run.buildEnabled` → `false`. The returned object includes `workspaceByMappingRepo` and `workspaceById`. See [examples/bug-platform-autofix/operator.example.yaml](../../../examples/bug-platform-autofix/operator.example.yaml) for a full sample.

## Personal skill upload

`validateSkillUpload` accepts UTF-8 Markdown with kebab-case `name` and a non-empty `description`; it rejects `scripts/` paths, non-`.md` names, NUL bytes, ZIP magic (`PK` at byte 0), and personal `force: true`. `writePersonalSkill` writes `personalRoot/operatorId/<name>/SKILL.md` only when `operatorId` and `name` are kebab-case and the resolved directory stays under `personalRoot`; otherwise it throws. Callers must not skip that check by assuming `validateSkillUpload` already ran.

## Run lock

`acquireRunLock(lockPath, info)` writes `{ pid, startedAt, configPath }` to `dirname(progressFile)/run.lock`. A second live pid throws `已有跑批（pid=<n>），progressFile=<path>`. `process.kill(pid, 0)` reporting `ESRCH` is stale and is replaced; `EPERM` is live and is not stolen. `readRunLock` returns that document or `undefined`. The returned `release()` deletes the file. `runLockPath(progressFile)` is the lock path helper. The example `run-once` holds this lock for the whole force / whitelist / poll process.

## Config

| Key | Default | Meaning |
|---|---|---|
| `mappingFile` | `""` | Absolute path to `menu-mapping.json`. Empty means the caller passes parsed JSON to `loadMenuMapping`. |

## Menu mapping

`loadMenuMapping(json)` reads `systems.*.items[]`. `resolveMenu(index, targetMenu)` exact-matches `target_menu`, keeps only `repo` of `custom` or `ailpha`, prefers `file_exists === true`, then prefers `custom` over `ailpha`, and returns null for unknown, `repo == null`, `home`, or other ineligible repos.

## Selection and local state

`selectTickets(tickets, index, store, options?)` keeps rows where `assignee_id` is null, `status` is in the allow-list (default `待确认` / `验证未通过` / `转派` / `转需求`), `target_menu` is not `网络安全数据大屏` or `网络安全指挥大屏`, `resolveMenu` returns a hit, the mapped workspace is not `autofix: false` when `options.workspaces` is set, and the ticket is not active in `TicketStateStore` (`claimed` / `fixing` / `awaiting_push`). Pass `options.statuses` to override the allow-list. `runBatch` always passes workspaces so `autofix: false` tickets never occupy `maxTickets`; force `--ticket` still runs `runOneTicket`.

`loadState(path)` / `saveState(path, store)` read and write `{ tickets: TicketRecord[] }`. A missing file loads an empty `TicketStateStore`. `isActive(record)` is true for in-progress phases; `store.get` / `store.upsert` mutate the in-memory map.

## Git workspace

Helpers take a single `localRoot` and never switch product jinan across worktrees. `assertProductBranch(localRoot, expectedJinan)` allows that jinan or `bugfix/<digits>`; it hard-fails when HEAD is a different `*-jinan`. `assertClean` requires empty porcelain status. `createBugfixBranch(localRoot, ticketId, expectedJinan)` reuses HEAD when already on `bugfix/<id>`, checks out an existing branch, or checks out `expectedJinan` then `checkout -b` so new branches never stack on a prior `bugfix/*` tip. `commitAll` runs `add -A` + `commit` and returns `rev-parse HEAD`. `pushBranch` runs `push -u origin <branch>`. `listChangedFiles` parses porcelain paths. Pass `runGit(cwd, args)` to inject fakes in tests; omit it to use `defaultRunGit`. `inspectWorkspace({ localRoot, productBranch, gitlabHost, gitlabProjectId, runGit })` reports `{ ok, reasons }` from local git only (directory, `.git`, HEAD, clean porcelain, origin hostname vs `gitlab.host`) and does not call GitLab HTTP. `inspectAutofixWorkspaces({ workspaces, gitlabHost, runGit })` inspects only `autofix: true` workspaces, collects `id: 原因` lines, and returns `{ ok, lines }`. `run-once` calls `assertGlobalSkillsRunnable` after the progress-file lock and before that aggregator when `manifest.yaml` has `force: true` entries: dirty force files or `manifest.yaml` refuse to start even with `--allow-stale-global-skills`; HEAD must match `origin/main` unless that flag is set. A missing global clone with force names fails the process (exit code 1). `run-once` then calls the workspace aggregator; any failure sets exit code 1.

## Optional GitLab MR

`ensureMergeRequest(...)` POSTs a new MR; on conflict (typical HTTP 409 when the source branch already has an MR) it lists by `source_branch` and reuses the existing MR. `addMergeRequestNote(...)` posts a discussion note. After every successful push the orchestrator: ensures the MR → writes an MR note (commit + summary) → writes a platform followup (`处理中`, with MR / commit / summary; never `现场验证`). A second autofix pass on the same `bugfix/<id>` therefore does not fall into `awaiting_push` merely because the MR already exists, and each pass leaves its own comments. `createMergeRequest` remains a create-only helper. Missing token throws `GitlabTokenMissingError` so orchestration keeps `处理中` / `awaiting_push`. Inject `fetchImpl`, `ensureMr`, and `addMrNote` in tests.

## Orchestrator

`runOneTicket(config, ticketIdOrDetail)` implements the claim → fix → git state machine. Pass a preloaded `BugTicketDetail` to force a ticket (for example `--ticket 428`) without the list status whitelist. Mapping is resolved before any `处理中` followup; unmapped / home / `autofix: false` writes an optional followup with `status_change` null/empty and does not claim. Claim uses `status_change=处理中` and `assignee_change=null`. Assets download after mapping, before claim (`file_size === 0` skipped). Before claim, `assessPreAgentContext` skips without claiming (`phase=skipped`) with `insufficient_context` when the description is too short and there are no screenshots. After that precheck and still before claim, `runOneTicket` resolves `force: true` skills from `config.skills.globalLocal/manifest.yaml` (`skills/<name>/SKILL.md` or `skills/<name>.md`; `workspaceIds: []` means every `autofix: true` id; `skills[].name` must match kebab-case `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`) and injects bodies into the brief under `## 强制 skill（编排注入，必须遵守）`; exceeding `forceMaxCount` / `forceMaxChars`, a non-kebab `name`, or a forced `disable-model-invocation: true` skips without `处理中` (`phase=skipped`). When `config.vision` is set and screenshots exist, `describeScreenshots` calls official DeepSeek multimodal (`deepseek-flash` by default) and injects `## 截图观察（模型视觉）` into the agent brief; vision failure writes a followup without changing status and still allows claim. Agent briefs include stop rules; summaries with `SKIP_AUTOFIX|<category>|<reason>` take the stop path after claim. `lintEnabled` / `buildEnabled` default `false`. Success with MR → followup stays `处理中` (MR link + summary) and `phase=done`; local commit but push/MR failure → stay `处理中`, `phase=awaiting_push`; fix/no-diff → stay `处理中`, `phase=failed`. Autofix never sets `现场验证`. Wrong product jinan hard-fails without auto-checkout. `runBatch(config, { maxTickets: 1 })` calls `ensureToken`, lists candidates, and runs `runOneTicket` up to `maxTickets`. Inject `agentRunner`, `runGit`, `ensureMr`, and `addMrNote` in tests; `buildAgentBrief` / `createDefaultAgentRunner` cover the brief and default harness `apps/cli` headless spawn (`harnessRoot` required; product worktree is `cwd`). `run-once` passes `skills.globalLocal` and the force limits from `operator.yaml`. `createDefaultAgentRunner({ skillPatch })` writes a `dsh --patch` overlay before the brief: skill-filesystem `customSkillDirs` is the global `skills/` directory (rank 300, so in-repo 100/200 win); a rank-50 `autofix-personal` provider is inserted for `join(personalRoot, operatorId)`, so personal skills beat in-repo names. Overlay `name` is the source-plane `personal-skill-plugin.ts` path so tsx headless launch does not need this extra export built.

## Model Experience

The orchestrator injects enabled `force: true` global skill bodies into the headless agent brief (`## 强制 skill（编排注入，必须遵守）`) so the model must obey them without calling a skill tool. Names appear on the second line (`强制 skill 名称：…`). The rest of the brief (ticket fields, stop rules, assets) is assembled here and passed to a separate headless run.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Default agent runner spawns harness `apps/cli` via tsx with `harnessRoot` and product worktree `cwd`; inject timeouts and richer exit parsing in production, and never run `pnpm dsh` inside the product tree. Optional `skillPatch` writes a `--patch` overlay (`customSkillDirs` + rank-50 personal provider); personal `disable-model-invocation: true` skills are omitted from that catalog.
- Home worktree roots are typed on `WorkspaceRoots` but phase-1 edits must not target home; mapped `home` skips before claim.
- No scheduled polling and no multi-ticket concurrency; `runBatch` is serial and manually triggered.
- Automatic reassignment to backend handlers is deferred; failure followups stay `处理中` with assignee unchanged.
- Phase-1 `run-once` keeps the agent brief outside the session log; session integration must make that model-visible brief reconstructable from session events.
