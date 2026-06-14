# business-team / rerun

Mission rerun framework：9-cell heartbeat decision + guard + cascade stage dispatcher + ctx-hydrator + runtime-builder + orchestrator。

## 含

- `heartbeat-decision.ts` — `decideMissionInFlight` 纯函数 + 阈值常量（E3；9-cell `[status × heartbeatAge × businessEventAge]` 决策矩阵）
- `business-team-rerun-guard.framework.ts` — `BusinessTeamRerunGuardFramework`（P5；checkInFlight + ensureRerunable + zombie cleanup）
- `business-team-stage-rerun-dispatcher.framework.ts` — cascade rerun 链路 runner（StageRerunHandler registry + hooks）
- `business-team-ctx-hydrator.framework.ts` — rerun 时业务 ctx 恢复 framework（schema provider hook）
- `business-team-rerun-runtime-builder.framework.ts` — rerun 专用 runtime session 装配
- `business-team-rerun-orchestrator.framework.ts` — 业务侧 rerun 入口编排（rate limit + guard 调用 + builder + dispatcher）
- `abstractions/` — `stage-rerun-handler.contract.ts` / `ctx-hydrator-schema.contract.ts` / `rerun-runtime-builder.contract.ts` / `rerun-orchestrator.contract.ts`

## 业务侧应如何继承

每个 framework 一次 extends，注入业务 hook（store 引用 / event prefix / stage handler 注册 / ctx schema 提供）。reference 实现：`ai-app/agent-playground/services/mission/rerun/` 6 件 service 全部 thin extends framework。

## 历史

- 2026-05-08 PR-E3：`decideMissionInFlight` 纯函数 + `IBusinessRerunGuard` 接口先上提
- 2026-05-24 P5：剩余 5 件 framework 抽自 `ai-app/agent-playground/services/mission/rerun/` （`@migrated-from`）
