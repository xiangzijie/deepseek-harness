# Agent Note: Internal bug-platform autofix (phase 1)

Status: implemented

English | [中文](2026-09-09-bug-platform-autofix.zh.md)

## Problem

An internal bug platform holds unassigned frontend tickets that can be fixed in local product worktrees of `jgts/bigdata-web-frontend`. Operators need a manual batch path: claim a ticket, map its menu to the correct worktree, run a headless agent, attempt Git push and GitLab MR, and write followups back. deepseek-harness must host that path without changing `agent-loop`, without inventing a full capability seam before the pilot lands, and without checking out the wrong product jinan into another worktree.

## Decision

Ship a **hybrid two-package, library-first** layout under `packages/bug-platform/`:

- `@deepseek-ai/dsh-bug-platform-http` owns login, list/get, followup, and authenticated download. Callers construct `BugPlatformClient` from resolved credentials; Cordis `apply` validates Config only and does not register `ctx.bugPlatform`.
- `@deepseek-ai/dsh-bug-platform-autofix` owns menu mapping, ticket selection, local idempotency state, per-worktree Git helpers, `inspectWorkspace` / `inspectAutofixWorkspaces` health checks, GitLab ensure-MR plus notes, `runOneTicket` / `runBatch` orchestration, and forced global skill injection into the agent brief. Cordis `apply` stays a Config stub; `examples/bug-platform-autofix/run-once` imports helpers directly.

A full Service Definition / Provider / Consumer seam and installable bundle remain deferred. Phase-1 merge policy is **auto-fix + human merge**; high-confidence auto-merge remains deferred and must record its judgment basis. Experience capture remains deferred.

### Configuration authority

`operator.yaml` is the configuration authority for workspace paths, GitLab host and per-workspace `gitlabProjectId`, mapping / state / progress / assets paths, skill roots, and run tunables. `run-once` and `reset-to-pending` require `--config` or `BUG_PLATFORM_OPERATOR_FILE` and fail when the file is missing. Secrets stay in environment variables / `.env`. Pilot absolute paths live only in `operator.example.yaml`, not as TypeScript defaults.

The operator console is a separate git repository: it is not a harness package and not a `dsh web` bundle. CLI and console read the same `operator.yaml`.

### Three skill layers

Headless sees three layers, personal > in-repo > global: `join(personalRoot, operatorId)` via the rank-50 `autofix-personal` provider, `<localRoot>/.agents/skills` and `<localRoot>/.dsh/skills` (skill-filesystem ranks 100/200), and `globalLocal/skills` via `customSkillDirs` (rank 300). Same-name catalog/tool discovery follows that order. Forced global bodies still inject into the brief even when a higher layer overrides the catalog name.

The global clone is GitLab `jgts/autofix-skills`, independent of product repos. Duty machines clone it to `skills.globalLocal`. Protect `main`; `force: true` changes land through that skill repo's MR. Copy [`examples/bug-platform-autofix/skill-repo-template/`](../../../../examples/bug-platform-autofix/skill-repo-template/README.md) to create the remote.

### Worktrees and mapping

Each local root (`dkh-custom`, `dkh-ailpha`, `dkh-home`) binds one product jinan and its own `gitlabProjectId`. Mapping resolves a single `localRoot`; all edit / lint / commit / push / MR work stays in that directory. `ensureMergeRequest` uses that workspace's `gitlabProjectId`. Helpers never cross-checkout another product `*-jinan` into the wrong root; wrong HEAD hard-fails instead of auto-correcting. `createBugfixBranch` checks out the bound jinan before `checkout -b` so new ticket branches do not stack on a prior `bugfix/*` tip. A workspace with `autofix: false` is excluded at `selectTickets` time so whitelist batches never occupy `maxTickets` with it. Force `--ticket` still runs `runOneTicket`, which skips after mapping with a followup (`status_change` null) and no `处理中` claim.

`menu-mapping.json` (`systems.*.items[]`) is the mapping authority. `resolveMenu` exact-matches `target_menu`, keeps only `custom` / `ailpha`, prefers `file_exists`, then **custom over ailpha**, and returns null for unknown, null repo, or **home**. Filing must select leaf menus; description text is not used for menu resolution. Default list statuses are `待确认` / `验证未通过` / `转派` / `转需求`; `网络安全数据大屏` and `网络安全指挥大屏` are hard-excluded.

### Gates, GitLab, and re-fix

`lintEnabled` and `buildEnabled` default **off**. `GITLAB_TOKEN` is optional. Missing token or push/ensure-MR failure keeps platform status `处理中`, records `phase=awaiting_push`. Successful push keeps platform status **`处理中`** (followup includes MR URL) and must **not** claim `现场验证`; human review merges the MR.

`run-once` holds the progress-file lock, then calls `assertGlobalSkillsRunnable` before workspace inspection or tickets: a dirty force skill file or `manifest.yaml` refuses to start even with `--allow-stale-global-skills`; HEAD that does not match `origin/main` refuses unless that flag is set. A missing global clone with force names fails the process (stderr, exit code 1) instead of skip-unclaimed every ticket.

`run-once` calls `inspectAutofixWorkspaces` after constructing orchestrator config and before any ticket run. That helper inspects every `autofix: true` workspace via `inspectWorkspace`. The check verifies the directory exists, `.git` exists, HEAD is the bound jinan or `bugfix/<digits>`, porcelain is clean, and origin hostname matches `gitlab.host`. It does not call the GitLab HTTP API to look up project path. Any failure sets process exit code 1 and prints `id: 原因` on stderr.

After each successful push, orchestration **ensures** the MR (create, or reuse on conflict), adds an MR note, and writes a platform followup (`处理中` with MR / commit / summary; never `现场验证`). A second pass on the same `bugfix/<id>` therefore still updates bug-platform处理记录 and MR discussion instead of failing solely because the MR already exists. Force `--ticket` / `--tickets` may retry `done` / `awaiting_push` / `failed`; only local `claimed` / `fixing` block.

Default agent runner spawns harness `apps/cli` via tsx with product worktree as `cwd` (`harnessRoot` required)—never `pnpm dsh` inside the product tree. When `skillPatch` is set, each spawn writes `dsh --profile headless --patch <overlay.yml> <brief>`: the overlay sets only skill-filesystem `customSkillDirs` (global `skills/`, rank 300, so in-repo 100/200 beat global) and inserts the rank-50 `autofix-personal` provider at `join(personalRoot, operatorId)`, so personal > in-repo > global. Do not change `packages/skill/skill-filesystem` ranks. The overlay plugin `name` is the source-plane `.ts` path so tsx source-launch does not need the `./personal-skill-plugin` export built. The example supports `--poll-interval <seconds>` for a serial daemon loop; Windows Task Scheduler can also fire one-shot `--max 1` runs. Ops entry `reset-to-pending.ts` batch-resets tickets to `待确认` (explicit `--tickets`, or local `phase=failed`) with a follow-up note and clears matching local state—no agent. Batch progress prints the queue and `[i/n]` lines and writes `progress.json` (optional display `pid`). `run-once` acquires `dirname(progressFile)/run.lock` for the whole force / whitelist / poll process: a live holder pid fails with `已有跑批（pid=<n>），progressFile=<path>`; `ESRCH` is stale and is replaced; `EPERM` is live and is not stolen.

### Stop when context is thin or not clearly frontend

After mapping resolves, orchestration downloads assets and runs `assessPreAgentContext` **before** claiming. Thin context stops with a platform followup (`status_change` null), local `phase=skipped`, and no `处理中`. After that precheck, a text eligibility preflight (`assessNeedFrontendFix`) judges `need_frontend_fix` from description and followups only (no screenshots); ticket text is untrusted. Skip only when the model returns explicit `false` (`out_of_scope`, no `处理中`); `true` / `uncertain` / HTTP or parse failure continue. Force tickets (`--ticket` / `--tickets`) take the same judgment. In `runBatch`, skipped outcomes do not consume `maxTickets`; later candidates backfill until claimed outcomes reach the cap. When screenshots exist, a DeepSeek vision pre-pass (`deepseek-flash` by default) describes them into the agent brief; vision failure is recorded but does not block claim. When the agent cannot locate a frontend change or cannot confirm a frontend bug after claim, it must emit `SKIP_AUTOFIX|<category>|<reason>`; orchestration writes a platform followup (category + reason), keeps status `处理中`, sets `phase=failed`, and opens no MR. The brief also requires independent judgment (do not sycophantically follow the ticket narrative), separating facts from predictions and opinions, and an evidence priority: local code → vision observation → screenshots → concrete latest followups → vague description. Conflicting asks, oversized changes, env-only issues, already-fixed tickets, and security-sensitive work still map onto the same three stop categories—no new category tokens.

### Forced global skills

`runOneTicket` resolves `force: true` entries from `globalLocal/manifest.yaml` after the text eligibility preflight and before claim. Matching skills (`enabled: true`; `workspaceIds: []` means every `autofix: true` workspace id) have their `skills/<name>/SKILL.md` or `skills/<name>.md` bodies injected into the agent brief under `## 强制 skill（编排注入，必须遵守）`; names are listed on line 2. The model must obey them without calling a skill tool. `skills[].name` must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (the dsh `isSkillName` grammar, copied locally so this package does not depend on `@deepseek-ai/dsh-skill`); otherwise `path.join(globalLocal, 'skills', name, …)` can leave `skills/` on Windows (`../`, drive-letter absolute, `foo/bar`). Invalid names throw at manifest load — not an empty list — so orchestration calls `skipUnclaimed` without `处理中`. Count above `forceMaxCount`, combined body characters above `forceMaxChars`, or `disable-model-invocation: true` on a forced skill also skips without `处理中` (`phase=skipped`). `run-once` passes `skills.globalLocal` and those limits from `operator.yaml`.

### Model-visible brief vs session log

When autofix later runs inside a session-backed agent, the agent brief is model-visible input and must be reconstructable from the session log (model-visible ⟺ logged). Phase-1 `run-once` spawns headless outside that path, so the brief is **not** session-logged yet; that remains an accepted limitation until session integration.

## Alternatives considered

**Full capability seam in phase 1.** Rejected because Definition / Provider / Consumer packaging and a product bundle would delay the pilot without changing the HTTP or orchestration contracts the example already needs.

**Single package for HTTP and orchestration.** Rejected because the HTTP client is reusable without mapping/Git, and splitting keeps the library-first HTTP surface independent of autofix state machines.

**Checkout any jinan inside one worktree.** Rejected because each root binds one product jinan; checking out another product jinan contaminates the wrong local tree. One ticket maps to one root and one bound jinan only.

**One hardcoded GitLab project id for all three worktrees.** Rejected because each workspace may target a different GitLab project on the same `gitlab.host`; MR create/reuse uses `workspaces[].gitlabProjectId`.

**Hand-maintained short menu YAML beside `menu-mapping.json`.** Rejected because the exported JSON already carries `repo`, routes, and `file_exists`; a second table would drift.

**Require GitLab token for a successful run.** Rejected because local commit plus `awaiting_push` still delivers a fix when remote Git is unavailable; claiming `现场验证` without an MR would lie to the platform.

**Auto-reassign backend handlers on “looks like API” failures.** Rejected for phase 1; keep `处理中` with a reason and leave assignee unchanged.

**Default auto-merge of MRs.** Rejected; human merge is the default. Optional high-confidence auto-merge later must record judgment basis.

**Hardcode duty-machine paths in TypeScript.** Rejected because workspace roots, GitLab ids, and skill clones vary per machine; `operator.yaml` is the authority and a missing file fails loud.

**Ship the operator console inside harness or `dsh web`.** Rejected because the console is a business UI over this library; it belongs in a separate repository that shares `operator.yaml` with the CLI.

**Depend on the model calling a skill tool for force rules.** Rejected because force rules must apply even when the model never invokes a skill tool; orchestration injects matching `SKILL.md` bodies into the brief.

**Keep global skills inside a product worktree.** Rejected because product jinan and force-policy have independent remotes and protected branches; mixing them couples unrelated MRs. The skill clone is `jgts/autofix-skills`.

## Consequences

Operators run from `operator.yaml` (one-shot, `--poll-interval`, or `--continuous`); forced global skills inject into the agent brief; the console is not in this repository. The path has opened real GitLab MRs and written platform followups, at the cost of deferred concurrency, full seam packaging, session-logged briefs, and experience capture. Two `run-once` processes that share a `progressFile` cannot overlap: the second live pid fails before claim. Skipping lint/build can push broken diffs until operators enable path-scoped lint. Re-fix updates platform and MR records, but wrong product merges still require human review before landing on jinan.
