# autofix-skills

[English](README.md) | 中文

bug-platform 自动修复的全局 skill 仓。本仓独立于产品仓（如 `jgts/bigdata-web-frontend`）以及 harness 树。值班机按 `operator.yaml` 把它 clone 到 `skills.globalLocal`。

## 在 GitLab 创建项目

在与产品仓相同的 GitLab 主机上创建 `jgts/autofix-skills`。不要把产品工作区或 harness 仓库当作线上 clone。

把本模板拷进该项目，然后在值班机上 clone：

```sh
git clone git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-skills.git
```

把 `operator.yaml` 的 `skills.globalRepo` 设为该远程，`skills.globalLocal` 设为 clone 路径。

## 保护 main

保护 `main`，强制策略不得直接 push 合入。`run-once` 在强制 skill 的 `SKILL.md` 或 `manifest.yaml` 有未提交变更时拒绝开跑，即使带了 `--allow-stale-global-skills`。HEAD 必须与 `origin/main` 一致，除非设置该 flag。

## 强制变更走合并请求

`manifest.yaml` 里 `force: true` 的项会把 `skills/<name>/SKILL.md` 注入 agent brief。更改 `force`、或强制 skill 正文，必须经 MR 合入 `main`。合入后值班机 pull clone。强制 skill 不得设置 `disable-model-invocation: true`。

## 布局

```text
manifest.yaml
skills/fix-frontend-ticket/SKILL.md
```
