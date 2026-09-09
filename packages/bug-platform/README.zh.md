# bug-platform/：内部 bug 平台自动修复

[English](README.md) | 中文

访问内部 bug 平台 API 的 HTTP 能力，以及挑选工单、将菜单映射到工作区并驱动 headless 自动修复运行的编排。第一阶段以库／插件形式由示例 profile 组合，不是完整的能力 seam。

| 包 | 职责 | ctx key |
|---|---|---|
| [`bug-platform-http/`](bug-platform-http/README.md) | bug 平台 HTTP 客户端库与可选的 Cordis Config 插件 | 可选插件 `bug-platform-http`（第一阶段不拥有 ctx 键） |
