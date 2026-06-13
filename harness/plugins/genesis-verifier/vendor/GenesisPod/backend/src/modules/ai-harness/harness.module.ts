/**
 * Harness Module — Agent 运行时脚手架
 *
 * 依赖链：
 *   AI App → HarnessFacade → AgentFactory → (ReActLoop + MemoryContextBindingService + SkillActivator)
 *     ReActLoop → AiChatService + ToolInvoker + HookRegistry
 *     ToolInvoker → ToolRegistry
 *     MemoryContextBindingService → MemoryCoordinatorService (@Optional)
 *     SkillActivator → SkillRegistry + HookRegistry
 *     SkillLoader → SkillRegistry (OnModuleInit 自动加载 built-in/*)
 *
 * Phase 1: abstractions + HarnessedAgent skeleton + HookRegistry
 * Phase 2: ReActLoop + ToolInvoker + MemoryContextBindingService
 * Phase 3: SKILL.md system (parser / registry / loader / activator)
 * Phase 4: SubagentSpawner + 3-level isolation (none / context / worktree)
 * Phase 5: Context Engineering (compactor / pruner / manager)
 * Phase 6 (current): Long-horizon checkpoint + resume + skill learning
 */

import {
  Global,
  Module,
  forwardRef,
  OnApplicationBootstrap,
  Inject,
  Optional,
} from "@nestjs/common";
import { HarnessFacade } from "./facade/harness.facade";
import { AgentFactory } from "./agents/core/agent-factory";
import { ModelElectionService } from "../ai-engine/llm/models/selection";
import { MissionElectionTracker } from "./guardrails/runtime/mission-election-tracker.service";
import { SpecAgentRegistry } from "./agents/core/spec-agent-registry";
import {
  SPEC_AGENT_REGISTRY_PROBE,
  TOOL_CIRCUIT_BREAKER_PROBE,
} from "../ai-harness/guardrails/runtime/runtime-resource.abstractions";
import { HookRegistry } from "./agents/core/hook-registry";
import { ReActLoop } from "./runner/loop/react-loop";
import { PlanActLoop } from "./runner/loop/plan-act-loop";
import { ReflexionLoop } from "./runner/loop/reflexion-loop";
import { SimpleLoop } from "./runner/loop/simple-loop";
import { LoopRegistry } from "./runner/loop/loop-registry";
import { ToolInvoker } from "./runner/tool-invoker/tool-invoker";
import { ToolCircuitBreaker } from "./runner/tool-invoker/tool-circuit-breaker";
import { LlmExecutor } from "./runner/executor/llm-executor";
import { AgentExecutorService } from "./runner/executor/agent-executor.service";
import { FunctionCallingExecutor } from "./runner/executor/function-calling-executor";
import { OutputReviewerService } from "./evaluation/critique/output-reviewer.service";
import { ReportArtifactAssembler } from "./evaluation/critique/report-artifact/report-artifact-assembler.service";
import { InMemoryVectorStore } from "./memory/vector/in-memory-vector-store";
import { PrismaVectorStore } from "./memory/vector/prisma-vector-store";
import { MemoryAutoIndexer } from "./memory/indexing/memory-auto-indexer";
import { MemoryContextBindingService } from "./memory/indexing/memory-context-binding.service";
import {
  BuiltinSkillCatalog,
  SkillLoader,
  SkillActivator,
} from "./agents/skill-runtime";
import { SKILL_PROVIDERS } from "./agents/abstractions";
import { EngineSkillProvider } from "../ai-engine/skills/integration/adapters/engine-skill-provider.adapter";
import { AiEngineSkillsModule } from "../ai-engine/skills/skills.module";
import { SubagentSpawner } from "./agents/subagents";
import {
  ContextManager,
  ContextCompactor,
  PriorityPruner,
} from "./runner/context";
import { CacheControlPlanner } from "./runner/context/cache-control-planner";
import { AgentRegistry } from "./handoffs/agent-registry";
import { HandoffService } from "./handoffs/handoff.service";
import {
  AgentStepCheckpointService,
  InMemoryCheckpointStore,
  PrismaCheckpointStore,
  AgentEventStore,
} from "./memory/checkpoint";
import type { ICheckpointStore } from "./memory/checkpoint/checkpoint.types";
import { SkillLearner, SkillLearningCoordinator } from "./agents/learning";

// SOTA task-centric runner/planning services available to AI Apps.
import { ReActRunner } from "./runner/env/react-runner";
import { AgentTracer } from "./tracing/tracer/otel-tracer";
import { AgentToolSchemaRegistry } from "./runner/env/agent-tool-schema-registry";
import { MissionOrchestrator } from "./runner/plan-execution/task-execution-orchestrator";
// ModelPricingRegistry 在 AiEngineLLMModule 注册并 export，harness 通过
// imports: [AiEngineLLMModule] 拿到，不在此重复注册。
import { SpanExporter } from "./tracing/tracer/span-exporter";
import { JudgeService } from "./evaluation/verify/judge.service";
// ★ 沉淀（2026-04-29）: figure 相关性判断（来自 {app}, TI 暂不切换）
import { FigureRelevanceService } from "./evaluation/figure";
// ★ 沉淀（2026-04-29）: Reflexion 批评-改进闭环（来自 {app}, TI 暂不切换）
//   v3 (同日): quality-gate / section-remediation / report-evaluation / quality-trace-compute
import {
  CritiqueRefineService,
  SectionSelfEvalService,
  ReportQualityGateService,
  SectionRemediationService,
  ReportEvaluationService,
  QualityTraceComputeService,
} from "./evaluation/critique";
import { ReflectionMissionScheduler } from "./evaluation/consolidation";
import { RubricGeneratorService } from "./evaluation/rubric/rubric-generator.service";
import { MCPRelay } from "../ai-engine/tools/adapters/mcp/mcp-relay.service";
import { MCPManager } from "../ai-engine/tools/adapters/mcp/manager/mcp-manager";
import { MCPClientRegistryService } from "../ai-engine/tools/adapters/mcp/registry/mcp-client-registry.service";
import { AgentRunner, FixtureStore } from "./agents/dev-tools";
// PR-J..P
import { LeaderWorkerLoop } from "./runner/loop/leader-worker-loop";
import { EventRegistry } from "@/common/events/event-registry";
import { EventBus } from "@/common/events/event-bus";
import { LoggerBroadcastAdapter } from "@/common/events/broadcast-adapter";
import { DomainConceptRegistry } from "./agents/domain/concept-registry";
import { DomainAdapterRegistry } from "./agents/domain/domain-adapter";
import { RuntimePromptRouter } from "./runner/prompt/runtime-prompt-router";
import { ToolSelectorRegistry } from "./runner/tool-routing/tool-selector-registry";
// ★ 2026-06-02: 语义工具选择器（opt-in，构造时自注册进 ToolSelectorRegistry）
import { SemanticToolSelector } from "./runner/tool-routing/semantic-tool-selector";
// 2026-05-14: AICapabilityResolver 缺少 module 注册导致 ToolFeature.capabilityResolver
// 永远是 undefined → ToolFacade.capabilityResolveTools 永远 warn "DI not wired" + 返回 []。
// 见 feedback_optional_di_must_wire_module：@Optional() 注入必须配套 module providers。
import { AICapabilityResolver } from "./runner/capabilities/ai-capability-resolver.service";

import { AiEngineLLMModule } from "../ai-engine/llm/llm.module";
import { AiEngineToolsModule } from "../ai-engine/tools/tools.module";
// AiEngineMemoryModule 已移除（2026-04-30）—— Memory 服务全部迁到
// ai-harness/memory（RuntimeMemoryModule @Global），无需在此 forwardRef。
import { CreditsModule } from "../platform/credits/credits.module";
import { NotificationModule } from "../platform/notifications/notification.module";
import { MissionCompletionBroadcastAdapter } from "./protocols/realtime/mission-completion-broadcast.adapter";
import { MissionContextModule } from "./teams/collaboration/context/context.module";
import { MissionAbortRegistry } from "./lifecycle/mission-lifecycle/abort-registry";
import { MissionLifecycleManager } from "./lifecycle/mission-lifecycle/mission-lifecycle-manager";

// PR-X18: Engine 端 DI tokens — harness 提供这 9 个 token 的 useExisting 绑定
import {
  AGENT_REGISTRY_PORT,
  AGENT_ORCHESTRATOR_PORT,
  AGENT_CONFIG_SERVICE_PORT,
  CHAT_PROVIDER_PORT,
  CHECKPOINT_MANAGER_PORT,
  PROGRESS_TRACKER_PORT,
  TRACE_COLLECTOR_PORT,
  CONSTRAINT_ENFORCEMENT_PORT,
  EXECUTION_STATE_MANAGER_PORT,
  MCP_PROVIDER_PORT,
} from "@/modules/ai-engine/facade/abstractions/runtime-deps.tokens";
import { PlanBasedAgentRegistry } from "./agents/registry/plan-based-agent-registry";
import { AgentOrchestrator } from "./agents/registry/agent-orchestrator";
import { AgentConfigService } from "./agents/config/agent-config.service";
import { CheckpointManager } from "./protocols/journal/checkpoint-manager";
import { ProgressTrackerService } from "./protocols/ipc/progress-tracker.service";
import { TraceCollectorService } from "./tracing/observability/trace-collector.service";
import { FailureLearnerService } from "./lifecycle/learning/failure-learner.service";
import { PostmortemClassifierService } from "./lifecycle/learning/postmortem-classifier.service";
import { ConstraintEnforcementService } from "./guardrails/constraints/constraint-enforcement.service";
import { CapabilityGuardService } from "./guardrails/capability";
import { ProcessSupervisorService } from "./lifecycle/supervisor/process-supervisor.service";

// â˜… PR-X13: AIFacade + Domain Facades (migrated from ai-engine/facade)
import { AIFacade } from "./facade/ai.facade";
import { ChatFacade } from "./facade/domain/chat.facade";
import { ConcurrencyPlanner } from "./guardrails/resources/concurrency-planner.service";
import { RAGFacade } from "./facade/domain/rag.facade";
import { AgentFacade } from "./facade/domain/agent.facade";
import { TeamFacade } from "./facade/domain/team.facade";
import { ToolFacade } from "./facade/domain/tool.facade";
import { ModelResolverService } from "./facade/model-resolver.service";
import { FACADE_FEATURE_PROVIDERS } from "./facade/facade.providers";
// ★ 2026-05-08 PR-E0: BusinessAgentTeam 框架——mission runtime shell 上提自 playground @migrated-from
import { MissionRuntimeShellFramework } from "./teams/business-team/lifecycle/mission-runtime-shell.framework";

@Global()
@Module({
  imports: [
    forwardRef(() => AiEngineLLMModule),
    forwardRef(() => AiEngineToolsModule),
    // 2026-05-01 (PR-X-K): 让 SkillActivator 能 fallback 到 ai-engine SkillRegistry，
    // 透出用户在 Admin UI / API 自定义的 skill 给 harness agent
    forwardRef(() => AiEngineSkillsModule),
    // ★ 2026-05-08 PR-E0: MissionRuntimeShellFramework 依赖 CreditsService。
    //   RuntimeEnvironmentService 由 @Global RuntimeResourceModule 通过 HarnessApiModule
    //   提供，无需在此 import。MissionAbortRegistry 由本模块 providers 直接注册。
    CreditsModule,
    // ★ W2-F: mission 协作上下文/状态/输入服务（从 ai-app/teams 迁入）@Global
    MissionContextModule,
    // 2026-06-03: 解散 notifications-bridge —— mission-completion adapter 迁入本层，需 NotificationPresetsService
    NotificationModule,
  ],
  providers: [
    // Cross-cutting
    HookRegistry,
    // ★ W2（2026-06-04）: Agent 进程能力授权（从 ai-engine/safety 迁回，律4）
    CapabilityGuardService,
    // ★ 2026-05-08 PR-E0: BusinessAgentTeam mission runtime shell 框架 + abort registry 上提为 @Global
    MissionRuntimeShellFramework,
    MissionAbortRegistry,
    // ★ 2026-05-22 C0/G1: mission 唯一终态写入口（finalize 仲裁），@Global 供三 app 注入
    MissionLifecycleManager,

    // ai-harness/guardrails (RuntimeResourceModule) 通过 DI token 拿 harness 能力探针，避免反向 import
    {
      provide: SPEC_AGENT_REGISTRY_PROBE,
      useExisting: SpecAgentRegistry,
    },
    {
      provide: TOOL_CIRCUIT_BREAKER_PROBE,
      useExisting: ToolCircuitBreaker,
    },

    // PR-X18: 8 个 engine 端 DI tokens — harness 提供具体类的 useExisting 绑定
    // 这样 planning.module 用 token 注入，避免反向 import harness 类
    PlanBasedAgentRegistry,
    AgentOrchestrator,
    AgentConfigService,
    CheckpointManager,
    ProcessSupervisorService,
    { provide: AGENT_REGISTRY_PORT, useExisting: PlanBasedAgentRegistry },
    { provide: AGENT_ORCHESTRATOR_PORT, useExisting: AgentOrchestrator },
    { provide: AGENT_CONFIG_SERVICE_PORT, useExisting: AgentConfigService },
    { provide: CHAT_PROVIDER_PORT, useExisting: ChatFacade },
    { provide: CHECKPOINT_MANAGER_PORT, useExisting: CheckpointManager },
    { provide: PROGRESS_TRACKER_PORT, useExisting: ProgressTrackerService },
    { provide: TRACE_COLLECTOR_PORT, useExisting: TraceCollectorService },
    {
      provide: CONSTRAINT_ENFORCEMENT_PORT,
      useExisting: ConstraintEnforcementService,
    },
    {
      provide: EXECUTION_STATE_MANAGER_PORT,
      useExisting: ProcessSupervisorService,
    },
    { provide: MCP_PROVIDER_PORT, useExisting: MCPManager },

    // Executor / Loop / Memory (Phase 2)
    ToolInvoker,
    ToolCircuitBreaker,
    InMemoryVectorStore,
    LlmExecutor,
    AgentExecutorService,
    OutputReviewerService,
    ReportArtifactAssembler,
    FailureLearnerService,
    PostmortemClassifierService,
    ReActLoop,
    PlanActLoop,
    ReflexionLoop,
    SimpleLoop,
    LoopRegistry,
    MemoryContextBindingService,

    // Skills (Phase 3)
    BuiltinSkillCatalog,
    SkillLoader,
    SkillActivator,
    // ★ 2026-05-01 (PR-X-K): SKILL_PROVIDERS 多源注入 — built-in miss 时 fallback
    // 到 ai-engine SkillRegistry（DB-backed 用户自定义 skill）
    {
      provide: SKILL_PROVIDERS,
      useFactory: (engineProvider: EngineSkillProvider) => [engineProvider],
      inject: [EngineSkillProvider],
    },

    // Subagent (Phase 4)
    SubagentSpawner,

    // Context Engineering (Phase 5)
    ContextCompactor,
    PriorityPruner,
    ContextManager,
    CacheControlPlanner,

    // PR-R: Agent Handoff
    AgentRegistry,
    HandoffService,

    // PR-S: Vector memory + indexing
    PrismaVectorStore,
    MemoryAutoIndexer,

    // Checkpoint + Learning (Phase 6) — PR-C 升级为 Prisma 可选
    InMemoryCheckpointStore,
    PrismaCheckpointStore,
    {
      // 2026-05-15 PR-G: 切换为"默认 Prisma 持久化"模式（生产正确性优先）。
      //   - NODE_ENV === 'test' 且未显式 HARNESS_CHECKPOINT_PERSIST=1 → in-memory（spec 默认不污染 DB）
      //   - 其他场景（dev / staging / prod）→ Prisma（multi-pod 安全 + 真 session resume）
      //   - 显式 HARNESS_CHECKPOINT_PERSIST=0 → 任何环境强制回 in-memory（应急回滚）
      provide: AgentStepCheckpointService,
      useFactory: (
        memStore: InMemoryCheckpointStore,
        prismaStore: PrismaCheckpointStore,
      ) => {
        const envFlag = process.env.HARNESS_CHECKPOINT_PERSIST;
        const isTest = process.env.NODE_ENV === "test";
        const useInMemory = envFlag === "0" || (isTest && envFlag !== "1");
        const store: ICheckpointStore = useInMemory ? memStore : prismaStore;
        return new AgentStepCheckpointService(store);
      },
      inject: [InMemoryCheckpointStore, PrismaCheckpointStore],
    },
    AgentEventStore,
    SkillLearner,
    SkillLearningCoordinator,

    // Core
    AgentFactory,
    SpecAgentRegistry,
    HarnessFacade,

    // SOTA task-centric runner/planning services.
    AgentTracer,
    AgentToolSchemaRegistry,
    ReActRunner,
    MissionOrchestrator,

    // ★ ModelPricingRegistry 在 AiEngineLLMModule 注册（单一注册源，
    //    harness 通过 imports: [AiEngineLLMModule] 拿到）。这里删除重复注册
    //    避免 multi-instance hydrate 同一 DB 表。
    JudgeService,

    // ★ 沉淀: figure 相关性判断（{app} 复用，TI 暂保留私有）
    FigureRelevanceService,
    // ★ 沉淀: Reflexion critique-refine 闭环
    CritiqueRefineService,
    SectionSelfEvalService,
    // ★ 沉淀 v3: quality-gate / remediation / evaluation / trace-compute
    ReportQualityGateService,
    SectionRemediationService,
    ReportEvaluationService,
    QualityTraceComputeService,

    // ★ 2026-05-15 PR-I: Consolidation（主动反思）骨架 — 周期归纳跨 mission 规则
    ReflectionMissionScheduler,

    // ★ P1 Self-Driven Team (2026-06-04): LLM 按诉求生成验收 rubric（带 clamp 护栏）
    RubricGeneratorService,

    // ★ PR-G: SpanExporter — AgentTracer 多目标分发（Logger + Langfuse）
    SpanExporter,

    // ★ PR-E: MCP Relay — 远端 MCP server 工具自动注册
    MCPRelay,

    // â˜… PR-X7: MCP Manager + Client Registry (moved from ai-engine)
    MCPManager,
    MCPClientRegistryService,

    // ★ PR-H: DX 套件 — @DefineAgent + AgentRunner + record/replay
    AgentRunner,
    FixtureStore,

    // PR-J..P
    LeaderWorkerLoop,
    EventRegistry,
    EventBus,
    LoggerBroadcastAdapter,
    MissionCompletionBroadcastAdapter,
    DomainConceptRegistry,
    DomainAdapterRegistry,
    RuntimePromptRouter,
    ToolSelectorRegistry,
    // ★ 2026-06-02: 语义工具选择器（注入 ScoredRouter + ToolRegistry，自注册）
    SemanticToolSelector,

    // 2026-05-14: AICapabilityResolver — Agent 运行时拿可用 tools/skills/MCP 的总入口
    // 之前没在任何 module 注册，DI 永远拿到 undefined → ToolFacade.capabilityResolveTools
    // 永远走 fallback 空 list。修复见 commit 2f418ac01 后续。
    AICapabilityResolver,

    // 2026-05-21: FunctionCallingExecutor — 同 AICapabilityResolver 的坑：@Injectable
    // 但此前没在任何 module 注册（C2-step2 清理误删 provider 行，planning.module 只剩
    // 注释 "保留 FunctionCallingExecutor"）。toolFeatureProvider 的
    // { token: FunctionCallingExecutor, optional } 永远拿到 undefined →
    // tool-exec.sub-facade / ToolFacade.chatWithToolsStream 报 "Tool execution not
    // available"（对话整理 / teams 工具调用全挂）。必需依赖 ToolRegistry 来自已 import
    // 的 AiEngineToolsModule，FunctionCallingLLMAdapter 来自 AiEngineLLMModule，其余 @Optional。
    FunctionCallingExecutor,

    // â˜… PR-X13: AIFacade + Domain Facades (migrated from ai-engine/facade)
    // These are @Global — all ai-app modules can inject them without explicit imports.
    ...FACADE_FEATURE_PROVIDERS,
    ModelResolverService,
    ChatFacade,
    RAGFacade,
    AgentFacade,
    TeamFacade,
    ToolFacade,
    AIFacade,
    ConcurrencyPlanner,
  ],
  // PR-I: 关键 SOTA 缺口补全
  // - ToolCircuitBreaker: 连续失败自动 disable
  // - InMemoryVectorStore: Harness 内置语义召回（不强依赖外部 coordinator）
  // HarnessInspectorController moved to open-api/admin/harness-inspector.controller.ts (PR-X17)
  exports: [
    HarnessFacade,
    // ★ W2（2026-06-04）: Agent 进程能力授权（供 ai-app / harness 注入）
    CapabilityGuardService,
    // ★ 2026-05-08 PR-E0: BusinessAgentTeam mission runtime shell 框架 + abort registry @Global
    MissionRuntimeShellFramework,
    MissionAbortRegistry,
    // ★ 2026-05-22 C0/G1: mission 唯一终态写入口 @Global
    MissionLifecycleManager,
    AgentFactory,
    SpecAgentRegistry,
    LlmExecutor,
    AgentExecutorService,
    OutputReviewerService,
    ReportArtifactAssembler,
    FailureLearnerService,
    PostmortemClassifierService,
    BuiltinSkillCatalog,
    ContextManager,
    AgentStepCheckpointService,
    AgentEventStore,
    SkillLearner,
    SkillLearningCoordinator,
    LoopRegistry,
    ReActLoop,
    PlanActLoop,
    ReflexionLoop,
    SimpleLoop,

    // PR-X18: 导出 8 个 engine 端 token + 实现类（@Global，跨模块全局可注入）
    PlanBasedAgentRegistry,
    AgentOrchestrator,
    AgentConfigService,
    CheckpointManager,
    ProcessSupervisorService,
    AGENT_REGISTRY_PORT,
    AGENT_ORCHESTRATOR_PORT,
    AGENT_CONFIG_SERVICE_PORT,
    CHAT_PROVIDER_PORT,
    CHECKPOINT_MANAGER_PORT,
    PROGRESS_TRACKER_PORT,
    TRACE_COLLECTOR_PORT,
    CONSTRAINT_ENFORCEMENT_PORT,
    EXECUTION_STATE_MANAGER_PORT,
    MCP_PROVIDER_PORT,

    // â˜… SOTA runtime exports
    AgentTracer,
    AgentToolSchemaRegistry,
    ReActRunner,
    MissionOrchestrator,
    JudgeService,
    FigureRelevanceService, // ★ 沉淀: figure 相关性
    CritiqueRefineService, // ★ 沉淀: critique-refine
    SectionSelfEvalService, // ★ 沉淀: section-level 4 维自评
    ReportQualityGateService, // ★ 沉淀 v3: code-enforced 质量门控
    SectionRemediationService, // ★ 沉淀 v3: 弱维度合并补救
    ReportEvaluationService, // ★ 沉淀 v3: 10 维结构化报告评审
    QualityTraceComputeService, // ★ 沉淀 v3: 全链路质量 trace 纯计算
    ReflectionMissionScheduler, // ★ 2026-05-15 PR-I: Consolidation 骨架
    RubricGeneratorService, // ★ P1 Self-Driven Team: LLM 生成验收 rubric（带 clamp）
    SpanExporter,
    MCPRelay,
    MCPManager,
    MCPClientRegistryService,
    AgentRunner,
    FixtureStore,
    ToolCircuitBreaker,
    InMemoryVectorStore,

    // ai-harness/guardrails 探针 token（实际指向上面 useExisting）
    SPEC_AGENT_REGISTRY_PROBE,
    TOOL_CIRCUIT_BREAKER_PROBE,

    // PR-S: Vector memory + indexing
    PrismaVectorStore,
    MemoryAutoIndexer,

    // PR-J..P exports
    LeaderWorkerLoop,
    EventRegistry,
    EventBus,
    LoggerBroadcastAdapter,
    DomainConceptRegistry,
    DomainAdapterRegistry,
    RuntimePromptRouter,
    ToolSelectorRegistry,

    // 2026-05-14: AICapabilityResolver — 跨模块可用
    AICapabilityResolver,

    // â˜… PR-X13: AIFacade + Domain Facades
    ModelResolverService,
    ChatFacade,
    RAGFacade,
    AgentFacade,
    TeamFacade,
    ToolFacade,
    AIFacade,
    ConcurrencyPlanner,
  ],
})
export class HarnessModule implements OnApplicationBootstrap {
  constructor(
    @Inject(AgentFactory) private readonly factory: AgentFactory,
    @Inject(SubagentSpawner) private readonly spawner: SubagentSpawner,
    @Inject(LoopRegistry) private readonly loopRegistry: LoopRegistry,
    @Inject(ReActLoop) private readonly reactLoop: ReActLoop,
    @Inject(PlanActLoop) private readonly planActLoop: PlanActLoop,
    @Inject(ReflexionLoop) private readonly reflexionLoop: ReflexionLoop,
    @Inject(SimpleLoop) private readonly simpleLoop: SimpleLoop,
    @Inject(LeaderWorkerLoop)
    private readonly leaderWorkerLoop: LeaderWorkerLoop,
    @Inject(JudgeService) private readonly judgeService: JudgeService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    @Inject(LoggerBroadcastAdapter)
    private readonly defaultBroadcaster: LoggerBroadcastAdapter,
    @Inject(MissionCompletionBroadcastAdapter)
    private readonly missionCompletionBroadcaster: MissionCompletionBroadcastAdapter,
    @Optional()
    @Inject(ModelElectionService)
    private readonly election?: ModelElectionService,
    @Optional()
    @Inject(MissionElectionTracker)
    private readonly electionTracker?: MissionElectionTracker,
  ) {}

  onApplicationBootstrap(): void {
    // Break the circular dependency: AgentFactory — SubagentSpawner.
    // Constructor injection requires both instances up-front; setter injection
    // lets NestJS finish provider instantiation, then we wire the cycle here.
    this.factory.setSubagentSpawner(this.spawner);
    // Same rationale for ModelElectionService — forwardRef-provided dep.
    // At onApplicationBootstrap the container is fully instantiated so Optional
    // inject here resolves cleanly without sibling-provider timing side effects.
    if (this.election) {
      this.factory.setElectionService(this.election);
    }
    // 2026-05-10 §3：mission-scoped diversity tracker — 让 elect() 在同 mission
    // 内已选过的 modelId 按出现次数扣分，自然分布到多 provider
    if (this.electionTracker) {
      this.factory.setElectionTracker(this.electionTracker);
    }

    // v2: 把内置 loops 注册到 LoopRegistry。
    // AgentFactory.pickLoop(spec) 据此按 spec.loop 字段派发。
    this.loopRegistry.register(this.reactLoop);
    this.loopRegistry.register(this.planActLoop);
    this.loopRegistry.register(this.reflexionLoop);
    // ★ Phase live-fix (2026-04-30): 单步直答 loop（纯生成 / 评分类 agent 用）
    this.loopRegistry.register(this.simpleLoop);
    // PR-L: 五元环 loop
    this.loopRegistry.register(this.leaderWorkerLoop);

    // PR-B: 给 ReflexionLoop 注入默认 verifiers（self + critical）。
    // PR-I 必修 #3: 改用实例方法（之前是 static，影响测试隔离）
    const defaults = this.judgeService.createVerifiers(["self", "critical"]);
    this.reflexionLoop.setDefaultVerifiers(defaults);

    // PR-K: 默认把 LoggerBroadcastAdapter 装到 EventBus（业务方可后续注册更多）
    this.eventBus.registerAdapter(this.defaultBroadcaster);
    // 2026-06-03: 解散 notifications-bridge —— 通用 mission 完成→通知 桥接 adapter
    // （DomainEvent `*.mission:completed` → 持久化通知，业务细节由 emit 侧 payload 注入）。
    this.eventBus.registerAdapter(this.missionCompletionBroadcaster);
  }
}
