# business-team / helpers

Mechanism-only helpers：纯函数 / 静态函数式工具，业务方通过 thin shims 适配，不强制 extends。

## 含

- `business-team-batch-executor.helper.ts` — `executeBusinessTeamBatch`（P4；并发 per-item 执行 + pre-dispatch budget gate；`@migrated-from chapter-batch-executor.helper`）
- `business-team-supply-budget.helper.ts` — `computeSupplyBudget` / `deriveMaxDemandSlots` / `deriveMinPerSlot` / `extractGroupFromUrlOrText`（supply→demand slot 反死锁推导；`@migrated-from evidence-budget`）
- `business-team-axis-grade-grounding.helper.ts` — `groundMultiAxisGrade`（多 axis grade 重算 + supply-axis ceiling；`@migrated-from grade-grounding.util`）

## 业务侧应如何继承

不继承：直接 `import { executeBusinessTeamBatch } from "@/modules/ai-harness/facade"`，注入业务 logger + budget context 调用。`BusinessTeamBatchItem` / `BusinessTeamBatchContext` 等类型由业务侧填充。

## 历史

- 2026-05-24 P4（Wave-1）：从 ai-app `services/mission/workflow/` 提炼公共 mechanism，剥离业务知识后上提。
