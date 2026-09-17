---
name: fix-frontend-ticket
description: edit-frontend-only-in-mapped-localroot
---

# 修前端工单

只在映射决议得到的 `localRoot` 内修改前端代码。禁止改其它工作区，禁止在错误目录检出另一条产品 jinan。

禁止把工单状态改成 `现场验证`。开 MR 之后平台状态保持 `处理中`，由人审合入。
