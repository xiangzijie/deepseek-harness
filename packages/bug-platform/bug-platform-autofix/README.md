# @deepseek-ai/dsh-bug-platform-autofix

English | [中文](README.zh.md)

Library-first helpers for internal bug-platform autofix: load `menu-mapping.json` and resolve a ticket `target_menu` to a custom/ailpha worktree hit. Phase 1 keeps Cordis `apply` as a Config stub (empty inject); orchestration imports `loadMenuMapping` / `resolveMenu` directly. Later tasks add selection, idempotency, Git, and batch orchestration in this package.

## Config

| Key | Default | Meaning |
|---|---|---|
| `mappingFile` | `""` | Absolute path to `menu-mapping.json`. Empty means the caller passes parsed JSON to `loadMenuMapping`. |

## Menu mapping

`loadMenuMapping(json)` reads `systems.*.items[]`. `resolveMenu(index, targetMenu)` exact-matches `target_menu`, keeps only `repo` of `custom` or `ailpha`, prefers `file_exists === true`, then prefers `custom` over `ailpha`, and returns null for unknown, `repo == null`, `home`, or other ineligible repos.

## Model Experience

None, as this package is a deployment-local mapping library that never contributes tokens to a model request.

#### KV Cache effect

No effect; the package does not touch model request assembly.

## Known Limitations and Deferred Work

- Cordis `apply` validates Config only; it does not register orchestration on `ctx`.
- Ticket selection, Git, and agent brief builders are not yet implemented in this package.
