# AI Harness — Sediment Topology

**Status:** Canonical reference for benchmark Agent Team consumers.
**Source:** Extracted from `docs/architecture/ai-app/agent-playground/agent-team-boundary-audit-2026-05-08.md` §2.5 (Rev 5 — 2026-05-09 三轮审议共识).
**Owner:** ai-harness architecture WG.

---

## 1. Why this document exists

`ai-harness` is **not** a single sediment area. New benchmark Agent Team(MissionPipeline 派)consumers — `playground`（前端路由 `agent-playground`）、`writing-team`、未来的 `debate-team` / `planning-team` 等 — 必须知道:

- 哪些 zone 是 **canonical**(facade 暴露给新 team 主消费的 surface);
- 哪些 zone 是 **foundational**(底层 primitive,被 canonical zone 内部依赖,facade 也直接 re-export 部分公开符号);
- 哪一区是 **parallel / 待裁定**(目前无 ai-app 消费,benchmark **不**消费,等独立 ADR)。

**重要**:无论 zone 角色如何,新 team **所有 ai-harness import 路径必须为 `@/modules/ai-harness/facade`**(由 lint Section 10 强制);本文档说明 facade 暴露的 symbol 来自哪个 sediment 区,**不**是直接 import 子路径授权。

不写明这些区分,新 team 会随机选 zone import,要么落在 deprecated 处,要么自造 wrapper 与现有 sediment 冲突。本文档把审计 §2.5 的拓扑共识固化为可独立引用的架构条目。

---

## 2. Six Sediment Zones

| Zone                                    | Path                                      | Role                                                                                                                                                                                                                                                                                                                  | Canonical for benchmark?                                                                                                                                     |
| --------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Z1 Mission-lifecycle primitives**     | `ai-harness/lifecycle/mission-lifecycle/` | 通用 mission 持久化 + 执行原语:`IMissionStore<TBusiness>` / `MissionRerunOrchestrator` / `InMemoryMissionStore` / `MissionLivenessGuard` / `AbortRegistry` / `OwnershipRegistry` / `RuntimeStateStore` / `HealthMonitor` / `RerunLockRegistry`                                                                        | ✅ Foundational(被 Z3 内部依赖,公开符号经 facade re-export 给 ai-app services)                                                                               |
| **Z2 Mission-checkpoint**               | `ai-harness/memory/mission-checkpoint/`   | `CheckpointStore` 接口 + `checkpoint.service` + in-memory impl                                                                                                                                                                                                                                                        | ✅ Foundational                                                                                                                                              |
| **Z3 BusinessAgentTeam framework**      | `ai-harness/teams/business-team/`         | E0–E4 框架:`MissionRuntimeShellFramework`(per-mission lifecycle wrap,7 项守护:wallTimer / heartbeat / abort / cleanup / billing / validateModels / validateCredits)+ `EventRelayFramework`(namespace-injected 事件转发)+ `IBusinessTeamMissionStore`(7 个 lifecycle 方法子集)+ `RerunGuard` / `BusinessTeamSpec` 聚合 | ✅ Canonical(R1 新轨 benchmark 落点)                                                                                                                         |
| **Z4 Mission pipeline orchestrator**    | `ai-harness/teams/orchestrator/pipeline/` | `MissionPipelineOrchestrator` + `MissionPipelineRegistry` + `MissionPipelineConfig` + stage hooks 类型                                                                                                                                                                                                                | ✅ Canonical(playground 与 writing-team 同时消费)                                                                                                            |
| **Z5 Stage primitives**                 | `ai-harness/teams/services/stages/`       | `StagePrimitive` 接口 + `plan` / `persist` / `research` / `assess` / `synthesize` / `draft` / `review` / `signoff` / `learn` 内置 primitive + `cross-stage-state` 抽象                                                                                                                                                | ✅ Canonical(stage-level 复用)                                                                                                                               |
| **Z6 Mission executor (process-style)** | `ai-harness/lifecycle/manager/`           | `IMissionExecutor` / `MissionExecutorService`,以 `ProcessId` 为中心                                                                                                                                                                                                                                                   | ⚠ **Parallel — 与 Z3/Z4 重叠**;benchmark 不消费,待裁定。Z6 去向(并入 Z3 / 标 deprecated / 留作 process-level 上层)由独立 ADR 决定。**TBD: pending ADR-NNNN** |

**补充(不在 benchmark 范围)**:`ai-harness/teams/{abstractions, base, factory, registry, constraints, collaboration}/` 是早期 R1 抽象层(`TeamConfig` / `WorkflowConfig` / 内置角色 / 工具),被 WorkflowConfig 派 ai-app 消费(`ai-app/teams/teams/debate-team.config.ts` 等 6 个 config),与 Z3/Z4 不冲突;benchmark Agent Team 不消费这一层。

---

## 3. Topology(实际依赖关系)

ai-app benchmark consumer **逻辑上**与 5 个 zone(Z1 / Z2 / Z3 / Z4 / Z5)发生 use 关系
(并非单一 stack,而是平行 use);**实际 import 路径必须为 `@/modules/ai-harness/facade`**
(由 `backend/.eslintrc.js` Section 10 强制),5 zone 是 facade 内部 re-export 的逻辑分区,
本文档用于让新 team 知道"facade 暴露的 symbol 来自哪个 sediment 区"。

```
   ai-app/<team>(business 语义)
   │
   └─ import via @/modules/ai-harness/facade ──┐
                                               │
        逻辑 use 关系(facade 内部 re-export):  │
        ├─ Z3 business-team framework          │  facade re-exports:
        │   └─ uses ─→ Z1.AbortRegistry(唯一向下边)   MissionRuntimeShellFramework
        ├─ Z4 mission-pipeline-orchestrator           EventRelayFramework
        │   └─ uses ─→ Z5(仅 type:CrossStageState)   IBusinessTeamMissionStore
        ├─ Z5 stage primitives                        MissionPipelineOrchestrator
        ├─ Z1 mission-lifecycle primitives             MissionPipelineRegistry
        └─ Z2 mission-checkpoint                       IMissionStore / InMemoryMissionStore
                                                       MissionLivenessGuard
   Z6(executor)在拓扑外 — benchmark 不消费,待裁定。     CheckpointStore / ...
```

### Grep-verified edges(2026-05-09 验证)

- **Z3 → Z1**(唯一向下边,且仅一项 abort-registry):
  - `ai-harness/teams/business-team/lifecycle/mission-runtime-shell.framework.ts:24` → `MissionAbortRegistry from "../../../lifecycle/mission-lifecycle/abort-registry"`
  - `ai-harness/teams/business-team/relay/event-relay.framework.ts:24` → `MissionAbortRegistry from "@/modules/ai-harness/lifecycle/mission-lifecycle/abort-registry"`
- **Z4 → Z5(仅 type)**:
  - `ai-harness/teams/orchestrator/pipeline/mission-pipeline-orchestrator.service.ts:20` → `import { CrossStageState } from "../../services/stages/abstractions"`
  - `ai-harness/teams/orchestrator/pipeline/mission-pipeline-registry.service.ts:15-16` → `import { ALL_STAGE_PRIMITIVES } from "../../services/stages"; import type { IStagePrimitive } from "../../services/stages/abstractions"`
  - **Z4 不依赖 Z1 / Z2**(grep 命中 0)
- **Z5 闭环**(只 import 自身 `./abstractions`):
  - `ai-harness/teams/services/stages/{plan,persist,research,assess,synthesize,draft,review,signoff,learn}.primitive.ts` 全部仅 import `./abstractions`
  - **Z5 不依赖 Z1 / Z2**(grep 命中 0)
- **Z1 / Z2 自包含**(被 Z3 局部依赖 + 公开符号通过 facade re-export 给 ai-app,**不**经 Z3/Z4 中转)
- **Z6 在拓扑外**:`ai-harness/lifecycle/manager/teams-mission-orchestrator.ts` import Z1 `RuntimeStateStore`,但无任何 ai-app 消费 Z6,benchmark 不引用

### Consumer 现状(grep verified)

- `ai-app/playground` 跨 **Z1+Z3+Z4** 消费:
  - `services/mission/lifecycle/mission-store.service.ts` 结构性 satisfies `IBusinessTeamMissionStore`(Z3)
  - dispatcher 注入 `MissionPipelineOrchestrator`(Z4)
  - heartbeat 由 `MissionRuntimeShellFramework`(Z3)接管
- `ai-app/writing-team` 跨 **Z1+Z4** 消费(**未触及 Z3**):
  - `writing-team.service.ts:16` import `IMissionStore`(Z1)
  - `writing-team.service.ts:18` import `MissionPipelineOrchestrator`(Z4)
- **WorkflowConfig 派(`ai-app/teams/teams/*` / `ai-app/research/teams/*` / `ai-app/insight/teams/*` / `ai-app/office/teams/*`,共 6 个 config)**消费 `WorkflowConfig`(`ai-harness/facade`)早期抽象层,**不**触达 Z1–Z6 中任意一区,benchmark 不计入第二消费者。

---

## 4. Canonical import surface(给新 benchmark team 的拷贝指引)

新 MissionPipeline 派 team **所有 ai-harness import 都必须走 `@/modules/ai-harness/facade`**
(由 `backend/.eslintrc.js` Section 10 强制,任何 ai-app 子路径 import `ai-harness/{lifecycle,memory,teams}/**`
均 lint error)。本表说明 facade 之上的**业务 import 分层规则**,目的是防止 mission/stage 概念
逆向污染 agent/role/tool primitive。

| ai-app 层                  | 允许 import                                                                                                 | 禁止 import                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **`<team>/services/**`\*\* | `@/modules/ai-harness/facade`(逻辑覆盖 Z1 / Z2 / Z3 / Z4 / Z5 公开符号)+ 本 app 内部代码                    | 任何 `ai-harness/{lifecycle,memory,teams}/**` 子路径(由 Section 10 强制)                                                     |
| **`<team>/agents/**`\*\*   | **仅** `@/modules/ai-harness/facade`(`AgentSpec` / `DefineAgent` / `BUILTIN_*`)+ 本 app 内部 primitive 代码 | 任何 `ai-harness/teams/**` / `ai-harness/lifecycle/mission-lifecycle/**`(R8 强制)+ 本 app 业务 service 层 mission-aware 类型 |
| **`<team>/skills/**`\*\*   | **仅** `@/modules/ai-harness/facade` + 本 app 内部 primitive 代码                                           | 任何 `ai-harness/teams/**` / `ai-harness/lifecycle/mission-lifecycle/**`(R8 强制)+ 本 app 业务 service 层 mission-aware 类型 |

**重点**:三层都不允许 import `ai-harness` 子路径,差异在于"agents/skills 即使是本 app
代码,也不能 import 业务 service 层的 mission-aware 类型"(防止 mission 概念向 primitive
逆向污染)。

R8 三组 mechanical 检查由 lint + grep gate 兜底:

- **ai-app/**/agents/** + ai-app/**/skills/\*\*\*\* → `backend/.eslintrc.js` Section 10(2026-05-08 落地)
- **ai-harness/agents/\*\*** → `backend/.eslintrc.js` 新增 R8 override(2026-05-09 Stage 0 落地)
- **ai-engine/\*\*** → `backend/.eslintrc.js` ai-engine override(禁止反向 import ai-harness)+ `scripts/ci/check-harness-namespace.sh` [ENGINE] grep gate(禁止 `Mission*`/`Stage*`/`Pipeline*`/`MissionRun*` 标识符 import)

补充:`ai-engine/**` 全树**不**含任何 mission-aware 类型 — 由 audit §6.4 + §6.5 + S0-6 grep gate 强制。

---

## 5. Topology-level issues 与解决路径

(摘自审计 §2.5.3,标 `[Topology]` 影响多消费者契约,标 `[Single-consumer lift mistake]` 仅影响 playground 一家的 lift 落点。)

| #      | 性质                             | 问题                                                                                                                                                                                                   | 解决方向                                                                                                                                                                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | `[Topology]` 多消费者契约共识    | 双 IMissionStore 接口:`Z1.IMissionStore<TBusiness>`(9 个 generic CRUD method)vs `Z3.IBusinessTeamMissionStore`(7 个 lifecycle method,**与 Z1 method 名互不重叠**),playground store 同时 satisfies 两者 | S2-7:用类型层 `IMissionStore<TBusiness> & IBusinessTeamMissionStore` **intersection** 表达"同一 store 的两个视角"(非 Pick<> 子集 — 两接口 method 名互补不重叠);doc 部分由 S0-8 在 Z3 interface JSDoc 显式声明 |
| **T2** | `[Topology]` 多消费者抽象选择    | 三套 mission 执行抽象:Z3 `MissionRuntimeShellFramework` / Z4 `MissionPipelineOrchestrator` / Z6 `IMissionExecutor`                                                                                     | Z6 去向另立 ADR,本审计不在 Z6 上做 lift。**ADR 锚点:TBD: pending ADR-NNNN**                                                                                                                                   |
| **T3** | `[Single-consumer lift mistake]` | dispatcher 用 class body 字段(`lastPlan` / `lastResearcherResults` / `s4PatchFailures`)绕过 Z1+Z5 既有抽象                                                                                             | S1-2:迁移到 `Z1.IMissionStore.saveCrossStageState/getCrossStageState` + `Z5.cross-stage-state.ts`(prisma 列若暂无,先用 Z1 `RuntimeStateStore` in-memory 兜底)                                                 |
| **T4** | `[Single-consumer lift mistake]` | dispatcher 用 `CHECKPOINT_AT` 自管 timing,绕过 Z2 `CheckpointStore`                                                                                                                                    | S2-2:接入 Z2,`CHECKPOINT_AT` 字面值留 app 作为业务决策                                                                                                                                                        |
| **T5** | `[Single-consumer lift mistake]` | dispatcher 自实现 `cleanupOrphanRunningMissions` 调度,绕过 Z1 `MissionLivenessGuard` + `OwnershipRegistry`                                                                                             | S2-3:调度面归 Z1,持久化 hook(`cleanupOrphanRunningMissions`)留 Z3 业务接口                                                                                                                                    |

---

## 6. 维护规则

- 本文档变更必须经 ai-harness architecture WG approval。
- 任何新 sediment zone 加入(Z7+)需走 ADR 流程,且必须在本文档 §2 + §3 同步登记 + grep-verified edges 列出。
- 任何 zone 的 canonical/foundational/parallel 标注变更等同于 boundary 决策,需走审议流程。
- Z6 "TBD: pending ADR-NNNN" 在对应 ADR 落地后必须替换为实际 ADR 链接。
- 本文档与 `docs/architecture/ai-app/agent-playground/agent-team-boundary-audit-2026-05-08.md` §2.5 保持同步;若审计文档 §2.5 后续修订,本文档同步。
