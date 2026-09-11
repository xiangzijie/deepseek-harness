# @deepseek-ai/dsh-bug-platform-autofix

English | [中文](README.zh.md)

Library-first helpers for internal bug-platform autofix: load `menu-mapping.json`, resolve a ticket `target_menu` to a custom/ailpha worktree hit, filter list rows, keep a local JSON idempotency store, run per-worktree Git helpers (`assertProductBranch`, `assertClean`, `createBugfixBranch`, `commitAll`, `pushBranch`, `listChangedFiles`) with an injectable `RunGit`, optionally open a GitLab MR via `createMergeRequest`, and orchestrate one ticket or a batch with `runOneTicket` / `runBatch`. Phase 1 keeps Cordis `apply` as a Config stub (empty inject); orchestration imports helpers directly.

## Config

| Key | Default | Meaning |
|---|---|---|
| `mappingFile` | `""` | Absolute path to `menu-mapping.json`. Empty means the caller passes parsed JSON to `loadMenuMapping`. |

## Menu mapping

`loadMenuMapping(json)` reads `systems.*.items[]`. `resolveMenu(index, targetMenu)` exact-matches `target_menu`, keeps only `repo` of `custom` or `ailpha`, prefers `file_exists === true`, then prefers `custom` over `ailpha`, and returns null for unknown, `repo == null`, `home`, or other ineligible repos.

## Selection and local state

`selectTickets(tickets, index, store, options?)` keeps rows where `assignee_id` is null, `status` is in the allow-list (default `待确认` / `验证未通过` / `转派` / `转需求`), `target_menu` is not `网络安全数据大屏` or `网络安全指挥大屏`, `resolveMenu` returns a hit, and the ticket is not active in `TicketStateStore` (`claimed` / `fixing` / `awaiting_push`). Pass `options.statuses` to override the allow-list.

`loadState(path)` / `saveState(path, store)` read and write `{ tickets: TicketRecord[] }`. A missing file loads an empty `TicketStateStore`. `isActive(record)` is true for in-progress phases; `store.get` / `store.upsert` mutate the in-memory map.

## Git workspace

Helpers take a single `localRoot` and never switch product jinan across worktrees. `assertProductBranch(localRoot, expectedJinan)` allows that jinan or `bugfix/<digits>`; it hard-fails when HEAD is a different `*-jinan`. `assertClean` requires empty porcelain status. `createBugfixBranch(localRoot, ticketId, expectedJinan)` reuses HEAD when already on `bugfix/<id>`, checks out an existing branch, or checks out `expectedJinan` then `checkout -b` so new branches never stack on a prior `bugfix/*` tip. `commitAll` runs `add -A` + `commit` and returns `rev-parse HEAD`. `pushBranch` runs `push -u origin <branch>`. `listChangedFiles` parses porcelain paths. Pass `runGit(cwd, args)` to inject fakes in tests; omit it to use `defaultRunGit`.

## Optional GitLab MR

`ensureMergeRequest(...)` POSTs a new MR; on conflict (typical HTTP 409 when the source branch already has an MR) it lists by `source_branch` and reuses the existing MR. `addMergeRequestNote(...)` posts a discussion note. After every successful push the orchestrator: ensures the MR → writes an MR note (commit + summary) → writes a platform followup (`处理中`, with MR / commit / summary; never `现场验证`). A second autofix pass on the same `bugfix/<id>` therefore does not fall into `awaiting_push` merely because the MR already exists, and each pass leaves its own comments. `createMergeRequest` remains a create-only helper. Missing token throws `GitlabTokenMissingError` so orchestration keeps `处理中` / `awaiting_push`. Inject `fetchImpl`, `ensureMr`, and `addMrNote` in tests.

## Orchestrator

`runOneTicket(config, ticketIdOrDetail)` implements the claim → fix → git state machine. Pass a preloaded `BugTicketDetail` to force a ticket (for example `--ticket 428`) without the list status whitelist. Mapping is resolved before any `处理中` followup; unmapped/home writes an optional followup with `status_change` null/empty and does not claim. Claim uses `status_change=处理中` and `assignee_change=null`. Assets download after mapping (`file_size === 0` skipped). Before claim, `assessPreAgentContext` stops with `insufficient_context` when the description is too short and there are no screenshots. When `config.vision` is set and screenshots exist, `describeScreenshots` calls official DeepSeek multimodal (`deepseek-flash` by default) and injects `## 截图观察（模型视觉）` into the agent brief; vision failure writes a followup without changing status and still allows claim. Agent briefs include stop rules; summaries with `SKIP_AUTOFIX|<category>|<reason>` take the stop path after claim. `lintEnabled` / `buildEnabled` default `false`. Success with MR → followup stays `处理中` (MR link + summary) and `phase=done`; local commit but push/MR failure → stay `处理中`, `phase=awaiting_push`; fix/no-diff → stay `处理中`, `phase=failed`. Autofix never sets `现场验证`. Wrong product jinan hard-fails without auto-checkout. `runBatch(config, { maxTickets: 1 })` calls `ensureToken`, lists candidates, and runs `runOneTicket` up to `maxTickets`. Inject `agentRunner`, `runGit`, `ensureMr`, and `addMrNote` in tests; `buildAgentBrief` / `createDefaultAgentRunner` cover the brief and default harness `apps/cli` headless spawn (`harnessRoot` required; product worktree is `cwd`).

## Model Experience

None, as this package is a deployment-local mapping library that never contributes tokens to a model request. The agent brief string is assembled for a separate headless run.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Default agent runner spawns harness `apps/cli` via tsx with `harnessRoot` and product worktree `cwd`; inject timeouts and richer exit parsing in production, and never run `pnpm dsh` inside the product tree.
- Home worktree roots are typed on `WorkspaceRoots` but phase-1 edits must not target home; mapped `home` skips before claim.
- No scheduled polling and no multi-ticket concurrency; `runBatch` is serial and manually triggered.
- Automatic reassignment to backend handlers is deferred; failure followups stay `处理中` with assignee unchanged.
- Phase-1 `run-once` keeps the agent brief outside the session log; session integration must make that model-visible brief reconstructable from session events.
