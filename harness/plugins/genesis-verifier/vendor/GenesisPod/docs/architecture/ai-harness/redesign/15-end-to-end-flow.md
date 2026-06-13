# Topic Insights · 端到端流程图

> 版本：2026-04-24（Model Election 落地后）
> 目标：一张图看清 "用户提交话题 → 拿到完整报告" 的全链路，每个节点可直接跳到代码。

---

## 0 · 分层速览

```
┌─────────────────────────────────────────────────────────────────────────┐
│ L5 Intent Gateway  │ modules/intent-gateway/ (意图路由，暂不参与)        │
├─────────────────────────────────────────────────────────────────────────┤
│ L4 Open API        │ modules/open-api/ (MCP Server，外部 API)            │
├─────────────────────────────────────────────────────────────────────────┤
│ L3 AI App          │ modules/ai-app/topic-insights/                      │
│                    │  ├─ api/controllers/ (HTTP / WebSocket)             │
│                    │  ├─ mission/ (lifecycle / pipeline / orchestrator)  │
│                    │  ├─ agents/specs/ (19 个 IAgentSpec)                │
│                    │  └─ knowledge/ search/ evidence-sync/ ...           │
├─────────────────────────────────────────────────────────────────────────┤
│ L2 AI Engine       │ modules/ai-engine/                                  │
│                    │  ├─ facade/ (唯一对外入口)                          │
│                    │  ├─ llm/ (AiChatService, Election, Adapters)        │
│                    │  ├─ harness/ (SpecBasedAgent, LlmExecutor, ReAct)   │
│                    │  ├─ runtime/ (env resource, supervisor, journal)    │
│                    │  ├─ knowledge/ (RAG: embedding + vector + chunker)  │
│                    │  ├─ tools/ skills/ teams/ agents/ mcp/ safety/      │
│                    │  └─ observability/ realtime/ scheduler              │
├─────────────────────────────────────────────────────────────────────────┤
│ L1 Infra           │ modules/ai-infra/ (Auth, Credits, Storage, BYOK)    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1 · 端到端宏观流（Happy Path）

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ 用户                                                                               │
│   POST /api/v1/topic-insights/topics  { title, type, researchDepth }              │
└──────────────────────────────────┬────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ① 鉴权 + 话题落库 + 创建 Mission                                     │
│   TopicAccessGuard → TopicController.createTopic                    │
│   └─ TopicInsightsService.createTopicAndStartResearch               │
│       └─ MissionLifecycleService.createMission                      │
│          ├─ prisma.topic.create                                     │
│          └─ prisma.researchMission.create { status: QUEUED }        │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ missionId
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ② 入队 + 环境感知                                                    │
│   MissionExecutionService.runWithHarness(missionId)                 │
│   ├─ RuntimeEnvironmentService.snapshot(userId)                     │
│   │   └─ AIModel findMany → CHAT/REASONING/EMBEDDING/VISION 桶      │
│   │      + agent/tool/skill registries + error rate                 │
│   ├─ TopicInsightsCapabilityReconciler.reconcile                    │
│   │   └─ 降级建议 + TopicInsightsCapabilitySnapshot                  │
│   └─ 构造 PipelineIdentityContext {                                  │
│          missionId, topicId, reportId, userId,                      │
│          capabilities: { env, recommendedDepth, degradations },     │
│          budget, abortController, mode, ...                         │
│      }                                                               │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ identity
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ③ PipelineOrchestratorService.run(identity, stageList)              │
│   按拓扑顺序执行 15 个 stage（依赖由 dependsOn 决定）。               │
│   每个 stage 的生命周期：                                            │
│     ├─ prepare(identity, upstream) → StageInput                      │
│     ├─ execute(identity, input, signal) → StageOutput                │
│     └─ persist(identity, output) → void                              │
│   事件：stage:started · stage:completed · stage:failed               │
│   取消：signal 由 abortController 驱动，stage 主动查 signal.aborted   │
│   Checkpoint：ST-00 创建，后续 stage 每完成一步进 pipeline-checkpoint │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼  15 stages (见第 2 节)
                                   │
┌──────────────────────────────────┴──────────────────────────────────┐
│ ④ 报告落盘 + Mission 收尾                                            │
│   ST-11-ASM / ST-12-EDIT / ST-13-GATE / ST-14-FINALIZE               │
│   → prisma.topicReport.update { fullReport, status: READY }          │
│   → prisma.researchMission.update { status: COMPLETED, completedAt } │
│   → eventEmitter.emit("topic-insights.report.refreshed")             │
│   → WebSocket ResearchEventType.REPORT_READY                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                         用户拿到 topicReport
                     /topics/:id/latest-report
```

---

## 2 · 15-Stage Pipeline 详图

```
ST-00-INIT
  ├ 创建 TopicReport draft 行（status=WRITING）
  ├ 写入 leaderPlan 占位 / budget 快照
  └ emit: mission:started
      │
      ▼
ST-01-PLAN  ——  AG-01-LD (Leader · LeaderPlanner)
  ├ PlanContextProvider.load → topicName / topicType / availableModels
  ├ executeSpec(input, capabilities.env)
  │   └ Election: role=leader → reasoning 模型优先
  │   └ LLM → LeaderPlan { dimensions[]，每维度分配 modelId + agentId }
  └ persist: prisma.topicDimension upsert × N，researchMission.leaderPlan 更新
      │
      ▼
ST-02-RESEARCH  ——  AG-02-LAS × dim (LeaderAgenticSearcher)
  ├ 每个 dimension 并行：
  │   ├ SearchAdapterRegistry.pick → Tavily/DuckDuckGo/PubMed/Finance/...
  │   ├ UrlValidationService → 过滤坏链
  │   ├ ContentEnrichmentService → fetch + parse
  │   ├ EvidenceEvaluationService → 相关性 / 来源权威度
  │   └ prisma.topicEvidence.create × N + evidenceSync（Library）
  └ output: byDimension[{ dimensionId, evidenceIds, evidenceCount }]
      │
      ▼
ST-03-WRITE  ——  AG-03-SW × (dim × section)
  ├ 读 ST-02 的 topicEvidence 行
  ├ TIER_ADAPTATIONS 自适应：
  │   · leader model tier=BASIC → 最多 8 条证据 + 结构化 promptSuffix
  │   · tier=STRONG → 不限证据 + 综合推理 promptSuffix
  ├ executeSpec(input, env) × M sections
  │   └ Election: role=writer → STRONG 模型优先
  │   └ LLM → SectionResult { content, wordCount, keyFindings, citations }
  └ output: sections[]
      │
      ▼
ST-04-REVIEW  ——  AG-04-SR × section (SectionReviewer)
  ├ 每个 section 调 AG-04-SR
  │   └ Election: role=reviewer → STRONG
  │   └ LLM → SectionReview { needsRevision, issues, revisionInstructions }
  └ output: reviews[]
      │
      ▼ (有 needsRevision 时触发 remediate 循环)
      │
ST-04-REMED  ——  AG-12-SREM × (needsRevision section)
  └ 覆盖 ST-03 的 section.content
      │
      ▼
ST-05-INTEGRATE  ——  AG-05-ME × dim (MetaExtractor)
  ├ 每个 dim 的多个 section 合并 → dimensionMetas[]
  │   { summary, keyFindings, trends, challenges, evidenceCount }
  └ output: integrate.dimensionMetas
      │
      ▼
ST-06-COGLOOP  (thoroughOrDeep, degrade 时跳过)
  ├ AG-08-GS  GapSearcher    每个 dim 找研究缺口
  ├ AG-09-HV  HypothesisVerifier  验证 trends/challenges 假设
  └ AG-10-FX  FactExtractor   提炼可核查事实
      output: { gapsByDim, hypotheses, facts }
      │
      ▼
ST-07-SYNTHESIS  ——  AG-11-SY (Synthesizer)
  ├ 输入：dimensionMetas + integratedSectionsPerDim + cogLoop 产物
  └ output: synthesis.fullMarkdown + executiveSummary + crossCuttingThemes
      │
      ▼
ST-08-QGATE  ——  ReportQualityGateService
  ├ 10+ 维度规则检查（heading_hierarchy / citation_coverage / bold_density /
  │   min_content_length / chart_json_residue / blockquote_density / ...）
  ├ violations >= threshold → needsRemediate=true
  └ 触发新一轮 ST-04-REMED → ST-05-INTEGRATE → ST-07-SY → ST-08-QGATE
      (maxRounds 由 orchestrator 控制)
      │
      ▼
ST-09-REPORT-EDIT  ——  AG-06-RED (ReportEditor)
  └ 顶层润色：段落过渡 / 冗余剔除 / 专业术语统一
      │
      ▼
ST-10-FACT-CHECK  ——  AG-07-FC (FactChecker)
  ├ 从正文抽 claim[]，对 topicEvidence 做引用核查
  └ output: { accuracyScore, issueCount, issuesByClaim }
      │
      ▼
ST-11-ASM  ——  ReportAssemblyService
  ├ 拼装 fullReport：cover + toc + sections + appendix + references
  └ 写 prisma.topicReport.fullReport / structuredReport
      │
      ▼
ST-12-EDIT  (LaTeX 修复 + Figure 合成 + RAG 索引)
  ├ LatexRepairService（有公式时补分隔符）
  ├ Figure pipeline：AG-13-FIGGEN → TL-03-FIGEXT → 图插入
  └ DocumentChunker + EmbeddingService + VectorService
      store chunks + embedding into child_embeddings
      │
      ▼
ST-13-GATE  (最终门禁 · 防止 release 劣质报告)
      │
      ▼
ST-14-FINALIZE
  ├ researchMission.status = COMPLETED
  ├ topicReport.status = READY
  ├ eventEmitter.emit(report.refreshed)
  └ WebSocket REPORT_READY → 前端拉新
      │
      ▼
  用户收到完整报告（HTML + Markdown + citations + 图表）
```

---

## 3 · 一次 Agent 执行的微观流（以 ST-03-WRITE 里的 AG-03-SW 为例）

```
WriteStage.execute(identity, input, signal)
  │
  │  runner = SpecAgentRegistry.get("AG-03-SW")   // SpecBasedAgent 实例
  │
  ▼
SpecBasedAgent.executeSpec(sectionInput, identity.capabilities.env)
  │
  ├─ buildSystemPrompt(ctx) / buildUserPrompt(ctx)     (spec 声明)
  │
  ├─ ★ 环境感知选举 electModelOrNull(taskProfile, userId, env)
  │     │
  │     │ role = resolveRoleHint("AG-03-SW") → "writer"
  │     │ candidates = env.models.CHAT + env.models.REASONING
  │     │
  │     ▼
  │   ModelElectionService.elect({
  │     modelType: CHAT, candidates, taskProfile, role: "writer", userId
  │   })
  │     ├─ Step 1  硬过滤 (type 兼容 + healthy + blacklist)
  │     ├─ Step 2  BYOK 过滤 (KeyResolverService.getAvailableProviders)
  │     ├─ Step 3  每个候选查 DB AIModelConfig
  │     ├─ Step 4  多维打分：
  │     │         tier(STRONG=25 / STANDARD=10) + role("writer"+STRONG=+15)
  │     │         + cost + health + priority + isDefault
  │     └─ Step 5  排序 + tie-break → elected = "claude-sonnet-4-0"
  │
  ├─ LlmExecutor.execute({ agentId, model: elected, systemPrompt, userPrompt,
  │                        outputSchema, validateBusinessRules, taskProfile,
  │                        signal, stubFn? })
  │     │
  │     │ stub 模式（AI_ENGINE_AGENT_STUB=1 且非 production）→ stubFn
  │     │ 正常：retry loop (maxRetries=2)
  │     │   ├─ aiChatService.chat({ model, messages, taskProfile,
  │     │   │                      responseFormat:"json", signal, userId })
  │     │   │     │
  │     │   │     ├─ getModelConfig(model) → AIModelConfig
  │     │   │     ├─ BYOK resolve (KeyResolverService) → apiKey + endpoint
  │     │   │     ├─ TaskProfileMapper → temperature + maxTokens
  │     │   │     ├─ AiApiCallerService.callXxxAPI (openai/anthropic/google)
  │     │   │     ├─ retry on rate-limit (AiChatRetryService)
  │     │   │     ├─ CircuitBreakerService 记录成功/失败
  │     │   │     └─ AiObservabilityService.recordMetric + cost
  │     │   │
  │     │   ├─ extractJsonFromLlmContent (容错 fence)
  │     │   ├─ Zod safeParse(outputSchema)  失败 → error-fed retry
  │     │   └─ validateBusinessRules(output) 失败 → error-fed retry
  │     │
  │     └─ 返回 { output, tokensUsed, model: 实际使用的, costUsd, retries }
  │
  └─ state="completed"; return SpecAgentResult<SectionResult>

WriteStage.execute 拿到 SectionResult → sections.push(res.output)
```

---

## 4 · 关键横切机制（贯穿所有 stage）

### 4.1 取消 / Abort

```
用户点 "取消"
  → TopicController.cancelRefresh
    → MissionCancellationService.cancel(missionId)
      → identity.abortController.abort()
        → 每个 stage.execute 的 signal.aborted 被触发
        → ReActLoop / LlmExecutor 查 signal.aborted 抛 AbortError
        → aiChatService.chat(signal) 在 HTTP 层中断请求
```

### 4.2 Mission 暂停 / 续跑

```
MissionAmendmentService.pauseForAmendment → mission.status = PAUSED
  + PipelineCheckpointService.save（记录已完成 stage 列表）

恢复：mission.status = EXECUTING
  → PipelineOrchestrator 读 checkpoint → 跳过已完成的 stage
  → 从下一个 stage 继续
```

### 4.3 实时进度 (WebSocket)

```
每个 stage 的事件：
  engineEventEmitter.emit({
    room: `topic-insights:mission:${missionId}`,
    type: ResearchEventType.STAGE_STARTED / STAGE_COMPLETED / ... ,
    payload: { stageId, progress, ... }
  })
前端订阅 /ws?missionId=... 拿到实时进度条
```

### 4.4 Quality Gate 循环

```
ST-08-QGATE.failedViolations > threshold
  ├─ AG-16-MA 判决（continue / abort / downgrade_depth）
  ├─ ST-04-REMED → ST-05-INTEGRATE → ST-07-SY → ST-08-QGATE
  └─ round < maxRounds
```

### 4.5 Observability

```
每个 AG-XX 调用：
  traceCollector.startSpan + endSpan (含 model / tokens / latency)
  evalPipelineService.record (可回放评测 baseline)
  costAttributionService.attribute (按 userId / missionId / stage)
```

---

## 5 · 数据库路径

```
Topic (topics)
  └─ TopicDimension (topic_dimensions)                    ← ST-01-PLAN 创建
       └─ TopicEvidence (topic_evidence)                  ← ST-02-RESEARCH 创建
            └─ ChildChunk + child_embeddings (pgvector)   ← ST-12-EDIT 索引

ResearchMission (research_missions)                       ← ①createMission
  └─ leaderPlan (JSON)                                    ← ST-01-PLAN persist
  └─ status state machine: QUEUED → EXECUTING → (PAUSED|COMPLETED|FAILED|CANCELLED)

TopicReport (topic_reports)                               ← ST-00-INIT 创建 draft
  ├─ fullReport (Markdown，长文走 R2 offload)              ← ST-11-ASM 更新
  ├─ structuredReport (JSON)
  └─ status: WRITING → READY

TopicReportSection (若启用细粒度存储)                      ← ST-03 → ST-05
AgentActivity / LatencySession / process_events          ← observability

AIModel (ai_models) — isEnabled/isDefault/isReasoning/priority/supportsVision
  ← ModelElectionService 打分依据
```

---

## 6 · 容错与降级

| 失败点                                      | 处理                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Leader model 选不出（NoEligibleModelError） | ST-01 fail → mission FAILED，返回明确错误                                           |
| Stage 超时（signal abort）                  | stage emit failed → orchestrator 判是否 retry / degrade                             |
| Quality Gate 循环未收敛（round >= max）     | 降级接受当前报告，日志 warn                                                         |
| Evidence 0（某 dimension 搜不到）           | AG-08-GS 补充 gap，否则该 dim section 空占位                                        |
| WebSocket 断连                              | 前端 SSE 回退，订阅 `/topics/:id/refresh/progress`                                  |
| process 内存溢出 / OOM                      | ProcessSupervisorService 监测 → kill + resume from checkpoint                       |
| BYOK 用户 key 无效                          | AiChatService 抛 NoAvailableKeyError → 前端 ByokErrorCard 引导到 /settings/api-keys |

---

## 7 · 一次典型调用的代码引用索引

| 入口 / 阶段      | 关键文件                                                                        |
| ---------------- | ------------------------------------------------------------------------------- |
| HTTP 入口        | `backend/src/modules/ai-app/topic-insights/api/controllers/topic.controller.ts` |
| Mission 生命周期 | `.../mission/control/mission-lifecycle.service.ts`                              |
| 任务执行入口     | `.../mission/execution/mission-execution.service.ts`                            |
| 环境感知         | `backend/src/modules/ai-engine/runtime/resource/runtime-environment.service.ts` |
| 能力对齐         | `.../topic-insights/agents/capability/reconciler.ts`                            |
| Pipeline 编排    | `.../mission/pipeline/pipeline-orchestrator.service.ts`                         |
| 15 个 stage      | `.../mission/pipeline/stages/st-00..st-14.*.ts`                                 |
| 19 个 agent spec | `.../topic-insights/agents/specs/*.ts`                                          |
| Spec 执行器      | `backend/src/modules/ai-engine/harness/core/spec-based-agent.ts`                |
| LLM 执行         | `.../ai-engine/harness/executor/llm-executor.ts`                                |
| 模型选举         | `.../ai-engine/llm/election/model-election.service.ts`                          |
| LLM 调用         | `.../ai-engine/llm/services/ai-chat.service.ts`                                 |
| API 调用         | `.../ai-engine/llm/services/ai-api-caller.service.ts`                           |
| BYOK             | `backend/src/modules/ai-infra/key-resolver/key-resolver.service.ts`             |
| RAG 存证         | `.../ai-engine/knowledge/rag/embedding/` + `.../vector/vector.service.ts`       |
| Quality Gate     | `.../topic-insights/quality/report-quality-gate.service.ts`                     |
| WebSocket        | `.../topic-insights/gateways/research-event.gateway.ts`                         |

---

## 8 · 与 Apr 21 baseline 的核心差异

| 维度                | Apr 21 baseline          | 现在                                                  |
| ------------------- | ------------------------ | ----------------------------------------------------- |
| Agent 框架          | plan-based + god service | declarative IAgentSpec + SpecBasedAgent               |
| 执行链              | 定制 task-executor 树    | 15-stage 声明式 pipeline                              |
| 环境感知            | 隐式，散落在 service     | RuntimeEnvironmentService + CapabilityReconciler      |
| 模型选择            | 硬编码 + env fallback    | ModelElectionService 多维打分                         |
| 取消                | 不传 signal / 部分支持   | AbortController 贯穿全链                              |
| Checkpoint          | 无                       | PipelineCheckpointService + Harness CheckpointService |
| Subagent            | 无                       | SubagentSpawner + 3 级 isolation                      |
| Context engineering | 无                       | ContextCompactor + Pruner + Manager                   |
| Tier 适配           | SectionWriter 内置       | TIER_ADAPTATIONS 统一配置                             |
| 观测                | ad-hoc logs              | Trace + Cost + Latency + Eval baseline                |
