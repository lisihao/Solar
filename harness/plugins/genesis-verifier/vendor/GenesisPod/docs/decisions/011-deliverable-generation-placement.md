# 011. 交付件组装收口 orchestrator/IDeliveryGenerator（非 evaluation）

**日期**: 2026-06-04
**状态**: 已采纳

## 背景

自驱需"按交付件类型组装产出"。设计初稿把 `DeliverableComposer` 归 `harness/evaluation` 并称"泛化 `report-artifact-assembler`"。审视核实：evaluation 官方语义是质量评判（critique/verify/figure）；项目已有 `IDeliveryGenerator`（`orchestrator.interface.ts:341`，`generate(outputs, deliverableTypes)`）；assembler 的 `AssembleInput` 全是 report 专有字段，"泛化为 type 分发"是重抽象。

## 决策

1. **不**在 evaluation 新建 DeliverableComposer。**扩展既有 `IDeliveryGenerator`**（归 `harness/teams/orchestrator` 产出侧）。
2. v1 只接 **report projector**；report 专有字段保留，report 作为一个 projector 实现，**不强行泛化大接口**（YAGNI；扩展点写文档不写未用枚举/接口）。
3. evaluation 只留 rubric 验收判定（`RubricGenerator` 与 judge 同聚合，保留）。
4. **前置**：`report-artifact-assembler.service.ts:42-51` 4 处 ai-engine 内部路径直 import，接线前先补 facade export、违规清零。

## 理由

- 聚合名实相符（MECE）：输出装配属 delivery concern，非质量评判。
- 同名概念唯一：收口既有 `IDeliveryGenerator`，不造同义新名。
- YAGNI：v1 单 report 类型，不预付多 projector 抽象成本。

## 影响

- 正面：聚合职责清晰、复用既有接口、避免重抽象。
- 负面：多类型交付（PPT/code）后续接 projector 时需扩 `IDeliveryGenerator`，届时再抽 type-agnostic 边界。

## 替代方案

- 归 evaluation 泛化 assembler → 否决：名实不符 + 重抽象。
- 归 `business-team/projectors/` → 否决：该目录是 todo-board 视图投影，与交付投影无关。
