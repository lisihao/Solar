# business-team / bindings

Stage bindings 薄骨架：subclass 实现 `buildCtx` / `buildDeps`，framework 提供 degraded 标记 + 错误兜底。

## 含

- `business-team-stage-bindings.framework.ts` — `BusinessTeamStageBindingsFramework`（P2；buildCtx/buildDeps abstract + markStageDegraded 通用流程）
- `abstractions/business-team-stage-bindings.interface.ts` — `BusinessTeamStageBindings` 契约 + `MarkStageDegradedFn` 类型

## 业务侧应如何继承

```ts
@Injectable()
class PlaygroundMissionStageBindings extends BusinessTeamStageBindingsFramework {
  buildCtx(input) {
    /* 业务 stage context 拼装 */
  }
  buildDeps(input) {
    /* 业务 stage 依赖注入 */
  }
}
```

每个业务 stage 一个 binding 类；framework 负责 degraded 上报。

## 历史

- 2026-05-24 P2：从 `mission-stage-bindings.service` 抽出（`@migrated-from`），保留业务侧 buildCtx/buildDeps 实现。
