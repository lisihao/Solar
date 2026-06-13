# Benchmark Agent Team — Architectural Invariants

**Status:** Stage 3 / S3-2 deliverable(boundary audit Rev 5 §7 Stage 3,2026-05-09 落地)。
**Companion:** [`benchmark-agent-team-template.md`](./benchmark-agent-team-template.md) — copy guide。
**Audience:** 任何写、review、maintain MissionPipeline 派 Agent Team 的工程师。

---

## 1. 目的

把 `agent-playground` 边界审计 Stage 0/1 实施得来的不变式,固化为**长期 mechanical-guarded 架构契约**。任何新 MissionPipeline 派 team 必须满足这些不变式;任何重构必须保持这些不变式不破。

不变式 = 不能被业务个例打破的架构规则;违反 = lint/CI 失败。

---

## 2. Mechanical 守护规则(自动验证)

### R6 Reverse-import rule

`ai-harness/**` MUST NOT import `ai-app/**`。

- **机制**:`backend/.eslintrc.js` Section `ai-engine override` + `harness facade-barrel guard` 联合
- **违反后果**:lint error → PR CI fail
- **rationale**:依赖方向单向 `ai-app → ai-harness → ai-engine`。harness 反向引用具体 app = 抽象层混乱。

### R7 Test-isolation rule

Sunk components MUST be unit-testable using harness-only fixtures, without booting any `ai-app` module。

- **机制**:`ai-harness/**/__tests__/*.spec.ts` 不 import `ai-app/**`
- **当前 reference**:`backend/src/modules/ai-harness/__tests__/contract/sediment-zone-surface.contract.spec.ts`(11 tests,R7 合规)
- **rationale**:harness contract 应 self-contained;依赖 app 启动 = harness 不真正 sunk。

### R8 Agent / Skill primitive isolation

`ai-app/**/agents/**` 与 `ai-app/**/skills/**`,以及 `ai-harness/agents/**`(含 `agents/skill-runtime/` 子树),仅允许 import `@/modules/ai-harness/facade` 暴露的 agent/role/tool 抽象 + 本目录代码;不得直接 import `ai-harness/teams/**` 或 `ai-harness/lifecycle/mission-lifecycle/**`。

- **机制**:`backend/.eslintrc.js` 三处 `no-restricted-imports`(ai-app→facade Section 10、`ai-harness/agents/**` override、`ai-engine` override)+ `scripts/ci/check-harness-namespace.sh` [ENGINE] grep gate
- **rationale**:防止 mission/stage/pipeline 概念逆向污染 agent/role/tool primitive。primitive 应保持 mission-unaware,可在不同 mission 框架间复用。

---

## 3. Topology 不变式(reference: [`sediment-topology.md`](../ai-harness/facade/sediment-topology.md))

### T-1 facade-only consumption

ai-app 所有 ai-harness import 路径必须为 `@/modules/ai-harness/facade`。

- 6 个 sediment zones(Z1–Z6)是 facade 内部 re-export 的逻辑分区,**不是直接 import 子路径授权**
- ai-app `services/` / `agents/` / `skills/` 三层都遵守此规则,差异仅在 R8(agents/skills 还不能 import 业务 service 层 mission-aware 类型)

### T-2 单向依赖

`ai-app/<team> → ai-harness/facade → ai-harness/{Z1,Z2,Z3,Z4,Z5} → ai-engine → ai-infra`

向下依赖永不 reverse;harness 内部 zone 间的 cross-zone 依赖**仅 Z3 → Z1**(`MissionAbortRegistry`),其余 zones 互不依赖(grep verified)。

### T-3 Z6 在拓扑外

`ai-harness/lifecycle/manager/`(`IMissionExecutor` / `MissionExecutorService` / `ProcessId`)与 Z3/Z4 重叠,benchmark **不消费**。Z6 去向(并入 Z3 / 标 deprecated / 留 process-level 上层)由独立 ADR 决定 — `TBD: pending ADR-NNNN`。

---

## 4. Stage hook closure 模式(idempotent 必读)

### IM-1 dispatcher / business-orchestrator 拆分

每个 MissionPipeline 派 team **必须**把 dispatcher 拆为两个 app-local services:

| Service                                   | 职责(business-orch vs runtime-glue)                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<team>-pipeline-dispatcher.service.ts`   | runtime-glue:sessions Map / runMission 主入口 / withProgressTracking / hydrate inherited / orphan cleanup / handleMissionFailure / fireSelfEvolutionPostlude |
| `<team>-business-orchestrator.service.ts` | business:STAGE_NUMBER / CHECKPOINT_AT 字面量 / N 个 build\*Hooks / buildStageInvariants / resolveTriggerType                                                 |

**单向依赖**:dispatcher → business-orchestrator;business-orchestrator 不 import dispatcher 运行时类(只 type-import SessionEntry),通过 `bindSessionLookup(callback)` pattern 间接访问 sessions Map。

### IM-2 cross-stage state 走 Z5 wrapper

每个 team 必须建 `<team>-cross-stage-state.ts`(typed wrapper around Z5 `CrossStageState`):

- 14+ stage 中间产物 / 共享状态字段全部走 typed getter/setter
- SessionEntry 内只持 `readonly crossState: <Team>CrossStageState`,**不持 ad-hoc class body cache fields**(grep gate [S1-2] 强制)
- 内部 Z5 `Map<string, unknown>` 是 sync 操作,**不引入 async I/O**(idempotent 关键)
- toJSON / fromJSON 接口预留,Stage 2 follow-up 接 `IMissionStore.saveCrossStageState/getCrossStageState` 实现 crashed-mission resume

### IM-3 hook closure 通过 ctx.missionId 反查 entry

stage hook closures 通过 `args.ctx.missionId` 调 `getEntry(missionId)`(business-orchestrator 内通过 sessionLookup,dispatcher 自身有 sessions Map.get)。**不通过 closure 捕获**(避免 stale state 跨 mission 串扰)。

### IM-4 idempotent 重构守门

任何 dispatcher / business-orchestrator / cross-stage-state 重构必须满足 **外部行为完全不变**(用户 2026-05-09 明确要求):

- 14-stage event flow 顺序、payload shape、timing 完全等价
- mission DB 写入(mission row / report version / checkpoint / events)完全等价
- mission summary 返回值 shape 等价
- abort / failure 路径行为等价
- 1685+ existing specs 全 pass(端到端 idempotent 保证)

---

## 5. Mission Store 双视角实现(closes audit T1)

### MS-1 双 interface satisfies

Mission store 必须 structurally satisfies 两个 interface:

| Interface                              | Zone | 来源                                                                             |
| -------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `IMissionStore<TBusiness>`(9 methods)  | Z1   | `ai-harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts` |
| `IBusinessTeamMissionStore`(7 methods) | Z3   | `ai-harness/teams/business-team/abstractions/mission-store.interface.ts`         |

两个 interface method 名 **互不重叠**;新 team store 实现这 9+7 = 16 个方法即可被 Z3 framework + Z1 generic 调用方都消费。

### MS-2 markFailed 截断契约(closes S0-7)

`IBusinessTeamMissionStore.markFailed(args.errorMessage)` 由 **业务方实现侧**截断,framework / caller **不**截断。

- reference impl 上限 2000 chars(UTF-16 code units)
- 超出 truncate 末尾保留 `…[truncated]`
- 其他 BusinessAgentTeam impl 可选不同上限,但必须保证 DB 列容纳

---

## 6. Cross-app 共享 mission surface(closes S1-5)

### CA-1 跨 app 通过 `ai-app/contracts/` interface tokens 解耦

任何 ai-app 消费另一 ai-app 的 mission runner / store **必须**通过 `ai-app/contracts/<scope>.contract.ts` 提供的 DI token + interface,不直接 import 具体类。

- **reference**:`backend/src/modules/ai-app/contracts/mission-platform.contract.ts`(`MISSION_RUNNER` / `MISSION_LIST_READER` tokens + `IMissionRunner` / `IMissionListReader` interfaces)
- **绑定**:owner module 用 `{ provide: TOKEN, useExisting: ConcreteService }`(避免实例 duplication)
- **rationale**:Dependency Inversion;消费方依赖 interface 而非 concrete class,降低跨 app 紧耦合

---

## 7. Mechanical guard suite(7 grep gates)

`scripts/ci/check-harness-namespace.sh`(7 项 grep + lint 联合检查):

| #   | Rule                                                                                                                         | 当前期望                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | [R6] `ai-harness/**` 不 import `ai-app/**`                                                                                   | 0 命中                                    |
| 2   | [NS] `ai-harness/**` 不出现业务命名空间字面量(如 `'agent-playground.'`)                                                      | 0 命中                                    |
| 3   | [STEPID] `ai-harness/**` 不出现 step-id 字符串字面量(`s\d+[a-z]?-` 形式)                                                     | 0 命中                                    |
| 4   | [STAGE-NUM] `ai-harness/**` 不出现 stage-number 字面比较(`stage === \d+`)                                                    | 0 命中                                    |
| 5   | [DI-TOKEN] `ai-harness/**` 不出现业务 DI token 字符串(`AGENT_PLAYGROUND_*` / `PLAYGROUND_*`,新 team 同款 `<MY_TEAM>_*` 加入) | 0 命中                                    |
| 6   | [S1-2] dispatcher class body 不出现 cache field 声明(`lastPlan` / `lastResearcherResults` / `s4PatchFailures` 等)            | 0 命中(由 cross-stage-state wrapper 满足) |
| 7   | [ENGINE] `ai-engine/**` 不出现 mission-aware identifier import(`Mission*` / `Stage*` / `Pipeline*` / `MissionRun*`)          | 0 命中                                    |

每加一个新 team,gate 5 应该新增该 team 命名空间的检查(如 `<MY_TEAM>_PIPELINE` / `<my-team>.mission:` 等)。

---

## 8. 不变式 violation 处理流程

发现违反任一不变式:

1. **lint / grep gate red** → 不能 merge(PR CI 阻塞)
2. **运行时 violation**(如 stage 行为非 idempotent)→ 按 [`agent-team-boundary-audit-2026-05-08.md`](./agent-playground/agent-team-boundary-audit-2026-05-08.md) §10 流程开 audit 重审
3. **架构边界 violation**(新 zone 加入、依赖 reverse 等)→ 按 sediment-topology.md §6 维护规则:走 ADR

---

## 9. 长期失效条款

audit Rev 5 §2 R1 长期失效:

- Stage 2 候选 lift 若 24 个月内无第二个 MissionPipeline 派 consumer 出现,候选回退留 app(R1 长期兜底)
- 已 lift 的 candidate(如 Z3 `MissionRuntimeShellFramework` / `EventRelayFramework`)若 ≥ 24 个月仍无 2nd consumer 实际使用,触发 ADR 重审是否回退

---

## 10. 维护规则

- 本 doc 与 mechanical guard suite + lint config 保持同步。任何 grep / lint 规则变更必须同步更新本 doc 的 §7 表
- 不变式新增 / 修改 / 失效必须走 ADR + 全 audit 流程(对应 boundary-audit-2026-05-08.md Rev N)
- 本 doc 与 [`benchmark-agent-team-template.md`](./benchmark-agent-team-template.md) 互为 companion:template 是 how-to-copy,本 doc 是 what-must-hold
