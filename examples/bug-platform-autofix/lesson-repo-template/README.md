# autofix-lessons

English | [中文](README.zh.md)

Lesson clone for bug-platform autofix. This repository is independent of product repos such as `jgts/bigdata-web-frontend`, of the harness tree, and of the skill clone `jgts/autofix-skills`. Duty machines clone it to `lessons.local` from `operator.yaml`. Do not mix lesson files with the skill repo.

## Create the GitLab project

Create `jgts/autofix-lessons` on the same GitLab host as the product repos. Do not use a product worktree, the skill clone, or the harness repo as the live clone.

Copy this template into that project, then clone on the duty machine:

```sh
git clone git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-lessons.git
```

Set `operator.yaml` `lessons.repo` to that remote and `lessons.local` to the clone path. `lessons.injectMax` defaults to `3`.

## Allow Maintainer push on main

Allow Maintainers to push `main` directly. Confirmation writes accepted bodies and index rows by fast-forward pull, commit, and push; an MR is not the confirmation gate. Do not copy the skill repo's protected-`main` policy.

## Query only through index.yaml

`index.yaml` is the only query entry. Listing, dedup, and claim-time lookup read index rows only. Do not load every markdown body to decide which lessons apply.

Do not put secrets, tokens, or API request bodies in markdown.

## Layout

```text
index.yaml
pending/.gitkeep
accepted/.gitkeep
```

`pending/` holds unconfirmed drafts (`<id>.md`) and optimize suggestions (`opt-<id>-<ticket>.md`). `accepted/` holds confirmed bodies; inject reads only those files.
