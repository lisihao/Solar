# GenesisPod 组件级架构图

> 落到真实 controller / service / registry / facade / gateway / loop 类名的组件级架构。
> 信息源：2026-05-29 对 `open-api` / `ai-app` / `ai-harness` / `ai-engine` / `ai-infra` 各层 module providers、`@Controller`、`@WebSocketGateway`、`onModuleInit`、class 定义的实测扫描，非记忆推断。
> 配套：分层总图见 [layered-architecture.md](layered-architecture.md)；数据流见 [system-overview.md](system-overview.md)。
>
> **范围说明**：框架层（open-api / harness / engine / infra）做全量组件；`ai-app` 聚焦接线模式 + 两大活跃多 Agent 系统（teams、agent-playground），其余 18 个产品模块走同一 facade + registry 接线模式（见 §6）。

---

## 1. 全局组件接线总图

```mermaid
flowchart TB
    subgraph L4["L4 open-api"]
        OAC["Controllers<br/>PublicApi · A2ARpc · Agents · Teams<br/>Skills · MCPServer · Webhooks · Admin*"]
    end

    subgraph L3["L3 ai-app（活跃多 Agent）"]
        TEAMS["teams<br/>AiTeamsController · AiTeamsService<br/>AiTeamsGateway · DebateService"]
        PG["agent-playground<br/>AgentPlaygroundController<br/>PlaygroundPipelineDispatcher · MissionStore"]
    end

    subgraph L25["L2.5 ai-harness · facade"]
        HF["HarnessFacade / AIFacade"]
        DF["Domain Facades<br/>Chat · RAG · Agent · Team · Tool"]
    end

    subgraph L2["L2 ai-engine · facade"]
        EF["AIEngineFacade exports<br/>AiChatService · ToolRegistry<br/>SkillRegistry · EmbeddingService"]
    end

    subgraph L1["L1 ai-infra · facade"]
        IF["AuthService · CreditsService<br/>SecretsService · R2StorageService<br/>KeyResolverService · NotificationService"]
    end

    OAC --> TEAMS & PG
    OAC -.直接调用.-> DF & EF & IF
    TEAMS --> DF
    PG --> DF
    DF --> EF
    HF --> EF
    EF --> IF
    DF -.guardrails/credits.-> IF

    classDef l fill:#0f172a,stroke:#334155,color:#e2e8f0
    class L4,L3,L25,L2,L1 l
```

---

## 2. L2.5 ai-harness 组件图（11 聚合 + facade）

### 2.1 Facade 门面层

```mermaid
flowchart TB
    HARNESS["HarnessFacade<br/>facade/harness.facade.ts<br/>(唯一公开入口)"]
    AI["AIFacade<br/>facade/ai.facade.ts"]
    subgraph DOMAIN["Domain Facades · facade/domain/"]
        CHAT["ChatFacade"]
        RAG["RAGFacade"]
        AGT["AgentFacade"]
        TEAM["TeamFacade"]
        TOOL["ToolFacade"]
    end
    subgraph SUB["Sub-Facades · facade/sub-facades/"]
        SA["AgentSubFacade"]
        SM["MemorySubFacade"]
        SMO["ModelSubFacade"]
        ST["TeamSubFacade"]
        STE["ToolExecSubFacade"]
    end
    HARNESS --> AI --> DOMAIN
    DOMAIN --> SUB
    CHAT --> LOOP["LoopRegistry → ReActLoop ..."]
    TOOL --> TI["ToolInvoker"]
    AGT --> AF["AgentFactory + AgentOrchestrator"]
    TEAM --> TMO["TeamsMissionOrchestrator"]
    RAG --> MEM["Memory services + ContextManager"]
```

### 2.2 runner 聚合（运行循环核心）

```mermaid
flowchart TB
    subgraph LOOPS["loop/ · LoopRegistry 路由派发"]
        REACT["ReActLoop（默认 SOTA）"]
        PLANACT["PlanActLoop"]
        REFLEX["ReflexionLoop"]
        SIMPLE["SimpleLoop"]
        LW["LeaderWorkerLoop"]
    end
    subgraph EXEC["executor/"]
        LLME["LlmExecutor"]
        AES["AgentExecutorService"]
        FCE["FunctionCallingExecutor"]
        TT["TokenTrackerService"]
    end
    subgraph TOOLINV["tool-invoker/"]
        TI["ToolInvoker"]
        CB["ToolCircuitBreaker"]
    end
    SCHED["scheduler/ · KernelSchedulerService"]
    DAG["dag/ · DAGExecutor"]
    subgraph CTX["context/"]
        CM["ContextManager"]
        CC["ContextCompactor"]
        PP["PriorityPruner"]
        CCP["CacheControlPlanner"]
    end

    REACT --> LLME
    REACT --> TI
    TI --> CB
    LLME --> AICHAT["AiChatService（engine）"]
    TI --> TOOLREG["ToolRegistry（engine）"]
    REACT --> CM
    REACT --> BUDGET["BudgetAccountant（guardrails）"]
```

### 2.3 其余 9 聚合核心类

| 聚合         | 核心类（path 前缀 `ai-harness/`）                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`     | `AgentFactory`(core/agent-factory) · `HarnessedAgent` · `SpecAgentRegistry` · `HookRegistry` · `AgentOrchestrator`(registry) · `PlanBasedAgentRegistry` · `AgentConfigService` · `SubagentSpawner`(subagents) · `SkillActivator`/`SkillLoader`(skill-runtime) · `SkillLearner`(learning) · `DomainConceptRegistry`(domain)                                                  |
| `teams`      | `TeamsMissionOrchestrator`(orchestrator) · `AdaptiveReplannerService` · `MissionPipelineOrchestratorService` · `MissionPipelineRegistry` · `TeamRegistry`/`RoleRegistry`(registry) · `TeamsService` · `ReviewWorkflowService`(collaboration/review) · `MissionRuntimeShellFramework`(business-team)                                                                         |
| `handoffs`   | `AgentRegistry`(中央 Agent 目录) · `HandoffService`（OpenAI 标准切换）                                                                                                                                                                                                                                                                                                      |
| `memory`     | `AgentStepCheckpointService`/`AgentEventStore`(checkpoint) · `MemoryCoordinatorService`(coordinator) · `MemoryContextBindingService`/`MemoryAutoIndexer`(indexing) · `InMemoryVectorStore`/`PrismaVectorStore`(vector) · `LongTermMemoryService`/`ShortTermMemoryService`(stores) · `ProcessMemoryManagerService`(working) · `MissionCheckpointService`(mission-checkpoint) |
| `protocols`  | `DomainEventBus`/`DomainEventRegistry`(events) · `EventBusService`/`MessageBusService`/`ProgressTrackerService`/`AgentLifecycleProtocolService`(ipc) · `EventJournalService`/`CheckpointManager`(journal) · `A2ARpcService`/`A2AClientService`/`AgentCardRegistry`(a2a) · `SocketBroadcastAdapter`(realtime)                                                                |
| `evaluation` | `CritiqueRefineService`/`OutputReviewerService`/`ReportQualityGateService`(critique) · `JudgeService`(verify) · `FigureRelevanceService`(figure) · `ReflectionMissionScheduler`(dreaming)                                                                                                                                                                                   |
| `guardrails` | `ConstraintEnforcementService`(constraints) · `ConcurrencyPlannerService`/`ResourceManagerService`(resources) · `RuntimeEnvironmentService`/`TokenBudgetService`(runtime) · `BudgetAccountant`(budget)                                                                                                                                                                      |
| `tracing`    | `AgentTracer`(tracer, OTEL) · `AiObservabilityService`/`LlmTracingService`/`CostAttributionService`/`TraceCollectorService`(observability) · `SessionLatencyTrackerService`(latency)                                                                                                                                                                                        |
| `lifecycle`  | `MissionLifecycleManager`/`MissionAbortRegistry`/`MissionLivenessGuardService`/`OwnershipRegistry`/`RerunLockRegistry`(mission-lifecycle) · `MissionExecutorService`/`ProcessManagerService`(manager) · `FailureLearnerService`/`PostmortemClassifierService`(learning) · `ProcessSupervisorService`(supervisor)                                                            |

**关键 DI 端口（token → impl）**：`AGENT_REGISTRY_PORT→PlanBasedAgentRegistry` · `CHAT_PROVIDER_PORT→ChatFacade` · `CHECKPOINT_MANAGER_PORT→CheckpointManager` · `CONSTRAINT_ENFORCEMENT_PORT→ConstraintEnforcementService` · `EXECUTION_STATE_MANAGER_PORT→ProcessSupervisorService` · `MCP_PROVIDER_PORT→MCPManager`。

---

## 3. L2 ai-engine 组件图（10 聚合）

```mermaid
flowchart TB
    subgraph LLM["llm/"]
        CHAT["AiChatService"]
        CALLER["AiApiCallerService"]
        FOC["AiChatFailoverCallerService"]
        STREAM["AiStreamHandlerService"]
        ELECT["ModelElectionService"]
        FB["ModelFallbackService"]
        PRICE["ModelPricingRegistry"]
        CAP["ModelCapabilityService"]
        CFG["AiModelConfigService"]
        UADP["UniversalLLMAdapter / FunctionCallingLLMAdapter"]
    end
    subgraph TOOLS["tools/"]
        TR["ToolRegistry"]
        TP["ToolPipeline / ToolExecutor"]
        MCPM["MCPManager"]
        MCPR["MCPClientRegistryService"]
        MID["Validation/Timeout/RateLimit/Permission Middleware"]
    end
    subgraph SKILLS["skills/"]
        SR["SkillRegistry"]
        SL["SkillLoaderService"]
        SC["SkillContentService"]
        SB["SkillPromptBuilder"]
        SS["SkillSandboxService"]
        ESP["EngineSkillProvider（→harness ISkillProvider 端口）"]
    end
    subgraph RAG["rag/ + knowledge/"]
        EMB["EmbeddingService"]
        VEC["VectorService"]
        CHUNK["DocumentChunker"]
        PIPE["RAGPipelineService"]
        SEARCH["SearchService"]
        EVID["EvidenceManagerService"]
        CITE["CitationFormatterService"]
    end
    subgraph PLAN["planning/"]
        TB["TokenBudgetService"]
        INTENT["IntentDetectionService"]
        REFLECT["ReflectionService"]
    end
    subgraph SAFETY["safety/"]
        GP["GuardrailsPipelineService"]
        INJ["PromptInjectionDetector"]
        CIRC["CircuitBreakerService"]
        RL["RateLimitService"]
        QG["QualityGateService"]
    end
    subgraph CONTENT["content/"]
        FETCH["ContentFetchService"]
        YT["YoutubeService"]
        IMGF["ImageFactory"]
        FIG["FigureExtractorService"]
    end

    CHAT --> CALLER --> UADP
    CHAT --> ELECT --> FB
    CHAT --> PRICE
    TR --> TP --> MID
    TR --> MCPM --> MCPR
    PIPE --> EMB & VEC & CHUNK
```

**SSOT 唯一源**：`ModelPricingRegistry`（价格）· `ModelCapabilityService`（能力，读）· `CapabilityOverridesWriterService`（能力，写）· `ToolRegistry`（工具）· `SkillRegistry`（技能）。

**engine → infra 依赖**：`SecretsService`(secrets) · `KeyResolverService`/`KeyExecutorService`/`UserApiKeysService`/`UserModelConfigsService`(credentials BYOK) · `CreditsService`(credits 计费) · `KeyHealthService`(key 健康)。

---

## 4. L1 ai-infra 组件图

```mermaid
flowchart LR
    subgraph AUTHC["auth / credits"]
        AUTH["AuthService"]
        CREDITS["CreditsService<br/>consumeCredits() 原子扣费"]
        RULES["CreditRulesService"]
        BILL["BillingContext"]
    end
    subgraph SEC["secrets / encryption / credentials"]
        SECRETS["SecretsService"]
        ENC["EncryptionService"]
        KR["KeyResolverService"]
        KE["KeyExecutorService"]
        UAK["UserApiKeysService"]
        UMC["UserModelConfigsService"]
        TKR["ToolKeyResolverService"]
        PROBE["ProviderProbeService"]
    end
    subgraph STORE["storage"]
        R2["R2StorageService"]
        SG["StorageGovernanceService / StorageOffloadService"]
    end
    subgraph NOTIF["email / notifications"]
        EMAIL["EmailService"]
        NOTI["NotificationService"]
        DISP["NotificationDispatcher"]
        PREF["NotificationPreferenceService"]
    end
    subgraph OPS["settings / monitoring / release / db-governance"]
        SET["SettingsService"]
        METRICS["AIMetricsService"]
        HEALTH["HealthCheckService"]
        ERR["ErrorTrackingService"]
        REL["ReleaseService"]
        DBG["DbGovernanceService / DataRetentionService"]
    end
    CREDITS --> RULES
```

> 原子扣费链：`CreditsService.consumeCredits(params)` → `CreditRulesService`（规则）+ `BillingContext`（上下文），抛 `InsufficientCreditsException`/`AccountFrozenException`（commit `ccd267ba8` 修复 lost-update 与负余额）。

---

## 5. L4 open-api 组件图

```mermaid
flowchart TB
    subgraph CTRL["Controllers（路由前缀）"]
        PUB["PublicApiController /public"]
        A2ARPC["A2ARpcController /a2a/v1（JSON-RPC 2.0）"]
        A2ASRV["A2AServerController /a2a（旧兼容）"]
        AGT["AgentsController /agents"]
        TEAM["TeamsController /ai/teams"]
        SKILL["SkillsController /skills"]
        MCPS["MCPServerController /mcp"]
        WH["WebhooksController /webhooks"]
        CORE["AiCoreController /ai"]
    end
    subgraph ADMIN["admin/*（~25 个 controller，前缀 /admin/*）"]
        AD["AdminController · AiAdminController · BillingAdminController<br/>QuotaAdminController · HarnessInspectorController · KernelAdminController<br/>AiTeamsAdminController · ObservabilityAdminController · ..."]
        BYOK["AdminByokDashboardController · AdminKeyRequestsController<br/>AdminKeyAssignmentsController"]
    end
    CTRL --> FAC["ai-harness/facade: AIFacade · ChatFacade · ToolFacade<br/>ai-engine/facade: RAGPipelineService · SearchService · MCPClientRegistryService<br/>ai-infra/facade: SecretsService · BillingContext · StorageInventoryService"]
```

---

## 6. L3 ai-app 接线模式 + 两大活跃系统

### 6.1 通用接线模式（所有 20 个产品模块共用）

```typescript
// onModuleInit 向下层 Registry 注册自己的 Agent/Team
onModuleInit() {
  this.teamRegistry.registerConfig(MY_TEAM_CONFIG);   // 注册团队配置
  this.agentRegistry.register(this.myAgent);          // 注册 Agent
}

// 运行时只经 facade 调用下层
const result = await this.chatFacade.chat({
  messages, model, taskProfile: { creativity: "low", outputLength: "standard" },
});
```

### 6.2 teams 系统组件图

```mermaid
flowchart TB
    subgraph CTRL["Controllers"]
        AC["AiTeamsController /topics"]
        CC["CustomTeamsController /ai-teams/custom-teams"]
        PR["PublicReportsController /public/reports"]
    end
    GW["AiTeamsGateway<br/>ns:/ai-teams · topic:join/leave · message:send"]
    subgraph SVC["核心 Service"]
        ATS["AiTeamsService"]
        REPO["TeamsRepository"]
        INT["AiTeamsIntegrationService"]
        EV["TopicEventEmitterService"]
    end
    subgraph COLLAB["collaboration/"]
        DEBATE["DebateService"]
        TM["TeamMissionService"]
        ME["MissionExecutionService"]
        MR["MissionReviewService"]
        MSM["MissionStateManager"]
        ML["MissionLifecycleService"]
    end
    subgraph AISVC["ai/"]
        CR["ContextRouterService"]
        AR["AiResponseService"]
        LM["LeaderModelService"]
    end
    AC --> ATS --> REPO
    AC --> GW
    ATS --> CHATF["ChatFacade（harness）"]
    INT --> TEAMF["TeamFacade / TeamRegistry / RoleRegistry"]
    ATS --> COLLAB
    COLLAB --> AISVC

    ONINIT["onModuleInit:<br/>teamRegistry.registerConfig(DEBATE_TEAM_CONFIG)<br/>agentRegistry.register(TeamCollaborationAgent)"]
```

持久化对象：`Topic*` · `TeamMission` · `AgentTask` · `MissionLog` · `VoteProposal`/`VoteRecord` · `DebateSession`/`DebateAgent`/`DebateMessage`。

### 6.3 agent-playground 系统组件图

```mermaid
flowchart TB
    subgraph CTRL["Controllers /agent-playground"]
        PC["AgentPlaygroundController<br/>team/run · missions/:id/cancel"]
        RC["MissionReadController"]
        RR["MissionRerunController"]
        DC["MissionDagController"]
    end
    GW["AgentPlaygroundGateway ns:agent-playground"]
    subgraph PIPE["pipeline / orchestration"]
        DISP["PlaygroundPipelineDispatcher<br/>(唯一 orchestrator, 13+1 stage)"]
        BORCH["PlaygroundBusinessOrchestrator"]
        SHELL["MissionRuntimeShellService"]
        MPO["MissionPipelineOrchestrator（harness）"]
        MPR["MissionPipelineRegistry"]
    end
    subgraph LIFE["lifecycle"]
        STORE["MissionStore（terminal arbiter）"]
        BUF["MissionEventBuffer"]
        CKPT["PrismaMissionCheckpointStore"]
    end
    subgraph ROLES["roles/ 8 角色"]
        ROLE["Leader · Researcher · Reconciler · Analyst<br/>Writer · Reviewer · Verifier · Steward"]
    end
    subgraph RERUN["rerun/"]
        LR["LocalRerunService · StageRerunDispatcher<br/>RerunGuardService · CtxHydratorService"]
    end

    PC --> DISP
    DISP --> MPR
    DISP --> BORCH --> ROLE
    DISP --> SHELL
    DISP --> STORE
    ROLE --> AGTF["AgentFacade / ChatFacade（harness）"]
    BUF --> DEB["DomainEventBus（harness）"]
    GW -.replay.-> BUF

    ONINIT["onModuleInit:<br/>skillLoader.addSkillDirectory(agent-playground)<br/>eventRegistry.registerAll(AGENT_PLAYGROUND_EVENTS)<br/>eventBus.registerAdapter(buffer)<br/>livenessGuard.registerAdapter('agent-playground')"]
```

运行时对象：`MissionStore` · `MissionEventBuffer` · `MissionCheckpointService` · `OwnershipRegistry` · `MissionAbortRegistry`（后 3 者由 ai-harness 提供）。

---

## 7. 端到端核心调用链（ReAct 一次回合）

```mermaid
sequenceDiagram
    participant APP as ai-app（teams/playground）
    participant CF as ChatFacade（harness）
    participant LR as LoopRegistry → ReActLoop
    participant LE as LlmExecutor
    participant CHAT as AiChatService（engine）
    participant TI as ToolInvoker
    participant TR as ToolRegistry（engine）
    participant BUD as BudgetAccountant
    participant CR as CreditsService（infra）

    APP->>CF: chat(messages, taskProfile)
    CF->>LR: 按 spec.loop 派发
    LR->>LE: reason step
    LE->>CHAT: chat()（含 model election / failover / pricing）
    CHAT-->>LE: assistant + tool_use
    LE->>TI: invoke(tool_use)
    TI->>TR: lookup + execute（middleware/熔断）
    TR-->>TI: tool_result
    TI-->>LR: 回填观察
    LR->>BUD: 扣预算 / token
    BUD->>CR: consumeCredits() 原子扣费
    LR-->>CF: final answer
    CF-->>APP: 结构化结果
```

---

## 8. 维护要求

1. 组件图每个方框必须能指回真实 class + path，新增/重命名核心 service 时同步更新本图。
2. 新 ai-app 模块默认走 §6.1 接线模式，无需单独画图；只有出现新的"活跃多 Agent 系统"才补组件图。
3. SSOT 类（ToolRegistry / SkillRegistry / ModelPricingRegistry / 各 Registry）全项目唯一,新增同名概念前先查本图。
4. 顶层结构变化时,同步更新 [layered-architecture.md](layered-architecture.md) 与 [system-overview.md](system-overview.md)。

---

**最后更新**：2026-05-29
**信息源**：4 路并行 Explore agent 实测扫描（module providers / @Controller / @WebSocketGateway / onModuleInit / class 定义）
**维护者**：Claude Code
