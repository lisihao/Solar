# 全自驱 Agent Team

> 跨聚合能力文档簇：用户在 AI 问答选 `Self-Driven Team` 伪模型 → Harness 自驱（模型选择/团队组建/工作流编排/验收标准/执行/交付）。
> 与 `teams/business-team` 框架**同源**、与 Agent Playground **平级**（同为 harness mission 原语的消费方），取 `teams/orchestrator` 动态编排路径。

## 文档列表

- [self-driven-agent-team-design-2026-06-04.md](self-driven-agent-team-design-2026-06-04.md) — **主设计方案 v1.1**（已通过四视角审视 GO，5 条 major 已闭合）
- [design-review-2026-06-04/](design-review-2026-06-04/summary.md) — 多路集中审视产出（architecture / mece-boundary / feasibility-gaps / safety-cost-dx + summary）

> 命名说明：`design-review-2026-06-04/` 为标准化评审簇格式（视角名 + 综合 summary），与既有 `wave-N-review-*` 先例同型、去掉波次前缀。

## 关联 ADR

- [009 — SelfDrivenMissionPlanner 归位与 decomposeTask 去重](../../../decisions/009-self-driven-mission-planner-placement.md)
- [010 — HITL 采用阶段边界 gate](../../../decisions/010-self-driven-hitl-stage-gate.md)
- [011 — 交付件组装收口 orchestrator/IDeliveryGenerator](../../../decisions/011-deliverable-generation-placement.md)

## 相关资源

- 同型能力先例：[../coding-agent/](../coding-agent/coding-agent-feasibility-and-roadmap.md)
- mission 运行时契约：[../lifecycle/mission-runtime-contract.md](../lifecycle/mission-runtime-contract.md)
- 入口侧（薄壳）：[../../ai-app/ask/teams-mode.md](../../ai-app/ask/teams-mode.md)
