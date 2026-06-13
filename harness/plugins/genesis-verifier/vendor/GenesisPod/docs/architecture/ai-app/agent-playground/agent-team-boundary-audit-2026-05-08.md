# Agent Playground Agent Team Boundary Audit

**Date:** 2026-05-09
**Revision:** Rev 6 — Stage 0/1/3 实施完成回写(2026-05-09,Round 5 三人共识 + Stage 0/1 落地 main + Stage 3 docs 落地)。Rev 5 是设计共识的最终态;Rev 6 是实施完成态(无新设计变更,只回写实施事实 + Round 6/7/8/X/Y 实际签字记录)。
**Scope:** `backend/src/modules/ai-app/agent-playground` + `backend/src/modules/ai-harness/teams/**` + `backend/src/modules/ai-harness/lifecycle/**` + `backend/src/modules/ai-harness/memory/mission-checkpoint/**` + `backend/src/modules/ai-engine/**`(Rev 4 — 范围扩大)
**Goal:** Rev 1–3 已确立 `ai-app` 与 `ai-harness` 的二层边界共识;Rev 4 在此基础上系统审视 (a) `ai-harness` 内部沉淀拓扑,确保 benchmark 团队拷贝时有单一 canonical import surface;(b) `ai-engine` 与 mission-aware 类型 / agent-skill primitive 的双向隔离;(c) Stage 1/2 lift 决策对齐既有 sediment,避免在 `business-team/` 重复实现已存在他处的 wrapper。

**Review participants (Rev 3 → Rev 5,经 Round 3 + Round 4 + Round 5 三轮迭代,Round 5 三人一致 ✅):**

- Reviewer A — 代码事实核查;Round 3 ⚠ → Rev 4 反馈 → Rev 5 / Round 5 ✅(签字理由:WorkflowConfig 派 6 个 config 修正落地、§2.5.2 拓扑 grep 全部验证、S0-6 / S0-9 / S1-1 deliverable 表述清晰)
- Reviewer B — 架构边界批判;Round 3 ⚠ → Rev 4 反馈 → Rev 5 / Round 5 ✅(签字理由:7 项核心修订全部吸收 — 拓扑图、R8 主语、§9 import 分层、R1 mechanical 判定、T 性质标签、Stage 2 兜底、24 月长期失效)
- Reviewer C — 重构风险与排序;Round 3 ⚠ → Rev 4 反馈 → Rev 5 / Round 5 ✅(签字理由:5 项排序问题闭合 — S1-1 单一陈述、S2-7 doc 提前、S0-6 系列合并 + artifact 路径、Stage 2 1B 兜底、S0-9 deliverable、S1-2 prisma 注)

---

## 1. Executive Summary

`agent-playground` is already a strong **full-capability reference implementation** for Agent Team business flows, but it is **not yet the cleanest benchmark template**.

The current boundary state is:

- Most core runtime substrate that should live in `ai-harness` has already moved in the right direction; some of this work is **in-flight as of the audit date** (see §1.5).
- Business semantics that must stay in `ai-app` are mostly still in the right place.
- The main remaining problem is not "over-sinking business logic", but "team-runtime glue still left in app code".
- The risk now is the _opposite_ of premature abstraction: it is **continuing to compensate for framework gaps inside the app**.

Overall verdict:

| Question                                                                  | Verdict           |
| ------------------------------------------------------------------------- | ----------------- |
| Have the major runtime foundations been sunk?                             | Partly; in-flight |
| Has business semantics been kept out of harness/engine?                   | Yes, mostly       |
| Are all sink-worthy common capabilities already sunk?                     | No                |
| Is there serious over-sinking of business semantics?                      | No, not currently |
| Can this directory already be treated as the cleanest benchmark template? | Not yet           |

---

## 1.5 Current-State Fact Baseline (Rev 2 — added)

> 边界决策必须基于事实,而不是预测。本节列出审计当日的实际 consumer 与 in-flight 工作。

### 1.5.1 已存在的 ai-app consumers

| Consumer           | Path                       | 形态                                                                   | 消费的 harness 表面                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-playground` | `ai-app/agent-playground/` | 14-stage 完整 pipeline,benchmark team                                  | 全部 R1 primitives + 自带的 progress/checkpoint/orphan/rerun wrapper(尚在 app)                                                                                                                                                                                                                                                                                                                                                    |
| `writing-team`     | `ai-app/writing-team/`     | 3-stage demo,validates R1 framework                                    | **Value 耦合(3,运行时类)**:`MissionPipelineOrchestrator` / `MissionPipelineRegistry` / `InMemoryMissionStore` — 改签名即破坏(R1 直接约束)。**Type 耦合(4)**:`IMissionStore` / `MissionPipelineConfig` / `ResolvedStageHooks` / `StageRunArgs` — 纯 type import,R1 不直接约束。**Rev 4 注**:全部落在 Z1+Z4(见 §2.5),**未触及 Z3** business-team/,故"E1 EventRelayFramework / E0 ShellFramework 由 writing-team 验证"在结构上不可达 |
| `custom-agents`    | `ai-app/custom-agents/`    | 通过 `forwardRef` 复用 `agent-playground.PlaygroundPipelineDispatcher` | 隐式依赖 dispatcher 内部接口(非 harness 表面)                                                                                                                                                                                                                                                                                                                                                                                     |

**关键判读**:

- `writing-team` 已是真实第二消费方,**但只验证 R1-A generic primitives**;它**不消费** `withProgressTracking` / `STAGE_NUMBER` / `CHECKPOINT_AT` / `cleanupOrphanRunningMissions`。这些 wrapper 仍处于 1-consumer 状态。
- `custom-agents` 直接复用 `agent-playground` 的 dispatcher,这是**事实上的反向耦合**(consumer 通过 dispatcher 借道),不算独立的 harness 消费者,反而是文档需要正视的隐式耦合点。

### 1.5.2 In-flight 下沉工作(已部分上提到 `ai-harness/teams/business-team/`)

下表所有路径在 Rev 3 二轮事实核查中**通过 Glob 直接验证存在**(`ai-harness/teams/business-team/` 子树包含 4 个 interface 文件 + 3 个 framework 文件 + 对应 spec 文件)。

| Capability                       | 状态               | Commit / 文件(已验证存在)                                                                                                                     |
| -------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MissionRuntimeShellFramework`   | E0 已上提          | `ai-harness/teams/business-team/lifecycle/mission-runtime-shell.framework.ts` ✓                                                               |
| `EventRelayFramework`            | E1 已上提          | `ai-harness/teams/business-team/relay/event-relay.framework.ts` ✓                                                                             |
| Rerun heartbeat decision         | E2 已上提          | `ai-harness/teams/business-team/rerun/heartbeat-decision.ts` ✓                                                                                |
| `IMissionStore` interface        | 已声明,impl 留 app | `ai-harness/teams/business-team/abstractions/mission-store.interface.ts` ✓ (含 `cleanupOrphanRunningMissions` 必需方法,L55 — **非 optional**) |
| `business-team-spec` aggregation | E3–E4 已上提       | `ai-harness/teams/business-team/abstractions/business-team-spec.interface.ts` ✓ + `rerun-guard.interface.ts` ✓                                |

这意味着:已识别"应下沉"的项目中,有一部分**正处在迁移过程中**,而非"未开始"。文档对这部分应表述为"继续完成 in-flight 下沉",而不是"启动新的下沉决策"。

### 1.5.3 计划中的未来 team & 现存双轨(Rev 4 — 扩展)

`docs/architecture/ai-app/agent-playground/benchmark-app-plan.md` 与 `services/README.md` 明文列出预期未来 team:**writing-team(已 demo)、debate-team、planning-team**。这是判定"是否过早抽象"的事实依据。

**Rev 4 增补 — `ai-app/` 已存在两类 team 实现,benchmark 决策必须直面双轨**:

| Track                              | 代表                                                                                                                                                                                                                                                          | 消费的 harness 表面                                                                                                                | 状态                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **MissionPipeline 派**(R1 新轨)    | `agent-playground` / `writing-team`                                                                                                                                                                                                                           | Z1+Z3+Z4(详见 §2.5):`MissionPipelineOrchestrator` + `IMissionStore` + `MissionRuntimeShellFramework` + `EventRelayFramework`       | benchmark 候选             |
| **WorkflowConfig 派**(legacy 共存) | `ai-app/teams/teams/debate-team.config.ts` / `ai-app/research/teams/research-team.config.ts` / `ai-app/topic-insights/teams/topic-insights-team.config.ts` / `ai-app/office/teams/{report,slides,visual-design}-team.config.ts`(**6 个 config**,Rev 5 — 修正) | `WorkflowConfig` from `ai-harness/facade`(`BUILTIN_ROLES` / `BUILTIN_TOOLS` / `createConstraintProfile`) — **不消费 R1 substrate** | 既存,grep 验证 0 个引用 R1 |

**关键判读**:`benchmark-app-plan.md` 列的"debate-team"实际上已存在(`ai-app/teams/teams/debate-team.config.ts`),但停留在 WorkflowConfig 派,**并非 R1 新轨**。这意味着:

- §7 Stage 2 entry condition #1 的"第二消费者"门槛在双轨期内**应排除 WorkflowConfig 派**,只承认 MissionPipeline 派的 production 路径(Rev 4 — 收紧)。
- 双轨何时合并、由谁主导,**不在本审计范围**;但本审计的 lift 决策必须假设双轨长期共存,benchmark 仅代表 R1 新轨。

---

## 2. Boundary Decision Rules

Use the following rules to decide whether a concern belongs in `ai-app`, `ai-harness`, or `ai-engine`.

| #      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | If yes    | Destination                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------ |
| R1     | Will another Agent Team likely copy more than 70% of this logic unchanged? — **限定语境(Rev 2):** 仅当存在第二个真实 consumer 草案/迁移文档时才允许以"复用"论据下沉;否则按 R2/R6/R7 判断。**(Rev 4 — 过渡态豁免,Rev 5 — 加 mechanical 判定)** in-flight 迁移期豁免成立的判定:`git log --follow <interface-file>` 至少存在一次"老 consumer 已开始迁移"的 commit(grep `migrating to` / `adapter over` / `@migrated-from`)。瞬时 0 完成切换 consumer 时仍可推进,但必须始终满足 R6/R7;若 24 个月仍无第二 MissionPipeline 派 consumer,R1 失效,候选回退留 app(长期兜底) | Yes       | `ai-harness`                                     |
| R2     | Is this a runtime/execution/orchestration mechanism rather than product semantics?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Yes       | `ai-harness`                                     |
| R3     | Is this a single-call primitive or content/tool/model capability that does not need mission awareness?                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Yes       | `ai-engine`                                      |
| R4     | Does this logic encode `agent-playground` product semantics, mission schema, event names, or report meaning?                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Yes       | `ai-app`                                         |
| R5     | Would sinking this force other teams to inherit `agent-playground`-specific semantics?                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Yes       | Keep in `ai-app`                                 |
| **R6** | **Reverse-import rule (Rev 2 — added):** `ai-harness` MUST NOT import from `ai-app/*`;若必须 import 才能工作,该 capability **未真下沉**,应回退                                                                                                                                                                                                                                                                                                                                                                                                                    | Violation | Stop sinking                                     |
| **R7** | **Test-isolation rule (Rev 2 — added):** Sunk components MUST be unit-testable using harness-only fixtures, without booting any `ai-app` module                                                                                                                                                                                                                                                                                                                                                                                                                   | Violation | Stop sinking                                     |
| **R8** | **Agent / Skill primitive isolation (Rev 4 — added,Rev 5 — 主语统一):** `ai-app/**/agents/**` 与 `ai-app/**/skills/**`,以及 `ai-harness/agents/**`(含 `agents/skill-runtime/` 子树),仅允许 import `@/modules/ai-harness/facade` 暴露的 agent/role/tool 抽象与本目录代码;不得直接 import `ai-harness/teams/**` 或 `ai-harness/lifecycle/mission-lifecycle/**` 的 mission/stage/pipeline 类型(`ai-harness/skills/**` 不存在,Rev 5 — 修正口径)                                                                                                                       | Violation | Move import to facade,或上移到 app service layer |

In short:

- `ai-engine` answers: "what a single capability can do"
- `ai-harness` answers: "how agents and teams run"
- `ai-app` answers: "what this business team means"

R6 / R7 / R8 act as **mechanical guards**: they can be enforced by lint and test infrastructure (see §7 Stage 0)。R1 的限定语境防止单 consumer 投机抽象;R1 的 Rev 4 过渡态豁免允许 in-flight 迁移期不被自身规则反咬。R8 防止 mission/stage/pipeline 概念逆向污染 agent/role/tool primitive。

---

## 2.5 Harness Sediment Topology (Rev 4 — added)

`ai-harness` 不是单一沉淀区。Rev 1–3 隐含假设"沉淀 = 落到 `teams/business-team/`",这一假设在面对 Stage 2 lift 决策时会与既有沉淀冲撞:在 Z2 已有 `CheckpointStore` 的情况下还在 Z3 新建 checkpoint wrapper、在 Z1 已有 `MissionLivenessGuard` 的情况下还在 Z3 新建 orphan-cleanup invocation,会产生第二轮 duplication。本节给出当前实际拓扑,作为 §7 lift 决策的落点依据。

### 2.5.1 Six Sediment Zones

| Zone                                    | Path                                      | Role                                                                                                                                                                                                                                           | Canonical for benchmark?                                   |
| --------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Z1 Mission-lifecycle primitives**     | `ai-harness/lifecycle/mission-lifecycle/` | 通用 mission 持久化 + 执行原语:`IMissionStore<TBusiness>` / `MissionRerunOrchestrator` / `InMemoryMissionStore` / `MissionLivenessGuard` / `AbortRegistry` / `OwnershipRegistry` / `RuntimeStateStore` / `HealthMonitor` / `RerunLockRegistry` | ✅ Foundational(被 Z3 / Z4 / Z5 复用)                      |
| **Z2 Mission-checkpoint**               | `ai-harness/memory/mission-checkpoint/`   | `CheckpointStore` 接口 + `checkpoint.service` + in-memory impl                                                                                                                                                                                 | ✅ Foundational                                            |
| **Z3 BusinessAgentTeam framework**      | `ai-harness/teams/business-team/`         | E0–E4 框架:`MissionRuntimeShellFramework`(per-mission lifecycle wrap,7 项守护)+ `EventRelayFramework`(namespace-injected 事件转发)+ `IBusinessTeamMissionStore`(7 个 lifecycle 方法子集)+ `RerunGuard` / `BusinessTeamSpec` 聚合               | ✅ Canonical(R1 新轨 benchmark 落点)                       |
| **Z4 Mission pipeline orchestrator**    | `ai-harness/teams/orchestrator/pipeline/` | `MissionPipelineOrchestrator` + `MissionPipelineRegistry` + `MissionPipelineConfig` + stage hooks 类型                                                                                                                                         | ✅ Canonical(playground 与 writing-team 同时消费)          |
| **Z5 Stage primitives**                 | `ai-harness/teams/services/stages/`       | `StagePrimitive` 接口 + `plan` / `persist` 内置 primitive + `cross-stage-state` 抽象                                                                                                                                                           | ✅ Canonical(stage-level 复用)                             |
| **Z6 Mission executor (process-style)** | `ai-harness/lifecycle/manager/`           | `IMissionExecutor` / `MissionExecutorService`,以 `ProcessId` 为中心                                                                                                                                                                            | ⚠ **Parallel — 与 Z3/Z4 重叠**;benchmark 不消费,审计待裁定 |

补充(不在 Stage 2 lift 范围):`ai-harness/teams/{abstractions, base, factory, registry, constraints, collaboration}/` 是早期 R1 抽象层(`TeamConfig` / `WorkflowConfig` / 内置角色 / 工具),被 §1.5.3 WorkflowConfig 派消费,与 Z3/Z4 不冲突。

### 2.5.2 Topology(Rev 5 — 修正:实际为 ai-app 平行 import 5 个 zone,非单一 stack)

Rev 4 原图把"被 ai-app 同时 import 的多个 zone"误画为"Z3→Z4→Z1+Z2 stack"。grep 验证后纠正:

```
   ai-app/<team>(business 语义)
   │
   ├─ uses ─→ Z3 business-team framework  ─ uses ─→ Z1.AbortRegistry(唯一向下边)
   ├─ uses ─→ Z4 mission-pipeline-orchestrator  ─ uses ─→ Z5(仅 type:CrossStageState / IStagePrimitive)
   ├─ uses ─→ Z5 stage primitives(若需 PLAN_PRIMITIVE / PERSIST_PRIMITIVE)
   ├─ uses ─→ Z1 mission-lifecycle primitives(IMissionStore / InMemoryMissionStore / RerunOrchestrator / LivenessGuard / OwnershipRegistry)
   └─ uses ─→ Z2 mission-checkpoint(CheckpointStore)

   Z6(executor)在拓扑外 — benchmark 不消费,待裁定。
```

**关键事实(grep 验证)**:

- Z4(`teams/orchestrator/pipeline/`)只 import Z5 的 `abstractions/`(`CrossStageState` / `IStagePrimitive`)与自身 `./mission-pipeline-{config,registry}` — **Z4 不依赖 Z1 / Z2**。
- Z5(`teams/services/stages/`)各 primitive 只 import 本目录 `./abstractions` — **Z5 不依赖 Z1 / Z2**。
- Z3(`teams/business-team/`)的 `mission-runtime-shell.framework.ts:24` 与 `event-relay.framework.ts:24` 均 import `Z1.MissionAbortRegistry` — **Z3 → Z1 是唯一存在的向下边**(且仅一项 abort-registry,非全 Z1)。
- Z1 / Z2 / Z5 是 ai-app 直接平行消费的 foundational 原语,**不是经 Z3 / Z4 中转**。
- `writing-team.service.ts:16/18` 平行 import Z1(`IMissionStore`)+ Z4(`MissionPipelineOrchestrator`),**未触及 Z3** — 与上图一致。

### 2.5.3 已识别的拓扑级问题(Rev 5 — 区分性质标签)

| #      | 性质                             | 问题                                                                                                                                                                                                                       | 影响                                                             | 解决方向                                                                                                                                  |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | `[Topology]` 多消费者契约共识    | **双 IMissionStore 接口**:`Z1.IMissionStore<TBusiness>`(15+ 方法,泛型 CRUD + crossStageState + roleDecisions)vs `Z3.IBusinessTeamMissionStore`(7 个 lifecycle 方法,heartbeat 中心)。playground store 需同时 satisfies 两者 | benchmark consumer 必须维护双接口,新 team 拷贝时不知该实现哪一个 | S2-7:显式声明 `IBusinessTeamMissionStore` 为 `IMissionStore` 的 BusinessAgentTeam 视角子集(`Pick<IMissionStore, ...>` 或 README 显式注释) |
| **T2** | `[Topology]` 多消费者抽象选择    | **三套 mission 执行抽象**:Z3 `MissionRuntimeShellFramework`(per-mission lifecycle)、Z4 `MissionPipelineOrchestrator`(stage 编排)、Z6 `IMissionExecutor`(process-id 中心)。playground 用 Z3+Z4,Z6 无 ai-app 消费            | "benchmark import 哪一套"无单一答案;Z6 处于无主状态              | 本审计不在 Z6 上做 lift;Z6 去向(并入 Z3 / 标 deprecated / 留作 process-level 上层)由独立 ADR 决定,不阻塞本审计                            |
| **T3** | `[Single-consumer lift mistake]` | **跨 stage 状态有现成 Z1+Z5 抽象**(`IMissionStore.saveCrossStageState/getCrossStageState` + `Z5.cross-stage-state.ts`),dispatcher 仍用 class body 字段(L89-104)绕过                                                        | 仅影响 playground 单消费者的 lift 落点                           | S1-2 落点改为 Z1+Z5 现有抽象(详见 §7)                                                                                                     |
| **T4** | `[Single-consumer lift mistake]` | **CheckpointStore (Z2) 已存在**,dispatcher 用 `CHECKPOINT_AT` 自管 timing                                                                                                                                                  | 仅影响 playground 单消费者的 lift 落点                           | S2-2 落点改为 Z2(详见 §7)                                                                                                                 |
| **T5** | `[Single-consumer lift mistake]` | **MissionLivenessGuard / OwnershipRegistry (Z1) 已存在**,dispatcher 自实现 `cleanupOrphanRunningMissions` 调度                                                                                                             | 仅影响 playground 单消费者的 lift 落点                           | S2-3 落点改为 Z1 调度 + Z3 业务持久化 hook 分离(详见 §7)                                                                                  |

---

## 3. System Classification Table

### 3.1 Should Continue Sinking

These concerns are still too reusable to remain long-term in `agent-playground`. The `Phase` column distinguishes:

- **Lifted (verified)** — code merged AND validated by ≥ 1 independent consumer
- **Lifted (unverified)** — code merged, no second consumer has exercised it yet (do not treat as "settled")
- **In-flight** — migration in progress; finish it, do not start new lifts on top
- **Candidate** — must wait for §7 Stage 2 trigger conditions

| Component                                       | Current file                                                                           | Why it should sink                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Target layer                             | Phase / Stage ref                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission runtime shell framework                 | `services/mission/workflow/mission-runtime-shell.service.ts`                           | Already adapter-shaped over `MissionRuntimeShellFramework` (E0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `ai-harness`                             | **In-flight** (S0-7)                                                                                                                                                                                    |
| Event relay framework                           | `services/roles/agent-playground-event-relay.ts`                                       | 26-line `extends EventRelayFramework` thin wrapper (E1);**契约形状已强制业务 namespace 由 app 注入**,无 mission-aware 字面量泄露                                                                                                                                                                                                                                                                                                                                                                                                                            | `ai-harness Z3`                          | **Lifted (contract-final, Rev 4)** — 契约本身已挡掉唯一可能的业务泄露(命名空间字面量),mechanical 守护由 §6.4 + S0-6 兜底,**不再等待 2nd consumer**;writing-team 落 Z1+Z4 不触达 Z3,结构上无法由其"验证" |
| Rerun heartbeat decision                        | (already lifted)                                                                       | Lifted in E2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `ai-harness`                             | **Lifted (unverified)**                                                                                                                                                                                 |
| Mission store lifecycle interface               | `services/mission/lifecycle/mission-store.service.ts`                                  | Refresh heartbeat / mark failed / reopen / orphan cleanup are runtime contract; **app retains schema**。**(Rev 4 — T1 注)** Z1.`IMissionStore<TBusiness>`(generic CRUD + crossStageState + roleDecisions)与 Z3.`IBusinessTeamMissionStore`(lifecycle 子集)并存,benchmark 团队需同时 satisfies 两者 → 待 S2-7 显式声明子集关系                                                                                                                                                                                                                               | `ai-harness Z1+Z3`                       | **In-flight** (S0-7;关系裁定 S2-7)                                                                                                                                                                      |
| Stage progress wrapper _protocol_               | `playground-pipeline-dispatcher.service.ts` (`withProgressTracking`, L230)             | The wrapper _mechanism_ is reusable — calling `store.markStageComplete(n)` after a step succeeds                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ai-harness Z3`(mechanism)               | Candidate (S2-1)                                                                                                                                                                                        |
| Step→stage **mapping table** `STAGE_NUMBER`     | `playground-pipeline-dispatcher.service.ts` (L182)                                     | **DO NOT sink the literal map** — encodes product decisions like `s8b-quality-enhancement → 8` (two steps share one stage). Only the wrapping mechanism is generic.                                                                                                                                                                                                                                                                                                                                                                                         | Keep in `ai-app` (Rev 2 — corrected)     | n/a                                                                                                                                                                                                     |
| Checkpoint timing wrapper                       | `playground-pipeline-dispatcher.service.ts` (`CHECKPOINT_AT`, L200)                    | Same split: wrapper protocol may sink; **`CHECKPOINT_AT` set is a business milestone choice and stays in app**。**(Rev 4 — T4)** Z2 `CheckpointStore` + `checkpoint.service` 已存在,落点应为 Z2 而非 Z3 新建 wrapper                                                                                                                                                                                                                                                                                                                                        | `ai-harness Z2`                          | Candidate (S2-2)                                                                                                                                                                                        |
| Orphan/zombie running mission cleanup           | `playground-pipeline-dispatcher.service.ts` (`cleanupOrphanRunningMissions`, L292/301) | Common runtime governance concern. **Rev 3 fact-check correction:** the harness `IMissionStore` interface declares `cleanupOrphanRunningMissions` as a **required** method (`mission-store.interface.ts:55`, no `?`) — earlier "already optional" claim was wrong. The harness contract already encodes this responsibility; the candidate sink is the _invocation/scheduling_ surface, not the interface slot。**(Rev 4 — T5)** Z1 已有 `MissionLivenessGuard` + `OwnershipRegistry`,调度面归 Z1,持久化 hook(`cleanupOrphanRunningMissions`)归 Z3 业务接口 | `ai-harness Z1`(调度)+ `Z3`(持久化 hook) | Candidate (S2-3)                                                                                                                                                                                        |
| Hook wrapping & standard stage lifecycle bridge | `playground-pipeline-dispatcher.service.ts`                                            | Should not stay app-local once dispatcher is split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `ai-harness Z3`                          | Candidate (post-S1-1)                                                                                                                                                                                   |
| Rerun runtime builder                           | `services/mission/rerun/rerun-runtime-builder.service.ts`                              | Team rerun execution substrate;**(Rev 4)** Z1 已有 `MissionRerunOrchestrator`,Z3 builder 应组合 Z1.orchestrator,而非平行实现                                                                                                                                                                                                                                                                                                                                                                                                                                | `ai-harness Z3`(组合 Z1)                 | Candidate (S2-5)                                                                                                                                                                                        |
| Rerun guard / common in-flight governance       | `services/mission/rerun/rerun-guard.service.ts`                                        | Cross-team rerun governance. The interface intentionally avoids `CtxHydrator/StageRerunDispatcher` until a 2nd ai-app needs it; finish the lift, defer further abstraction.                                                                                                                                                                                                                                                                                                                                                                                 | `ai-harness Z3`                          | **In-flight** (S0-7)                                                                                                                                                                                    |
| Event replay / buffer framework contract        | `services/mission/lifecycle/mission-event-buffer.service.ts`                           | Buffer contract (FIFO + TTL + write-through) is generic; **the `accepts(namespace)` predicate MUST be injected by the app** — harness must not hold namespace literals like `"agent-playground."`                                                                                                                                                                                                                                                                                                                                                           | `ai-harness Z3` interface                | Candidate (S2-4)                                                                                                                                                                                        |

### 3.2 Must Stay in `ai-app`

These are business semantics and should not sink into harness or engine.

| Component                                                           | Current file                                          | Why it must stay in app                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Event type namespace and payload semantics                          | `agent-playground.events.ts`                          | Product-level protocol consumed by frontend and mission UX       |
| Event schemas                                                       | `agent-playground.event-schemas.ts`                   | Business payload shape and validation rules                      |
| Pipeline roles/steps/DAG/rerunability                               | `playground.config.ts`                                | Business workflow definition                                     |
| REST interface                                                      | `agent-playground.controller.ts`                      | Product API surface                                              |
| WebSocket namespace/join semantics                                  | `agent-playground.gateway.ts`                         | Product realtime boundary                                        |
| Mission data model fields                                           | `services/mission/lifecycle/mission-store.service.ts` | Business persistence schema                                      |
| Stage logic (14 stages, Rev 2 — corrected)                          | `services/mission/workflow/stages/*`                  | Business script, not runtime substrate; README count out of date |
| Role service semantics                                              | `services/roles/*.service.ts`                         | Business role meaning and method vocabulary                      |
| Agents, duties, soul, skills                                        | `agents/*`, `skills/*`                                | Product-specific mission behavior                                |
| Leader chat semantics                                               | `services/chat/leader-chat.service.ts`                | Business conversational contract                                 |
| Mission export semantics                                            | `services/export/mission-export.service.ts`           | Product output contract                                          |
| **`STAGE_NUMBER` / `CHECKPOINT_AT` literal values (Rev 2 — added)** | `playground-pipeline-dispatcher.service.ts`           | Encode product step→stage mapping & milestone choices            |

### 3.3 Boundary-Mixed / Needs Refactoring

| Component                                       | Current file                                                                                 | Mixed concerns                                                                                                                                                                                                                                                                                                                                                                                                                                       | Decision                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline dispatcher                             | `services/mission/workflow/playground-pipeline-dispatcher.service.ts` (1914 lines, verified) | Session registry (L133) + hook construction (L852/871) + STAGE_NUMBER (L182) + CHECKPOINT_AT (L200) + withProgressTracking (L230) + cleanupOrphanRunningMissions (L292/301) + frontend mapping (L445) + legacy wrappers (L1259–1518) + **cross-stage state cache fields declared at L89-L104** (`lastPlan` / `lastResearcherResults` / `s4PatchFailures`, with comment "legacy team.mission.ts 用 sharedState",referenced 30+ 处 across stage hooks) | **Stage 1: split inside app first** — produce two local services (`business-orchestrator` + `runtime-glue`); only sink runtime-glue after Stage 2 trigger conditions met                                                                                                                                                    |
| Stage bindings                                  | `services/mission/workflow/mission-stage-bindings.service.ts`                                | Giant dependency assembly plus app-specific ctx mapping                                                                                                                                                                                                                                                                                                                                                                                              | Narrow stage dependency contracts; keep only app-specific mapping                                                                                                                                                                                                                                                           |
| Mission deps                                    | `services/mission/workflow/mission-deps.ts`                                                  | Declares reusable phase groups but still exposes oversized aggregate deps                                                                                                                                                                                                                                                                                                                                                                            | Keep in app, but shrink signatures by phase/stage                                                                                                                                                                                                                                                                           |
| Stage rerun dispatcher                          | `services/mission/rerun/stage-rerun.dispatcher.ts`                                           | Mixes runtime cascade chain runner with business patch logic                                                                                                                                                                                                                                                                                                                                                                                         | **Before split:** produce a per-method classification (runtime cascade vs business patch) — current "likely mixes" is insufficient grounds for Stage 2 action                                                                                                                                                               |
| Skill registration path wiring                  | `agent-playground.module.ts` (L93, L166–170)                                                 | Two registration mechanisms: `EXTRA_SKILL_DIRS` token → `skills/built-in/` (**path does not exist**); `skillLoader.addSkillDirectory` → `skills/` (**valid, 17 SKILL.md subdirs**)                                                                                                                                                                                                                                                                   | Stage 0: collapse to the single valid `skills/` registration                                                                                                                                                                                                                                                                |
| **Custom-agents back-coupling (Rev 2 — added)** | `ai-app/custom-agents/` uses `forwardRef` to reach `PlaygroundPipelineDispatcher`            | Treats `agent-playground`'s dispatcher as a shared service — implicit reverse coupling                                                                                                                                                                                                                                                                                                                                                               | **(Rev 4 — 三选项)** (a) lift the needed surface to harness Z3;**(b) 提到 `ai-app/contracts/`(已存在跨 app 契约目录,含 `agent-catalog.ts` / `interfaces/data-export.interface.ts` / 10 个 skill 契约文档)作为跨 app 共享接口** — 推荐;(c) 承认 `custom-agents` 是 playground 的扩展 module 而非平级 ai-app,合并 module 边界 |

---

## 4. File-by-File Verdict Matrix

| File                                                                  | Verdict               | Action                                                                                                                    |
| --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `agent-playground.module.ts`                                          | Stage 0 fix           | Remove `EXTRA_SKILL_DIRS → skills/built-in` (invalid path); keep `skillLoader.addSkillDirectory({path: skills})`          |
| `agent-playground.controller.ts`                                      | Keep in app           | No sink                                                                                                                   |
| `agent-playground.gateway.ts`                                         | Keep in app           | No sink                                                                                                                   |
| `agent-playground.events.ts`                                          | Keep in app           | No sink                                                                                                                   |
| `agent-playground.event-schemas.ts`                                   | Keep in app           | No sink                                                                                                                   |
| `playground.config.ts`                                                | Keep in app + clean   | Stage 0: strip `PLAYGROUND_RUNTIME=legacy` / `team.mission.ts` / feature-flag stale comments                              |
| `services/README.md`                                                  | Stage 0 fix           | Remove `team.mission.ts` references (file deleted in `27350f494`); update stage count to 14                               |
| `services/mission/workflow/mission-runtime-shell.service.ts`          | **Done (adapter)**    | No new action; thin adapter over E0 framework                                                                             |
| `services/mission/workflow/playground-pipeline-dispatcher.service.ts` | **Stage 1 split**     | Split inside app; do NOT lift contracts to harness until Stage 2 trigger met                                              |
| `services/mission/workflow/mission-stage-bindings.service.ts`         | Partial keep          | Keep app ctx mapping, shrink dependency assembly surface                                                                  |
| `services/mission/workflow/mission-deps.ts`                           | Keep in app, reduce   | Replace mega aggregate use with phased contracts                                                                          |
| `services/mission/lifecycle/mission-event-buffer.service.ts`          | **Stage 2 candidate** | Keep business adapter/storage; `IBroadcastAdapter.accepts(namespace)` must be app-injected                                |
| `services/mission/lifecycle/mission-store.service.ts`                 | **In-flight**         | Continue: keep schema/model in app; finish lifecycle interface in harness; clarify `markFailed` truncation responsibility |
| `services/mission/rerun/rerun-runtime-builder.service.ts`             | Stage 2 candidate     | Move only after a 2nd team needs rerun                                                                                    |
| `services/mission/rerun/rerun-guard.service.ts`                       | **In-flight**         | Continue current minimal lift; **do not** abstract `CtxHydrator/StageRerunDispatcher` yet                                 |
| `services/mission/rerun/stage-rerun.dispatcher.ts`                    | Pre-split analysis    | Stage 1: produce per-method runtime/business classification before any split                                              |
| `services/roles/agent-invoker.service.ts`                             | Mostly appropriate    | Keep app façade if it preserves business-facing semantics                                                                 |
| `services/roles/agent-playground-event-relay.ts`                      | **Done (thin)**       | 26-line wrapper, no further action                                                                                        |
| `services/chat/leader-chat.service.ts`                                | Keep in app           | No sink                                                                                                                   |
| `services/export/mission-export.service.ts`                           | Keep in app           | No sink                                                                                                                   |
| `services/mission/workflow/stages/*` (14 files)                       | Keep in app           | No sink                                                                                                                   |
| `agents/*`, `skills/*`                                                | Keep in app           | No sink                                                                                                                   |

---

## 5. Current Boundary Problems

### 5.1 The primary problem is incomplete sinking, not over-sinking

The current architecture does **not** mainly suffer from business logic being pushed too low.

The real issue is:

- common team-runtime glue is still in app code
- `agent-playground` is still compensating for framework gaps
- the directory is therefore both a business app and a runtime patch layer

### 5.2 The dispatcher is a verified state-leakage hot spot

`PlaygroundPipelineDispatcher` is **1914 lines** (verified) and currently behaves as a mixed "business orchestrator + runtime integration hub + cross-stage state cache".

It owns at the same time:

- session registry (`private readonly sessions = new Map`, L133)
- hook construction (L852/871)
- stage success progress bookkeeping (`STAGE_NUMBER` L182, `withProgressTracking` L230)
- checkpoint saving (`CHECKPOINT_AT` L200)
- orphan mission cleanup (L292/301)
- frontend stage mapping (L445)
- legacy compatibility wrappers (L1259–1518)
- **cross-stage state cache** declared at L89-L104 (`lastPlan` / `lastResearcherResults` / `s4PatchFailures`),with the field's own comment admitting "legacy team.mission.ts 用 sharedState" — referenced 30+ times across stage hooks (verified). This is state-leakage, not just multi-responsibility.

The cross-stage cache makes this not "a normal large class" but a **boundary-violating state container**: stage scripts share state through dispatcher fields rather than through declared inputs/outputs. Any sink decision must address this first.

### 5.3 Documentation and assembly drift signals boundary instability

- `services/README.md` still references `team.mission.ts` (deleted in commit `27350f494`)— stage count 已在 §3.2 修正为 14
- `playground.config.ts` still contains `PLAYGROUND_RUNTIME=legacy` / `team.mission.ts` / feature-flag stale commentary
- `agent-playground.module.ts` registers `skills/built-in` via `EXTRA_SKILL_DIRS`, but **the path does not exist** (only `skills/` with 17 SKILL.md subdirs is valid)

These are not just doc issues; they indicate the system is still in a mid-migration boundary state。

### 5.4 Sinking work is in-flight (Rev 2 — added)

The audit must not be read as "nothing has happened". Recent commits `ffaf672b3 / 14f8e8ec9 / 6f94ebc33 / a1e18f5d3 / 6e5748846` (E0–E4) progressively lifted runtime-shell / event-relay / rerun-heartbeat / mission-store-interface / business-team-spec into `ai-harness/teams/business-team/`. Recommendations in §7 must distinguish **finishing in-flight work** from **starting new lifts**.

---

## 6. Target Boundary Model

### 6.1 What `ai-harness` should own

`ai-harness` should own all **team runtime substrate** that future business teams will reuse:

- mission session lifecycle ✅ in-flight
- runtime orphan/zombie cleanup contract (mechanism only)
- rerun runtime reconstruction (when a 2nd team needs it)
- standard stage lifecycle bridge (mechanism only)
- event replay/buffer framework contract (with app-injected `accepts` predicate)
- mission store lifecycle interface ✅ in-flight (schema stays in app)
- progress tracking & checkpoint **wrapper protocol** (NOT the literal step/stage tables)

### 6.2 What `ai-app/agent-playground` should own

`agent-playground` should own all **business semantics**:

- mission pipeline definition
- stage ordering and DAG semantics
- role/agent meaning
- event names and payload semantics
- mission persistence fields
- export/chat/report semantics
- built-in mission skills
- **`STAGE_NUMBER` / `CHECKPOINT_AT` literal values** (these encode product decisions)

### 6.3 What `ai-engine` should own

`ai-engine` should continue to own **single-capability primitives**, not mission semantics:

- skill loading, figure extraction, embeddings
- content/tool/model primitives that do not need team awareness

### 6.4 Falsifiable boundary checks (Rev 2 — added)

Each layer's ownership must be checkable mechanically. If any of the following appear, **the boundary is broken**:

| Layer        | Smell                                                                                                          | What it indicates                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| `ai-harness` | Any string literal matching `agent-playground.` or `s\d+[a-z]?-` step ids                                      | Business namespace leaked into harness                                |
| `ai-harness` | **Stage number literal comparison** — e.g. `if (stage === 8)` / `switch(stageNum)` over fixed integers (Rev 3) | Implicit dependency on product stage table; bypasses R6               |
| `ai-harness` | **DI token strings** prefixed `AGENT_PLAYGROUND` / `PLAYGROUND_` (Rev 3)                                       | Reverse reference via `@Inject(string)`,bypasses static `import` lint |
| `ai-harness` | `import .* from "ai-app/.*"`                                                                                   | Reverse coupling — capability is not actually sunk                    |
| `ai-harness` | Test cannot run without booting an `ai-app` module                                                             | R7 violation — capability is not actually sunk                        |
| `ai-app`     | Re-implements progress/checkpoint/orphan-cleanup mechanisms locally                                            | Framework gap; lift the mechanism (not the values)                    |
| `ai-app`     | **Cross-stage state cache fields on dispatcher class body** matching `lastPlan                                 | lastResearcherResults                                                 | s4PatchFailures` (Rev 3) | Hidden boundary-violating state container (S1-2) |
| `ai-engine`  | Imports anything mission-aware (`Mission*`, `Stage*`, `Pipeline*`)                                             | Engine has been polluted with team semantics                          |

These checks are designed to be enforced by ESLint `no-restricted-imports` and lightweight grep-based CI checks (see §7 Stage 0)。

### 6.5 Agent / Skill primitive isolation (Rev 4 — added,Rev 5 — 修正口径)

为防止 mission/stage/pipeline 概念逆向污染 agent/role/tool primitive,本审计追加一组 import 隔离断言(对应 R8):

| 检查                                                                                                                                                                  | 通过条件                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| `ai-app/**/agents/**/*.ts` 与 `ai-app/**/skills/**/*.ts` 仅 import `@/modules/ai-harness/facade` 与本 app 内部                                                        | grep `from .\*ai-harness/(teams    | lifecycle/mission-lifecycle)` 命中 0 |
| `ai-harness/agents/**`(含 `agents/skill-runtime/` 子树,Rev 5 — 修正:`ai-harness/skills/**` 不存在)只 import `@/modules/ai-harness/facade` 暴露的 agent/role/tool 抽象 | grep `from .\*teams/(business-team | orchestrator)` 命中 0                |
| `ai-engine/**` 不出现 `Mission*` / `Stage*` / `Pipeline*` / `MissionRun*` 标识符                                                                                      | grep 命中 0                        |

事实基线(2026-05-09 验证):

- `agent-playground/agents/**` 16 处 import 全部落 `@/modules/ai-harness/facade`(`AgentSpec` / `DefineAgent` / `BUILTIN_*`)— 通过
- `agent-playground/skills/**` 0 行 `ai-harness` import — 通过
- `ai-harness/skills/**` 路径不存在,口径已在 Rev 5 修正
- 这是**当前已成立的隔离**,缺乏 mechanical 守护,后续重构容易回退;Stage 0 加 ESLint 锁定(S0-8 / S0-6 系列)。

---

## 7. Recommended Refactor Plan (Rev 2 — restructured into stages with trigger conditions)

The plan is reorganized into three stages. Each stage has explicit **entry** and **exit** conditions. Mixing stages is the failure mode the original Rev 1 plan suffered from.

### Stage 0 — Uncontroversial cleanup (do now, ~1 sprint)

**Entry:** none.
**Exit:** all items below merged; CI enforces R6/R7 on new code.

| #    | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Outcome                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S0-1 | Remove `EXTRA_SKILL_DIRS → skills/built-in` (invalid path); keep `skillLoader.addSkillDirectory({path: skills})` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Single source of truth for skill registration                                                                                       |
| S0-2 | Strip stale migration commentary from `playground.config.ts` and `services/README.md` (`team.mission.ts`, `PLAYGROUND_RUNTIME=legacy`, feature-flag prose)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Doc/code architectural truthfulness                                                                                                 |
| S0-3 | Update `services/README.md` stage count to 14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Eliminate count drift                                                                                                               |
| S0-4 | **Add ESLint `no-restricted-imports`** preventing `ai-harness/**` from importing `ai-app/**` (R6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Mechanical reverse-coupling guard                                                                                                   |
| S0-5 | **Add minimal contract tests** covering current `IMissionStore` and `MissionPipelineOrchestrator` surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Lock current behavior before any restructuring                                                                                      |
| S0-6 | **(Rev 5 — 合并 S0-6 / S0-6b / S0-8 系列,统一为 mechanical guard suite,并附 artifact 落地路径)** 在 `backend/eslint.config.js` 加 `no-restricted-imports` rule + 在 `scripts/ci/check-harness-namespace.sh`(新建)落 grep gate suite,覆盖以下 6 项:(1) `ai-harness/**` 不得 import `ai-app/**`(R6);(2) `ai-harness/**` 不出现 `agent-playground.` 命名空间字面量、step-id regex(`s\d+[a-z]?-`)、stage-number 字面比较(`stage === \d+` / `switch(stageNum)`)、`AGENT_PLAYGROUND_` / `PLAYGROUND_` DI token 字符串(Rev 3 §6.4);(3) `PlaygroundPipelineDispatcher` class body 不出现 `lastPlan` / `lastResearcherResults` / `s4PatchFailures` 字段声明(Rev 3 S1-2 closes);(4) `ai-app/**/agents/**`、`ai-app/**/skills/**`、`ai-harness/agents/**` 不得 import `ai-harness/teams/**` 与 `ai-harness/lifecycle/mission-lifecycle/**`(R8 / Rev 4 / Rev 5 主语统一);(5) `ai-engine/**` 不出现 `Mission*` / `Stage*` / `Pipeline*` / `MissionRun*` 标识符(§6.4 / §6.5);(6) 每条规则在 PR CI 必须 green | 一份 mechanical guard suite + 两个 artifact(`eslint.config.js` rule block + `scripts/ci/check-harness-namespace.sh`),全部规则可机检 |
| S0-7 | **In-flight closure** _(not a representative Stage 0 activity, listed here for completeness — these E-series lifts started before this audit and are best closed before Stage 1)_: finish `IMissionStore` lifecycle interface lift; **codify** existing `markFailed` truncation contract (interface comment at `mission-store.interface.ts:64` already states "由业务方决定截断长度,reference impl: 2000 chars" — caller-side; just promote that to a typed JSDoc so it cannot drift)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Closes E-series migration; does NOT establish a precedent for Stage 0 doing cross-layer lifts                                       |
| S0-8 | **(Rev 5 — 提前 doc-only,从 S2-7 拆出)** 在 `Z3.IBusinessTeamMissionStore` interface 顶部 JSDoc 显式声明"BusinessAgentTeam 视角的 `IMissionStore` 子集",列出 7 个 lifecycle 方法对应的 Z1 来源(若来自 Z1)+ 1 个 BusinessAgentTeam 专有方法(若有);doc-only 工作,不改任何运行时代码                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Closes T1 doc 部分,不阻塞 S2-7 的 `Pick<>` 类型层(后者仍按 Stage 2 执行)                                                            |
| S0-9 | **(Rev 5 — added,§8 #13 deliverable)** 创建 `docs/architecture/ai-harness/facade/sediment-topology.md`,固化 §2.5 6 个 sediment zones 的 canonical / foundational / parallel 标注 + Z6 去向 ADR 链接位置(若 ADR 尚未存在,标 `TBD: pending ADR-NNNN`);从 §2.5 抽取拓扑图 + 拓扑边 grep 证据落地为长期可引用的架构文档                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 防止 §2.5 拓扑共识只活在审计文档里,benchmark consumer 可独立 reference                                                              |

### Stage 1 — App-internal restructuring (1–2 sprints; do NOT touch harness public surface)

**Entry:** Stage 0 exit.
**Exit:** dispatcher split inside app; `writing-team` and the split `agent-playground` both green for ≥ 2 sprints with no public-surface regressions.

| #    | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Outcome                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| S1-1 | **(Rev 5 — 单一陈述,deliverable 明确)** dispatcher 拆分为两个 app-local service:(a) `playground-business-orchestrator.service.ts` — 持有 stage scripts / semantics / `STAGE_NUMBER` / `CHECKPOINT_AT` 字面量;(b) `playground-runtime-glue.service.ts` — 持有 sessions Map / hooks 装配 / progress wrap / orphan cleanup 调度,**Stage 1 留 app**,Stage 2 按 S2-1 / S2-3 / S2-4 lift 到对应 zone。**注**:Z3 `MissionRuntimeShellFramework` 已覆盖 wallTimer / heartbeat / abort / cleanup / billing / validateModels / validateCredits 共 7 项守护(`mission-runtime-shell.framework.ts:41-120` 验证),dispatcher 通过 `mission-runtime-shell.service.ts` adapter 已走 Z3,S1-1 不再重复 7 项实现 | 拆出 2 个文件,deliverable 明确,Stage 2 lift 时不必再做拆分      |
| S1-2 | **(Rev 4 — refined destination,closes T3;Rev 5 — 加 prisma 工作量注)** Eliminate cross-stage state cache fields(`lastPlan` / `lastResearcherResults` / `s4PatchFailures`),迁移到既有抽象:**Z5 `cross-stage-state.ts`**(运行时态)+ **Z1 `IMissionStore.saveCrossStageState/getCrossStageState`** 持久化端口。**(Rev 5 注)** 若 playground 的 prisma `agent_playground_mission` schema 暂无 `crossStageState` 列,先以 Z1 `RuntimeStateStore`(in-memory)兜底,prisma 落地另立 ticket,**不阻塞 S1-2**                                                                                                                                                                                             | 复用既有 cross-stage 抽象,closes T3;prisma 落地分开管理避免低估 |
| S1-3 | Shrink `mission-deps` and `mission-stage-bindings` from mega aggregates to phase-specific deps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Clearer app boundary                                            |
| S1-4 | Per-method classification of `stage-rerun.dispatcher.ts` (runtime cascade chain runner vs business patch logic) — output a written split plan, do not split yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Replaces "likely mixes" with evidence-based decision            |
| S1-5 | Document the resolution of `custom-agents` back-coupling (either lift the consumed surface, or write an explicit removal plan with a date)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Removes an undeclared cross-app dependency                      |

### Stage 2 — Cross-layer sinking (gated by trigger conditions; possibly Q3+)

**Entry — at least one of {1A, 1B} must hold,且 {2, 3} must hold(Rev 5 — 重整,加兜底分支):**

**1A — Second-consumer test (Rev 4 — 收紧;Rev 5 — 不变,主路径)**:存在 `ai-app/<team>` 目录,满足:

- 是**独立 mission pipeline**(stage script tree 不与 `agent-playground` / `writing-team` 共享)、
- 含至少一条 **production 代码路径**(非 `*.spec.ts` / `*.mock.ts` / `__tests__/**`)直接调用候选 wrapper、
- 调用 PR 已 merged to main、
- **消费 Z3 / Z4 substrate via MissionPipeline 派 import 路径**(详见 §1.5.3);**WorkflowConfig 派 6 个 team(`ai-app/teams/teams/debate-team.config.ts` / `research/teams/research-team.config.ts` / `topic-insights/teams/topic-insights-team.config.ts` / `office/teams/{report,slides,visual-design}-team.config.ts`)即使存在,亦不计入第二消费者** — 它们消费的是早期 `WorkflowConfig` 抽象层,不触达 Z3/Z4。
  `writing-team` 与其 extension 不单独满足此项 — 共享 writing-team stage tree 的 extension 仍计为一个 consumer。

**1B — Doc-anchored 兜底(Rev 5 — added,防止 Stage 2 永久 stuck)**:若 1A 在候选 wrapper 的 contract-final 后 ≥ 6 个月仍不成立,可改以以下条件入场:

- §6.4 全部 mechanical smell + §6.5 R8 + S0-6 所有 grep gate / lint **持续 ≥ 2 sprint 0 报警**、
- `docs/architecture/ai-harness/facade/sediment-topology.md`(由 S0-9 落地)merged ≥ 2 sprint 且包含本候选 wrapper 的目标 zone 标注、
- harness 端 contract test suite ≥ 2 sprint 0 修改(只允许新增)。
  兜底分支 lift 不享 R1 的"复用论据";若 24 个月内仍无 1A 出现,候选回退留 app(R1 长期失效条款,见 §2 R1)。

**2 — Interface stability (mechanically defined,不变)**:候选 Stage-1 interface,

- `git log --follow <interface-file>` 在 ≥ 2 sprints 内 **零 breaking-change commit**、AND
- 覆盖该 interface 的 contract test suite 在同窗口内 **零修改**(只允许新增)。

**3 — Contract-doc-first (不变)**:harness 端 contract 文档已 **merged to `docs/`** _在_ code-lift PR 开启之前,且获得至少一位第二消费者维护者(1A 路径)/ harness owner(1B 路径)approval。

**(原 #4 已合并)** "R6/R7/R8 lints from Stage 0 are still green" 是 1A / 1B 都默认覆盖的必要前置(B 反馈:lint 不绿则任何 PR 都进不去 main),不再单列。

**Exit:** harness exposes the contract; both apps consume via adapters; R6/R7 lints prevent regression.

| #    | Action                                                                                                                                                                                                                                                                                      | Outcome                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S2-1 | Lift the **progress-tracking wrapper protocol** (NOT the `STAGE_NUMBER` literal map) to **Z3**                                                                                                                                                                                              | Mechanism shared; product values stay in app                       |
| S2-2 | **(Rev 4 — refined,closes T4)** Dispatcher checkpoint timing 接入既有 **Z2 `CheckpointStore` + `checkpoint.service`**;`CHECKPOINT_AT` 字面值留 app 作为"哪些 stage 触发 checkpoint"的业务决策                                                                                               | 不在 Z3 新建 wrapper,closes T4;落点 Z2                             |
| S2-3 | **(Rev 4 — refined,closes T5)** Dispatcher orphan/zombie cleanup 调度委托 **Z1 `MissionLivenessGuard` + `OwnershipRegistry`**;`IBusinessTeamMissionStore.cleanupOrphanRunningMissions` 保留作为业务持久化 hook(各 team 自己的 mission 表 schema),**调度责任归 Z1,持久化责任归 Z3 业务接口** | 调度面归 Z1,持久化归业务,closes T5                                 |
| S2-4 | Lift `IBroadcastAdapter` for event buffer with **app-injected `accepts(namespace)`**                                                                                                                                                                                                        | Buffer container generic; namespace stays 在 app 侧;落点 Z3        |
| S2-5 | Lift `rerun-runtime-builder` substrate (only if a 2nd team has rerun needs);**(Rev 4)** Z3 builder 应组合 Z1 既有 `MissionRerunOrchestrator`,而非平行实现                                                                                                                                   | Shared rerun execution layer;Z3 = 组合,Z1 = 原语                   |
| S2-6 | Execute the `stage-rerun.dispatcher` split per the S1-4 written plan                                                                                                                                                                                                                        | Evidence-based, not speculative                                    |
| S2-7 | **(Rev 4 — added,closes T1;Rev 5 — 与 S0-8 doc 部分配对)** 在 Z3.`IBusinessTeamMissionStore` 用 `Pick<IMissionStore, ...>` / `extends` 表达"BusinessAgentTeam 视角子集"(类型层强制约束)。**Entry condition**:S0-8 doc 部分已落、S2-1 / S2-2 / S2-3 都已落地,且 Stage 2 entry(1A 或 1B)成立  | 类型层固化子集关系,消除"benchmark 团队该 implement 哪个 store"歧义 |

### Stage 3 — Standardization (after Stage 2 stabilizes)

| #    | Action                                                | Outcome                                  |
| ---- | ----------------------------------------------------- | ---------------------------------------- |
| S3-1 | Turn benchmark layout into reusable team template     | New teams stop copying migration residue |
| S3-2 | Document benchmark invariants for future team modules | Reduce architecture drift                |

**Rev 6 — Stage 3 实施状态:** ✅ 完成,详见 §11.3。S3-1 / S3-2 不依赖 Stage 2 完成(均为 doc/template 工作,low risk),Stage 3 提前于 Stage 2 入场是经过审议的:doc 类工作可独立落地,Stage 2 受 entry condition 1A/1B 阻塞期间不影响 Stage 3 推进。

### Why this restructuring

The Rev 1 plan put architectural sinking (P0-1/2/3), an independent bug (P0-4), and doc hygiene (P0-5) at the same priority. That conflated **risk levels**. Rev 2:

- Demotes `progress / checkpoint / orphan` wrapper sinking from P0 to Stage 2 — they have **only one consumer** (`writing-team` does not use them).
- Promotes `R6/R7 lints + contract tests` from P2 to Stage 0 — they are mechanical guards that make every later stage falsifiable.
- Keeps in-flight items (E-series lifts) on the critical path so they don't stall.

---

## 8. Acceptance Criteria (Rev 2 — falsifiable form)

`agent-playground` can be considered the clean benchmark Agent Team only when the following are true. Each criterion must be **machine-checkable** or backed by a concrete artifact.

### Mechanically verifiable

1. ESLint `no-restricted-imports` rejects `ai-harness/**` importing `ai-app/**` (R6).
2. CI grep gate rejects `agent-playground.` namespace literals, step-id regexes, stage-number literal comparisons (`stage === \d+`), and `AGENT_PLAYGROUND_` / `PLAYGROUND_` DI token strings inside `ai-harness/**`.
3. `ai-harness/teams/business-team/**/*.spec.ts` runs without booting any `ai-app` module (R7).
4. Contract tests cover `IMissionStore` and `MissionPipelineOrchestrator` surfaces.
5. `writing-team` E2E spec passes against any harness change without modification.
6. (Rev 3 — added) CI grep gate rejects `lastPlan|lastResearcherResults|s4PatchFailures` field declarations on the `PlaygroundPipelineDispatcher` class body — closes S1-2。
7. **(Rev 4 — added,Rev 5 — artifact 落地)** S0-6 mechanical guard suite 已落地:`backend/eslint.config.js` 含 `no-restricted-imports` rule(R6 + R8) + `scripts/ci/check-harness-namespace.sh`(覆盖 §6.4 命名空间字面量 / step-id / stage-number / DI token / cross-stage cache fields / `ai-engine/**` mission-aware 标识符),PR CI 必须 green。
8. **(Rev 5 — added)** ESLint `no-restricted-imports` 主语完整覆盖 `ai-app/**/agents/**`、`ai-app/**/skills/**`、`ai-harness/agents/**`(R8 / §6.5 主语统一)。

### Artifact-backed

9. `PlaygroundPipelineDispatcher` 拆为两个 app-local service:`playground-business-orchestrator.service.ts` + `playground-runtime-glue.service.ts`,无 cross-stage state cache 字段(cross-stage 状态走 Z1+Z5 抽象,Rev 5 closes T3)。
10. `services/README.md` and `playground.config.ts` no longer reference `team.mission.ts`, `PLAYGROUND_RUNTIME=legacy`, or `skills/built-in`。
11. `custom-agents` cross-app coupling is either resolved 或 lift 到 `ai-app/contracts/`(Rev 4 — 推荐路径),或 has a written removal plan with a date。
12. `stage-rerun.dispatcher.ts` has a per-method runtime/business classification document。
13. **(Rev 4 — added,Rev 5 — deliverable 由 S0-9 完成)** `docs/architecture/ai-harness/facade/sediment-topology.md` 已 merged,固化 §2.5 6 个 sediment zones 的 canonical / foundational / parallel 标注 + Z6 去向 ADR 锚点(closes T2)。
14. **(Rev 4 — added,Rev 5 — 拆为 doc-only S0-8 + 类型层 S2-7)** `IBusinessTeamMissionStore`(Z3)在 interface JSDoc 显式声明为 `IMissionStore<TBusiness>`(Z1)的 BusinessAgentTeam 视角子集(S0-8 doc-only,Stage 0 即可),且 Stage 2 时以 `Pick<>` / `extends` 类型层固化(S2-7,closes T1)。

### Strategic

15. Business teams no longer copy runtime glue from this directory (verifiable when a 3rd MissionPipeline 派 team is added,Rev 4 — 限定派别;若 24 个月内无 3rd 出现,触发 R1 长期失效兜底,候选回退留 app)。

---

## 9. Final Judgement (Rev 4)

As of 2026-05-09, after三轮协同审议:

- `agent-playground` is **already a strong reference implementation**。
- It is **not yet the cleanest benchmark template**。
- The architecture is **closer to under-sunk common runtime glue than over-sunk business semantics** — but the _cure_ is sequencing-sensitive,且 lift 落点必须对齐既有 sediment(§2.5),不能默认全部沉到 `business-team/`(Z3)。
- Sinking work is **partially in-flight** (E0–E4 commits)。Recommendations distinguish _finishing in-flight work_ from _starting new lifts_。
- **(Rev 4)** `ai-harness` 内部存在 6 个共存 sediment zones,benchmark 决策必须指明落点 zone,而不是"沉到 harness";S1-2 / S2-2 / S2-3 / S2-5 落点已分别对齐 Z1+Z5 / Z2 / Z1 / Z3-组合-Z1。
- **(Rev 4)** `ai-engine` 与 agent/skill primitive 的隔离从 §6.4 的 smell 升级为 R8 形式 rule + 对应 ESLint 锁定(S0-8)。
- **(Rev 4)** 双 `IMissionStore` 接口关系(T1)进入 Stage 2 终结议题(S2-7)。
- **(Rev 4)** `ai-app/` 双轨现实(MissionPipeline 派 vs WorkflowConfig 派)纳入 Stage 2 entry condition,WorkflowConfig 派不计入第二消费者。

The correct strategy is therefore:

- **Stage 0:** mechanical guards(R6/R7/R8 + 6 个 grep gate)+ doc/assembly cleanup + finish in-flight `IMissionStore` lift。
- **Stage 1:** split the dispatcher _inside the app_ 按 §2.5 sediment topology 重新归位职责;cross-stage 状态走 Z1+Z5 既有抽象 — without touching harness public surface。
- **Stage 2:** only after entry condition **1A 或 1B** 满足(Rev 5 — added 兜底)且 Stage 1 已稳定,lift wrapper _mechanisms_(not literal value tables)to **the right sediment zone**(Z2 for checkpoint / Z1 for orphan-cleanup invocation / Z3 for progress wrapper / Z3 组合 Z1 for rerun)。
- **Always:** business semantics — including `STAGE_NUMBER` / `CHECKPOINT_AT` literal values — stay in `ai-app`。

That is the correct boundary direction for making `agent-playground` the benchmark Agent Team for GenesisPod,**canonical import surface 分层声明(Rev 5)**:

- **app 的 `services/` 层** 可直接 import 5 个 sediment zone(Z3 + Z4 主轨,带 Z1 / Z2 / Z5 作为 foundational 原语 — 详见 §2.5 实际拓扑,非经 Z3/Z4 中转);
- **app 的 `agents/` / `skills/` 层** 仅走 `@/modules/ai-harness/facade`(R8 / §6.5 强制) — 防止 mission 概念逆向污染 agent/role primitive;
- **`ai-engine/**`\*\* 全树不含任何 mission-aware 类型(§6.4 + §6.5 强制)。

新 team 拷贝时按以上分层 import,即可获得清晰的"哪些层走 facade、哪些层走 sediment zone"指引,避免 Rev 1–3 隐含的"全部沉到 Z3"假设。

---

## 10. Review Trail

### Round 1 — independent parallel review (Rev 1 → Rev 2)

| Reviewer | Lens                            | Key contribution                                                                                                                                      |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | Code fact-check                 | Verified file paths, symbol locations, 1914-line dispatcher composition, in-flight E0–E4 commits, `writing-team` and `custom-agents` consumer reality |
| B        | Architectural boundary critique | Surfaced rule gaps (R6/R7), `STAGE_NUMBER` value-vs-mechanism conflation, `accepts` predicate leak, `markFailed` truncation responsibility            |
| C        | Refactor risk & sequencing      | Restructured the plan into Stage 0/1/2 with trigger conditions; demoted single-consumer sinks; promoted mechanical guards                             |

### Round 2 — sign-off review (Rev 2 → Rev 3)

Each reviewer re-read Rev 2 and only checked whether their Round-1 positions were faithfully reflected and whether the new structure introduced any regressions. All three returned **⚠ 有保留** (no ❌ blocking objections).

| Reviewer | Round-2 reservations resolved in Rev 3                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A        | All 4 fact items re-verified by direct Grep/Read in Rev 3 prep; one error corrected (`cleanupOrphanRunningMissions` is **required**, not optional, on `IMissionStore`); `writing-team` consumed surface expanded to all 7 imported symbols; cross-stage cache fields anchored to L89-L104                                                                          |
| B        | §6.4 smell table extended with stage-number literal comparison + `AGENT_PLAYGROUND_` / `PLAYGROUND_` DI token strings; Stage 2 entry condition #1 given mechanically-checkable definition; `event-relay` Phase relabeled "Lifted (unverified)" with explicit semantics                                                                                             |
| C        | S0-7 reframed as "in-flight closure" (explicitly NOT a Stage 0 precedent); Stage 2 entry conditions #1, #2, #3 all given mechanical criteria (independent pipeline / git-log + contract-test stability / contract-doc merged before code); §8 grep rule for cross-stage cache fields added (§8 #6); `Phase / Stage ref` column in §3.1 cross-references S- numbers |

### Round 3 — sediment-topology + engine-boundary review (Rev 3 → Rev 4)

第三轮聚焦 Rev 3 未触达的两个盲区:(a) `ai-harness` 内部沉淀拓扑(发现 6 区共存 + Z6 无主 + 三套并行 mission 执行抽象);(b) `ai-engine` 与 mission-aware 类型 / agent-skill primitive 的隔离(Rev 3 仅在 §6.4 列为 smell,未提升为 rule)。Rev 4 为本轮交付。**三人均返回 ⚠**,具体见下表 Round 4 反馈。

| Reviewer | Round-3 contributions(写入 Rev 4)                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | 6 个 sediment zone 路径与 symbol 全部 Glob/Read 验证存在;Z3 framework 实际覆盖 7 项守护(`mission-runtime-shell.framework.ts:41-120`);writing-team symbol 区分 value 耦合 / type 耦合;`agent-playground/agents/**` import 全部落 `ai-harness/facade` |
| B        | §6.4 中的 ai-engine smell 升级为 R8 形式 rule + 增补 §6.5;§2.5 加拓扑图与 6 zones 表;双 `IMissionStore` 关系升级为 T1 拓扑级议题                                                                                                                    |
| C        | S1-1 改为"职责按已存在 harness 落点归位";S1-2 / S2-2 / S2-3 / S2-5 lift 落点分别对齐 Z5+Z1 / Z2 / Z1 / Z3 组合 Z1;新增 S2-7 / S0-8;Stage 2 entry condition #1 增"WorkflowConfig 派不计入第二消费者"约束                                             |

### Round 4 — sign-off review (Rev 4 → Rev 5)

第四轮三人独立复审,**全员返回 ⚠**(无 ❌),Rev 5 完整吸收 7 项关键修订:

| Reviewer | Round-4 reservations resolved in Rev 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A        | WorkflowConfig 派 file 数从 "7" 修正为 **6**(实际:debate / research / topic-insights / report / slides / visual-design);其余 7 项事实声明全部 ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B        | (1) §2.5.2 拓扑图 grep 验证后**重画**:Z4 不依赖 Z1,Z5 不依赖 Z1 / Z2,Z3 → Z1 仅一项 abort-registry,实际为"ai-app 平行 import 5 个 zone";(2) `ai-harness/skills/**` 路径**不存在**,R8 / §6.5 主语统一为 `ai-app/**/agents/**` + `ai-app/**/skills/**` + `ai-harness/agents/**`;(3) R1 过渡态豁免加 mechanical 判定(`@migrated-from` commit 存在);(4) T1 / T2 标 `[Topology]`,T3 / T4 / T5 标 `[Single-consumer lift mistake]`,避免被误认为多消费者教训;(5) §9 加 services 层 vs agents/skills 层 import 区分;(6) Stage 2 加 1B doc-anchored 兜底分支;(7) §7 entry condition 4 合并入 1A/1B 默认必要前置 |
| C        | (1) S1-1 改为"拆 2 个具名文件" 单一陈述;(2) S2-7 doc 部分**前移**为 S0-8 doc-only,运行时 `Pick<>` 实施留 S2-7;(3) S0-6 / S0-6b / S0-8(原)合并为统一 mechanical guard suite,落地 artifact 路径 `backend/eslint.config.js` + `scripts/ci/check-harness-namespace.sh`;(4) 新增 S0-9 创建 `docs/architecture/ai-harness/facade/sediment-topology.md`(§8 #13 的 deliverable);(5) S1-2 加 prisma 兜底注(若 schema 暂无 `crossStageState` 列,先用 Z1 `RuntimeStateStore` in-memory)                                                                                                                           |

### Round 5 — final sign-off (Rev 5,2026-05-09)

三位 reviewer 在 Rev 5 上独立复审,**全员返回 ✅**(无 ⚠ / ❌)。consensus 达成,审计闭合。

| Reviewer | Round 5 签字理由(独立验证)                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | §1.5.3 6 个 config / §2.5.2 拓扑图 / Z4 不依赖 Z1·Z2 / Z5 不依赖 Z1·Z2 / Z3→Z1 仅 abort-registry 一项 — 全部 grep 验证;`ai-harness/skills/**` 路径不存在确认;S0-6 / S0-9 / S1-1 deliverable 表述清晰(允许 "未存在 + 列为 deliverable" 的逻辑)                                                                 |
| B        | 7 项核心修订全部吸收:§2.5.2 拓扑重画、R8 主语三处对齐、§9 import 三段式分层、R1 mechanical 判定、T 性质 `[Topology]` / `[Single-consumer lift mistake]` 切割、Stage 2 entry 1A/1B 双路径 + 6 月触发 / 24 月长期失效双时窗、原条 4 合并入必要前置                                                              |
| C        | 5 项排序问题全部闭合:S1-1 单一陈述 + 2 个具名 service file deliverable;S2-7 doc 部分前移为 S0-8(Stage 0 即可)+ 类型层留 S2-7;S0-6 系列合并 + artifact 路径(`backend/eslint.config.js` + `scripts/ci/check-harness-namespace.sh`);Stage 2 1B 兜底分支;S0-9 sediment-topology.md deliverable;S1-2 prisma 兜底注 |

### Round 6 — Stage 0 实施审议(Rev 5 设计 → Stage 0 落地)

Stage 0 实施完成后第一轮独立审议。三人初轮 ⚠/⚠/⚠,经 2 轮 fixup commit (`70fac2b25` + `8f99ec157`)收敛。

| Reviewer | Round 6 reservations resolved                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | §1.5.3 WorkflowConfig 派 6 个 config 文件全部 grep 存在;9 项事实声明全部 ✅;1 灰区(playground.config.ts L9 historical comment 残留 PLAYGROUND_RUNTIME / team.mission.ts 字面量,描述删除史 — 不阻塞)                                                                                                     |
| B        | (key) sediment-topology.md §3/§4 与 lint Section 10 矛盾(原写"平行直接 import",lint 强制 facade-only)→ 修订为"facade-only,5 zone 是 facade re-export 逻辑分区";(nit) `Pick<IMissionStore, ...>` 表述不准 — Z3 7 method 与 Z1 9 method 互不重叠,改为 intersection;(nit) [STEPID] / [DI-TOKEN] regex 范围 |
| C        | (1) `scripts/ci/check-harness-namespace.sh` 加 `--stage-0-mode` advisory flag([S1-2] 命中 warn 不 fail,Stage 1 完成后转 strict);(2) `docs/architecture/ai-harness/README.md` 加 sediment-topology 引用;(3) PR description 明示 advisory mode 状态                                                       |

### Round 7 — Stage 0 sign-off(Rev 5 + Round 6 fixups → ✅)

A ✅ / B ⚠(留 backend/src/modules/ai-harness/README.md 也加 sediment-topology link)/ C ✅。

### Round 8 — Stage 0 final sign-off(commit `b5796bde3` 闭合 B reservation → ✅)

B ✅ — `backend/src/modules/ai-harness/README.md` 已加 "benchmark Agent Team 沉淀拓扑" 节,链接 sediment-topology.md。Stage 0 三人 ✅,merge to main commit `67c3f3935`。

### Round X — Stage 1 实施审议(Stage 1 落地 → ✅)

Stage 1 commits `5100efb5a`(S1-1/S1-4/S1-5)+ `af8f9f50d`(S1-2)+ `3fbd76ea3`(cross-state unit spec follow-up)。

| Reviewer | Round X 签字理由                                                                                                                                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | 4 个新文件落地(business-orch / cross-state / mission-platform.contract / classification doc);dispatcher 1914 → 1067 行(减 847);business-orch 862 行;1685/1685 specs pass;grep gate strict 7/7 green;business-orch 零 import 具体 dispatcher;custom-agents 解耦完整 — 1 advisory(TARBALL pre-existing,与 Stage 1 无关)   |
| B        | dispatcher / business-orch 边界符合 audit Rev 5 §7 S1-1 (a)/(b) 分类;bindSessionLookup pattern 单向依赖;PlaygroundCrossStageState wrapper 是 Z5 typed view,reference semantics 等价 ad-hoc fields;mission-platform.contract IMissionRunner 用 unknown 符合 Dependency Inversion;S1-3 deferral 与 PR-7b W22 主线规划一致 |
| C        | (initial ⚠) 缺 PlaygroundCrossStageState 单元 spec → fixup commit `3fbd76ea3` 落地 10/10 spec 验证 reference semantics + JSON roundtrip → ✅;commit 拆分顺序合理(先类边界后内字段);dispatcher 减重不失清晰职责;S1-3 deferred 不影响 Stage 1 exit                                                                        |

merge to main(via `2b93fbbeb` 并发 wiki commit 合并附带,parents `cbcb9743f` + `3fbd76ea3`)。

### Round Y — Stage 3 实施审议(Stage 3 落地 → ✅)

Stage 3 deliverables(`benchmark-agent-team-template.md` + `benchmark-agent-team-invariants.md` + Rev 6 audit doc 实施回写)在 Round Y 三人共识 ✅,详见 Stage 3 commit message。

### Consensus status (Rev 5 设计共识 final + Rev 6 实施完成回写)

**Rev 5 是本审计设计共识的最终文档状态**;**Rev 6 是实施完成回写**(无新设计变更,只补 Stage 0/1/3 实施事实 + Round 6/7/8/X/Y 实际签字记录)。

实施已完成范围:Stage 0 ✅(commit `67c3f3935`)+ Stage 1 ✅(commit `2b93fbbeb`,stabilization 期 ≥ 2 sprints 在 main 上观察)+ Stage 3 ✅(本 Rev 6)。

实施 deferred 范围:Stage 2 ⏸(gated by entry 1A 第二消费者 OR 1B doc-anchored 6 月窗口);Stage 1 mission-deps signature 收窄 ⏸(deferred to PR-7b W22 主线波次)。

Open items (not blockers, but flagged for future revision):

- §2.5 Z6(`IMissionExecutor`)去向(并入 Z3 / 标 deprecated / 留作 process-level 上层)需独立 ADR — Rev 5 — S0-9 sediment-topology.md 中预留 ADR 锚点 `TBD: pending ADR-NNNN`,本审计不在 Z6 上做 lift。
- §3.1 `heartbeat-decision` "Lifted (unverified)" 待第二 MissionPipeline 派 consumer(由 1A 路径满足)或 1B doc-anchored 路径(Rev 5)。
- §3.3 `stage-rerun.dispatcher` Rev 6 — S1-4 per-method classification doc 已落地 `docs/architecture/ai-app/agent-playground/stage-rerun-dispatcher-classification.md`(commit `5100efb5a`,9 method 三类拆分);Stage 2 split execution 仍 gated by Stage 2 entry condition 1A/1B。
- §3.3 `custom-agents` back-coupling Rev 6 — 已选 (b) `ai-app/contracts/` 路径并执行,详见 commit `5100efb5a` 的 `mission-platform.contract.ts`(MISSION_RUNNER / MISSION_LIST_READER tokens + IMissionRunner / IMissionListReader interfaces),依赖反转闭环。
- §1.5.3 双轨(MissionPipeline 派 vs WorkflowConfig 派)长期共存策略,不在本审计范围;Rev 5 已加 R1 长期失效条款(24 个月)兜底。
- **Rev 6 — Stage 1 stage signature 收窄(原 S1-3 mission-deps + stage-bindings)deferred 到 PR-7b W22 主线波次**(audit 原 mission-deps.ts 注释规划),不影响 Stage 1 exit;phase-specific types(`PlanDeps` / `ResearchDeps` / ...)已在 `mission-deps.ts` declared,stage signature 改造留 W22 PR。

Consensus points (✅), reconciled disagreements (⚠), and items deferred as open questions are encoded throughout §1.5、§2.5、§3、§6、§7、§8、§11。

---

## 11. Implementation Status (Rev 6 — 实施完成回写)

设计阶段(Rev 1–5)以 Round 1–5 共识确立;实施阶段(Stage 0/1/3)经 Round 6/7/8 + Round X(Stage 1)+ Round Y(Stage 3)最终 ✅,merged 到 main。本节回写实施事实,**不引入新设计变更**。

### 11.1 Stage 0 实施状态:✅ Complete

**Merge commit:** `67c3f3935 merge: stage 0 boundary audit deliverables (4 commits, 4-round consensus)`(2026-05-09)。

**Round 6 → Round 7 → Round 8 三轮迭代后三人 ✅**(详见 §10 Round 5–8 trail)。

| #    | Deliverable                                                                                                                    | Commit / Path                                                                                             | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ |
| S0-1 | 删除 `EXTRA_SKILL_DIRS → skills/built-in` invalid 注册                                                                         | `agent-playground.module.ts`(in `f414ef4cc`)                                                              | ✅     |
| S0-2 | 清理 `playground.config.ts` + `services/README.md` 残留 PLAYGROUND_RUNTIME / team.mission.ts                                   | `f414ef4cc`                                                                                               | ✅     |
| S0-3 | services/README stage count 12 → 14                                                                                            | `f414ef4cc`                                                                                               | ✅     |
| S0-5 | contract test:`backend/src/modules/ai-harness/__tests__/contract/sediment-zone-surface.contract.spec.ts`(11 tests,R7 合规)     | `f414ef4cc`                                                                                               | ✅     |
| S0-6 | mechanical guard suite(`backend/.eslintrc.js` Section 10 + R8 override + `scripts/ci/check-harness-namespace.sh` 7 grep gates) | `f414ef4cc`(suite)+ Round 6 fixup `70fac2b25`(`--stage-0-mode` advisory flag)                             | ✅     |
| S0-7 | `markFailed` 截断契约 codified to JSDoc                                                                                        | `f414ef4cc` `mission-store.interface.ts` JSDoc                                                            | ✅     |
| S0-8 | `IBusinessTeamMissionStore` JSDoc 显式声明为 `IMissionStore<TBusiness>` BusinessAgentTeam 子集(intersection 表述)              | `f414ef4cc` `mission-store.interface.ts` JSDoc + Round 6 fixup `70fac2b25`(intersection 措辞)             | ✅     |
| S0-9 | `docs/architecture/ai-harness/facade/sediment-topology.md`(208 行,6 sediment zones + grep-verified edges)                      | `f414ef4cc` + Round 6 fixup `8f99ec157`(facade-only wording)+ `b5796bde3`(backend ai-harness/README 链接) | ✅     |

**Stage 0 acceptance criteria(§8)实际状态**:1–6 mechanically green;7–8 ESLint + grep gate suite already enforces;9–11 artifact-backed deliverables 全部落地(`PlaygroundPipelineDispatcher` 拆分由 Stage 1 完成);15(strategic)等 3rd consumer 出现验证。

### 11.2 Stage 1 实施状态:✅ deliverables merged / ⏸ exit pending ≥ 2 sprints stabilization observation

**Merge commit:** `2b93fbbeb`(并发 wiki 工作合并附带 my Stage 1,parents `cbcb9743f` + `3fbd76ea3`)。

**Round X 三人 ✅**(A 事实核查 + B 架构边界 + C 重构风险),详见 §10 Round X trail。

| #    | Deliverable                                                                                                                                        | Commit                                                      | Status                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| S1-1 | dispatcher 1914 → 1067 行,业务编排抽到 `playground-business-orchestrator.service.ts`(11 stage hooks + STAGE_NUMBER / CHECKPOINT_AT 字面量)         | `5100efb5a`                                                 | ✅                                             |
| S1-2 | 14 SessionEntry cache fields → `playground-cross-stage-state.ts`(typed wrapper around Z5 CrossStageState),idempotent                               | `af8f9f50d` + cross-state unit spec `3fbd76ea3`(10/10 pass) | ✅                                             |
| S1-3 | phase-specific types(PlanDeps / ResearchDeps / ...)declared in `mission-deps.ts`;**stage signature 收窄 deferred to PR-7b W22 主线波次**           | mission-deps.ts post-Stage 1                                | ⏸ deferred(audit 原文规划,不阻塞 Stage 1 exit) |
| S1-4 | `stage-rerun-dispatcher-classification.md`(9 method 三类拆分:3 [runtime cascade] / 3 [mixed] / 4 [business patch]),Stage 2 split 决策依据          | `5100efb5a`                                                 | ✅                                             |
| S1-5 | custom-agents back-coupling 走 `ai-app/contracts/mission-platform.contract.ts`(IMissionRunner / IMissionListReader DI tokens),Dependency Inversion | `5100efb5a`                                                 | ✅                                             |

**Stage 1 idempotent 验证**(用户 2026-05-09 明确要求"功能外部所有表现幂等"):

- `npx tsc --noEmit`: stage 1 域 EXIT=0
- `npx jest --testPathPattern='(playground|business-team|mission-store|sediment-zone-surface|custom-agents)'`: **1685/1685 specs pass**(stage hook 调度 / event flow / DB 写入 完全等价)
- `bash scripts/ci/check-harness-namespace.sh`(strict mode,无 `--stage-0-mode` advisory): **EXIT=0**,7/7 rules green(含 [S1-2] dispatcher class body cross-stage cache fields ✓ — 由 SessionEntry refactor 触发转 strict green)

**Stabilization 期**:audit Rev 5 §7 Stage 1 exit 要求 "writing-team and the split agent-playground both green for ≥ 2 sprints with no public-surface regressions"。merge 后开始观察期,Stage 2 entry 须等 stabilization 期满 + 1A 或 1B 触发。

### 11.3 Stage 3 实施状态:✅ Complete

**Round Y 三人 ✅**,详见 §10 Round Y trail(Rev 6 commit)。

| #    | Deliverable                                                                                                                | Path                                                          | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| S3-1 | benchmark Agent Team template(how-to-copy guide)                                                                           | `docs/architecture/ai-app/benchmark-agent-team-template.md`   | ✅     |
| S3-2 | benchmark architectural invariants(R6/R7/R8 + sediment topology + stage hook 模式 + idempotent 重构守门 + grep gate suite) | `docs/architecture/ai-app/benchmark-agent-team-invariants.md` | ✅     |

Stage 3 docs 不依赖 Stage 2 entry,提前入场是经过审议的合理安排:doc/template 工作 low risk,independent of Stage 2 lift sequencing。

### 11.4 Stage 2 实施状态:⏸ Gated(Stage 2 entry 1A/1B 未触发)

Stage 2 实施未启动,gating reasons:

- **1A 主路径未满足**:writing-team 是 MissionPipeline 派但 grep-verified **不消费 Z3**(只跨 Z1+Z4),不计入 Z3 候选 wrapper 第二消费者。无第三个 MissionPipeline 派 consumer。
- **1B doc-anchored 兜底未触发**:6 个月窗口未到(Stage 0 commit `67c3f3935` 2026-05-09 起算)。

**Stage 2 候选 lift(参见 §7 Stage 2 表)** 全部 deferred 至 1A 或 1B 触发后启动:

- S2-1(progress wrapper → Z3)/ S2-2(checkpoint → Z2,closes T4)/ S2-3(orphan-cleanup invocation → Z1,closes T5)/ S2-4(IBroadcastAdapter event buffer → Z3)/ S2-5(rerun-runtime-builder → Z3 组合 Z1)/ S2-6(stage-rerun.dispatcher 按 S1-4 分类 split)/ S2-7(`IMissionStore` 双视角 intersection 类型层固化,closes T1)

### 11.5 Mechanical guard suite 总览

`scripts/ci/check-harness-namespace.sh` 当前 **strict mode 7/7 green**(无需 `--stage-0-mode` advisory):

| #   | Rule                                                                               | Stage 0 落地 | Stage 1 转 strict green                    |
| --- | ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------ |
| 1   | [R6] ai-harness 不 import ai-app                                                   | ✓            | unchanged                                  |
| 2   | [NS] ai-harness 不出现 `agent-playground.` 字面量                                  | ✓            | unchanged                                  |
| 3   | [STEPID] ai-harness 不出现 step-id 字面量                                          | ✓            | unchanged                                  |
| 4   | [STAGE-NUM] ai-harness 不 stage-number 字面比较                                    | ✓            | unchanged                                  |
| 5   | [DI-TOKEN] ai-harness 不 PLAYGROUND*/AGENT_PLAYGROUND* DI token                    | ✓            | unchanged                                  |
| 6   | [S1-2] PlaygroundPipelineDispatcher class body 不出现 cache field                  | ⚠ (advisory) | ✓ Stage 1 S1-2 触发(SessionEntry refactor) |
| 7   | [ENGINE] ai-engine 不 import mission-aware identifiers(Mission*/Stage*/Pipeline\*) | ✓            | unchanged                                  |

### 11.6 Open items 完成状态摘要

| 原 Rev 5 open item                                  | Rev 6 状态                                                   |
| --------------------------------------------------- | ------------------------------------------------------------ |
| §2.5 Z6 去向 ADR                                    | ⏸ pending ADR-NNNN(独立 ADR,不在本审计范围)                  |
| §3.1 heartbeat-decision unverified                  | ⏸ Stage 2 1A/1B 触发后转 verified                            |
| §3.3 stage-rerun.dispatcher per-method 分类         | ✅ S1-4 doc 落地 (`5100efb5a`)                               |
| §3.3 custom-agents back-coupling                    | ✅ S1-5 选 (b) `ai-app/contracts/` 路径并执行 (`5100efb5a`)  |
| §1.5.3 双轨长期共存                                 | ⏸ R1 24 月长期失效条款兜底,不在本审计范围                    |
| (Rev 6 新)Stage 1 mission-deps stage signature 收窄 | ⏸ deferred to PR-7b W22 主线波次,phase-specific types 已就绪 |
