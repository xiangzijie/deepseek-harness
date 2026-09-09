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

`selectTickets(tickets, index, store, options?)` keeps rows where `assignee_id` is null, `status` is in the allow-list (default `待确认` / `验证未通过`), `target_menu` is not `网络安全数据大屏`, `resolveMenu` returns a hit, and the ticket is not active in `TicketStateStore` (`claimed` / `fixing` / `awaiting_push`). Pass `options.statuses` to override the allow-list.

`loadState(path)` / `saveState(path, store)` read and write `{ tickets: TicketRecord[] }`. A missing file loads an empty `TicketStateStore`. `isActive(record)` is true for in-progress phases; `store.get` / `store.upsert` mutate the in-memory map.

## Git workspace

Helpers take a single `localRoot` and never switch product jinan across worktrees. `assertProductBranch(localRoot, expectedJinan)` allows that jinan or `bugfix/<digits>`; it hard-fails when HEAD is a different `*-jinan`. `assertClean` requires empty porcelain status. `createBugfixBranch` reuses HEAD when already on `bugfix/<id>`, checks out an existing branch, or `checkout -b` from the current HEAD. `commitAll` runs `add -A` + `commit` and returns `rev-parse HEAD`. `pushBranch` runs `push -u origin <branch>`. `listChangedFiles` parses porcelain paths. Pass `runGit(cwd, args)` to inject fakes in tests; omit it to use `defaultRunGit`.

## Optional GitLab MR

`createMergeRequest({ host, projectId, token, sourceBranch, targetBranch, title, description, fetchImpl? })` POSTs `/api/v4/projects/:id/merge_requests` with a `PRIVATE-TOKEN` header and returns `{ webUrl }` from `web_url`. Missing, null, or empty `token` throws `GitlabTokenMissingError` so orchestration can keep `处理中` / `awaiting_push` instead of claiming `现场验证`. Inject `fetchImpl` in tests.

## Orchestrator

`runOneTicket(config, ticketIdOrDetail)` implements the claim → fix → git state machine. Pass a preloaded `BugTicketDetail` to force a ticket (for example `--ticket 428`) without the list status whitelist. Mapping is resolved before any `处理中` followup; unmapped/home writes an optional followup with `status_change` null/empty and does not claim. Claim uses `status_change=处理中` and `assignee_change=null`. Assets download after claim (`file_size === 0` skipped). `lintEnabled` / `buildEnabled` default `false`. Success with MR → followup `现场验证` and `phase=done`; local commit but push/MR failure → stay `处理中`, `phase=awaiting_push`; fix/no-diff → stay `处理中`, `phase=failed`. Wrong product jinan hard-fails without auto-checkout. `runBatch(config, { maxTickets: 1 })` calls `ensureToken`, lists candidates, and runs `runOneTicket` up to `maxTickets`. Inject `agentRunner`, `runGit`, and `createMr` in tests; `buildAgentBrief` / `createDefaultAgentRunner` cover the brief and default `pnpm dsh --profile headless` spawn.

## Model Experience

None, as this package is a deployment-local mapping library that never contributes tokens to a model request. The agent brief string is assembled for a separate headless run.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Default agent runner is a thin `pnpm dsh` spawn; production runners should inject timeouts and richer exit parsing.
- Home worktree roots are typed on `WorkspaceRoots` but phase-1 edits must not target home; mapped `home` skips before claim.
- No scheduled polling and no multi-ticket concurrency; `runBatch` is serial and manually triggered.
- Automatic reassignment to backend handlers is deferred; failure followups stay `处理中` with assignee unchanged.
- Phase-1 `run-once` keeps the agent brief outside the session log; session integration must make that model-visible brief reconstructable from session events.
