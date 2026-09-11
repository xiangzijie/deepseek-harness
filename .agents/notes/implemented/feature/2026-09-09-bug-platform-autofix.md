# Agent Note: Internal bug-platform autofix (phase 1)

Status: implemented

English | [中文](2026-09-09-bug-platform-autofix.zh.md)

## Problem

An internal bug platform holds unassigned frontend tickets that can be fixed in local product worktrees of `jgts/bigdata-web-frontend`. Operators need a manual batch path: claim a ticket, map its menu to the correct worktree, run a headless agent, attempt Git push and GitLab MR, and write followups back. deepseek-harness must host that path without changing `agent-loop`, without inventing a full capability seam before the pilot lands, and without checking out the wrong product jinan into another worktree of the same remote.

## Decision

Ship a **hybrid two-package, library-first** layout under `packages/bug-platform/`:

- `@deepseek-ai/dsh-bug-platform-http` owns login, list/get, followup, and authenticated download. Callers construct `BugPlatformClient` from resolved credentials; Cordis `apply` validates Config only and does not register `ctx.bugPlatform`.
- `@deepseek-ai/dsh-bug-platform-autofix` owns menu mapping, ticket selection, local idempotency state, per-worktree Git helpers, GitLab ensure-MR plus notes, and `runOneTicket` / `runBatch` orchestration. Cordis `apply` stays a Config stub; `examples/bug-platform-autofix/run-once` imports helpers directly.

A full Service Definition / Provider / Consumer seam and installable bundle remain deferred. Phase-1 merge policy is **auto-fix + human merge**; high-confidence auto-merge is a later exception that must audit its judgment (design §3.11). Experience capture stays phase 3 (design §9.2).

### Worktrees and mapping

The three local roots (`dkh-custom`, `dkh-ailpha`, `dkh-home`) share one GitLab project and bind one product jinan each. Mapping resolves a single `localRoot`; all edit / lint / commit / push / MR work stays in that directory. Helpers never cross-checkout another product `*-jinan` into the wrong root; wrong HEAD hard-fails instead of auto-correcting. `createBugfixBranch` checks out the bound jinan before `checkout -b` so new ticket branches do not stack on a prior `bugfix/*` tip.

`menu-mapping.json` (`systems.*.items[]`) is the mapping authority. `resolveMenu` exact-matches `target_menu`, keeps only `custom` / `ailpha`, prefers `file_exists`, then **custom over ailpha**, and returns null for unknown, null repo, or **home**. Filing must select leaf menus; description text is not used for menu resolution (design §4.3). Default list statuses are `待确认` / `验证未通过` / `转派` / `转需求`; `网络安全数据大屏` and `网络安全指挥大屏` are hard-excluded.

### Gates, GitLab, and re-fix

`lintEnabled` and `buildEnabled` default **off**. `GITLAB_TOKEN` is optional. Missing token or push/ensure-MR failure keeps platform status `处理中`, records `phase=awaiting_push`. Successful push keeps platform status **`处理中`** (followup includes MR URL) and must **not** claim `现场验证`; human review merges the MR.

After each successful push, orchestration **ensures** the MR (create, or reuse on conflict), adds an MR note, and writes a platform followup (`处理中` with MR / commit / summary; never `现场验证`). A second pass on the same `bugfix/<id>` therefore still updates bug-platform处理记录 and MR discussion instead of failing solely because the MR already exists. Force `--ticket` / `--tickets` may retry `done` / `awaiting_push` / `failed`; only local `claimed` / `fixing` block.

Default agent runner spawns harness `apps/cli` via tsx with product worktree as `cwd` (`harnessRoot` required)—never `pnpm dsh` inside the product tree. The example supports `--poll-interval <seconds>` for a serial daemon loop (phase-2 item 1, partial); Windows Task Scheduler can also fire one-shot `--max 1` runs.

### Stop when context is thin or not clearly frontend

After mapping resolves, orchestration downloads assets and runs `assessPreAgentContext` **before** claiming. Thin context stops with a platform followup (`status_change` null), local `phase=skipped`, and no `处理中`. When the agent cannot locate a frontend change or cannot confirm a frontend bug after claim, it must emit `SKIP_AUTOFIX|<category>|<reason>`; orchestration writes a platform followup (category + reason), keeps status `处理中`, sets `phase=failed`, and opens no MR. The brief also requires independent judgment (do not sycophantically follow the ticket narrative), separating facts from predictions and opinions, and an evidence priority: local code → screenshots → concrete latest followups → vague description. Conflicting asks, oversized changes, env-only issues, already-fixed tickets, and security-sensitive work still map onto the same three stop categories—no new category tokens.

### Model-visible brief vs session log

When autofix later runs inside a session-backed agent, the agent brief is model-visible input and must be reconstructable from the session log (model-visible ⟺ logged). Phase-1 `run-once` spawns headless outside that path, so the brief is **not** session-logged yet; that remains an accepted limitation until session integration.

## Alternatives considered

**Full capability seam in phase 1.** Rejected because Definition / Provider / Consumer packaging and a product bundle would delay the pilot without changing the HTTP or orchestration contracts the example already needs.

**Single package for HTTP and orchestration.** Rejected because the HTTP client is reusable without mapping/Git, and splitting keeps the library-first HTTP surface independent of autofix state machines.

**Checkout any jinan inside one worktree.** Rejected because the three roots share one remote; checking out another product jinan contaminates the wrong local tree. One ticket maps to one root and one bound jinan only.

**Hand-maintained short menu YAML beside `menu-mapping.json`.** Rejected because the exported JSON already carries `repo`, routes, and `file_exists`; a second table would drift.

**Require GitLab token for a successful run.** Rejected because local commit plus `awaiting_push` still delivers a fix when remote Git is unavailable; claiming `现场验证` without an MR would lie to the platform.

**Auto-reassign backend handlers on “looks like API” failures.** Rejected for phase 1; keep `处理中` with a reason and leave assignee unchanged.

**Default auto-merge of MRs.** Rejected; human merge is the default. Optional high-confidence auto-merge later must record judgment basis (design §3.11).

## Consequences

Phase 1 delivers a manually triggered library-first path that has opened real GitLab MRs and written platform followups, at the cost of deferred polling, concurrency, full seam packaging, session-logged briefs, and experience capture. Overlapping manual runs can still race without a shared lock beyond the local state file. Skipping lint/build can push broken diffs until operators enable path-scoped lint. Re-fix updates platform and MR records, but wrong product merges still require human review before landing on jinan.
