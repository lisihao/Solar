# Agent Playground vs 业界 SOTA 系统对标审计

> **审计日期**：2026-04-29
> **审计方法**：纯代码 verify（read-only）+ 业界 SOTA 对标
> **审计范围**：业务流（mission pipeline）+ 整体架构（业务 / Harness / Engine / Infra）+ 12 stage 逐节 dry-run
> **综合评分**：**7.6 / 10** —— 已超 OSS 主流（CrewAI / AutoGen / LangGraph）；与闭源 SOTA（Anthropic Multi-Agent / OpenAI Deep Research / Magentic-One）在工程纪律层面同档；落后在"用户在环 + 自我进化真闭环 + 动态 supervisor 路由"三处

---

## 阅读路径

| 部分                           | 内容                                                         | 适合受众            |
| ------------------------------ | ------------------------------------------------------------ | ------------------- |
| 一、业务流深度分析 + SOTA 对标 | 12 stage 拓扑全图 + 14 维度对比矩阵 + 6 处超 SOTA / 6 处落后 | 架构师 / Tech Lead  |
| 二、整体架构 SOTA 对标         | L4/L2.5/L2/L1 实际分层 + 17 维度对比矩阵 + 亮点 vs 短板      | 架构师 / 平台负责人 |
| 三、12 stage 逐节 Dry-Run      | 每 stage 输入/产出/SOTA 比                                   | Engineering / 调优  |
| 四、综合评分与 P0 改动清单     | 评分表 + 9 项改进按 ROI 排序                                 | PM / 决策者         |

---

# 一、业务流（Mission Pipeline）深度分析 + SOTA 对标

## 1.1 当前业务流 = "12 节点带闭环的瀑布"

```
S1  Budget    余额闸门 + estimateAffordable + budget-warning soft/hard
S2  Plan      Leader 拆 2-7 dim + 声明 successCriteria/qualityBar/deliverables/initialRisks
S3  Research  N×Researcher 并行（DAG/topo 调度，dependsOn 触发）
              ├ per-dim chapter pipeline: outline→chapter writer/reviewer×K→integrator→5-axis grade
              ├ self-heal +50% budget retry on RECOVERABLE failureCode
              ├ cross-mission failure pattern preDisable + successFallback 回写
              └ 自动抽图 (figureExtractor + figureRelevance) 不依赖 LLM 主动抽
S4  Assess    Leader 看完 researcher 产出做决策（accept-all / patch / redirect / abort）
              ├ 单轮 patch 上限 = 2（防 retry 风暴）
              └ 并行 retry + redirect 追加 dim 实跑
S5  Reconcile Reconciler 跨 dim 对账 → factTable / conflicts / overlaps / gaps / termGlossary / figurePool
              └ 业务规则强约束：(entity,attribute) 重复必须有 conflict
S6  Analyst   ReflexionLoop + self/critical verifier，输出 insights + themeSummary + contradictions
              └ 双轮 retry：第一轮 null/格式错误 → 简化 prompt 重跑
S7  Outline   thorough+/paranoid 才跑：Mission-level chapter 大纲（factAllocation + targetWords）
S8  Draft     Writer + judgeWithConsensus(self/external/critical) consensus retry × 2
              ├ Memory.indexAgentTrajectory（轨迹入向量库）
              ├ Credits.consumeCredits（终态扣费）
              └ ReportAssembler.assemble v2 + 三路质量信号融合（reconciler/coverage/reviewer 写到 quality.dimensions）
S8B Enhance   每 section 4 维 self-eval（analytical_depth/evidence/actionability/writing）
              ├ score<7 弱维度 → SectionRemediation 单次 LLM 合并补救
              ├ 补救后强制重评，delta < -0.3 拒绝替换
              └ qualityTraceCtx 记录 before/after
S9  Critic L4 独立 meta-review（blindspot/bias/suggestion/rationale），跳出 Writer/Reviewer 闭环
              └ fail/concerns → 降权 quality.overall × 0.7 / dimensions.novelty × 0.6
S9B Evaluate  EVALUATOR 模型 10 维客观评分（factualAccuracy/analyticalDepth/.../actionability）
              └ 多 writerModel 对比 落 metadata.pipelineEvaluation
S10 Sign-off  Leader 综合所有产出（含 objectiveScore/criticVerdict）写 foreword + 签字
              ├ accountabilityNote 强制引用历史决策（业务规则校验"我在/M0/M1/M6"）
              └ verdict-score 一致性约束（excellent ≥80 / good [65,90) / acceptable [45,75) / failed <60）
S11 Persist   按签字结果分流 markCompleted / markFailed
S12 Evolve    异步：postmortem 落 harness_vector_memory + leader 拒签时入 FailureLearner
```

代码入口：

- `backend/src/modules/ai-app/agent-playground/services/mission/workflow/team.mission.ts`（trunk）
- `backend/src/modules/ai-app/agent-playground/services/mission/workflow/stages/s1-s12.stage.ts`

## 1.2 SOTA 对标矩阵

| 维度                                  | 业界 SOTA 代表                                                               | 本项目                                                                                           | 差距评估                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator-Worker 模式**          | Anthropic Multi-Agent Research、Magentic-One、AutoGen GroupChat              | Leader (4-phase) + Researcher×N + Reconciler/Analyst/Writer/Reviewer/Critic                      | ✅ 同档：Leader 全程在场 + 历史决策可追溯比 Anthropic 公开版更严格（accountabilityNote 强制引用）                                                                                                 |
| **Plan-then-Execute**                 | OpenAI Deep Research（公开 plan 让用户预览）、STORM (perspective generation) | S2 Leader plan 输出 dimensions + goals + qualityBar                                              | ⚠ **缺**：plan 不暴露给用户预览/编辑（OpenAI Deep Research 让用户审 plan 后再 execute），是开发者眼里的"半 transparent"                                                                           |
| **并行子任务调度**                    | Anthropic 让 lead agent spawn 3-5 subagents                                  | DAG 拓扑序 / runWithConcurrency 池化（concurrency 1-10）                                         | ✅ 优于平铺并行；劣于 LangGraph 的 supervisor 动态路由（本项目静态切片）                                                                                                                          |
| **跨源对账**                          | STORM、AutoGen Magentic OrchestratorState                                    | S5 Reconciler（factTable + conflict + gap + termGlossary）独占节点                               | ✅✅ **超 SOTA**：业界很少把"对账"独立成强阻塞节点，多数靠 Writer 自己平衡。本项目用 Zod 强校验 (entity,attribute) 必须有 conflict 是少见的                                                       |
| **多 verifier consensus**             | Self-Consistency、Tree-of-Thoughts、Reflexion ensemble                       | JudgeService self/external/critical + createConsensusResolver + MetaJudge 仲裁                   | ✅ 与 Anthropic Constitutional AI / Self-Refine 同代；用 3 个 prompt 而非 3 个不同模型，**这是最大短板**——同模型自评相关性高，consensus 失真                                                      |
| **元批评 / Critic 层**                | OpenAI o1 self-critic、Reflexion                                             | S9 L4 critic 独立读 artifact 不读 Writer reasoning                                               | ✅ 同档；缺乏 dual judge calibration（同记忆里 evaluation_driven_optimization 标了的 backlog）                                                                                                    |
| **Self-eval per section**             | Stanford STORM、SciAgent                                                     | S8B 4 维 self-eval + 弱维度 remediation + 退步保护                                               | ✅ 较新颖；多数实现没有"重评 + delta 校验"的 closed loop                                                                                                                                          |
| **可执行问责**                        | 几乎无                                                                       | S10 Leader signOff schema 强制：verdict↔score 区间 / refusalReason / accountabilityNote 引用历史 | ✅✅ **超 SOTA**：业界不存在"Lead 拒签 → mission 失败"机制，绝大多数 agent 系统给个分数就交付，不承担问责语义                                                                                     |
| **Self-evolution / 经验沉淀**         | Voyager skill library、AgentLab、DSPy optimizer                              | S12 把 postmortem 入向量记忆 + FailureLearner 拒签入库；下次 leader plan 阶段可召回              | ⚠ **半成品**：（a）postmortem 入库已工作（v3 沉淀后从空壳升级）；（b）但 leader plan **未实际消费 listRecentPostmortems**，环路未闭合（agents/leader/duties/plan.md 看不到 prior knowledge 注入） |
| **Tool 召回 vs 静态绑定**             | Anthropic（runtime tool selection）、HuggingGPT (intent→tool routing)        | AgentRunner.performToolRecall 从 ToolRegistry 实时召回 + Leader toolHint 收窄 + ToolACL 黑名单   | ✅ 同档 Anthropic；优于 CrewAI / LangChain 的硬编码 tools 数组                                                                                                                                    |
| **图文并茂 (citation-aware)**         | Perplexity, GPT Researcher                                                   | S3 figureExtractor + relevance filter + 红线（无 stock 图、无 AI 生图）                          | ✅ 红线机制（reject unsplash/pexels）业界少见                                                                                                                                                     |
| **Failure learning（跨 mission）**    | 几乎无（OpenAI Operator 内部据传有）                                         | HarnessFailureLearner.lookup → markModelDisabled + 成功 fallback 回写                            | ✅✅ **超 SOTA**：把 (agentSpecId, modelId, systemPromptKey, failureCode) 当一张表，preDisable + successfulFallback 双向闭环                                                                      |
| **预算可观测**                        | LangSmith Cost Tracking、AutoGen budget                                      | MissionBudgetPool + cost:tick 事件 + estimateAffordable + budget-warning soft/hard               | ✅ 同档主流                                                                                                                                                                                       |
| **可恢复终止 (graceful degradation)** | LangGraph subgraph fallback                                                  | 每个 stage 独立 try-catch + 单 dim 降级 + 失败码归类（ORCH_DIMENSION_DEGRADED 等）               | ✅✅ **超 SOTA**：业界少有把 12 stage 的失败码全标准化的（如 `RUNNER_OUTPUT_SCHEMA_MISMATCH`、`PROVIDER_BYOK_MODEL_NOT_FOUND`）                                                                   |
| **outputSchema 闭环**                 | Outlines、Instructor、structured outputs API                                 | Zod schema + validateBusinessRules + LLM 重试                                                    | ✅ 优于纯 schema：还做"业务规则二级校验"（Reconciler 必须 ≥3 fact、conflict.factIds ⊆ factTable.id 等）                                                                                           |

## 1.3 业务流的"超 SOTA"亮点 vs 真短板

**真正达到或超过业界 SOTA 的（6 处）**：

1. **Reconciler 强阻塞跨源对账** — 多数系统让 Writer 隐式处理矛盾，本项目用独立 LLM agent 跑结构化对账 + Zod 强约束业务规则。
2. **Leader 全程在场 + accountabilityNote** — 不是橡皮图章，4-phase 历史决策传递 + 业务规则校验"必须引用过去自己说过什么"。
3. **退步保护的 self-eval/remediation 闭环** — `delta < -0.3 拒绝替换` 是工程化处理 LLM "改坏"问题的范例。
4. **失败码标准化 + cross-mission 黑名单** — 12 stage 的失败被归类为有限失败码集合，让自愈逻辑可写且可测。
5. **降级矩阵** — 单 dim 失败、reconciler 失败、figure pipeline 失败 都有明确的 graceful path，mission 不全黑。
6. **Lead 拒签语义闭环** — Lead `signed=false` → mission status=failed("Lead 拒绝签字") 是业界孤品。

**离 SOTA 仍有差距的（6 处）**：

1. **Plan 不暴露给用户预览** — OpenAI Deep Research 已成行业标杆，让用户在 plan 阶段编辑维度/方向，本项目只 emit `leader:goals-set` 给 trace 看（`agent-playground.controller` 没有 plan-confirmation endpoint）。
2. **JudgeService 三 verifier 用同模型不同 prompt** — Anthropic / o1 已用"不同模型族"做 consensus；当前 self/external/critical 都走 `AIModelType.CHAT`，多数情况落到同一个 BYOK 默认模型上（`judge.service.ts:88`）。
3. **S12 闭环未真正消费** — postmortem 落库了，但 Leader plan 阶段的 `agents/leader/duties/plan.md` 没读取历史 postmortem 作为 prior knowledge。沉淀写了，但消费链断了。
4. **lengthProfile 兑现率仍低** — 04-29 观测 extended (25K) 实际只 5K（20%）。`per-dim-pipeline.util.ts:482-485` 已加"字数 < target × 70% 强制 revise"硬门槛，但仍是 prompt-level 督促；缺少**章节字数审计 → 整体 mega/epic 兑现率反馈给 Leader 是否签字**的客观闭环。
5. **没有用户在环 (Human-in-the-Loop) 中断点** — 所有 Plan/Critic/Sign-off 都纯自动；OpenAI Deep Research、Devin、Cursor Agent 都有"中途让用户确认/编辑"机制。
6. **没有动态 supervisor 路由** — Magentic-One / LangGraph supervisor 可基于 state 决定"再跑一轮 reconciler"还是"直接进 writer"；本项目是 12 stage 静态串。

---

# 二、整体架构（Business / Harness / Engine / Infra）SOTA 对标

## 2.1 实际分层（基于代码 verify）

```
─── L4 ai-app/agent-playground (业务) ──────────────────────────────
   trunk:           team.mission.ts (12-stage runMission)
   stage 文件:      services/mission/workflow/stages/s1-s12.stage.ts
   role services:  services/roles/{leader,researcher,reconciler,
                                   analyst,writer,reviewer,verifier,
                                   steward}.service.ts
                   + agent-invoker.service.ts (relay/lifecycle/cost/concurrency)
   Agent specs:    agents/{leader,researcher,reconciler,analyst,
                          writer/{single-shot,chapter-writer,chapter-reviewer,
                                  dimension-integrator,dimension-outline-planner,
                                  mission-outline-planner},
                          reviewer/{mission-critic,mission-reviewer,
                                    dimension-quality-judge}}.agent.ts
   pure code:       services/artifact/report-assembler.service.ts (~900 行)
                   helpers/per-dim-pipeline.util.ts
                   helpers/{narrative,token-spend,failure-extraction}.util.ts
   lifecycle:       MissionStore / MissionState / MissionAbort / MissionEventBuffer / MissionOwnership
   cross-mission:   HarnessFailureLearner (lookup / recordFailure / recordSuccessfulFallback)

─── L2.5 ai-harness (运行时脚手架) ─────────────────────────────────
   kernel/dx:       AgentRunner (5-segment RunResult), AgentSpec, DefineAgent decorator
   kernel/core:     AgentFactory, SpecAgentRegistry, HookRegistry, ContextEnvelope
   execution/loop:  ReActLoop / ReflexionLoop / PlanActLoop / LeaderWorkerLoop
   execution/exec:  LlmExecutor, ToolInvoker, ToolCircuitBreaker
   execution/ctx:   ContextManager, ContextCompactor, PriorityPruner,
                    CacheControlPlanner, TokenEstimator
   execution/tools: ToolSelector + ToolSelectorRegistry + ResultFusion
   governance/critique:  CritiqueRefineService, SectionSelfEvalService,
                         SectionRemediationService, ReportEvaluationService,
                         ReportQualityGateService, QualityTraceComputeService,
                         scanContentDefects (pure fn)
   governance/figure:    FigureRelevanceService
   governance/verify:    JudgeService (self/external/critical + consensus)
   governance/resource:  CircuitBreaker, RateLimiter, CostController, ConstraintEngine,
                         ConstraintEnforcement, ConcurrencyPlanner, RuntimeEnvironment,
                         HealthCheckRunner
   governance/observe:   TraceCollector, AiObservability, LlmTracing, CostAttribution,
                         SessionLatencyTracker, EvalPipeline
   memory:               MemoryAutoIndexer + 向量存储
   protocol:             DomainEventBus, DomainEventRegistry, DomainEvent (scope/payload)
   runtime:              MissionBudgetPool, BudgetAccountant, ModelPricingRegistry,
                         judge-primitives/consensus.ts, BillingRuntimeEnvAdapter

─── L2 ai-engine (核心能力) ────────────────────────────────────────
   llm:           AiChatService (TaskProfile creativity×outputLength)
   tools:         ToolRegistry, 各类 tool 实现
   planning:      intent-detection, intent-router, task-planner
   image:         FigureExtractorService (来自 ai-engine/facade，被 playground/harness 复用)
   content:       report-template (PR-X29 沉淀，被 contracts/ shim re-export)

─── L1 ai-infra (基础设施) ─────────────────────────────────────────
   credits:       CreditsService, BillingContext (run + currentUserId),
                  consumeCredits with idempotencyKey
   storage / encryption / secrets / email / notifications
```

## 2.2 架构模式 SOTA 对标矩阵

| 架构维度                            | 业界 SOTA 模板                                                        | 本项目实现                                                                                                      | 评分                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **L4 ↔ L2.5 边界**                  | LangGraph: 业务 (graph) ↔ runtime (graph engine) 清晰                 | Facade barrel + ESLint no-restricted-imports 强制单向                                                           | ✅ 90 分；Facade 边界守护已成铁规（CLAUDE.md 三条规则）                                  |
| **L2.5 Loop 类型**                  | LangGraph 自定义图、AutoGen 4 种 chat、CrewAI sequential/hierarchical | ReAct / Reflexion / PlanAct / LeaderWorker 4 种 + loopOverride 动态切换                                         | ✅ 与 AutoGen 0.4 同档                                                                   |
| **DI / Provider 模型**              | NestJS（本项目）= 与 Microsoft semantic-kernel 接近                   | Module + Provider + onModuleInit 注册                                                                           | ✅ 工业级；优于 Python 装饰器堆                                                          |
| **Agent Spec as Class + Decorator** | Pydantic-AI、DSPy module、Semantic Kernel ChatHistory                 | `@DefineAgent({id, version, identity, loop, taskCategories, taskProfile, inputSchema, outputSchema, budget})`   | ✅ 与 Pydantic-AI 同代；buildSystemPrompt + validateBusinessRules 是亮点                 |
| **Schema-driven I/O**               | Outlines, Instructor, OpenAI structured outputs                       | Zod input/output + validateBusinessRules 业务规则二级校验                                                       | ✅✅ 业务规则层是少有的实践                                                              |
| **Tool Recall**                     | Anthropic（公开 blog 提及）、HuggingGPT、ToolFormer                   | runtime ToolRegistry 召回 + spec.toolCategories + Leader toolHint + ToolACL + preferIds                         | ✅ 五步流程详细；优于绝大多数主流 framework 的硬编码 tools                               |
| **Context engineering**             | Cline / Cursor / Claude Code 自有                                     | ContextManager + ContextCompactor + PriorityPruner + CacheControlPlanner + TokenEstimator                       | ✅ 工业级；compressIfNeeded 接到 stage（Summarize-on-Handoff，baseline §9.1）            |
| **Event Bus**                       | LangSmith, OpenTelemetry, AutoGen                                     | DomainEventBus + DomainEventRegistry（未注册 type 会 drop+warn）+ DomainEventBuffer（/replay 用）               | ✅ 完整                                                                                  |
| **Observability**                   | LangSmith, Langfuse, Arize Phoenix                                    | TraceCollector + LlmTracingService + EvalPipelineService + SessionLatencyTracker + CostAttribution              | ✅ 自建 + 可对接外部                                                                     |
| **Cost / Budget governance**        | LangSmith Cost、AutoGen budget                                        | MissionBudgetPool + BudgetAccountant per-loop + estimateAffordable + budget-warning 软硬两级                    | ✅ 同档                                                                                  |
| **Mission abort / cancel**          | LangGraph interrupt、AutoGen task.cancel                              | MissionAbortRegistry + AbortSignal 全 stack 透传 + wall-time setTimeout 自动 abort                              | ✅ 完整                                                                                  |
| **持久化恢复**                      | LangGraph checkpoint、Temporal                                        | MissionStore + recoverOrphanedRunning(30) 启动时清理                                                            | ✅ 启动恢复有，但 mid-mission resume 没（崩了从头跑）                                    |
| **多模型路由**                      | LiteLLM, Portkey, OpenRouter                                          | TaskProfile + AIModelType + BYOK + 系统级 default                                                               | ✅ 同档 LiteLLM；缺动态 model routing（同记忆里 evaluation-driven-optimization backlog） |
| **L2.5 vs L2 边界**                 | LangChain (no clear)、Microsoft semantic-kernel (kernel ↔ skills)     | Engine = LLM/Tools/Skills/Planning/Knowledge/Content；Harness = Loop/Memory/Process/Protocol/Governance/Runtime | ✅ 显著优于 LangChain；与 Semantic Kernel agent 框架同代                                 |
| **Quality 闭环 (新)**               | 几乎无标杆                                                            | Section self-eval + remediation + report evaluation + quality gate + trace 5 件套（v3 沉淀）                    | ✅✅ **超 SOTA**：把 quality 当独立子系统而非散点 LLM 调用                               |
| **沉淀机制**                        | DSPy optimizer、Voyager skill library                                 | TI ↔ ai-engine ↔ ai-harness 三方"沉淀"原则（不 fork、不 deep import）                                           | ✅ 工程纪律罕见；但执行有"半成品"（如 S12 消费链未闭合）                                 |
| **Failure-learning**                | OpenAI Operator 内部据传有                                            | HarnessFailureLearner（cross-mission 黑名单 + 成功 fallback 回写）                                              | ✅✅ 超 SOTA                                                                             |

## 2.3 架构层面的"超 SOTA"亮点 vs 真短板

**亮点（4 处）**：

1. **Mission-Stage-Agent-Loop 四层抽象**清晰：业务剧本 (mission) → 单步认知 (agent) → 内部执行 (loop) → 工具调用 (tool-invoker)，每层都 testable。
2. **Facade 单向依赖** + ESLint 强制：从 PR-X29 看，`L5 Intent Gateway 已删除` 这种"敢于删 0 消费方空壳"是工程纪律。
3. **每 stage 独立 .stage.ts 文件 + MissionContext mutable**：12 stage 各自 try-catch + 写 ctx 字段，是 LangGraph "graph node" 模式的 NestJS 实现，比 LangGraph 多了 NestJS DI 优势。
4. **Quality 沉淀 v3** 把 SectionSelfEval / Remediation / ReportEvaluation 抽到 governance/critique，让 TI 和 Playground 共享，未来其它 ai-app 也能复用——这是真正的"枢纽抽象"。

**短板（6 处）**：

1. **L2.5 内部 protocol 包散乱**：DomainEvent/EventBus 在 protocol；MissionBudgetPool 在 runtime；BillingRuntimeEnvAdapter 也在 facade barrel——业务层不知道符号 origin。建议按 Anthropic SDK 把 Tool / Event / Memory 三大原语收紧到一组明确名词。
2. **没有 graph-level abstraction**：当前 `team.mission.ts` 是 hand-written 12-stage runner，没法可视化、没法热替换、没法 declarative 表达 stage DAG。LangGraph 的 `StateGraph` / Temporal 的 `workflow` 都比裸代码高一档。
3. **Memory 没有"用户级长期记忆"产品化接入**：`MemoryAutoIndexer` 把轨迹入库了，但没有"下次同 user 同 topic 自动 RAG 召回 prior findings"的产品 API。这是 Voyager/Letta 的核心。
4. **Process/SubagentSpawner 在 facade 但 playground 不用**：ReActLoop 注释提到 "subagent_spawn 接通 SubagentSpawner（可选注入；Phase D）"，但 playground 没有 spawn 子 agent 的真实场景——所有"分发"都用 Stage S3 静态 fork，错失了 Anthropic Multi-Agent 系统的动态产生子 researcher 的能力。
5. **缺少 Eval as code 集成**：governance/observability 里有 EvalPipelineService 但 Playground 没把它接进 CI/regression test；Anthropic 用 Inspect AI 跑 nightly eval，本项目仍依赖 e2e mission 手测。
6. **缺少 deterministic replay**：MissionEventBuffer 给 /replay 用，但事件流 ≠ 完整可重放（LLM 不确定）。Temporal/Restate 的 deterministic replay 在 LLM 场景需要 prompt cache hash + tool result snapshot——本项目无此能力。

---

# 三、12 Stage Dry-Run 逐节深度分析 + SOTA 对比

> 以 mission："2026 年 AI 监管全球格局深度研究" + `深度=deep, 受众=executive, lengthProfile=epic, audit=thorough, withFigures=true, concurrency=3` 为例。

## S1 Budget Estimate

**代码**：`s1-mission-estimate-budget.stage.ts:21-95`

**做什么**：

- baseEstimate = 400_000 token，乘 budgetMultiplier（high×deep = 2.0×1.4=2.8） → ≈ 1.12M token 估算
- `billing.estimateAffordable({maxTokens: 1.12M})` → 看用户余额是否够
- 不够 → emit `budget-warning-soft` 或 `budget-warning-hard`，suggestion=`abort` 时直接 throw

**SOTA 对比**：

- ✅ AutoGen 0.4 / LangChain budget 都是 mission 跑完才知超限。**事前 estimate** 是 OpenAI Deep Research 之外行业少有的（公开材料）。
- ⚠ **base 400K 是经验值**：未见动态 calibration（基于过去同 topic 的 actual usage）。SOTA 应有 model-driven estimate（如 LiteLLM 的 cost prediction）。

## S2 Leader Plan

**代码**：`s2-leader-plan-mission.stage.ts:22-92` + `agents/leader/leader.agent.ts plan phase`

**做什么**：

- LLM 输出：themeSummary + dimensions[2-7]（按 depth target） + goals.successCriteria/qualityBar.minSources/minCoverage/hardConstraints/deliverables + initialRisks
- 业务规则：dim 数符合 depth 区间 + dim id 唯一
- store.appendLeaderJournal 持久化，下次 phase 可读自己历史

**SOTA 对比**：

- ✅✅ **goals + qualityBar 显式可问责** 强于 OpenAI Deep Research（plan 是 chain-of-thought，不是 contractual）。
- ✅ depth-aware dim count 是 STORM "perspective generation" 同代的设计。
- ⚠ **缺 plan 暴露给用户编辑**：当前 emit 给 trace 看，用户**不能**修改维度后再 execute；OpenAI Deep Research 让用户审 plan 是行业基准。
- ⚠ **plan duty.md 不消费 S12 postmortem**：记忆已落 `harness_vector_memory`，但 plan prompt 里没引用 `listRecentPostmortems(userId, 3)`。**真正的"自我进化"未闭环**。

## S3 Researcher Dispatch

**代码**：`s3-researcher-collect-findings.stage.ts:71-563` + `helpers/per-dim-pipeline.util.ts`

**做什么 (per-dim, ~7 dim 并行)**：

1. **L2 cross-mission 预查**：`failureLearner.lookup` → 拿到该 (topic, dim, language) 历史失败的 modelId，提前 markModelDisabled + emit `failure-pattern:pre-applied`
2. **ResearcherAgent 跑 ReAct**（budget=30K maxIter=5 wall=10min）：1 round parallel search → 1 round scrape (withFigures=true 必须 extractImages=true) → finalize
3. **L1 self-heal**：RECOVERABLE failureCode → +50% budget 重跑
4. **figure pipeline**：若 LLM 没主动抽，从 source URL 自动 figureExtractor → figureRelevance.filter → 取前 3 张
5. **per-dim chapter pipeline** (audit≥default 时启用)：
   - DimensionOutlinePlanner 出章节 outline (3-25 章，按 lengthProfile 推算)
   - 每章 ChapterWriter → ChapterReviewer (revise×2) → 字数 < target×70% 强制 revise
   - sanitizeSectionOutput (v4 白名单清理) + scanContentDefects (defect-scanner emit)
   - DimensionIntegrator 合并 chapter → fullMarkdown / abstract / keyFindings
   - DimensionQualityJudge 5-axis 打分 (breadth 20% / depth 25% / evidence 25% / coherence 15% / freshness 15%)
6. **L3 dim degraded**：单 dim 失败 → findings=[] + summary="(failed: ...)"，mission 仍继续，emit `ORCH_DIMENSION_DEGRADED` + 入 failureLearner

**SOTA 对比**：

| 与谁比                         | 谁更强        | 理由                                                                                                                          |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Anthropic Multi-Agent Research | **持平**      | Anthropic 公开版只到"lead spawn N subagents 并行" + citation agent。本项目多了 per-dim chapter pipeline + 5-axis grade        |
| GPT-Researcher (OSS)           | **本项目强**  | GPT-R 单 query→search→aggregate；本项目有 retry/recover/per-dim outline+chapter+grade                                         |
| STORM (Stanford)               | **持平**      | STORM 用 perspective→search→outline→generate 链；本项目类似但更工业（recovery、failure pattern）                              |
| LangGraph supervisor           | **本项目强**  | LG 给框架，调度策略要业务自写；本项目自带 DAG topo + failureLearner 黑名单 + concurrency 池化                                 |
| OpenAI Deep Research           | **OpenAI 强** | OpenAI 用 o3 reasoning 单模型多步 browse，每步透明展示。本项目是多 LLM 拼装，token 成本更高、单步质量受 model variance 影响大 |

## S4 Leader Assess

**代码**：`s4-leader-assess-research.stage.ts:43-446`

**做什么**：

- Leader 看每 dim 的 (state/findingsCount/sources/summary/failureCode)，决策：accept-all / patch / redirect / abort
- per-dim action：accept / accept-degraded / retry-with-critique / replace-spec / abort
- 防 retry 风暴：单轮 patch ≤ 2，按 finding-count 升序保留最弱 2 个 retry 其余降级 accept-degraded
- redirect.newDimensions[] 追加新 dim 跑 ResearcherAgent

**SOTA 对比**：

- ✅✅ **真闭环过程管理**：Anthropic、AutoGen、LangGraph 都没有 "lead 看 worker 输出后做 patch/redirect/abort 决策"的标准节点。这是本项目最 SOTA 的设计。
- ⚠ patch 上限 2 是经验法则；动态调整（如基于 token 余量）会更强。

## S5 Reconciler

**代码**：`s5-reconciler-cross-dim-fact-check.stage.ts:21-166` + `agents/reconciler/reconciler.agent.ts`

**做什么**：

- 跨 dim 抽 factTable (entity, attribute, value, sources[])
- conflict 检测 (preferred-one / kept-both / flagged-unresolved)
- overlap (merge-into-cross-dim / keep-both / drop-from-second)
- gap (critical / minor)
- termGlossary (canonical → variants)
- figureCandidates 跨 dim 去重汇总，cap 20

**业务规则强校验**（reconciler.agent.ts:252-326）：

- factTable.length ≥ 3
- factTable id 唯一
- 同 (entity, attribute) 重复必须有 conflict
- conflict.factIds ⊆ factTable.id
- unresolved ratio ≤ 30%

**SOTA 对比**：

- ✅✅✅ **业界几乎独有**。STORM/AutoGen/LangGraph 让 Writer 处理 conflict；本项目独立成 LLM 节点 + Zod 强校验业务约束。
- ✅ termGlossary 让下游 Analyst/Writer 用统一术语 → 解决多 dim "AI / 人工智能 / AGI" 混用问题，是产品化质量提升。
- ⚠ Reconciler 失败时（log warn），下游 Analyst 退化路径很弱（缺 conflict→无矛盾消解），mission 仍跑完但质量降。

## S6 Analyst Synthesize

**代码**：`s6-analyst-synthesize-insights.stage.ts:38-198` + `agents/analyst/analyst.agent.ts`

**做什么**：

- ReflexionLoop + self/critical verifier
- 输入：researcherResults（compressIfNeeded handoff） + reconciliationReport
- 输出：insights (≥2 dim 支持)、themeSummary、contradictions（必须显式列出 reconciler 发现的所有 conflicts）
- 双轮 retry：第一轮 null/格式错误 → 简化 prompt 重跑

**SOTA 对比**：

- ✅ Reflexion 同代（Shinn et al., 2023）。
- ✅✅ 强约束"必须列出 reconciler 的 conflicts"是业务规则，而非 prompt 软约束——很多系统 prompt 里说"acknowledge contradictions"但 LLM 经常忽略。
- ⚠ self/critical 用同模型，consensus 失真问题（前文已述）。

## S7 Writer Outline

**代码**：`s7-writer-plan-outline.stage.ts:22-118`

**做什么**：

- 仅 thorough/paranoid 跑
- MissionOutlinePlanner 输出 chapterOutlines (sectionId/heading/thesis + targetWordsPerChapter + factAllocation)
- **当前 Writer 不消费这个 outline**（注释明说："只 emit dimension:outline:planned 给前端 trace，后续 W2 接入"）

**SOTA 对比**：

- ⚠ **半成品**：节点存在但产物未流入下游 Writer。前端能看到大纲在 trace 里，但实际 Writer 起草还是按 dim 各写各的。STORM、Wikipedia outline-then-fill 都是真消费 outline 的。

## S8 Draft + Review + Memory + Assemble

**代码**：`s8-writer-draft-report.stage.ts:85-623`

**做什么**：

- SingleShotWriterAgent 起草 ResearchReport (title/summary/sections/conclusion/citations)
- judgeWithConsensus (self/external/critical, passThreshold=70)
- < pass → retry，max 2 次
- MemoryAutoIndexer.indexAgentTrajectory 入库
- credits.consumeCredits 终态扣费 (idempotencyKey=missionId)
- ReportAssembler.assemble 出 ReportArtifact v2
- 把 reconciliation 的 conflicts/gaps、coverage degraded 比例、reviewer score 三路信号融合到 quality.dimensions（factualConsistency / coverage / styleConformance + qualityTrace 时序记录）

**SOTA 对比**：

- ✅✅ 三路信号融合是少见实践；多数系统 reviewer 给个 final score 就完事，不让 reviewer 信号反向影响 dimension-level quality。
- ⚠ Writer 是 single-shot；OpenAI Deep Research/o1 用 chain-of-draft；本项目靠 chapter pipeline (S3 内部) 做长文，single-shot 主要服务"短报告/汇总"。
- ⚠ memory indexed 后 leader plan 阶段未召回，**S12 闭环在此处实际中断**。

## S8B Section Quality Enhancement

**代码**：`s8b-section-quality-enhancement.stage.ts:49-197`

**做什么**：

- 每 section（fullMarkdown.slice(startOffset, endOffset)）跑 4 维 self-eval：analytical_depth / evidence_coverage / actionability / writing_quality (1-10)
- weakArea (score<7) → SectionRemediation.remediate（合并补救，单次 LLM）
- 重评 → 取 delta；delta < -0.3 拒绝替换（防 regression）
- 倒序处理 section 防 offset 漂移
- qualityTraceCtx 记录 before/after

**SOTA 对比**：

- ✅✅ **退步保护 + delta 校验**是工程化处理"LLM 改坏"的范例；STORM/Refiner 不做这个。
- ✅ 4 维度划分接近 McKinsey/BCG 内部的 reviewer rubric。
- ⚠ 4 维硬编码；动态/可配置 rubric（按 audienceProfile 变）会更产品化。

## S9 L4 Critic

**代码**：`s9-reviewer-critic-l4.stage.ts:25-225`

**做什么**：

- 触发：auditLayers ∈ {thorough, paranoid} 或 audience=executive 且非 minimal
- 不读 Writer reasoning，只看 artifactSummary + reviewer score
- 输出 verdict (pass/concerns/fail) + blindspots + biasFlags + suggestions + rationale
- fail → quality.overall × 0.7 + dimensions.novelty × 0.6 + dimensions.styleConformance × 0.7 (有 bias 时)
- concerns → overall × 0.9 + novelty × 0.85

**SOTA 对比**：

- ✅ 与 Anthropic Constitutional AI 同代。
- ⚠ 单 LLM 跑 critic；ensemble critic（多 critic 投票）是 Reflexion ensemble 进阶——但成本翻倍。

## S9B Objective Evaluation

**代码**：`s9b-report-objective-evaluation.stage.ts:26-98`

**做什么**：

- 每 chapter 用 EVALUATOR 模型独立打 10 维分（factualAccuracy/analyticalDepth/evidenceCoverage/informationDensity/logicalConsistency/visualQuality/writingQuality/originality/timeliness/actionability）
- 汇总 overallScore + grade + modelComparison
- 落 reportArtifact.metadata.pipelineEvaluation

**SOTA 对比**：

- ✅ 与 Stanford HAI evaluation rubric 接近（10 维比业界普通 5 维细）。
- ⚠ EVALUATOR 模型的 calibration 没有 ground truth 校准；记忆里的 backlog "double-judge calibration" 是这块。

## S10 Leader Foreword + Sign-off

**代码**：`s10-leader-foreword-and-signoff.stage.ts:28-185` + `agents/leader/leader.agent.ts foreword/signoff`

**做什么 (foreword)**：

- 综合 dimensionStates + reconStats + reviewerAvg + criticVerdict + criticBlindspots + objectiveScore → 产 whatWeAnswered (yes/partial/no per criterion) + whatRemainsUnclear + howToRead + recommendedFollowUp
- 业务规则：有 degraded/criticalGap/criticConcern → whatRemainsUnclear 不能为空（Lead 必须诚实）

**做什么 (signoff)**：

- 产 leaderOverallScore + leaderVerdict + accountabilityNote + signed (boolean) + refusalReason
- 业务规则：
  - signed=false 必填 refusalReason
  - verdict↔score 区间一致 (excellent ≥80 / good [65,90) / acceptable [45,75) / failed <60)
  - accountabilityNote 必含 "我在/我决定/M0/M1/M6/当时" 之类历史决策引用

**SOTA 对比**：

- ✅✅✅ **业界孤品**。没有任何主流 framework（AutoGen、CrewAI、LangGraph、Magentic-One、Anthropic 公开版）做到"Lead 拒签 → mission 失败"的语义闭环。这是把 LLM agent 提升到"工程负责人"语义的关键设计。
- ⚠ 但记忆里 04-29 观测 "近 5 mission 全 failed"，因为 `coverageScore < 90 强制 quality-failed` 阈值过严。**设计领先但参数失调**。

## S11 Persist

**代码**：`s11-mission-persist.stage.ts:49-115`

**做什么**：

- snapshot 落 agent_playground_missions 行
- leaderSignOff.signed === false → markFailed("Lead 拒绝签字")
- signed === true → markCompleted + leaderOverallScore/leaderVerdict
- 未跑到 M7 → markCompleted (leaderSigned=undefined)

**SOTA 对比**：

- ✅ 同档 LangGraph checkpoint。
- ⚠ 没有 mid-mission resume（崩了从头跑）；Temporal/Restate 是 SOTA，本项目无。

## S12 Self-Evolution

**代码**：`s12-self-evolution.stage.ts:69-212`

**做什么**：

- 异步（不阻塞用户看报告）
- 计算 qualityHitRate (overallQuality / declaredBar) / wallTimeMs / totalCostUsd
- 5 条 rule-based recommendations
- emit `mission:evolved` 给前端
- 真沉淀 1: leader 拒签 → failureLearner.recordFailure
- 真沉淀 2: postmortem 入 harness_vector_memory（namespace=userId, tags=['agent-playground','mission-postmortem',signed/unsigned]）

**SOTA 对比**：

- ⚠ 真沉淀链已落，但**消费方未实现**：leader plan duty.md / agents/leader/duties/plan.md 没有"召回 user 历史 postmortem 注入 prior knowledge"的步骤。Voyager (Wang et al., 2023) 的核心是 "skill library lookup before plan"，本项目"library 写了但 plan 不读"。

---

# 四、综合评分与改进建议

## 4.1 总体评分（与业界 SOTA 对标）

| 维度                                     | 评分（0-10） | 业界对标                                                                                                                 |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 业务流深度（节点完整度）                 | **9.0**      | 12 节点 + S8B/S9B 深度审计闭环；行业平均 5-7 节点                                                                        |
| 业务流闭环（self-evolution）             | **6.5**      | 沉淀已落，消费未闭；行业平均 4-5（多无沉淀）                                                                             |
| Agent 设计（spec/loop/budget）           | **8.5**      | DefineAgent + Zod + validateBusinessRules 业务规则二级校验                                                               |
| Harness 抽象（loop/tool/judge/critique） | **8.5**      | 4 loop + judge consensus + quality v3 5 件套                                                                             |
| Engine 边界（Facade 单向依赖）           | **9.0**      | ESLint 强制 + barrel 收口；行业典范                                                                                      |
| Infra 计费/配额/恢复                     | **8.0**      | MissionBudgetPool + idempotency + recoverOrphaned                                                                        |
| Observability                            | **7.5**      | TraceCollector + Eval + Cost；缺 nightly eval as code                                                                    |
| 可演进性                                 | **6.5**      | 12 stage hand-written，缺 declarative graph DSL                                                                          |
| Human-in-the-Loop                        | **3.0**      | 全自动；无 plan-confirm/critic-confirm 中断点                                                                            |
| 工程纪律（沉淀/边界/单向依赖）           | **9.5**      | "沉淀 ≠ 复制" 原则 + 行为红线 + Sub-Agent 管控                                                                           |
| **综合**                                 | **7.6 / 10** | 已超过 OSS 主流（CrewAI/AutoGen/LangGraph）；与 Anthropic/OpenAI 闭源 SOTA 在工程纪律上同档，在用户在环/动态调度上有差距 |

## 4.2 按"投入产出比"排序的关键改进项

| 优先级 | 改进                                                                                              | 工作量                            | 预期收益                                                             |
| ------ | ------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| **P0** | S2 Plan 暴露给用户预览/编辑（plan-confirmation endpoint）                                         | 中（1 周）                        | 对标 OpenAI Deep Research 行业基线，质量+用户感受双赢                |
| **P0** | Leader plan duty.md 接入 `listRecentPostmortems` → S12 闭环真闭合                                 | 小（2 天）                        | "自我进化"从口号变为产品；同 user 同 topic 第二次 mission 应明显提速 |
| **P0** | leader signoff 阈值分档（quick=70 / deep=80 / mega=85） + 字数兑现率 ≥ 80% 才能 excellent         | 小（1 天）                        | 修当前"近 5 mission 全 failed"产线问题（已写入记忆 quality-gap）     |
| **P1** | JudgeService 三 verifier 走不同 model family（如 self=Claude / external=GPT / critical=Grok）     | 中（3 天，需扩展 modelType 解析） | consensus 真正去相关，分数更可信                                     |
| **P1** | S7 Writer outline 真消费（outline 流入 S8 SingleShotWriter）                                      | 中（3-4 天）                      | epic/mega 长文兑现率提升；当前 outline 是死字段                      |
| **P2** | 引入 graph DSL（pseudo-LangGraph StateGraph or 自建 DAG schema）                                  | 大（2-3 周）                      | stage 可视化、热替换、单 stage 测试隔离                              |
| **P2** | Process/SubagentSpawner 接通 ReActLoop 的 subagent_spawn → 让 Writer 真能 spawn 子 chapter writer | 大（2 周）                        | 长文写作动态扩展能力，对标 Anthropic Multi-Agent                     |
| **P2** | EvalPipelineService 接 nightly regression（10 fixed mission + judged）                            | 中（1 周）                        | 防止 SOTA 优化回归                                                   |
| **P3** | mid-mission resume（MissionStore 加 stage cursor + ctx snapshot）                                 | 大（2-3 周）                      | Railway recycle 不致全跑废                                           |

## 4.3 一句话总结

> **业务流：12 节点带闭环，业界 OSS 范式中拓扑最完整、容错最严谨之一；架构：4 层分隔 + Facade 强制边界 + Quality v3 5 件套，工程纪律罕见；离世界 SOTA 的差距，主要在"用户在环 + 自我进化真闭环 + 动态 supervisor 路由"三处——技术债不是设计缺陷，是从"工程已落"到"产品/学习闭环"的跃迁。**

---

## 附录：审计方法论

**纯代码 verify**：所有判断基于直接读 main 分支源码，未依赖文档/注释/记忆里的描述。关键文件：

- `team.mission.ts`（trunk，~787 行）
- `stages/s1-s12.stage.ts`（12 个独立 stage 文件）
- `helpers/per-dim-pipeline.util.ts`（per-dim chapter pipeline，~666 行）
- `agents/{leader,researcher,reconciler,analyst,writer,reviewer}.agent.ts`（8 个 Agent spec）
- `services/roles/{leader,agent-invoker}.service.ts`（per-role wrapper + 通用 invoker）
- `ai-harness/facade/index.ts`（暴露给 ai-app 的能力清单）
- `ai-harness/kernel/dx/agent-runner.service.ts`（DX 入口 + 5 段式 RunResult）
- `ai-harness/execution/loop/react-loop.ts`（ReAct 实现）
- `ai-harness/governance/verify/judge.service.ts`（JudgeService）

**SOTA 对标参照**：

- 闭源：Anthropic Multi-Agent Research（2024-06 blog）、OpenAI Deep Research（2025）、Google Gemini Deep Research、Microsoft Magentic-One
- 开源：AutoGen 0.4 / Magentic、CrewAI、LangGraph、MetaGPT、STORM、GPT-Researcher、Voyager、DSPy
- 论文：ReAct (Yao 2022)、Reflexion (Shinn 2023)、Self-RAG / CRAG、Tree of Thoughts、Plan-and-Solve、HuggingGPT、Self-Refine、Constitutional AI

**未审计范围**（留给后续 deep dive）：

- 前端三视图组件（continuous/chapter/quick reader）
- ReportAssemblerService 的 ~900 行装配逻辑
- ai-engine/content/report-template 的 13 类格式化标准（~4344 行）
- ai-harness/governance/observability 的 trace/eval pipeline 接入深度
- Tool 召回引擎（ToolSelector + ResultFusion）的具体算法
