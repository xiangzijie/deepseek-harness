# @deepseek-ai/dsh-bug-platform-autofix

English | [中文](README.zh.md)

Library-first helpers for internal bug-platform autofix: load `menu-mapping.json`, resolve a ticket `target_menu` to a custom/ailpha worktree hit, filter list rows, and keep a local JSON idempotency store. Phase 1 keeps Cordis `apply` as a Config stub (empty inject); orchestration imports helpers directly. Later tasks add Git and batch orchestration in this package.

## Config

| Key | Default | Meaning |
|---|---|---|
| `mappingFile` | `""` | Absolute path to `menu-mapping.json`. Empty means the caller passes parsed JSON to `loadMenuMapping`. |

## Menu mapping

`loadMenuMapping(json)` reads `systems.*.items[]`. `resolveMenu(index, targetMenu)` exact-matches `target_menu`, keeps only `repo` of `custom` or `ailpha`, prefers `file_exists === true`, then prefers `custom` over `ailpha`, and returns null for unknown, `repo == null`, `home`, or other ineligible repos.

## Selection and local state

`selectTickets(tickets, index, store, options?)` keeps rows where `assignee_id` is null, `status` is in the allow-list (default `待确认` / `验证未通过`), `target_menu` is not `网络安全数据大屏`, `resolveMenu` returns a hit, and the ticket is not active in `TicketStateStore` (`claimed` / `fixing` / `awaiting_push`). Pass `options.statuses` to override the allow-list.

`loadState(path)` / `saveState(path, store)` read and write `{ tickets: TicketRecord[] }`. A missing file loads an empty `TicketStateStore`. `isActive(record)` is true for in-progress phases; `store.get` / `store.upsert` mutate the in-memory map.

## Model Experience

None, as this package is a deployment-local mapping library that never contributes tokens to a model request.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Git helpers and agent brief builders are not yet implemented in this package.
