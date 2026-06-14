# business-team / orchestrator

BusinessAgentTeam orchestrator skeleton：playground / social / radar 公共 stage iteration framework，不下沉 Tier 5 业务编排。

## 含

- `business-team-orchestrator.framework.ts` — `BusinessTeamOrchestratorFramework`（P7；bindSessionLookup / getEntry / buildHooksForStep dispatch / primitive→hook key adapter / abort signal 保护 / stageNumber lookup）
- `abstractions/business-team-orchestrator.contract.ts` — `BusinessTeamOrchestratorConfig` / `SessionLookupFn` / `StageRunner` / `StageRunnerArgs`
- `abstractions/stage-iteration.contract.ts` — `DEFAULT_PRIMARY_HOOK_BY_PRIMITIVE` map + `resolvePrimaryHookKey` 函数

## 业务侧应如何继承

```ts
@Injectable()
class PlaygroundBusinessOrchestrator extends BusinessTeamOrchestratorFramework {
  // 提供 PIPELINE.steps 业务 stage handler + business event payload + report assembly
}
```

framework 负责 stage 迭代 / hook 路由 / abort guard / session lookup；业务方仅提供具体 stage 实现。social/radar 同款模式。

## 历史

- 2026-05-24 P7（Wave-1）：从 playground/social/radar 三家 `business-orchestrator.service` 公共 skeleton 抽出（`@migrated-from`）。
