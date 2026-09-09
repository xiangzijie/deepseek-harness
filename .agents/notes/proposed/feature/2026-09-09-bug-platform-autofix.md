# Agent Note: Internal bug-platform autofix (phase 1)

Status: proposed

English | [中文](2026-09-09-bug-platform-autofix.zh.md)

## Problem

An internal bug platform holds unassigned frontend tickets that can be fixed in local product worktrees of `jgts/bigdata-web-frontend`. Operators need a manual batch path: claim a ticket, map its menu to the correct worktree, run a headless agent, attempt Git push and GitLab MR, and write followups back. deepseek-harness must host that path without changing `agent-loop`, without inventing a full capability seam before the pilot lands, and without checking out the wrong product jinan into another worktree of the same remote.

## Proposal

Ship a **hybrid two-package, library-first** layout under `packages/bug-platform/`:

- `@deepseek-ai/dsh-bug-platform-http` owns login, list/get, followup, and authenticated download. Callers construct `BugPlatformClient` from resolved credentials; Cordis `apply` validates Config only and does not register `ctx.bugPlatform`.
- `@deepseek-ai/dsh-bug-platform-autofix` owns menu mapping, ticket selection, local idempotency state, per-worktree Git helpers, optional GitLab MR creation, and `runOneTicket` / `runBatch` orchestration. Cordis `apply` stays a Config stub; the example `run-once` imports helpers directly.

A full Service Definition / Provider / Consumer seam and installable bundle stay deferred until the pilot proves the flow.

### Worktrees and mapping

The three local roots (`dkh-custom`, `dkh-ailpha`, `dkh-home`) share one GitLab project and bind one product jinan each. Mapping resolves a single `localRoot`; all edit / lint / commit / push / MR work stays in that directory. Helpers never cross-checkout another product `*-jinan` into the wrong root; wrong HEAD hard-fails instead of auto-correcting.

`menu-mapping.json` (`systems.*.items[]`) is the mapping authority. `resolveMenu` exact-matches `target_menu`, keeps only `custom` / `ailpha`, prefers `file_exists`, then **custom over ailpha**, and returns null for unknown, null repo, or **home**.

### Gates, GitLab, and pilot ticket

`lintEnabled` and `buildEnabled` default **off**; a ticket with a local diff may enter the Git path without lint or build.

`GITLAB_TOKEN` is optional. Missing token or push/MR failure keeps platform status `处理中`, records `phase=awaiting_push`, and must not claim `现场验证`.

Pilot ticket **428** (`转派`) is outside the default list whitelist (`待确认` / `验证未通过`). Operators force it with `--ticket 428` (preloaded detail into `runOneTicket`), which bypasses list status filtering after mapping still succeeds.

### Model-visible brief vs session log

When autofix later runs inside a session-backed agent, the agent brief is model-visible input and must be reconstructable from the session log (model-visible ⟺ logged). Phase-1 `run-once` spawns headless outside that path, so the brief is **not** session-logged yet; that is an accepted limitation until session integration.

## Alternatives considered

**Full capability seam in phase 1.** Rejected because Definition / Provider / Consumer packaging and a product bundle would delay the pilot without changing the HTTP or orchestration contracts the example already needs.

**Single package for HTTP and orchestration.** Rejected because the HTTP client is reusable without mapping/Git, and splitting keeps the library-first HTTP surface independent of autofix state machines.

**Checkout any jinan inside one worktree.** Rejected because the three roots share one remote; checking out another product jinan contaminates the wrong local tree. One ticket maps to one root and one bound jinan only.

**Hand-maintained short menu YAML beside `menu-mapping.json`.** Rejected because the exported JSON already carries `repo`, routes, and `file_exists`; a second table would drift.

**Require GitLab token for a successful run.** Rejected because local commit plus `awaiting_push` still delivers a fix when remote Git is unavailable; claiming `现场验证` without an MR would lie to the platform.

**Auto-reassign backend handlers on “looks like API” failures.** Rejected for phase 1; keep `处理中` with a reason and leave assignee unchanged.

## Acceptance criteria

- Both packages ship as library-first plugins with empty inject and no owned `ctx` key; an example profile composes a manual `run-once` batch.
- Mapping prefers custom over ailpha, skips home and unmapped menus before any `处理中` claim, and refuses cross-worktree product jinan checkout.
- Default lint/build are off; optional GitLab MR falls back to `awaiting_push` without `现场验证`.
- `--ticket 428` can force the pilot ticket despite `转派` status.
- Package READMEs state deferred polling, concurrency, home edits, and auto-reassign; this note records the session-log gap for the phase-1 brief.

## Risks

Without polling or concurrency locks, overlapping manual runs can race on the same unassigned ticket; local idempotency only protects a single process that honors the state file.

Skipping lint/build can push broken diffs; operators must opt in when the target repos accept path-scoped lint.

Keeping the phase-1 brief outside the session log means transcript replay and SDK snapshots do not yet pin model-visible autofix context; session integration must add a session event before claiming harness-native model-visible compliance.
