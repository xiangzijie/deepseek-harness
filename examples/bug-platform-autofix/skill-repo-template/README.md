# autofix-skills

English | [中文](README.zh.md)

Global skill clone for bug-platform autofix. This repository is independent of product repos such as `jgts/bigdata-web-frontend` and of the harness tree. Duty machines clone it to `skills.globalLocal` from `operator.yaml`.

## Create the GitLab project

Create `jgts/autofix-skills` on the same GitLab host as the product repos. Do not use a product worktree or the harness repo as the live clone.

Copy this template into that project, then clone on the duty machine:

```sh
git clone git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-skills.git
```

Set `operator.yaml` `skills.globalRepo` to that remote and `skills.globalLocal` to the clone path.

## Protect main

Protect `main` so force-policy changes cannot land by direct push. `run-once` refuses a dirty force `SKILL.md` or `manifest.yaml` even with `--allow-stale-global-skills`. HEAD must match `origin/main` unless that flag is set.

## Force changes go through merge requests

`manifest.yaml` entries with `force: true` inject `skills/<name>/SKILL.md` into the agent brief. Changing `force`, or the body of a forced skill, requires an MR into `main`. After merge, the duty machine pulls the clone. Do not set `disable-model-invocation: true` on a forced skill.

## Layout

```text
manifest.yaml
skills/fix-frontend-ticket/SKILL.md
```
