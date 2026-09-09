# @deepseek-ai/dsh-bug-platform-autofix

English | [中文](README.zh.md)

Library-first helpers for internal bug-platform autofix: load `menu-mapping.json`, resolve a ticket `target_menu` to a custom/ailpha worktree hit, filter list rows, keep a local JSON idempotency store, and run per-worktree Git helpers (`assertProductBranch`, `assertClean`, `createBugfixBranch`, `commitAll`, `pushBranch`, `listChangedFiles`) with an injectable `RunGit`. Phase 1 keeps Cordis `apply` as a Config stub (empty inject); orchestration imports helpers directly.

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

## Model Experience

None, as this package is a deployment-local mapping library that never contributes tokens to a model request.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Agent brief builders and batch orchestration are not yet implemented in this package.
- Home worktree roots are typed on `WorkspaceRoots` but phase-1 edits must not target home.
