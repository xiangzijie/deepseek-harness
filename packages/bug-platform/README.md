# bug-platform/ — internal bug-platform autofix

English | [中文](README.zh.md)

HTTP access to the internal bug-platform API plus orchestration that selects tickets, maps menus to workspaces, and drives headless autofix runs. Phase 1 keeps this as libraries/plugins composed by an example profile — not a full capability seam.

| Package | Role | ctx key |
|---|---|---|
| [`bug-platform-http/`](bug-platform-http/README.md) | Bug-platform HTTP client library and optional Cordis Config plugin | optional plugin `bug-platform-http` (no owned ctx key in phase 1) |
| [`bug-platform-autofix/`](bug-platform-autofix/README.md) | Menu mapping and (later) autofix orchestration library | optional plugin `bug-platform-autofix` (no owned ctx key in phase 1) |
