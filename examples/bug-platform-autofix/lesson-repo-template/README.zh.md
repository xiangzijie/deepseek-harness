# autofix-lessons

[English](README.md) | 中文

bug-platform 自动修复的经验仓。本仓独立于产品仓（如 `jgts/bigdata-web-frontend`）、harness 树，以及 skill 仓 `jgts/autofix-skills`。值班机按 `operator.yaml` 把它 clone 到 `lessons.local`。不要把经验文件与 skill 仓混放。

## 在 GitLab 创建项目

在与产品仓相同的 GitLab 主机上创建 `jgts/autofix-lessons`。不要把产品工作区、skill clone 或 harness 仓库当作线上 clone。

把本模板拷进该项目，然后在值班机上 clone：

```sh
git clone git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-lessons.git
```

把 `operator.yaml` 的 `lessons.repo` 设为该远程，`lessons.local` 设为 clone 路径。`lessons.injectMax` 缺省为 `3`。

## 允许 Maintainer 直推 main

允许 Maintainer 直接 push `main`。确认路径用快进 pull、commit 与 push 写入已入库正文和索引行；不以 MR 作为确认闸门。不要照搬 skill 仓保护 `main` 的策略。

## 查询只走 index.yaml

`index.yaml` 是唯一查询入口。列表、去重与领单检索只读索引行。不要为了决定注入哪几条而加载全部 markdown 正文。

不要把密钥、Token 或 API 请求体写入 markdown。

## 布局

```text
index.yaml
pending/.gitkeep
accepted/.gitkeep
```

`pending/` 存放待确认草稿（`<id>.md`）和对已入库条目的优化建议（`opt-<id>-<ticket>.md`）。`accepted/` 存放已入库正文；注入只读这些文件。
