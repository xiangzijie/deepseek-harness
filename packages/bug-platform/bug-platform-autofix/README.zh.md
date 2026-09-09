# @deepseek-ai/dsh-bug-platform-autofix

[English](README.md) | 中文

面向内部 bug 平台自动修复的库优先辅助：加载 `menu-mapping.json`，并将工单的 `target_menu` 解析到 custom／ailpha 工作区命中项。第一阶段 Cordis `apply` 仅作 Config 桩（`inject` 为空）；编排直接导入 `loadMenuMapping`／`resolveMenu`。后续任务在本包内补充选单、幂等、Git 与跑批编排。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `mappingFile` | `""` | `menu-mapping.json` 的绝对路径。为空时由调用方把已解析 JSON 交给 `loadMenuMapping`。 |

## 菜单映射

`loadMenuMapping(json)` 读取 `systems.*.items[]`。`resolveMenu(index, targetMenu)` 精确匹配 `target_menu`，只保留 `repo` 为 `custom` 或 `ailpha` 的项，优先 `file_exists === true`，再优先 `custom` 于 `ailpha`；未知、`repo == null`、`home` 或其他不可修仓库返回 null。

## 模型体验

无，因为本包是部署本地的映射库，从不向模型请求贡献 token。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- Cordis `apply` 仅校验 Config；不在 `ctx` 上注册编排。
- 选单、Git 与 agent brief 构造尚未在本包实现。
