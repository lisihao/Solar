# 能力即产品（Capability-as-Product）执行架构 — 权威设计 + W1→W5 迁移计划

> 状态：权威设计（authoritative）。本文据五份只读勘察（25 服务分类 / MissionStore 耦合 / harness 原语 / playground 装配 / 消费契约）定形。
> 范围：14 阶段深度研究执行内核如何从 playground 私有沉淀为**平台共享能力**，被 company / playground / 未来 app 通过 `ICapabilityRunner` 端口消费。
> 关联：`ARCHITECTURE_RULES.md`、`.claude/CLAUDE.md`（AI 架构分层 + Facade 边界红线）、`standards/16-ai-engine-harness-structure.md`。

---

## 0. 现状基线（必读，避免重复造轮子）

勘察核实的**已存在事实**（设计基于此，不推翻）：

1. **能力家已落地**：`backend/src/modules/ai-app/marketplace/capabilities/deep-insight/` 已存在，含完整 `agents/`（leader/researcher/reconciler/analyst/writer/reviewer/verifier/steward 共享 @DefineAgent）+ `contract/` + `recipe/deep-insight.recipe.ts`（= `PLAYGROUND_PIPELINE` 13-step config）+ `deep-insight.runner.ts`。
2. **端口已存在**：`marketplace/capability/capability-runner.port.ts` 定义了 `ICapabilityRunner` / `CapabilityRunInput` / `CapabilityRunEvent` / `CapabilityRunContext` / `CapabilityRunResult`。
3. **company 已在消费**：`company/services/company-mission.service.ts` 的 `runViaCapability()` + `bridgeCapabilityEvent()` 已调 `runner.run(input, ctx)`，自己落库、自己桥事件、验收 gate 已上线。
4. **harness 原语已齐**：`MissionPipelineOrchestrator.run()`（顺序执行 + state 传递 + onEvent + abort + resume）、`CrossStageState`（内存 KV + append/incr + toJSON/fromJSON）、`IMissionStore`（持久化端口，含 `saveCrossStageState`/`getCrossStageState`/`setLastCompletedStepId`）、9 个空壳 stage primitive（行为由 hooks 注入）、`InMemoryMissionStore` 模板 —— **harness 层 0 改动即可承载 14 阶段不碰 app DB**。
5. **关键缺口（本设计要解决的）**：当前 `DeepInsightDefaultRunner` 是**精简 6 阶段**（plan→research→reconcile→analyze→write→review）直接手写 `agentRunner.run` 串联，**不是** playground 跑通的真 14 阶段（缺 budget gate / leader assess / outline / quality-enhance / meta-critic / objective-eval / signoff / verifier / steward / persist 的完整富 pipeline）。playground 的真 14 阶段仍锁在 `playground/mission/pipeline/` 的私有 dispatcher 里，与 app 持久化（MissionStore）/WS/OTel 深度耦合，无法被 company 复用。

> **本设计的产品断言**：能力（capability）= 产品。一份「14 阶段执行内核」住在能力家，跑在 harness 原语 + 共享 agent 上，**零 app import**；company / playground / 未来 app 都只是**消费方**，各自注入自己的持久化 / WS / HITL，互不依赖、都不依赖 playground。

---

## 1. 分层与铁律

### 1.1 三层职责（精确边界）

```
┌─────────────────────────────────────────────────────────────────────┐
│ 消费方层 (app)  —— company / playground / 未来 app                     │
│   职责：解析 manifest → 调 ICapabilityRunner.run(input, ctx)           │
│        注入自己的 MissionPersistencePort + MissionEventPort           │
│        管自己的 DB / WS / HITL / 验收 gate / 重跑策略                  │
│   铁律：① 只经 ICapabilityRunner 消费（不 import 能力内核实现）         │
│        ② 互不依赖（company 不 import playground，反之亦然）            │
│        ③ 都不依赖 playground（playground 不是"母体"，是平级消费方）    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ ICapabilityRunner.run(input, ctx)
                             │ ctx 注入 { persistence, events, onEvent, signal }
┌────────────────────────────▼────────────────────────────────────────┐
│ 能力层 (capabilities/<cap>/)  —— deep-insight 的 pipeline 拥有完整执行 │
│   capabilities/deep-insight/                                          │
│     ├── agents/        共享 @DefineAgent（8 角色）                     │
│     ├── contract/      schema / budget / tool-matrix                  │
│     ├── recipe/        14-step MissionPipelineConfig（原 PLAYGROUND）  │
│     ├── pipeline/      ★ 执行内核：StageBindings（14 阶段 hooks 实现） │
│     └── deep-insight.runner.ts  装配 orchestrator + bindings + ports  │
│   铁律：① pipeline 拥有完整 14 阶段执行（认知决策全在这里）            │
│        ② 只依赖 harness 原语 + 共享 agent + 三端口                     │
│        ③ 零 app import（verify:arch + ESLint 守护，见 §6）             │
└────────────────────────────┬────────────────────────────────────────┘
                             │ harness 原语（facade）
┌────────────────────────────▼────────────────────────────────────────┐
│ harness (L2.5)  —— 通用编排 / 原语，mission/agent-aware，无业务语义    │
│   MissionPipelineOrchestrator / CrossStageState / 9 stage primitive   │
│   AgentRunner / EventBus / MissionLifecycleManager / AbortRegistry    │
│   IMissionStore（端口定义）/ InMemoryMissionStore（模板）             │
│   铁律：不知道 deep-insight 是什么，不知道 company / playground        │
└───────────────────────────────────────────────────────────────────────┘
                             │ engine facade
                          AI Engine (L2) — LLM / tools / rag …
```

### 1.2 铁律（写进 verify，违者拒推）

| #   | 铁律                                                                                                                 | 守护                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R1  | 能力层 `capabilities/**` **不得 import 任何 app**（`ai-app/playground/**`、`ai-app/company/**` 及其它 app 业务目录） | ESLint 新规则 + `verify:arch` 新 spec（§6.1）                                                   |
| R2  | 能力内核执行期**只依赖** harness facade + engine facade + 共享 agent + 三端口                                        | ESLint（既有 ai-app→facade 规则已覆盖穿透）+ 新 spec                                            |
| R3  | 消费方**只经** `ICapabilityRunner` 消费，不 import 能力内核实现类（`DeepInsightDefaultRunner` 等）                   | 新 spec（按符号名禁止 import 具体 runner class）                                                |
| R4  | 消费方**互不依赖**：`ai-app/<X>` 不得 import `ai-app/<Y>` 业务目录                                                   | 既有 `layer-1-topology/no-app-cross-coupling.spec.ts` 扩条                                      |
| R5  | 能力内核执行期**零 app DB 访问**：中间态走 harness `CrossStageState`，落库经端口                                     | 新 spec（能力家不得 import prisma / app store）+ code review                                    |
| R6  | 禁 provider 硬编码：LLM 走 `TaskProfile` + `modelType`，fallback 用 `""`                                             | 既有 ESLint F 段 + temperature/maxTokens 守护                                                   |
| R7  | 不退化：playground 已跑通的 14 步 + company 已上线的验收 gate 必须持续绿                                             | 既有 `playground-as-template.spec.ts` / `playground-event-contract.spec.ts` + company gate 测试 |

---

## 2. 三端口精确定义（接口签名）

> 设计原点（勘察 2/3/5）：能力内核执行期只依赖 **harness 原语 + 三端口**，零 app import。
> 三端口分工：**StageBindings**（阶段逻辑，能力提供）、**MissionPersistencePort**（持久化，消费方注入）、**MissionEventPort**（事件，消费方桥）。
> 文件落位：`capabilities/<cap>/pipeline/ports.ts`（能力家自有 abstractions/，不放 app，不放 harness）。

### 2.1 端口 A：`StageBindings`（阶段逻辑 — 能力提供）

阶段认知决策（plan / research / reconcile / … / signoff）的实现注入点。**能力家实现它**，传给 harness `MissionPipelineOrchestrator`。它就是 harness `ResolvedStageHooks` 的能力侧具象 —— 但用能力家自己的端口名固化，避免 app 直接碰 harness hook 内部类型。

```typescript
// capabilities/deep-insight/pipeline/ports.ts
import type {
  StageRunArgs, // from ai-harness/facade —— { ctx, role, config, hooks, crossStageState, previousOutputs }
  ResolvedRole,
  IAgentEvent,
} from "@/modules/ai-harness/facade";

/** 单个 agent 调用的统一签名（能力内核内部用 AgentRunner，外部不可见）。*/
export interface AgentInvocation {
  /** 透传给 agentRunner.run 的 RunOptions（userId / preferredModelId / onEvent relay）。*/
  readonly userId: string;
  readonly preferredModelId?: string;
  readonly onAgentEvent?: (
    stepId: string,
    role: string,
    dimension: string | undefined,
    ev: IAgentEvent,
  ) => void;
}

/**
 * StageBindings —— 14 阶段逻辑契约（能力家实现）。
 * 每个方法 = 一个 stage primitive 的 hooks 集合的能力侧封装。
 * 实现内部用 harness AgentRunner 跑共享 @DefineAgent + 写 CrossStageState；
 * 不碰任何 app DB（中间态进 CrossStageState；落库由 PERSIST primitive → MissionPersistencePort）。
 */
export interface StageBindings<TInput = unknown> {
  /** PLAN primitive hooks：跑 leader.plan，把 plan 写入 crossStageState。 */
  runPlan(args: StageRunArgs<TInput>, inv: AgentInvocation): Promise<unknown>;

  /** RESEARCH primitive hooks：按 plan.dimensions fan-out + 单维 pipeline。 */
  fanOut(args: StageRunArgs<TInput>): Promise<ReadonlyArray<unknown>>;
  perItem(
    item: unknown,
    args: StageRunArgs<TInput>,
    inv: AgentInvocation,
  ): Promise<unknown>;
  onPatchFailure?(
    item: unknown,
    err: unknown,
    args: StageRunArgs<TInput>,
  ): void;

  /** ASSESS / SYNTHESIZE / DRAFT / REVIEW / SIGNOFF primitive hooks：跑对应角色。 */
  runRole(
    stepId: string,
    args: StageRunArgs<TInput>,
    inv: AgentInvocation,
  ): Promise<unknown>;

  /** 从某 stage 产出抽决策（stateful role 用，写 roleDecisions）。 */
  extractDecision?(
    stepId: string,
    output: unknown,
  ): { phase: string; decision: string; rationale?: string } | null;

  /** PERSIST primitive hooks（budget-pre / final）：经端口落库，不直连 DB。 */
  persist(
    args: StageRunArgs<TInput>,
    mode: "budget-pre" | "final",
    store: MissionPersistencePort,
  ): Promise<void>;
}
```

> 关键点：`StageBindings` 是**能力家提供**的（实现住 `pipeline/bindings/`），不是消费方注入。消费方注入的只有 `MissionPersistencePort` + `MissionEventPort`（下两节），通过 `ICapabilityRunner.run(input, ctx)` 的 `ctx`。runner 内部把 `ctx` 的两端口 + 自己的 `StageBindings` 一起喂给 harness orchestrator。

### 2.2 端口 B：`MissionPersistencePort`（持久化 — 消费方注入）

> 形状直接采纳勘察 2 的「最小化 checkpoint/resume + 可选 trajectory + terminal arbiter」，并对齐 harness 既有 `IMissionStore`（`saveCrossStageState`/`getCrossStageState`/`setLastCompletedStepId`），避免造第二套端口。

```typescript
// capabilities/deep-insight/pipeline/ports.ts
export interface MissionTerminalDetails {
  readonly report?: unknown;
  readonly reportArtifact?: unknown;
  readonly themeSummary?: string;
  readonly dimensions?: ReadonlyArray<unknown>;
  readonly verdicts?: unknown;
  readonly leaderSignOff?: unknown;
  readonly finalScore?: number;
  readonly elapsedWallTimeMs?: number;
  readonly tokensUsed?: number;
  readonly costCents?: number;
  readonly errorMessage?: string;
  readonly failureCode?: string;
}

/**
 * MissionPersistencePort —— 14 阶段持久化契约（消费方注入）。
 * 核心：仅 checkpoint/resume 是 MUST（执行内核 crash-resume 用）；其余 nice-to-have。
 * 能力内核执行期不碰 app DB；最终产物 + checkpoint 经此端口由消费方落库。
 *
 * 注：本端口是 harness IMissionStore 的"能力侧最小投影 + terminal arbiter 扩展"。
 *     消费方可让自家 store 同时实现 IMissionStore 与本端口（一套实现两个视图）。
 */
export interface MissionPersistencePort {
  // ── 核心：crash-resume（MUST）──
  markStageProgress(missionId: string, stepId: string): Promise<void>;
  saveCheckpoint(
    missionId: string,
    snapshot: {
      lastStepId: string;
      topic: string;
      crossState: Readonly<Record<string, unknown>>; // CrossStageState.toJSON()
    },
  ): Promise<boolean>; // false = mission 非 running
  loadCheckpoint(missionId: string): Promise<{
    lastStepId: string;
    topic: string;
    crossState: Readonly<Record<string, unknown>>;
  } | null>;
  clearCheckpoint(missionId: string): Promise<void>;

  // ── 终态：条件写仲裁（MUST；WHERE status='running' 首写赢）──
  applyTerminalIfRunning(
    missionId: string,
    outcome: "completed" | "failed" | "cancelled",
    details: MissionTerminalDetails,
  ): Promise<boolean>; // true = 赢得终态写

  // ── 可选：trajectory（UI 展示 / 重跑复用，能力内核不依赖）──
  saveResearchResult?(args: {
    missionId: string;
    dimension: string;
    findings: ReadonlyArray<unknown>;
    summary: string;
    state: "completed" | "failed";
  }): Promise<boolean>;
  saveReportVersion?(args: {
    missionId: string;
    triggerType: "initial" | "rerun-fresh";
    reportFull?: unknown;
    reportTitle?: string;
    reportSummary?: string;
    finalScore?: number;
    leaderSigned?: boolean;
  }): Promise<number>;
}
```

### 2.3 端口 C：`MissionEventPort`（事件 — 消费方桥）

> 设计原点（勘察 5）：**不扩 `run(input, ctx)` 签名**，事件统一过 `ctx.onEvent`；对 `CapabilityRunEvent` 加可选**结构化 telemetry** 字段，让消费方无感消费 14 阶段。`MissionEventPort` 是 runner 内部把 harness `MissionEvent` 翻译成 `CapabilityRunEvent` 后回灌 `ctx.onEvent` 的**薄适配契约**——消费方实现 `onEvent`，不需要额外注入对象。

```typescript
// marketplace/capability/capability-runner.port.ts —— 对既有 CapabilityRunEvent 增量加字段（向后兼容）
export interface CapabilityRunEvent {
  readonly type:
    | "started"
    | "stage:started"
    | "stage:completed"
    | "stage:failed"
    | "stage:degraded"
    | "stage:stalled" // ★ 新增：覆盖 14 阶段降级/停滞（向后兼容）
    | "agent-lifecycle"
    | "agent-trace"
    | "completed"
    | "failed";
  readonly stepId?: string; // 已有
  readonly label?: string; // 已有
  readonly timestamp: number; // 已有
  readonly payload?: Record<string, unknown>; // 已有
  /** ★ 新增：结构化阶段元数据（消费方可选消费；14 阶段点亮 + 计费用）。 */
  readonly telemetry?: {
    readonly systemStageId?: string; // ★ 14-chip 点亮锚点（见 §5）：s1-budget … s11-persist
    readonly tokensUsed?: number;
    readonly costCents?: number;
    readonly dimension?: string;
    readonly agentId?: string;
    readonly phase?: "started" | "completed" | "failed";
  };
}

/**
 * MissionEventPort —— 消费方事件桥契约（= ctx.onEvent 的语义化别名）。
 * runner 把 harness MissionEvent → CapabilityRunEvent（含 telemetry.systemStageId），
 * 调 ctx.onEvent 上抛；消费方在 onEvent 里桥到自己的 EventBus/WS（company.* / playground.*）。
 */
export type MissionEventPort = NonNullable<CapabilityRunContext["onEvent"]>;
```

> 为何不另加 `persistenceAdapter` 入参（勘察 5 方案 A 被否）：会倒逼端口随需求多次扩张。改为：**持久化端口由 runner 在 `run()` 内部从 ctx 取**（ctx 增一个可选 `persistence?: MissionPersistencePort` 字段），事件全过 `onEvent`。这样 `run(input, ctx)` 主签名稳定，company 现有 `bridgeCapabilityEvent` 只升级不重构。

```typescript
// CapabilityRunContext 增量（向后兼容，唯一新增字段）
export interface CapabilityRunContext {
  readonly userId: string;
  readonly missionId: string;
  readonly onEvent?: MissionEventPort; // 已有（= 事件端口）
  readonly signal?: AbortSignal; // 已有
  /** ★ 新增：消费方注入的持久化端口（缺省 → runner 用 InMemory，不落库纯跑）。 */
  readonly persistence?: MissionPersistencePort;
}
```

---

## 3. 25 服务去留表

> 基于勘察 1。分类：**下沉能力层** / **app 自留（变端口）** / **harness 不动**。
> 重要修正（基于现状基线 §0）：勘察 1 写「下沉到 `ai-harness/teams/business-team/capabilities/`」，但能力家实际已落在 **`ai-app/marketplace/capabilities/deep-insight/`**（不是 harness 子目录）。能力家在 ai-app 层、跑 harness 原语，符合「能力即产品、消费方平级」模型。下表「去哪里」按真实落位修正。

| #   | 服务                          | 来源                  | 分类                          | 迁移动作                                                                                                                                                  |
| --- | ----------------------------- | --------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `LeaderService`               | playground/roles      | **下沉能力层**                | 逻辑搬入 `capabilities/deep-insight/pipeline/bindings/`（plan/assess/signoff 三方法），调共享 leader @DefineAgent                                         |
| 2   | `ReconcilerService`           | playground/roles      | **下沉能力层**                | 搬入 bindings（SYNTHESIZE/reconcile），调共享 reconciler agent                                                                                            |
| 3   | `AnalystService`              | playground/roles      | **下沉能力层**                | 搬入 bindings（SYNTHESIZE/analyze）                                                                                                                       |
| 4   | `WriterService`               | playground/roles      | **下沉能力层**                | 搬入 bindings（DRAFT outline/full），6 writer agent 派发                                                                                                  |
| 5   | `ReviewerService`             | playground/roles      | **下沉能力层**                | 搬入 bindings（REVIEW main/critic/dimension）                                                                                                             |
| 6   | `VerifierService`             | playground/roles      | **下沉能力层**                | 搬入 bindings（REVIEW objective / citation-audit）                                                                                                        |
| 7   | `StewardService`              | playground/roles      | **下沉能力层**                | 搬入 bindings（budget-guard，配合 PERSIST budget-pre）                                                                                                    |
| 8   | `AgentInvoker`                | playground/roles      | **harness 不动**              | 已是通用门面（retry/abort/span/relay）；能力内核改用 harness `AgentRunner`，invoker 的 playground relay 部分留 playground                                 |
| 9   | `MissionStore`                | playground/lifecycle  | **app 自留（变端口）**        | playground 保留实现；让它实现 `MissionPersistencePort`，能力内核只见端口                                                                                  |
| 10  | `HandoffCompactorService`     | harness/memory        | **harness 不动**              | token 压缩通用原语                                                                                                                                        |
| 11  | `MissionAbortRegistry`        | harness/lifecycle     | **harness 不动**              | mission 级 AbortController                                                                                                                                |
| 12  | `AgentRunner`                 | harness/agents        | **harness 不动**              | 能力内核的 agent 执行引擎（已是 runner-deps 依赖）                                                                                                        |
| 13  | `JudgeService`                | harness/evaluation    | **下沉能力层**                | consensus verifier 逻辑由 bindings 在 REVIEW/quality-floor 调；判定原语留 harness，能力家组合它                                                           |
| 14  | `MemoryAutoIndexer`           | harness/memory        | **harness 不动**              | mission 完成索引轨迹，由消费方在 onCompleted 触发（playground postlude / company 可选）                                                                   |
| 15  | `EventBus`                    | harness/protocols     | **harness 不动**              | 消费方在 onEvent 内桥到它（能力内核不直连）                                                                                                               |
| 16  | `RuntimeEnvironmentService`   | harness/guardrails    | **harness 不动**              | 模型/agent/tool/key 发现，AgentRunner 内部用                                                                                                              |
| 17  | `FailureLearnerService`       | harness/lifecycle     | **harness 不动**              | 跨 mission 失败学习，消费方 postlude 触发                                                                                                                 |
| 18  | `ReportArtifactAssembler`     | harness/evaluation    | **下沉能力层**                | 纯组装（sections/citations/figures/quickView）；harness 保留通用 assembler 原语，能力家 bindings 在 DRAFT/PERSIST 调用                                    |
| 19  | `FigureExtractorService`      | engine/content/figure | **harness 不动（在 engine）** | 已在 engine；能力家经 facade 调（figure pipeline Stage 1-2）                                                                                              |
| 20  | `FigureRelevanceService`      | ai-app/insight        | **下沉能力层**                | 从 insight 迁出 → `capabilities/deep-insight/pipeline/figure/`（embedding 相关性过滤 Stage 3）；评估是否上提 harness 复用——若仅 deep-insight 用，留能力家 |
| 21  | `SectionSelfEvalService`      | harness/evaluation    | **下沉能力层**                | 4 维写中自评，bindings 在 DRAFT 内调；评判原语留 harness                                                                                                  |
| 22  | `SectionRemediationService`   | harness/evaluation    | **下沉能力层**                | 定向修复，bindings 在 quality-enhance 调                                                                                                                  |
| 23  | `ReportEvaluationService`     | harness/evaluation    | **下沉能力层**                | 10 维事后评审，bindings 在 objective-eval 调                                                                                                              |
| 24  | `QualityTraceComputeService`  | harness/evaluation    | **下沉能力层**                | 5 探针+5 维评分，bindings 在 signoff/score 调（纯计算，无 persistence）                                                                                   |
| 25  | `PostmortemClassifierService` | harness/lifecycle     | **harness 不动**              | 失败模式分类原语；消费方在 onFailed/postlude 触发                                                                                                         |
| +26 | `CreditsService`              | platform/credits      | **app 自留（变端口）**        | 平台积分；经 `RuntimeEnvironment` / billing context 注入，能力内核只透传 `billing.userId`，不直连                                                         |
| +27 | `MissionLifecycleManager`     | harness/lifecycle     | **harness 不动**              | 唯一终态写入口；消费方的 `applyTerminalIfRunning` 经它仲裁                                                                                                |

**归并结论**：

- **下沉能力层（13）**：Leader / Reconciler / Analyst / Writer / Reviewer / Verifier / Steward / Judge(组合) / ReportArtifactAssembler(组合) / FigureRelevance / SectionSelfEval / SectionRemediation / ReportEvaluation / QualityTraceCompute。这些是**纯执行认知逻辑**，进 `capabilities/deep-insight/pipeline/bindings/`。
- **app 自留变端口（3）**：MissionStore（→ `MissionPersistencePort`）、CreditsService（→ billing context 注入）、AgentInvoker 的 playground relay 部分（留 playground，能力内核用 harness AgentRunner）。
- **harness 不动（12）**：AgentRunner / EventBus / AbortRegistry / HandoffCompactor / MemoryAutoIndexer / RuntimeEnvironment / FailureLearner / PostmortemClassifier / MissionLifecycleManager + 评判原语（Judge/SelfEval/Remediation/ReportEval 的「打分基元」留 harness，能力家组合）+ FigureExtractor（在 engine）。

> 拆分原则（写进 review）：**「认知决策/编排」下沉能力家；「无状态打分/压缩/索引/仲裁基元」留 harness；「DB/积分/relay」留 app 经端口注入。** 评判类服务（21-24）的「怎么打分」是 harness 原语，「在哪个 stage 用、用结果做什么决策」是能力家 bindings。

---

## 4. MissionStore 解耦策略

> 基于勘察 2/3：能力内核执行期中间态用 harness `CrossStageState` 承载（不碰 app DB）；最终产物 + checkpoint 经 `MissionPersistencePort` 由消费方落库。

### 4.1 中间态：全程 CrossStageState（零 app DB）

playground 现状（勘察 2/4）：S1-S10 的 10 个 stage 输出全部经**内存** `PlaygroundCrossStageState`（`lastPlan` / `lastResearcherResults` / `lastReconciliationReport` / `lastAnalystOutput` / `lastOutlinePlan` / `lastReport` / `lastReportArtifact` / `lastReviewScore` / `lastLeaderForeword` / `lastLeaderSignOff` / `lastVerifierVerdicts`）传递，**只有 S3/S8/S11 写 DB**。

解耦后：

| 当前（playground 私有）                                      | 解耦后（能力内核）                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `PlaygroundCrossStageState`（app 类型）                      | harness `CrossStageState`（通用 KV，key 用 `deep-insight.*` 业务前缀）       |
| stage hook 直接 `entry.crossState.lastPlan = …`              | bindings 在 primitive 内 `args.crossStageState.set("deep-insight.plan", …)`  |
| S3 per-dim `store.saveResearchResult()`（直连 MissionStore） | RESEARCH primitive 内可选 `store.saveResearchResult?.()`（端口，缺省 no-op） |
| S8 `store.saveReportVersion()`                               | DRAFT/PERSIST 内可选 `store.saveReportVersion?.()`（端口）                   |

### 4.2 最终产物 + checkpoint：经端口落库

| 替换点（具体）                | 当前                                                                                                    | 解耦后                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **checkpoint 写**（S2/S3/S8） | `missionCheckpoint.save(missionId, {crossState})`（playground prisma `leaderJournal.__checkpoint`）     | `store.saveCheckpoint(missionId, { lastStepId, topic, crossState: args.crossStageState.toJSON() })`（端口）                        |
| **checkpoint 读**（resume）   | `missionCheckpoint.canResume()` → `PlaygroundCrossStageState.fromJSON()`                                | runner 启动时 `store.loadCheckpoint()` → `CrossStageState.fromJSON()` → orchestrator `initialCrossStageState` + `resumeFromStepId` |
| **stage 进度**                | `markStageComplete(missionId, stageNum)`                                                                | `store.markStageProgress(missionId, stepId)`（resume 入口定位）                                                                    |
| **终态写**（S11）             | `lifecycleManager.finalize<PlaygroundTerminalExtra>({ arbiter: this.store })`（WHERE status='running'） | `store.applyTerminalIfRunning(missionId, outcome, details)`（端口内部仍走 `MissionLifecycleManager` 仲裁）                         |
| **checkpoint 清理**（S11 后） | `missionCheckpoint.clear(missionId)`                                                                    | `store.clearCheckpoint(missionId)`                                                                                                 |

### 4.3 一套实现两个视图

playground 的 `MissionStore`（extends `BusinessTeamMissionStoreFramework`，已实现 `IMissionStore`）只需**再实现 `MissionPersistencePort`**（多数方法是既有 helper 的薄封装：`saveCheckpoint`→`prismaMissionCheckpoint.save`、`applyTerminalIfRunning`→`lifecycleManager.finalize`）。company 的 store 同理实现端口（终态写 company_missions 表）。**能力内核只见 `MissionPersistencePort`，不见任何具体 store**。

> 不碰 Prisma schema：能力内核走端口 → **无 schema 变更**（见 §6 硬约束评估）。各消费方落各自既有表，列已存在。

---

## 5. 前端 14-chip 点亮（消费方侧，company）

锚点：`CapabilityRunEvent.telemetry.systemStageId`（§2.3 新增）。

- runner 把 harness `MissionEvent.stepId`（`s1-budget` … `s11-persist`）原样放进 `telemetry.systemStageId`。
- company `bridgeCapabilityEvent` 读 `systemStageId` → 映射到 company 的 14-chip 视图（已存在）+ 任务列表 14 步（已存在），点亮对应 chip / 推进 todo。
- 当前 company 靠 `stepId` 硬编码映射 plan/research/…（勘察 5 line 710）—— 改为读结构化 `systemStageId`，去掉硬编码 map。

> 不退化：14-chip 视图与任务列表 14 步组件**已存在**（hero mission 已上线），本波只接事件锚点，不动 UI 组件（遵守前端 UI 复用红线）。

---

## 6. 硬约束（写进设计 + 每波 verify）

| 约束                                   | 落地                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 禁 provider 硬编码                     | LLM 全走 `AiChatService.chat` + `TaskProfile` + `modelType`；fallback 用 `""`。既有 ESLint F 段 + temperature/maxTokens 守护覆盖能力家（在 `ai-app/**`）。 |
| ai-app 只经 facade 访问 harness/engine | 既有 ESLint `no-restricted-imports`（SECTION 10/11）已覆盖 `capabilities/**`（属 `ai-app/**`）。                                                           |
| 能力层不得 import 任何 app             | **新增 ESLint 规则 + verify:arch 新 spec**（见 §6.1）。                                                                                                    |
| module/入口/迁移由主 Agent             | sub-agent 白名单仅限 bindings/ports 文件；`.module.ts` / 路由 / store 装配由主 Agent 手动改。                                                              |
| 改 Prisma schema 必手写 SQL 迁移       | **评估结论：能力内核走端口 → 无 schema 变更**。各消费方落既有表既有列；若某消费方需新列另起独立迁移（不在本计划范围）。                                    |
| 不退化                                 | playground 14 步 spec（`playground-as-template.spec.ts` / `playground-event-contract.spec.ts`）+ company 验收 gate 测试每波必绿。                          |

### 6.1 新增守护（能力层零 app import）

**ESLint** —— 在 `backend/.eslintrc.js` 新增 override（由主 Agent 改入口配置）：

```js
{
  // 能力层零 app import：capabilities/** 不得 import 任何 app 业务目录
  files: ["**/modules/ai-app/marketplace/capabilities/**/*.ts"],
  excludedFiles: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [
      { group: ["**/ai-app/playground/**", "**/ai-app/company/**",
                "**/ai-app/insight/**", "**/ai-app/teams/**", "**/ai-app/writing/**",
                "@/modules/ai-app/playground/**", "@/modules/ai-app/company/**"],
        message: "能力层 capabilities/** 不得 import 任何 app（playground/company/…）。" +
                 "执行内核只依赖 harness facade + engine facade + 共享 agent + 三端口。" },
      { group: ["@prisma/client/runtime/**", "**/prisma.service*"],
        message: "能力内核执行期零 app DB；中间态走 CrossStageState，落库经 MissionPersistencePort。" },
    ]}],
  },
},
```

> 例外：能力家可 import `marketplace/capability/**`（端口定义）+ `ai-app/contracts/agent-spec-catalog`（共享 agent spec，平台契约）+ harness/engine facade。`@prisma/client` 的 enum（如 `AIModelType`）允许（runner-deps 已用），仅禁 prisma runtime/service。

**verify:arch spec** —— 新增 `backend/src/__tests__/architecture/layer-3-authority/capability-isolation.spec.ts`：

1. 静态扫 `capabilities/**`（非测试）源码，断言无 import 命中 app 业务路径 / prisma service。
2. 断言消费方（company/playground）源码不 import 具体 runner class（`DeepInsightDefaultRunner`），只 import `ICapabilityRunner` / `CapabilityRegistry`。
3. 断言 `CapabilityRunEvent` 含 `telemetry.systemStageId`（契约防漂移）。

---

## 7. W1→W5 分波计划

> 每波：改动文件清单 + 验证标准 verify + 风险。绿色门：`npm run verify:arch` + `npm run type-check` + 相关 spec。
> 入口文件（`.module.ts` / ESLint / store 装配）由**主 Agent** 手动改；bindings/ports/runner 内核逻辑可委派 sub-agent（白名单严格限定）。

### W1 — 定义三端口 + 抽 StageBindings 接口

**目标（可验证）**：三端口接口落地编译通过；`CapabilityRunEvent` 加 `telemetry.systemStageId`（向后兼容）；能力家有空 `bindings/` 骨架；新守护 spec/ESLint 就位（此刻应全绿，因尚无违规）。

**改动文件**：

- 新增 `capabilities/deep-insight/pipeline/ports.ts`（`StageBindings` / `MissionPersistencePort` / `MissionTerminalDetails` / `AgentInvocation`）。
- 改 `marketplace/capability/capability-runner.port.ts`：`CapabilityRunEvent` 加 `telemetry?` + `stage:degraded`/`stage:stalled` 类型；`CapabilityRunContext` 加 `persistence?`。
- 新增 `capabilities/deep-insight/pipeline/bindings/`（空骨架 + index.ts）。
- 主 Agent：`backend/.eslintrc.js` 加 §6.1 override；新增 `__tests__/architecture/layer-3-authority/capability-isolation.spec.ts`。

**verify**：

- `npm run type-check` 0 error；`npm run verify:arch` 全绿（含新 spec）。
- 既有 company `runViaCapability` 编译不破（telemetry/persistence 均可选）。

**风险**：低。纯加字段 + 可选端口，向后兼容。风险点：新 ESLint override glob 误伤 → 先 `npm run lint` 验证 0 新增违规。

---

### W2 — 下沉 deep-insight 14 阶段执行内核到 `capabilities/deep-insight/pipeline`

**目标（可验证）**：能力家拥有完整 14 阶段 `StageBindings` 实现，跑 `MissionPipelineOrchestrator` + `recipe`（14-step config）+ 共享 agent，**零 playground import**；`DeepInsightDefaultRunner` 从「手写 6 阶段」升级为「orchestrator + bindings 跑真 14 阶段」；缺 persistence 时用 `InMemoryMissionStore` 纯跑（不落库）。

**改动文件**：

- 新增 `capabilities/deep-insight/pipeline/bindings/*.ts`（14 阶段逻辑：plan/research/assess/reconcile/analyze/outline/draft/quality-enhance/critic/objective-eval/signoff/verifier/steward/persist）—— 逻辑源自勘察 1 的 13 个下沉服务（Leader/Reconciler/Analyst/Writer/Reviewer/Verifier/Steward/评判组合），改写为调 harness `AgentRunner` + 共享 @DefineAgent + 写 `CrossStageState`。
- 改 `capabilities/deep-insight/deep-insight.runner.ts`：`run()` 改为 §1 流程 —— openSession(经 harness/注入) → loadCheckpoint(端口) → `orchestrator.run({ pipelineId: recipe.id, initialCrossStageState, resumeFromStepId, onEvent })` → onEvent 内翻译 `MissionEvent`→`CapabilityRunEvent`（填 `telemetry.systemStageId`）→ 终态经 `ctx.persistence?.applyTerminalIfRunning`（缺省 InMemory）。
- 改 `capabilities/deep-insight/recipe/deep-insight.recipe.ts`：`AGENTS_ROOT_DIR` / eventPrefix 收口为 `deep-insight`（与能力家自洽，不引 playground 命名）。
- 改 `capabilities/deep-insight/runner-deps.ts`：补 `MissionPipelineOrchestrator` / `CrossStageState` / `InMemoryMissionStore` 的 facade re-export。
- 主 Agent：若 orchestrator/CrossStageState/InMemoryMissionStore 未在 `ai-harness/facade` 暴露，先补 facade export。

**verify**：

- `npm run verify:arch` 全绿，含 `capability-isolation.spec`（断言 bindings 零 app/playground import）。
- 新增 `capabilities/deep-insight/__tests__/pipeline-14-stage.spec.ts`：mock AgentRunner，跑 recipe 14 step，断言 stage:started/completed 序列覆盖 14 个 `systemStageId`，crossState 逐级传递，无 DB 调用（persistence = InMemory 探针，0 写）。
- `npm run type-check` 0 error。

**风险**：中。14 阶段逻辑改写量大；prompt/duty 行为须与 playground 等价。缓解：bindings 直接复用 `recipe` 已 load 的 SKILL.md（同一份 soul+duties），agent spec 同一份 `agent-spec-catalog`；以 playground 真实产出做对照基线（同 topic 跑 playground vs 能力内核，比 stage 数 + 报告结构）。**本波不接任何消费方**，纯内核 + spec 验证，隔离风险。

---

### W3 — playground 改消费（注入自己端口）不退化

**目标（可验证）**：playground 不再私有跑 14 阶段，改为消费 `ICapabilityRunner`，注入自己的 `MissionPersistencePort`（包既有 MissionStore）+ `onEvent`（桥既有 EventBus/OTel/WS）；**14 步 + checkpoint/resume + 重跑 + 验收行为全不退化**。

**改动文件**：

- 改 `playground/mission/lifecycle/mission-store.service.ts`：`implements MissionPersistencePort`（薄封装既有 helper：saveCheckpoint→prismaMissionCheckpoint、applyTerminalIfRunning→lifecycleManager.finalize、saveResearchResult/saveReportVersion→既有 report.helper）。
- 改 `playground/mission/pipeline/playground.pipeline.ts`：`runMission` 内核段（勘察 4 的 519-607）改为 `runner.run(input, { userId, missionId, signal, persistence: this.missionStore, onEvent })`；onEvent 内保留 playground 专属胶水（OTel span / bridgeOrchestratorStageEvent / electionTracker）。session 建立/checkpoint hydrate/失败分类/postlude 等 playground 胶水**保留**（勘察 4 标❌的部分）。
- 主 Agent：playground `.module.ts` 注入 `CapabilityRegistry` / resolve deep-insight runner（不直接 import runner class）。

**verify**：

- 既有 `playground-as-template.spec.ts` / `playground-event-contract.spec.ts` / `mission-app-conformance.spec.ts` 全绿（不退化硬证据）。
- 端到端：Railway 环境跑一个 playground mission，14 chip 全亮、报告产出、重跑某 stage 生效（勘察 4 的 rerun 路径）、crash-resume 生效。
- `npm run verify:arch` + `type-check` 全绿。

**风险**：高（动已上线主路径）。缓解：① 先 feature flag（`PLAYGROUND_VIA_CAPABILITY`）灰度，旧 dispatcher 路径保留可回退；② 逐文件 diff 审查；③ checkpoint 序列化格式必须与既有 `leaderJournal.__checkpoint` 兼容（`CrossStageState.toJSON` vs `PlaygroundCrossStageState.toJSON` 字段对齐，W2 已统一 key 前缀）；④ 终态仲裁仍走 `MissionLifecycleManager`（WHERE status='running' 不变）。

---

### W4 — company 消费（注入 company 持久化 + 事件桥）拿真 14 步 + 验收 gate 仍生效

**目标（可验证）**：company 经同一 `ICapabilityRunner` 拿到**真 14 阶段**（不再是 6 阶段精简版）；注入 company 自己的 `MissionPersistencePort`（写 company_missions）+ 升级 `bridgeCapabilityEvent` 读 `telemetry.systemStageId`；**manifest.rubric 验收 gate + 重跑判定不退化**。

**改动文件**：

- 改 `company/services/company-mission.service.ts`：`runViaCapability` 的 ctx 加 `persistence: <company 持久化适配器>`；`bridgeCapabilityEvent` 读 `event.telemetry.systemStageId` 替换硬编码 stepId map；验收 gate（reviewVerdict→score/三档→rubric 重跑）逻辑保留。
- 新增 `company/services/company-mission-persistence.adapter.ts`（implements `MissionPersistencePort`，写 company 既有 mission 表/JSON 列；trajectory 可选方法可不实现）。
- 主 Agent：company `.module.ts` 注入适配器（不动 schema）。

**verify**：

- 新增/扩 company gate 测试：rubric passThreshold/maxAttempts 触发重跑路径绿；reviewVerdict 抽取绿。
- 端到端（Railway）：company hero mission 跑出真 14 阶段（chip 14 个全亮，见 W5），report/references/usage 落 company 库。
- `npm run verify:arch` + `type-check` 全绿。

**风险**：中。company 之前吃 6 阶段，现在 14 阶段 → 耗时/成本上升、事件量增大。缓解：① company 验收 gate 阈值（passThreshold=60）行为不变；② 持久化适配器 trajectory 方法可缺省 no-op（company 不需要逐维落库就不实现）；③ 灰度 flag 同 W3。

---

### W5 — 前端 company 事件带 systemStageId 点亮 14-chip + 任务列表 14 步

**目标（可验证）**：company 前端用 `systemStageId` 点亮**已存在**的 14-chip 视图 + 任务列表 14 步；无新 UI 组件。

**改动文件**：

- 改 company 前端事件消费 hook/store（如 `useCompanyMission*`）：读后端转发的 `systemStageId` → 映射 14-chip 点亮 + todo 14 步推进。
- 改 company 后端 WS 转发（`bridgeCapabilityEvent` 落到 company.\* 事件时带上 `systemStageId` payload，W4 已接事件锚点，本波接前端消费）。

**verify**：

- 前端 `npm run audit:ui-discipline` 不上涨（复用既有 chip/todo 组件，0 新自写 UI）。
- 端到端（Railway）：company mission 运行中 14 chip 按 systemStageId 实时点亮，任务列表 14 步实时推进，与后端 stage 序列一致。
- `playground-frontend-contract.spec.ts` 类前端契约 spec 绿。

**风险**：低-中。纯前端事件接线，复用既有组件。缓解：systemStageId 命名与前端 chip id 对齐表（s1-budget…s11-persist ↔ 14 chip）写进 spec 防漂移；缺口 chip 不静默自写，停下问用户（遵守前端 UI 复用红线）。

---

## 8. 关键文件索引（落档参考）

| 用途                     | 路径                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 端口定义（capability）   | `backend/src/modules/ai-app/marketplace/capability/capability-runner.port.ts`                         |
| 三端口（新增）           | `backend/src/modules/ai-app/marketplace/capabilities/deep-insight/pipeline/ports.ts`                  |
| 14 阶段 bindings（新增） | `backend/src/modules/ai-app/marketplace/capabilities/deep-insight/pipeline/bindings/`                 |
| 默认 runner              | `backend/src/modules/ai-app/marketplace/capabilities/deep-insight/deep-insight.runner.ts`             |
| recipe（14-step config） | `backend/src/modules/ai-app/marketplace/capabilities/deep-insight/recipe/deep-insight.recipe.ts`      |
| 共享 agent               | `backend/src/modules/ai-app/marketplace/capabilities/deep-insight/agents/`                            |
| harness orchestrator     | `backend/src/modules/ai-harness/teams/orchestrator/pipeline/mission-pipeline-orchestrator.service.ts` |
| harness CrossStageState  | `backend/src/modules/ai-harness/teams/services/stages/abstractions/cross-stage-state.ts`              |
| harness IMissionStore    | `backend/src/modules/ai-harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts`  |
| harness InMemory 模板    | `backend/src/modules/ai-harness/lifecycle/mission-lifecycle/in-memory/in-memory-mission-store.ts`     |
| playground 消费改造      | `backend/src/modules/ai-app/playground/mission/pipeline/playground.pipeline.ts`                       |
| playground store→端口    | `backend/src/modules/ai-app/playground/mission/lifecycle/mission-store.service.ts`                    |
| company 消费             | `backend/src/modules/ai-app/company/services/company-mission.service.ts`                              |
| ESLint 守护              | `backend/.eslintrc.js`（§6.1 新 override）                                                            |
| arch spec（新增）        | `backend/src/__tests__/architecture/layer-3-authority/capability-isolation.spec.ts`                   |

---

**版本**：1.0（authoritative） · **依据**：五份只读勘察 + 现状代码核实（capability-runner.port / cross-stage-state / mission-store.interface / deep-insight.runner / deep-insight.recipe / .eslintrc.js） · **日期**：2026-06-09

---

## 附录：硬切收尾后的已知决策与债务（2026-06-09 追加）

> #16 终态硬切（playground 单轨消费能力核）+ 后续修复后沉淀的决策记录，避免被重新当 bug 翻出来。

### A. 章节级复用不映射到能力轨（#16d 决策：接受现状）

OFF 路靠**逐维 chapter_drafts 表**做章节级复用（"更新"时跳过已合格单章）。能力核的 writer
是**单发架构**（recipe `s8-writer` 单 stage、`draftOnce` 单 hook，一次写出全篇 sections），
**无逐章粒度**可选择性复用。结论：

- 能力轨"更新"已复用 **plan + research**（#16a，web 检索是最慢最贵段），writer 单发重生成一次。
- 单发 writer 很可能本就比 OFF 路逐维章节流水线（每章 write+review+retry）更省 token，故"章节复用缺失"
  未必是退化。
- 要做 OFF 路式逐章复用 = 把能力 writer 重构成逐维流水线（重引入刻意简化掉的复杂度），**不做**。

### B. 能力 bindings 必须对真 agent schema 校验（契约守护）

W1–W5 迁移时 bindings 给共享 agent 传的 input 字段名/结构与真 zod schema 不符（s2 depth、
s4 myPlan/researcherOutcomes、s10 foreword+signoff、reviewer draftReport），14-stage spec 用
mock agent 不校验 input → 全程假绿；真 LLM 下 s2 硬挂、s4/s10/reviewer try/catch 静默降级。
已全量对齐 + 新增**契约守护 spec**（`pipeline-14-stage.spec.ts` 的 makeContractValidatingRunner，
对每次 agentRunner.run 的 input 用真 @DefineAgent.inputSchema safeParse）。**铁律**：以后改
bindings 必须让契约守护转绿。

### C. company 耐久性：枢纽+恢复已接，队列待补

- ✅ 持久化端口接线（checkpoint 落 company_missions.result.\_\_checkpoint）+ 终态走仲裁（取消首写赢）
- ✅ boot orphan 恢复（recoverOrphanMissions：可恢复同 missionId 续跑、否则 mark failed 杀僵尸）
- ✅ 失败通知（MissionFailedPreset）
- ✅ 14 步实时任务列表（company.stage:lifecycle 透传 telemetry.systemStageId）
- ⏳ **待补**：入 BullMQ 去 fire-and-forget（彻底消灭"web 进程内异步、进程崩=丢"）；
  heartbeat 失联检测；多 pod 共享 cancel 信号。

### D. company S12 self-evolution 待共享化（债务）

playground 的 S12 自进化（runSelfEvolutionStage，postmortem + memory 沉淀，"专家越用越专业"）
住在 `ai-app/playground/.../stages/`。company 要复用必须先把它**抽到共享层**（engine/harness 或
能力核 postlude），否则 app-to-app 耦合（违反分层）。属架构级改动，未做。

### E. company OTel mission span 待接（债务）

playground 有 `PlaygroundMissionSpanService`（startMissionSpan/startStageSpan）；company 无 trace。
排障目前靠日志。待接共享 tracer。
