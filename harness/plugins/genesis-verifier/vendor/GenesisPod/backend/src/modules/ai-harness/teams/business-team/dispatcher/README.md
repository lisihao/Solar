# business-team / dispatcher

Mission dispatcher framework：`emitToBus` + `bridgeOrchestratorStageEvent` 通用 runtime-glue。

## 含

- `business-team-mission-dispatcher.framework.ts` — `BusinessTeamMissionDispatcherFramework`（P2；orchestrator stage event → business event bus 桥接 + step id 映射 hook）
- `abstractions/business-team-mission-dispatcher.interface.ts` — `BusinessTeamMissionDispatcherConfig` / `OrchestratorStageEventLike` / `BusinessTeamMissionBusEvent` / `MapStepIdHook`

## 业务侧应如何继承

`PlaygroundPipelineDispatcher extends BusinessTeamMissionDispatcherFramework`：注入 `mapStepId` hook（业务 stage number → 业务 step id）+ event bus 实例。social / radar 同款模式。

## 历史

- 2026-05-24 P2：从 playground / social / radar 三家 `pipeline-dispatcher.service` 公共部分抽出（`@migrated-from`）。
