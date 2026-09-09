# @deepseek-ai/dsh-bug-platform-autofix

[English](README.md) | 中文

面向内部 bug 平台自动修复的库优先辅助：加载 `menu-mapping.json`，将工单的 `target_menu` 解析到 custom／ailpha 工作区命中项，过滤列表行，并维护本地 JSON 幂等状态。第一阶段 Cordis `apply` 仅作 Config 桩（`inject` 为空）；编排直接导入辅助函数。后续任务在本包内补充 Git 与跑批编排。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `mappingFile` | `""` | `menu-mapping.json` 的绝对路径。为空时由调用方把已解析 JSON 交给 `loadMenuMapping`。 |

## 菜单映射

`loadMenuMapping(json)` 读取 `systems.*.items[]`。`resolveMenu(index, targetMenu)` 精确匹配 `target_menu`，只保留 `repo` 为 `custom` 或 `ailpha` 的项，优先 `file_exists === true`，再优先 `custom` 于 `ailpha`；未知、`repo == null`、`home` 或其他不可修仓库返回 null。

## 选单与本地状态

`selectTickets(tickets, index, store, options?)` 保留：`assignee_id` 为 null、`status` 在允许列表（默认 `待确认`／`验证未通过`）、`target_menu` 不是 `网络安全数据大屏`、`resolveMenu` 有命中、且不在 `TicketStateStore` 进行中阶段（`claimed`／`fixing`／`awaiting_push`）的行。可用 `options.statuses` 覆盖允许列表。

`loadState(path)`／`saveState(path, store)` 读写 `{ tickets: TicketRecord[] }`；文件不存在时得到空的 `TicketStateStore`。`isActive(record)` 对进行中阶段为 true；`store.get`／`store.upsert` 维护内存映射。

## 模型体验

无，因为本包是部署本地的映射库，从不向模型请求贡献 token。

#### KV Cache 影响

无影响；本包不参与模型请求装配。

## 已知限制与暂缓事项

- Cordis `apply` 仅校验 Config；不在 `ctx` 上注册编排。
- Git 辅助与 agent brief 构造尚未在本包实现。
