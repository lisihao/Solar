# business-team / state

Cross-stage state typed wrapper：基于通用 `CrossStageState`，提供业务类型化的 get/set。

## 含

- `business-team-cross-stage-state.framework.ts` — `BusinessTeamCrossStageStateFramework`（P2；TypedKey schema 注入 + safe get/set）

## 业务侧应如何继承

```ts
class PlaygroundCrossStageState extends BusinessTeamCrossStageStateFramework<PlaygroundStateMap> {
  // 业务侧定义 PlaygroundStateMap = { dimensions: Dimension[]; reportArtifact: ReportArtifact }
}
```

framework 保证类型安全，业务方仅声明 state schema。

## 历史

- 2026-05-24 P2：从 `playground-cross-stage-state` 抽出（`@migrated-from`）。
