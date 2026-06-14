# 009. SelfDrivenMissionPlanner 归位与 decomposeTask 去重

**日期**: 2026-06-04
**状态**: 已采纳

## 背景

全自驱 Agent Team 需要一个组件：输入用户诉求 + 可用角色/工具/模型，输出动态多步工作流（含团队、loopKind、rubric、成本估算）。设计初稿称"复用并替换 `teams/orchestrator/dynamic-planning.ts`"。审视核实：`tryDynamicDecomposition()` 输入已有 `ITeam`、仅产 `ExecutionStep[]`，产不出 team/loopKind/rubric/estimate。同时 harness 已有 `Leader.decomposeTask`（role-aware LLM 分解），engine/planning 曾有 `TaskDecomposerService` 因 0 注入于 2026-04-30 被删。

## 决策

1. **新建 `SelfDrivenMissionPlanner`**，归 `harness/teams/orchestrator`（接口放新建 `teams/orchestrator/abstractions/`）。`dynamic-planning.ts` 仅作分解逻辑参考，**非薄包装**。
2. 产出**扩展既有 `MissionExecutionPlan`**（追加 roleAssignments/rubric/deliverableType），**不引入平行 `MissionPlan`**；在 `capability-singleton.spec.ts` 锁唯一权威。
3. **role-agnostic 步骤分解核心下沉 `engine/planning`**；harness `decomposeTask` 改薄封装（注入 availableRoles 后调 engine 核心），一份 prompt 避免双轨漂移。

## 理由

- 据实表述工作量，避免 P1 低估（"复用替换"误导）。
- 同名概念全项目唯一（MECE）：扩展 MissionExecutionPlan 而非新建平行接口。
- engine 新原语**有确定注入方**（Planner + decomposeTask ≥2 处），不重蹈 0 注入死代码。

## 影响

- 正面：分层干净、复用最大化、避免分解 prompt 漂移。
- 负面/风险：P1 工作量大于初估（从零建 LLM 规划器）；engine/planning 新原语须确保被真实注入（spec 防回归）。

## 替代方案

- 直接改造 `dynamic-planning` → 否决：能力差距过大，等于重写还背历史包袱。
- 新建平行 `MissionPlan` 接口 → 否决：违反同名唯一。
