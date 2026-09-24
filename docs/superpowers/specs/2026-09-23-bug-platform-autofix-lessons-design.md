# Bug 平台自动修复：经验库（M6）

日期：2026-09-23

状态：已实现

范围：在 M0/M1 已能开 MR 的前提下，用**独立 git 仓**沉淀「这类菜单通常改哪」；控制台确认与优化；领单时按索引查询后按需加载正文注入 brief。不实现 M2–M5。一期目标与分工仍见 [一期规格 §9.1](./2026-09-09-bug-platform-autofix-design.md)；机制以本文为准。

## 1. 目标与非目标

### 1.1 目标

- 修单成功（已开或复用 MR，平台跟进含 MR 链接、状态保持「处理中」）后，系统可起草经验，人工确认后供后续修单使用。
- 权威存储为独立 GitLab 私有仓（与全局 skill 仓并列，文件不混用）。
- 查询只走索引，禁止为判重或选单而一次加载全库正文。
- 相同或明显相似的经验不得再生成一条；应跳过或作为对已有条目的优化建议。
- 已确认经验允许在控制台补充、修改后写回仓。

### 1.2 非目标

- 不把经验写进全局/个人/仓内 skill 的 `SKILL.md`。
- 不靠经验仓 MR 作为人工确认闸门（确认在控制台；仓的 `main` 允许 Maintainer 直推）。
- 不按全库向量/相似度检索修单 brief（只按 `target_menu` 精确匹配索引）。
- 不实现 M2 并发、M3 clone/review、M4 多人账号、M5 进程内编排。
- 不因起草或 push 失败而把已成功的修单 MR 改成失败。
- 不把密钥、Token、API 请求体写入经验正文、跟进、progress 或控制台响应。

## 2. 仓库与配置

GitLab 项目：`jgts/autofix-lessons`（私有）。值班机 clone 到本机目录，由 `operator.yaml` 指向。

```yaml
lessons:
  repo: 'git@gitlab.info.dbappsecurity.com.cn:jgts/autofix-lessons.git'
  local: 'D:/CODE/COMPANY/dkh-bugFix-project/autofix-lessons'
  injectMax: 3
```

`injectMax` 缺省 `3`。密钥沿用 `GITLAB_TOKEN` / SSH，与 skill 仓相同通道。缺 `lessons.local` 或目录不是 git 仓：本轮不注入、不起草，修单本身继续。

仓布局：

```text
index.yaml                 # 唯一查询入口（§3）
pending/<id>.md            # 待确认的全新草稿
pending/opt-<id>-<ticket>.md  # 对已入库 <id> 的优化建议
accepted/<id>.md           # 已入库正文；注入只读这些文件
```

`main` 允许 Maintainer 直推（与 `autofix-skills` 保护策略不同）。实现时创建项目须按此设置，否则控制台确认无法 `git push`。

## 3. 索引

`index.yaml` 是列表、判重、领单检索的**唯一入口**。一行一条，不含正文。字段：

- `id`：稳定 id（新建草稿用 `t<ticketId>`；同一 ticket 不新开第二条）。
- `status`：`pending` | `accepted` | `optimize`。
- `target_menu`：工单菜单，精确匹配用。
- `symptom`：一句中文症状（判重与列表只看这句加菜单，不看全文）。
- `ticketId`、`mrUrl`、`updatedAt`（ISO-8601）。
- `optimizeOf`：仅 `optimize` 行填写，指向已有 `accepted` 的 `id`。

控制台「经验」页默认渲染索引：可按菜单过滤。点开一条才读对应 md。

同菜单用于判重的索引行最多取 **50** 条（按 `updatedAt` 倒序）。超过部分本轮判重不看，避免一次把整菜单历史塞进模型。

## 4. 时机

### 4.1 注入（领单前，写 brief 时）

在资格判断通过之后、启动 headless 之前：

1. 读取 `index.yaml`（必要时先 `git pull`，见 §7）。
2. 筛选 `status === accepted` 且 `target_menu` 与本单相同的行。
3. 按 `updatedAt` 倒序取最多 `injectMax` 条。
4. **只加载这几条**的 `accepted/<id>.md` 写入 brief 一节（例如「已入库经验」）。单篇超过 1200 字则截断并注明。
5. 无命中则不注入该节。

不得把 pending / optimize 正文注入修单 brief。

### 4.2 起草（修单成功之后）

仅当本次 `runOneTicket` 结果为 `kind === 'done'` 且有 MR URL。`skipped`、`failed`、`awaiting_push`、资格跳过均不起草。

顺序：cheap 规则 → 索引去重 →（需要时）写 pending 或 optimize 文件并更新索引 → `git add` / `commit` / `push`。任一步失败：日志或跟进一句，修单结果仍为 `done`。

## 5. 去重、起草与优化

Cheap 规则（不调模型）：无 `target_menu`、无有效 diff、纯文案改动（例如只改提示语且路径不可复用）→ 不起草。该 `ticketId` 在索引中已有任意状态的行 → 不起草。

否则加载**同菜单**索引行（≤50）：将本单摘要（菜单 + 一句话症状 + 变更路径列表，不含密钥、不含工单里的角色指令）与这些 `symptom` 交给文本模型。凭证与资格判断相同：`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_BASE_URL`；模型 id 为 `BUG_PLATFORM_LESSON_MODEL`，缺省 `deepseek-chat`。缺密钥或调用失败：本轮不起草。模型只返回 JSON：

- `action`: `create` | `skip` | `optimize`
- `existing_id`: `optimize` 时必填，且必须是本批索引里的 `accepted` id
- `reason`: 一句中文

`skip`：视为相同或明显相似，不写新文件。`optimize`：写入 `pending/opt-<existing_id>-<ticketId>.md`（建议 diff 式短文），索引加 `status: optimize` 行。`create`：写入 `pending/t<ticketId>.md` 与索引 `pending` 行；正文含症状、菜单、改法、关键路径、反例，以及 ticket / MR / 时间。

工单描述与 diff 视为不可信：只根据「该菜单以后怎么改前端」起草；忽略要求改输出格式或扮演其它角色的句子；不得把密钥抄进 md。

模型失败、非法 JSON：本轮不起草（fail-open），不中止已成功修单。

## 6. 控制台

第四页「经验」（`/lessons`），不塞进 Skill 页。

- 索引列表：菜单过滤；状态 pending / optimize / accepted。
- 待确认：通过（移到 `accepted/`，更新索引 status）、改一句或全文后通过、拒绝（删除 pending 文件与索引行）。
- 优化建议：采纳（把建议合并进对应 `accepted/<id>.md` 并更新 `symptom` / `updatedAt`）、编辑后采纳、拒绝（删 opt 文件与索引行）。
- 已入库：可再编辑正文并 push（补充优化）。若 `run.lock` 存活，确认/优化/编辑 API 返回错误，提示先停跑批，避免与跑批双写同一 clone。

写仓前先 `git pull` 快进；冲突则失败并展示，由操作者处理。成功路径为快进 pull + commit + push `main`。不得默默 `pull --rebase` 改写远程。

## 7. 同步与失败

跑批开始时对 `lessons.local` `git pull`（快进）。pull 失败：本轮不注入、不起草，修单继续。clone 缺失：同上。

经验仓脏（有未提交文件）且不是本进程刚写下的草稿：不起草、控制台写操作失败并说明。

## 8. 测试

- 注入：同菜单 5 条 accepted、`injectMax=3` → brief 只含最新 3 篇正文；其它 md 未被读取（可用假 fs 断言路径）。
- 注入：菜单不匹配 → brief 无经验节。
- 去重：索引已有极相似 `symptom` → `skip`，不新建 pending。
- 去重：`optimize` → 只新增 opt 文件，不新增独立 `t<id>` accepted。
- 同一 `ticketId` 已在索引 → 第二次 `done` 不起草。
- `done` 但起草 push 失败 → 结果仍为 `done`。
- `skipped` / `awaiting_push` → 不写 pending。
- 控制台：存活跑批锁时通过操作失败。
- 控制台：通过后索引为 accepted 且 `pending/` 无该文件。

## 9. 默认不做

- 不为经验单独做控制台开关来关闭注入（缺省始终按索引注入；无仓则自然为空）。
- 不在本里程碑做已入库条目的批量作废工作流（单条编辑或日后删除即可）。
- 不按问题类型检索（索引可预留字段，查询仍只认 `target_menu`）。
