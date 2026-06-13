# 007. Agent Teams 呈现标准化 - 迁到 agent-playground canonical（落实标准 21 P3）

**Date**: 2026-05-21
**Status**: ✅ Accepted + 实施中（四路两轮 4/4 共识，2026-05-21）。**BLK-7 gateway JWT 已修** `20e9d0e31`；**P0 事件调研已完成**（见设计 §4.1：adapter 强制必需 ~580 行 + cost/dimension 无源 → 本期略 Compute tab + 23 项功能映射底稿）。下一波 P1 泛化 useMissionStream
**评审纪要**: [features/2026-05-21-design-review-minutes.md](../features/2026-05-21-design-review-minutes.md)
**关联设计文档**: [features/ai-teams/presentation-migration-design.md](../features/ai-teams/presentation-migration-design.md)
**关联标准**: [.claude/standards/21-agent-teams-presentation.md](../../.claude/standards/21-agent-teams-presentation.md)（本 ADR = 其 §7 P3 的 ai-teams 落地）

## 背景

`ai-teams` 后端（Harness+Engine+Infra）已实现，但前端详情/执行页是 **3153 行自写 god-class**（`app/ai-teams/[topicId]/page.tsx`），未用 canonical。标准 21 已钦定 agent 团队类功能统一用 agent-playground 范式（事件流 → 纯函数派生 → 只读组件），并把 ai-teams 列为 P3 待迁移。用户要求做到 playground 式标准化呈现（Screenshot_100）。

## 决策

按标准 21 **完整迁移**（非仅视觉对齐）：

1. **实时**：用 `useMissionStream`（由 `useAgentPlaygroundStream` 泛化，与标准 21 P1 协同），不自写轮询。
2. **派生**：新增纯函数 `lib/features/ai-teams/deriveTeamsView(events)`（+ step-map + 必要时 events adapter），幂等可重放，**带 fixture 回归测试**。
3. **呈现**：复用 `components/common/mission-detail/`（Frame/StageStepper/MissionActionGroup）+ `common/team-topology`。
4. **标准化 Tab 体系（2026-05-21 评审补充）**：右侧 tab **业务定"展示哪些"、平台定"每个怎么呈现"**。把 tab 抽成 canonical（`common/mission-detail/tabs/`：TaskList/ActionLog/Report/References/Messages/Compute，分别复用 DataTable/report-viewer/citations/MessageCardShell），业务（ai-teams）只声明 `tabs: MissionTab[]`（选哪些 + 数据适配）。即 ai-teams **贡献 step-map + tab 选择/适配 + artifact renderer**，每个 tab 的呈现规则统一不自写。
5. **瘦页**：`page.tsx` < 100 行；旧 god-class 功能逐块映射后下线，不丢功能。

## 关键不确定项（P0 先调研）

ai-teams 后端现有事件模型与 `MissionEvent` 的差异 → 决定是否需要 `lib/features/ai-teams/adapt-events.ts` 适配层。**P0 调研产出事件映射表后再开 P2。**

## 顺序

用户已定 **[ADR-006] 对话整理先做**；本迁移随后启动，P0 事件调研可提前并行准备。

## 影响

- 大重构（3153 行 god-class → 薄页 + 派生 + 复用组件），分 P0–P4 波次。
- 收敛到标准 21，与 playground / ai-social 同框架，后续可被 component-placement / 标准 21 看护。

## 待评审（详见设计文档 §10）

事件调研结论 / artifact 渲染范围 / 是否合并标准 21 P1 / 旧页下线节奏（灰度 vs 一次切）。
